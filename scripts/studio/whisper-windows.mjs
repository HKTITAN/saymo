// whisper.cpp on Windows: the project's own prebuilt programs, put where
// the Mac's build puts them (<to>/build/bin, as whisper-cli.exe and so on),
// so transcribe.mjs and dictation.ts find them the same way. The Mac builds
// whisper.cpp from source with Metal; on Windows a build needs Visual
// Studio, so the release's programs are used instead: CUDA on an NVIDIA
// card (about as fast as Metal), the CPU build everywhere else.
//
// whisper.cpp publishes its Windows programs on the build tag made with
// each release; b5454 is the one made with v1.9.5. Each download is
// checked against the SHA-256 GitHub lists for it before it's opened.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const BUILD = "b5454";
const BUILDS = {
  cpu: { file: "whisper-bin-x64.zip", sha256: "6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb" },
  cuda: { file: "whisper-bin-win-cuda-11.8.0-x64.zip", sha256: "e81c86c542be6e3d7b7245392d4e1c52ab6e5c61dbe38721754bc0ab59d4d027" },
  arm64: { file: "whisper-bin-win-cpu-arm64.zip", sha256: "28c37e7b598c3d9bbfef94f3bd67f2ee6f12b7c86f3da5edcf5e4308d615ff6d" },
};

// An NVIDIA card with a working driver. STUDIO_WHISPER_GPU=off picks the
// CPU build anyway.
const nvidia = () =>
  process.env.STUDIO_WHISPER_GPU !== "off" && spawnSync("nvidia-smi", ["-L"], { stdio: "ignore", windowsHide: true }).status === 0;

export function whisperBuild() {
  if (process.arch === "arm64") return BUILDS.arm64;
  return nvidia() ? BUILDS.cuda : BUILDS.cpu;
}

export async function installWhisperWindows(to, onProgress = () => {}) {
  const build = whisperBuild();
  await mkdir(to, { recursive: true });
  const zip = path.join(to, build.file);
  const res = await fetch(`https://github.com/ggml-org/whisper.cpp/releases/download/${BUILD}/${build.file}`);
  if (!res.ok || !res.body) throw new Error(`whisper.cpp download failed (${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  const hash = createHash("sha256");
  let done = 0;
  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk) => {
    hash.update(chunk);
    done += chunk.length;
    onProgress(done, total);
  });
  await pipeline(body, createWriteStream(zip));
  if (hash.digest("hex") !== build.sha256) {
    await rm(zip, { force: true });
    throw new Error(`${build.file} didn't match its published SHA-256`);
  }
  // Windows' own unzip; the paths go through the environment, never the
  // command, so they can't be read as PowerShell.
  await new Promise((resolve, reject) => {
    const p = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "Expand-Archive -Force -LiteralPath $env:STUDIO_ZIP -DestinationPath $env:STUDIO_TO -ErrorAction Stop"],
      { env: { ...process.env, STUDIO_ZIP: zip, STUDIO_TO: to }, stdio: "ignore", windowsHide: true },
    );
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`unzipping ${build.file} failed`))));
  });
  await rm(zip, { force: true });
  await mkdir(path.join(to, "build"), { recursive: true });
  await rename(path.join(to, "Release"), path.join(to, "build", "bin"));
}
