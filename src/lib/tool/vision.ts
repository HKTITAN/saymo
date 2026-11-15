import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

// Runs scripts/native/vision.swift: background removal and face finding with the
// Mac's own Vision framework. The helper is compiled once, on first use,
// into node_modules/.cache. Where Swift is missing every job reports
// "unavailable" and the tool carries on without it.

const run = promisify(execFile);
const SOURCE = path.join(process.cwd(), "scripts/native/vision.swift");
const BINARY = path.join(process.cwd(), "node_modules/.cache/speaker-post/vision");

const g = globalThis as { __visionBuild?: Promise<string | null> };

async function helper() {
  const [source, binary] = await Promise.all([stat(SOURCE), stat(BINARY).catch(() => null)]);
  if (binary && binary.mtimeMs >= source.mtimeMs) return BINARY;
  // One build at a time, however many uploads arrive together.
  g.__visionBuild ??= (async () => {
    try {
      await mkdir(path.dirname(BINARY), { recursive: true });
      await run("swiftc", ["-O", SOURCE, "-o", BINARY], { timeout: 120_000 });
      return BINARY;
    } catch (error) {
      console.error("Could not build the Vision helper:", error);
      return null;
    } finally {
      g.__visionBuild = undefined;
    }
  })();
  return g.__visionBuild;
}

// Writes `output` with the photo's subject on a transparent background.
export async function removeBackground(input: string, output: string) {
  const bin = await helper();
  if (!bin) return "unavailable" as const;
  try {
    await run(bin, ["cutout", input, output], { timeout: 60_000 });
    return "done" as const;
  } catch (error) {
    // Exit code 2: the photo has no clear subject to lift out.
    if ((error as { code?: number }).code === 2) return "no-subject" as const;
    console.error("Background removal failed:", error);
    return "unavailable" as const;
  }
}

export type Face = { x: number; y: number; width: number; height: number };

export async function findFace(input: string): Promise<Face | null> {
  const bin = await helper();
  if (!bin) return null;
  try {
    const { stdout } = await run(bin, ["face", input], { timeout: 30_000 });
    return JSON.parse(stdout) as Face | null;
  } catch (error) {
    console.error("Face finding failed:", error);
    return null;
  }
}
