import { spawn } from "node:child_process";
import { mkdirSync, openSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExportStatus } from "./doc";
import { postDir } from "./store";

// Runs `scripts/export.mjs --post <id>` for the tool, one post at a time:
// each export drives Chrome and ffmpeg at 4K, and two at once would only
// slow both down. Posts asked for meanwhile wait in line.

const g = globalThis as { __exports?: { queue: string[]; running: string | null } };
const jobs = (g.__exports ??= { queue: [], running: null });

export const exportDir = (id: string) => path.join(postDir(id), "export");

export function startExport(id: string) {
  if (jobs.running === id || jobs.queue.includes(id)) return;
  jobs.queue.push(id);
  next();
}

function next() {
  if (jobs.running || !jobs.queue.length) return;
  const id = jobs.queue.shift()!;
  jobs.running = id;
  const dir = exportDir(id);
  mkdirSync(dir, { recursive: true });
  // The last export's record goes, so any progress read from here on is
  // this export's.
  rmSync(path.join(dir, "progress.json"), { force: true });
  // The script's own output goes to a log beside the files, for when
  // something goes wrong.
  const log = openSync(path.join(dir, "log.txt"), "w");
  const child = spawn(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/export.mjs", "--post", id],
    { cwd: process.cwd(), stdio: ["ignore", log, log] },
  );
  let ended = false;
  const done = async (failed: boolean) => {
    if (ended) return;
    ended = true;
    // The script records its own success; a failure is recorded here, with
    // the last thing it said.
    if (failed) {
      const said = await readFile(path.join(dir, "log.txt"), "utf8").catch(() => "");
      const last = said.trim().split("\n").filter(Boolean).at(-1) ?? "";
      await writeFile(
        path.join(dir, "progress.json"),
        JSON.stringify({ state: "failed", error: last || "The export stopped." }),
      ).catch(() => {});
    }
    jobs.running = null;
    next();
  };
  child.on("exit", (code) => done(code !== 0));
  child.on("error", () => done(true));
}

type Progress =
  | { state: "running"; percent: number; startedAt: string }
  | Extract<ExportStatus, { state: "done" | "failed" }>;

export async function exportStatus(id: string): Promise<ExportStatus> {
  const at = jobs.queue.indexOf(id);
  if (at >= 0) return { state: "queued", ahead: at + (jobs.running ? 1 : 0) };
  const progress = await readFile(path.join(exportDir(id), "progress.json"), "utf8")
    .then((text) => JSON.parse(text) as Progress)
    .catch(() => null);
  if (jobs.running === id) {
    // Starting up: the script has not written its first progress yet.
    return progress ?? { state: "running", percent: 0, startedAt: "" };
  }
  // Marked running but nothing is: the server stopped in the middle.
  if (progress?.state === "running") {
    return { state: "failed", error: "The export stopped before it finished." };
  }
  return progress ?? { state: "none" };
}
