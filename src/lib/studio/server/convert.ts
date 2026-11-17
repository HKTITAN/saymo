import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { openZip } from "../input/zip";
import { IS_MAC } from "./platform";

// File conversions the studio needs on every computer, each in one place.

const run = (cmd: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let err = "";
    proc.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `${cmd} failed`))));
  });

// A phone photo (HEIC or HEIF) as a JPEG: the Mac's sips, else ffmpeg
// (sharp's own build can't read HEIC).
export async function heicToJpeg(input: string, output: string) {
  // eslint-disable-next-line no-restricted-syntax -- Mac only; ffmpeg below elsewhere
  if (IS_MAC) return run("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "95", input, "--out", output]);
  return run("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-frames:v", "1", "-q:v", "2", output]);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? m),
  );

// A Word file's words, one paragraph a line, read from the document inside
// it (word/document.xml): runs of text, tabs and line breaks.
export async function docxText(file: string): Promise<string> {
  const xml = openZip(await readFile(file)).text("word/document.xml");
  if (xml === null) throw new Error("This Word file has no document inside it.");
  return xml
    .split(/<\/w:p>/)
    .map((p) =>
      decode(
        p
          .replace(/<w:tab\/>/g, "<w:t>\t</w:t>")
          .replace(/<w:(br|cr)\/>/g, "<w:t>\n</w:t>")
          .replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g, "\u0000$1\u0000")
          .split("\u0000")
          .filter((_, i) => i % 2 === 1)
          .join(""),
      ),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
