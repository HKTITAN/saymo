import type { Engine, Film, FilmEdit, Param } from "./contract";

// Checks what the studio page sends before it reaches a film. Anything
// that doesn't fit is dropped or refused with a sentence that says why.

const ENGINES: Engine[] = ["html", "react", "rust"];
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const size = (v: unknown) => (Number.isInteger(v) && (v as number) >= 16 && (v as number) <= 4096 && (v as number) % 2 === 0 ? (v as number) : null);

export type NewFilm = { title?: string; engine?: Engine; kind?: "motion" | "video"; width?: number; height?: number };

export function newFilm(body: unknown): NewFilm | string {
  if (body === null || body === undefined) return {};
  if (!isObject(body)) return "Send the new film's settings as an object.";
  const out: NewFilm = {};
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) return "Give the film a name.";
    out.title = body.title.trim().slice(0, 120);
  }
  if (body.engine !== undefined) {
    if (!ENGINES.includes(body.engine as Engine)) return "That isn't a kind of film the studio makes.";
    out.engine = body.engine as Engine;
  }
  if (body.kind !== undefined) {
    if (body.kind !== "motion" && body.kind !== "video") return "A film is either motion or a video edit.";
    out.kind = body.kind;
  }
  for (const k of ["width", "height"] as const) {
    if (body[k] === undefined) continue;
    const v = size(body[k]);
    if (v === null) return "Width and height are even whole pixels, from 16 to 4096.";
    out[k] = v;
  }
  return out;
}

function paramValue(p: Param, v: unknown): Param["value"] | undefined {
  switch (p.type) {
    case "number": {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) return undefined;
      return Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, n));
    }
    case "color":
      return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : undefined;
    case "text":
      return typeof v === "string" ? v.slice(0, 2000) : undefined;
    case "toggle":
      return typeof v === "boolean" ? v : undefined;
    case "choice":
      return typeof v === "string" && (p.options ?? []).includes(v) ? v : undefined;
  }
}

export function filmEdit(film: Film, body: unknown): FilmEdit | string {
  if (!isObject(body)) return "Nothing to save.";
  const out: FilmEdit = {};
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) return "Give the film a name.";
    out.title = body.title.trim().slice(0, 120);
  }
  for (const k of ["width", "height"] as const) {
    if (body[k] === undefined) continue;
    const v = size(body[k]);
    if (v === null) return "Width and height are even whole pixels, from 16 to 4096.";
    out[k] = v;
  }
  if (body.fps !== undefined) {
    if (!Number.isInteger(body.fps) || (body.fps as number) < 1 || (body.fps as number) > 120) return "Frames per second go from 1 to 120.";
    out.fps = body.fps as number;
  }
  if (body.duration !== undefined) {
    const d = Number(body.duration);
    if (!Number.isFinite(d) || d < 0.5 || d > 120) return "A film runs from half a second to two minutes.";
    out.duration = Math.round(d * 1000) / 1000;
  }
  // The brand kit the film follows (brand.ts); the route checks it exists.
  if (body.brand !== undefined) {
    if (typeof body.brand !== "string" || !/^[a-z0-9][a-z0-9-]{2,31}$/.test(body.brand)) return "That isn't a brand kit.";
    out.brand = body.brand;
  }
  if (body.params !== undefined) {
    if (!isObject(body.params)) return "Send the values as an object, by name.";
    const params: Record<string, Param["value"]> = {};
    for (const [key, raw] of Object.entries(body.params)) {
      const p = film.params.find((q) => q.key === key);
      if (!p) continue;
      const v = paramValue(p, raw);
      if (v === undefined) return `That isn't a value "${p.label}" can take.`;
      params[key] = v;
    }
    out.params = params;
  }
  return out;
}
