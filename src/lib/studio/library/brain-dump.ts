import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { STUDIO_DIR } from "../connect/connect-store";

// The brain dump on the Ideas page: one free page of notes, anything at
// all, before it's an idea. Kept on this Mac in .studio/brain-dump.json.

const FILE = path.join(STUDIO_DIR, "brain-dump.json");
export const MAX_DUMP = 20000;

export async function readDump(): Promise<string> {
  try {
    const d = JSON.parse(await readFile(FILE, "utf8")) as { text?: unknown };
    return typeof d.text === "string" ? d.text : "";
  } catch {
    return "";
  }
}

export async function writeDump(text: string) {
  await mkdir(STUDIO_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ text: text.slice(0, MAX_DUMP) }, null, 2)}\n`);
  await rename(tmp, FILE);
}
