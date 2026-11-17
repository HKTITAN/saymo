import { inflateRawSync } from "node:zlib";

// Reads files out of a zip (a PowerPoint .pptx or an OpenDocument .odp is
// one), straight from its central directory: no extra package, nothing
// written to disk. Only "stored" and "deflated" entries, which is all
// Office and LibreOffice write. Sizes are capped so a crafted file can't
// make the server inflate gigabytes.

const MAX_ENTRY = 64 * 1024 * 1024;
const MAX_ENTRIES = 20_000;

export type Zip = {
  names: string[];
  list: () => ZipEntry[];
  has: (name: string) => boolean;
  read: (name: string) => Buffer | null;
  text: (name: string) => string | null;
};

// One file in a zip, as its listing gives it: `link` is a symbolic link
// (Unix mode bits in the external attributes).
export type ZipEntry = { name: string; size: number; link: boolean };

export class ZipError extends Error {}

export function openZip(data: Buffer): Zip {
  // The end of central directory record: the last "PK\x05\x06" within the
  // final 64 KB (a comment can follow it).
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65_535); i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ZipError("This file isn't a zip.");
  const count = data.readUInt16LE(end + 10);
  let at = data.readUInt32LE(end + 16);
  if (count > MAX_ENTRIES) throw new ZipError("This file holds too many parts.");
  const entries = new Map<string, { method: number; size: number; packed: number; local: number; link: boolean }>();
  for (let n = 0; n < count; n++) {
    if (at + 46 > data.length || data.readUInt32LE(at) !== 0x02014b50) throw new ZipError("This zip is damaged.");
    const method = data.readUInt16LE(at + 10);
    const packed = data.readUInt32LE(at + 20);
    const size = data.readUInt32LE(at + 24);
    const nameLength = data.readUInt16LE(at + 28);
    const extra = data.readUInt16LE(at + 30);
    const comment = data.readUInt16LE(at + 32);
    const local = data.readUInt32LE(at + 42);
    const link = ((data.readUInt32LE(at + 38) >>> 16) & 0o170000) === 0o120000;
    const name = data.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    entries.set(name, { method, size, packed, local, link });
    at += 46 + nameLength + extra + comment;
  }

  const read = (name: string): Buffer | null => {
    const e = entries.get(name);
    if (!e || e.size > MAX_ENTRY) return null;
    if (e.local + 30 > data.length || data.readUInt32LE(e.local) !== 0x04034b50) return null;
    const start = e.local + 30 + data.readUInt16LE(e.local + 26) + data.readUInt16LE(e.local + 28);
    const body = data.subarray(start, start + e.packed);
    try {
      if (e.method === 0) return Buffer.from(body);
      if (e.method === 8) return inflateRawSync(body, { maxOutputLength: MAX_ENTRY });
    } catch {
      return null;
    }
    return null;
  };

  return {
    names: [...entries.keys()],
    list: () => [...entries].map(([name, e]) => ({ name, size: e.size, link: e.link })),
    has: (name) => entries.has(name),
    read,
    text: (name) => read(name)?.toString("utf8") ?? null,
  };
}
