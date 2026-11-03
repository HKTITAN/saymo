// Reads a font file's family name and weights in the browser, so an
// uploaded face is named and described the way the kit needs it. TTF and
// OTF are read directly; WOFF2 is compressed, so its name comes from the
// file name and the browser fills in the rest.

export type FontInfo = { family: string; weights: string; axes?: string };

const WEIGHT_WORDS = /[-_ ]?(thin|hairline|extralight|ultralight|light|regular|book|normal|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|italic|oblique|variable|vf|var)\b/gi;

// "MyFont-Bold.woff2" → "MyFont"; "space_mono-regular" → "Space Mono".
export function familyFromName(name: string) {
  const base = name
    .replace(/\.[^.]+$/, "")
    .replace(/\[.*?\]/g, "")
    .replace(WEIGHT_WORDS, "")
    .replace(/[-_ ][1-9]00\b/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .trim();
  return base ? base.replace(/\b\w/g, (c) => c.toUpperCase()) : "Uploaded font";
}

const tag = (v: DataView, at: number) => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));

function readSfnt(buffer: ArrayBuffer): Partial<FontInfo> {
  const v = new DataView(buffer);
  const flavour = tag(v, 0);
  if (flavour !== "\0\x01\0\0" && flavour !== "OTTO" && flavour !== "true") return {};
  const count = v.getUint16(4);
  const tables = new Map<string, number>();
  for (let i = 0; i < count; i++) tables.set(tag(v, 12 + i * 16), v.getUint32(12 + i * 16 + 8));
  const out: Partial<FontInfo> = {};

  const name = tables.get("name");
  if (name !== undefined) {
    const n = v.getUint16(name + 2);
    const strings = name + v.getUint16(name + 4);
    const found = new Map<number, string>();
    for (let i = 0; i < n; i++) {
      const r = name + 6 + i * 12;
      const platform = v.getUint16(r);
      const id = v.getUint16(r + 6);
      if (platform !== 3 || (id !== 1 && id !== 16) || found.has(id)) continue;
      const len = v.getUint16(r + 8);
      const off = strings + v.getUint16(r + 10);
      let s = "";
      for (let j = 0; j + 1 < len; j += 2) s += String.fromCharCode(v.getUint16(off + j));
      found.set(id, s);
    }
    const family = (found.get(16) ?? found.get(1))?.trim();
    if (family) out.family = family;
  }

  const fvar = tables.get("fvar");
  if (fvar !== undefined) {
    const axesAt = fvar + v.getUint16(fvar + 4);
    const axisCount = v.getUint16(fvar + 8);
    const size = v.getUint16(fvar + 10);
    const axes: string[] = [];
    for (let i = 0; i < axisCount; i++) {
      const a = axesAt + i * size;
      const fixed = (o: number) => Math.round(v.getInt32(a + o) / 65536);
      const t = tag(v, a).trim();
      const [min, max] = [fixed(4), fixed(12)];
      axes.push(`${t} ${min}-${max}`);
      if (t === "wght") out.weights = `${String(Math.max(100, min)).padStart(3, "0")} ${String(Math.min(900, max)).padStart(3, "0")}`;
    }
    if (axes.length) out.axes = axes.join(", ");
  } else {
    const os2 = tables.get("OS/2");
    if (os2 !== undefined) {
      const w = v.getUint16(os2 + 4);
      if (w >= 100 && w <= 900) out.weights = String(w);
    }
  }
  return out;
}

export async function readFontFile(file: File): Promise<FontInfo & { buffer: ArrayBuffer }> {
  const buffer = await file.arrayBuffer();
  let info: Partial<FontInfo> = {};
  try {
    info = readSfnt(buffer);
  } catch {}
  return { buffer, family: info.family || familyFromName(file.name), weights: info.weights ?? "400", ...(info.axes ? { axes: info.axes } : {}) };
}
