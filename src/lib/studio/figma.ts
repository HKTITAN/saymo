import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { kitDir } from "./brands";

// Brings a Figma file into a brand kit's guide/ folder for Claude to read:
// its colour and text styles as a short Markdown sheet, and its main
// frames as PNGs. Uses the Figma REST API with FIGMA_TOKEN from .env.local
// (a personal access token the owner adds once). The token stays on this
// server: it is never logged, written to disk, sent to the page or given
// to Claude.

const API = "https://api.figma.com/v1";
const MAX_FRAMES = 8;

export const figmaReady = () => Boolean(process.env.FIGMA_TOKEN?.trim());

// figma.com/file/<key>/…, /design/<key>/…, /proto/<key>/… or /board/<key>/…
export function figmaKey(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)figma\.com$/.test(u.hostname)) return null;
    const [, kind, key] = u.pathname.split("/");
    return ["file", "design", "proto", "board"].includes(kind) && /^[A-Za-z0-9]{10,64}$/.test(key ?? "") ? key : null;
  } catch {
    return null;
  }
}

async function figma<T>(route: string): Promise<T> {
  const res = await fetch(`${API}${route}`, { headers: { "X-Figma-Token": process.env.FIGMA_TOKEN?.trim() ?? "" } });
  if (res.status === 403 || res.status === 401) throw new Error("Figma refused: the token can't open this file. Use a token from an account that can open it.");
  if (res.status === 404) throw new Error("Figma couldn't find that file. Check the link.");
  if (!res.ok) throw new Error(`Figma answered with error ${res.status}. Try again in a moment.`);
  return (await res.json()) as T;
}

type Paint = { type: string; color?: { r: number; g: number; b: number; a?: number }; visible?: boolean };
type FigmaNode = {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  fills?: Paint[];
  style?: { fontFamily?: string; fontWeight?: number; fontSize?: number; lineHeightPx?: number; letterSpacing?: number };
};

const hex = (c: { r: number; g: number; b: number }) =>
  `#${[c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

const slug = (s: string) => s.normalize("NFKD").replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "frame";

// Pulls one file into guide/; returns a one-line summary for Claude, or
// throws with a plain message.
export async function pullFigma(kitId: string, url: string): Promise<string> {
  const key = figmaKey(url);
  if (!key) throw new Error("That doesn't look like a Figma file link.");
  const guide = path.join(kitDir(kitId), "guide");
  await mkdir(guide, { recursive: true });

  const file = await figma<{ name: string; document: FigmaNode; styles: Record<string, { name: string; styleType: string }> }>(
    `/files/${key}?depth=2`,
  );

  // Styles: the published colour and text styles, read from their nodes.
  const styleIds = Object.keys(file.styles ?? {}).slice(0, 200);
  const lines: string[] = [`# Figma: ${file.name}`, "", `Source: ${url}`, ""];
  if (styleIds.length) {
    const nodes = await figma<{ nodes: Record<string, { document: FigmaNode } | null> }>(
      `/files/${key}/nodes?ids=${encodeURIComponent(styleIds.join(","))}`,
    );
    const colours: string[] = [];
    const texts: string[] = [];
    for (const id of styleIds) {
      const meta = file.styles[id];
      const node = nodes.nodes[id]?.document;
      if (!meta || !node) continue;
      if (meta.styleType === "FILL") {
        const paint = node.fills?.find((f) => f.type === "SOLID" && f.visible !== false && f.color);
        if (paint?.color) colours.push(`- ${meta.name}: ${hex(paint.color)}${paint.color.a !== undefined && paint.color.a < 1 ? ` at ${Math.round(paint.color.a * 100)}%` : ""}`);
      } else if (meta.styleType === "TEXT" && node.style) {
        const s = node.style;
        texts.push(
          `- ${meta.name}: ${s.fontFamily ?? "?"} ${s.fontWeight ?? ""}, ${s.fontSize ?? "?"} px${s.lineHeightPx ? ` on ${Math.round(s.lineHeightPx)} px` : ""}${s.letterSpacing ? `, tracking ${s.letterSpacing}` : ""}`,
        );
      }
    }
    if (colours.length) lines.push("## Colour styles", "", ...colours, "");
    if (texts.length) lines.push("## Text styles", "", ...texts, "");
  } else lines.push("The file has no published colour or text styles.", "");

  // Frames: the top-level frames of the first pages, as PNG pictures.
  const frames: FigmaNode[] = [];
  for (const page of file.document.children ?? []) {
    for (const node of page.children ?? []) {
      if (["FRAME", "COMPONENT", "COMPONENT_SET", "SECTION"].includes(node.type)) frames.push(node);
      if (frames.length >= MAX_FRAMES) break;
    }
    if (frames.length >= MAX_FRAMES) break;
  }
  const saved: string[] = [];
  if (frames.length) {
    const images = await figma<{ images: Record<string, string | null> }>(
      `/images/${key}?ids=${encodeURIComponent(frames.map((f) => f.id).join(","))}&format=png&scale=1`,
    );
    for (const [i, frame] of frames.entries()) {
      const src = images.images[frame.id];
      if (!src) continue;
      const res = await fetch(src);
      if (!res.ok) continue;
      const name = `figma-${key.slice(0, 6)}-${String(i + 1).padStart(2, "0")}-${slug(frame.name)}.png`;
      await writeFile(path.join(guide, name), Buffer.from(await res.arrayBuffer()));
      saved.push(name);
    }
  }
  if (saved.length) lines.push("## Frames", "", ...saved.map((n) => `- guide/${n}`), "");
  const sheet = `figma-${key.slice(0, 6)}.md`;
  await writeFile(path.join(guide, sheet), `${lines.join("\n")}\n`);
  return `The Figma file "${file.name}" is in guide/${sheet} (its styles) with ${saved.length} frame picture${saved.length === 1 ? "" : "s"}.`;
}
