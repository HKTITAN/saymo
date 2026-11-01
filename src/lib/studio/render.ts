import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RenderStatus } from "./contract";
import { outDir, ROOT } from "./films";
import { draftIsCurrent, newestChange } from "./stage";

// Renders films with `scripts/studio/render.mjs --film <id> [--draft]`, one
// at a time across the whole studio: every engine drives Chrome or the GPU
// flat out, and two renders at once only slow both. Films asked for
// meanwhile wait in line. Each film's latest status is kept in
// out/render.json, so it survives a restart of the server.

type Quality = "draft" | "final";
type Job = { id: string; quality: Quality };

const g = globalThis as {
  __studioRenders?: { queue: Job[]; running: (Job & { progress: number }) | null };
};
const jobs = (g.__studioRenders ??= { queue: [], running: null });

const statusFile = (id: string) => path.join(outDir(id), "render.json");

async function record(id: string, status: RenderStatus) {
  const file = statusFile(id);
  mkdirSync(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(status));
  await rename(`${file}.tmp`, file);
}

export function startRender(id: string, quality: Quality) {
  const same = (j: Job | null) => j?.id === id && j.quality === quality;
  if (same(jobs.running) || jobs.queue.some(same)) return;
  jobs.queue.push({ id, quality });
  next();
}

function next() {
  if (jobs.running || !jobs.queue.length) return;
  const job = jobs.queue.shift()!;
  jobs.running = { ...job, progress: 0 };
  const dir = outDir(job.id);
  mkdirSync(dir, { recursive: true });
  // The script's own words go to a log beside the files, for when something
  // goes wrong; its progress lines are read as they come.
  const log = openSync(path.join(dir, "render-log.txt"), "w");
  const child = spawn(
    process.execPath,
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "scripts/studio/render.mjs",
      "--film",
      job.id,
      ...(job.quality === "draft" ? ["--draft"] : []),
    ],
    { cwd: ROOT, stdio: ["ignore", "pipe", log] },
  );
  const files: string[] = [];
  let rest = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    const lines = (rest + chunk).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("progress ") && jobs.running) jobs.running.progress = Number(line.slice(9)) / 100;
      if (line.startsWith("wrote ")) files.push(path.basename(line.slice(6).trim()));
    }
  });
  let ended = false;
  const done = async (ok: boolean) => {
    if (ended) return;
    ended = true;
    const at = new Date().toISOString();
    if (ok) {
      await record(job.id, { state: "done", quality: job.quality, files, at }).catch(() => {});
    } else {
      const said = await readFile(path.join(dir, "render-log.txt"), "utf8").catch(() => "");
      await record(job.id, { state: "failed", message: plain(said), at }).catch(() => {});
    }
    jobs.running = null;
    next();
  };
  child.on("exit", (code) => done(code === 0));
  child.on("error", () => done(false));
}

// The last meaningful thing the renderer said, in a sentence.
function plain(log: string) {
  const lines = log
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("at ") && !/^node:|^Node\.js v/.test(l));
  const line = lines.find((l) => /error/i.test(l)) ?? lines.at(-1) ?? "";
  return line ? `The render stopped: ${line.slice(0, 240)}` : "The render stopped before it finished.";
}

export async function renderStatus(id: string): Promise<RenderStatus> {
  if (jobs.running?.id === id) return { state: "running", quality: jobs.running.quality, progress: jobs.running.progress };
  if (jobs.queue.some((j) => j.id === id)) return { state: "queued" };
  const saved = await readFile(statusFile(id), "utf8")
    .then((text) => JSON.parse(text) as RenderStatus)
    .catch(() => null);
  return saved ?? { state: "idle" };
}

// For the stage of a Rust film, which plays its draft: is the draft
// current, and if not, one is asked for. A draft that failed for the
// film as it is now isn't retried until the film changes.
export async function ensureDraft(id: string): Promise<RenderStatus & { current: boolean }> {
  if (await draftIsCurrent(id)) {
    const at = (await stat(path.join(outDir(id), "draft.mp4"))).mtime.toISOString();
    return { state: "done", quality: "draft", files: ["draft.mp4"], at, current: true };
  }
  const status = await renderStatus(id);
  if (status.state === "running" || status.state === "queued") return { ...status, current: false };
  if (status.state === "failed" && (await failedSinceChange(id, status.at))) return { ...status, current: false };
  startRender(id, "draft");
  return { ...(await renderStatus(id)), current: false };
}

async function failedSinceChange(id: string, at: string) {
  return Date.parse(at) >= (await newestChange(id));
}
