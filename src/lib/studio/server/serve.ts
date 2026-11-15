import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

// Hands a file on disk to the browser, with byte ranges so a <video> can
// seek in it.

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".jsx": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".aif": "audio/aiff",
  ".aiff": "audio/aiff",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

export const typeOf = (file: string) => TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";

export async function serveFile(request: Request, file: string, headers: Record<string, string> = {}) {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return new Response(null, { status: 404 });
  const base = { "Content-Type": typeOf(file), "Accept-Ranges": "bytes", "Cache-Control": "no-cache", ...headers };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
    }
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
      status: 206,
      headers: { ...base, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${info.size}` },
    });
  }
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: { ...base, "Content-Length": String(info.size) },
  });
}

// A path inside `root` from URL segments, or null if it would leave it or
// touch something that isn't the film's own (renders, history, builds,
// hidden files).
const HIDDEN = new Set(["out", "target", "node_modules"]);
export function inside(root: string, segments: string[]) {
  if (!segments.length) return null;
  if (segments.some((s) => !s || s.startsWith(".") || s.includes("\\") || s.includes("\0"))) return null;
  if (HIDDEN.has(segments[0])) return null;
  const file = path.resolve(root, ...segments);
  return file.startsWith(root + path.sep) ? file : null;
}
