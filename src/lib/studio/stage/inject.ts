// What every HTML film is given before its own scripts run, both on the
// stage and in a render: window.__film (size, fps, length from film.json)
// and window.__params (the panel's values). Also keeps the composition's
// own data-width/height/duration/fps in step with film.json, which is what
// HyperFrames reads.
//
// Plain TypeScript with no `@/` imports: scripts/studio/render.mjs imports
// it straight from Node.

import type { Film, Param } from "../films/contract";

export type FilmGlobals = Pick<Film, "width" | "height" | "fps" | "duration">;

export function paramValues(film: Pick<Film, "params">): Record<string, Param["value"]> {
  return Object.fromEntries((film.params ?? []).map((p) => [p.key, p.value]));
}

// JSON safe to put inside a <script>: no way to close the tag early, and
// no line or paragraph separators (which old parsers took as line ends).
const UNSAFE = new RegExp(`[<${String.fromCharCode(0x2028, 0x2029)}]`, "g");
export const scriptJson = (value: unknown) =>
  JSON.stringify(value).replace(UNSAFE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

export function globalsScript(film: FilmGlobals, params: Record<string, Param["value"]>) {
  const size = { width: film.width, height: film.height, fps: film.fps, duration: film.duration };
  return `<script>window.__film=${scriptJson(size)};window.__params=${scriptJson(params)};</script>`;
}

// Puts `snippet` first thing in <head>, ahead of every script of the film.
export function intoHead(html: string, snippet: string) {
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + snippet + html.slice(head.index + head[0].length);
  const doc = /<html(\s[^>]*)?>/i.exec(html);
  if (doc) return html.slice(0, doc.index + doc[0].length) + `<head>${snippet}</head>` + html.slice(doc.index + doc[0].length);
  return snippet + html;
}

// Sets data-width, data-height, data-duration and data-fps on the root
// composition (the first element with data-composition-id) from film.json.
export function syncRoot(html: string, film: FilmGlobals) {
  const tag = /<[a-z][\w-]*\b[^>]*\bdata-composition-id\s*=\s*["'][^"']*["'][^>]*>/i.exec(html);
  if (!tag) return html;
  let open = tag[0];
  const set = (name: string, value: number) => {
    const attr = new RegExp(`\\s${name}\\s*=\\s*["'][^"']*["']`, "i");
    open = attr.test(open)
      ? open.replace(attr, ` ${name}="${value}"`)
      : open.replace(/\s*\/?>$/, (end) => ` ${name}="${value}"${end}`);
  };
  set("data-width", film.width);
  set("data-height", film.height);
  set("data-duration", film.duration);
  set("data-fps", film.fps);
  return html.slice(0, tag.index) + open + html.slice(tag.index + tag[0].length);
}

// The film's brand kit (brand.ts BrandTokens) as window.__brand, with
// @font-face rules for its fonts, so the film draws with the brand's
// colours, type and logos. Its font and logo URLs are already resolved.
export function brandScript(tokens: unknown, faces: string) {
  return `<script>window.__brand=${scriptJson(tokens)};</script>${faces ? `<style>${faces.replace(/<\//g, "<\\/")}</style>` : ""}`;
}

// The film's index.html as the renderer (or the stage, with its bridge
// added) should load it.
export function prepareHtml(html: string, film: FilmGlobals, params: Record<string, Param["value"]>, extra = "") {
  return intoHead(syncRoot(html, film), globalsScript(film, params) + extra);
}
