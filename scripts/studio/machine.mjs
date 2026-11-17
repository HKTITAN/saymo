// Sizes a render to the computer it runs on. Every teammate runs the studio
// on their own Mac or PC, from an 8 GB MacBook Air to a Mac Studio or a
// gaming laptop, so nothing here is fixed to one machine: it looks at the
// cores, the memory and the encoders ffmpeg has, and picks
//
//   workers   how many Chrome pages draw frames at once (HyperFrames,
//             Remotion and our own capture all take this number)
//   encoders  what makes each file: the hardware encoder (Apple's
//             VideoToolbox, NVIDIA's NVENC, Intel's Quick Sync, AMD's AMF)
//             where it is there and measures as good, x264 everywhere else
//
// Measured on an M5 with 16 GB, a 29 s 4K film at 60 fps (see
// docs/studio.md, "How renders are made fast"):
//   - 5 Chrome workers drew it in 41 s, 8 in 34 s, 10 in 36 s: past the
//     cores minus two, more workers only fight each other.
//   - Each 4K worker held about 0.45 GB; at 1080p about half that.
//   - VideoToolbox at quality 90 encoded the 4K file 2.6x as fast as x264
//     slow, measuring at least as close to the lossless frames (SSIM
//     0.99986 against 0.99966; 100% crops of text and hairlines matched
//     within 0.5 dB), so a final uses it on Apple silicon. On Intel Macs
//     its quality mode isn't there and x264 does the 4K as before.
//
// Measured on an RTX 3050 laptop (Windows), a 4 s 4K clip at 60 fps of
// moving test pattern under a 1 px grid:
//   - NVENC (preset p7, hq, at the 120 Mb/s ceiling) encoded it in 7.2 s,
//     x264 slow CRF 14 in 58.7 s, and NVENC measured at least as close to
//     the lossless frames (SSIM 0.99153 against 0.99119), so a final uses
//     it where it's there. Quick Sync and AMF are used for drafts only,
//     until someone measures them.
//
// Override on one Mac in .env.local or the shell:
//   STUDIO_WORKERS=4            draw with 4 workers
//   STUDIO_ENCODER=x264         never use the hardware encoder

import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import { IS_MAC, IS_WINDOWS } from "./platform.mjs";

const sysctl = (key) => {
  if (!IS_MAC) return "";
  // eslint-disable-next-line no-restricted-syntax -- Mac only; Windows: windowsCores() and os
  const r = spawnSync("sysctl", ["-n", key], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
};

// Real cores (not threads) on Windows, as sysctl gives on the Mac.
const windowsCores = () => {
  if (!IS_WINDOWS) return 0;
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", "(Get-CimInstance Win32_Processor | Measure-Object NumberOfCores -Sum).Sum"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return Number(r.stdout?.trim()) || 0;
};

// Each hardware encoder: how to test it, and the settings a draft (only
// timing is checked) and a final (when measured as good as x264) use at
// `rate` Mb/s.
export const HARDWARE = {
  h264_videotoolbox: {
    test: ["-b:v", "8M"],
    draft: (rate) => ["-b:v", `${rate}M`],
    final: (rate) => ["-b:v", `${rate}M`],
  },
  h264_nvenc: {
    test: ["-preset", "p4", "-b:v", "8M"],
    draft: (rate) => ["-preset", "p4", "-rc", "vbr", "-b:v", `${rate}M`],
    final: (rate) => ["-preset", "p7", "-tune", "hq", "-rc", "vbr", "-spatial-aq", "1", "-b:v", `${rate}M`],
  },
  h264_qsv: { test: ["-b:v", "8M"], draft: (rate) => ["-b:v", `${rate}M`], final: null },
  h264_amf: { test: ["-b:v", "8M"], draft: (rate) => ["-b:v", `${rate}M`], final: null },
};

// Does ffmpeg encode a few small frames with these settings? An encoder can
// be listed and still refuse (no hardware for it, or an option it lacks).
const encodes = (args) =>
  new Promise((resolve) => {
    const p = spawn(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=256x144:r=30", "-frames:v", "4",
        "-vf", "format=yuv420p", ...args, "-f", "null", "-"],
      { stdio: "ignore" },
    );
    const timer = setTimeout(() => p.kill("SIGKILL"), 10_000);
    p.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    p.on("error", () => resolve(false));
  });

let found = null;

export function machine() {
  return (found ??= look());
}

async function look() {
  const cores = Number(sysctl("hw.physicalcpu")) || windowsCores() || os.availableParallelism();
  const memoryGb = os.totalmem() / 2 ** 30;
  // True on Apple silicon even when Node itself runs under Rosetta.
  const appleSilicon = sysctl("hw.optional.arm64") === "1";
  const forceX264 = /^x264$/i.test(process.env.STUDIO_ENCODER ?? "");
  const [vtQuality, vtBitrate] = forceX264 || !IS_MAC
    ? [false, false]
    : await Promise.all([
        encodes(["-c:v", "h264_videotoolbox", "-q:v", "90", "-profile:v", "high"]),
        encodes(["-c:v", "h264_videotoolbox", "-b:v", "8M", "-profile:v", "high"]),
      ]);
  // Off the Mac: the first of the GPU's encoders that encodes at all.
  let pc = null;
  if (!IS_MAC && !forceX264) {
    for (const name of ["h264_nvenc", "h264_qsv", "h264_amf"]) {
      if (await encodes(["-c:v", name, ...HARDWARE[name].test, "-profile:v", "high"])) {
        pc = name;
        break;
      }
    }
  }
  return {
    cores,
    memoryGb,
    appleSilicon,
    model: sysctl("machdep.cpu.brand_string") || os.cpus()[0]?.model?.trim() || "this computer",
    // A final's big file: hardware where it measures as good as x264 (Apple
    // silicon, NVIDIA), at a fraction of the time.
    finalEncoder: appleSilicon && vtQuality ? "h264_videotoolbox" : pc && HARDWARE[pc].final ? pc : null,
    // A draft only checks the timing: hardware wherever it encodes at all.
    draftEncoder: vtBitrate ? "h264_videotoolbox" : pc,
  };
}

// How many pages draw frames at once, for frames `scale` times the film's
// size. Leaves two cores for ffmpeg, the studio and the Mac, and keeps
// about 6.5 GB free for macOS, the studio, your browser and Claude, so an
// 8 GB Mac draws a 4K film with 2 pages rather than swapping.
export function workersFor(m, scale) {
  const own = Number(process.env.STUDIO_WORKERS);
  if (Number.isInteger(own) && own > 0) return own;
  const perWorkerGb = scale >= 2 ? 0.6 : 0.35;
  const byMemory = Math.floor((m.memoryGb - 6.5) / perWorkerGb);
  const byCores = m.cores - 2;
  return Math.max(1, Math.min(8, byCores, byMemory));
}

// One line for the render log, so a slow render on someone's Mac can be
// read back.
export const describe = (m, workers) =>
  `machine: ${m.model}, ${m.cores} cores, ${Math.round(m.memoryGb)} GB; ${workers} workers; ` +
  `final 4K ${m.finalEncoder ?? "x264"}, draft ${m.draftEncoder ?? "x264"}`;
