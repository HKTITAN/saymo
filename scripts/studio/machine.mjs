// Sizes a render to the Mac it runs on. Every teammate runs the studio on
// their own Mac, from an 8 GB MacBook Air to a Mac Studio, so nothing here
// is fixed to one machine: it looks at the cores, the memory and the
// encoders ffmpeg has, and picks
//
//   workers   how many Chrome pages draw frames at once (HyperFrames,
//             Remotion and our own capture all take this number)
//   encoders  what makes each file: Apple's hardware encoder (VideoToolbox)
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
// Override on one Mac in .env.local or the shell:
//   STUDIO_WORKERS=4            draw with 4 workers
//   STUDIO_ENCODER=x264         never use the hardware encoder

import { spawn, spawnSync } from "node:child_process";
import os from "node:os";

const sysctl = (key) => {
  const r = spawnSync("sysctl", ["-n", key], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
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
  const cores = Number(sysctl("hw.physicalcpu")) || os.availableParallelism();
  const memoryGb = os.totalmem() / 2 ** 30;
  // True on Apple silicon even when Node itself runs under Rosetta.
  const appleSilicon = sysctl("hw.optional.arm64") === "1";
  const forceX264 = /^x264$/i.test(process.env.STUDIO_ENCODER ?? "");
  const [vtQuality, vtBitrate] = forceX264
    ? [false, false]
    : await Promise.all([
        encodes(["-c:v", "h264_videotoolbox", "-q:v", "90", "-profile:v", "high"]),
        encodes(["-c:v", "h264_videotoolbox", "-b:v", "8M", "-profile:v", "high"]),
      ]);
  return {
    cores,
    memoryGb,
    appleSilicon,
    model: sysctl("machdep.cpu.brand_string") || os.cpus()[0]?.model || "this Mac",
    // A final's big file: hardware where its quality mode works (Apple
    // silicon), so it matches x264 at a third of the time.
    finalVideoToolbox: appleSilicon && vtQuality,
    // A draft only checks the timing: hardware wherever it encodes at all.
    draftVideoToolbox: vtBitrate,
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
  `final 4K ${m.finalVideoToolbox ? "VideoToolbox" : "x264"}, draft ${m.draftVideoToolbox ? "VideoToolbox" : "x264"}`;
