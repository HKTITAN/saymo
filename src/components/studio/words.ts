import type { Picked } from "@/lib/studio/contract";

// What was pointed at, and when.
export type Pinned = { pick: Picked; t: number };

// Small pieces of interface copy built from data.

// 2.4 → "2.40 s"
export const seconds = (t: number) => `${t.toFixed(2)} s`;

// What a picked element is called in the chip: its words if it has some,
// else its id made readable ("title-line" → "Title line"), else its kind.
export function pickName(pick: Picked) {
  if (pick.text) {
    const words = pick.text.replace(/\s+/g, " ").trim();
    return words.length > 26 ? `“${words.slice(0, 24).trimEnd()}…”` : `“${words}”`;
  }
  if (pick.id && !/^hf-/.test(pick.id)) {
    const name = pick.id.replace(/[-_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }
  if (pick.tag) return TAGS[pick.tag.toLowerCase()] ?? "This shape";
  return "This spot";
}

const TAGS: Record<string, string> = {
  text: "This text",
  tspan: "This text",
  p: "This text",
  span: "This text",
  h1: "This heading",
  h2: "This heading",
  img: "This picture",
  image: "This picture",
  video: "This video",
  svg: "This drawing",
  g: "This group",
  rect: "This shape",
  path: "This shape",
  circle: "This circle",
  div: "This box",
  section: "This section",
};

export const chipLabel = (pick: Picked | null, t: number) => (pick ? `${pickName(pick)} · ${seconds(t)}` : `At ${seconds(t)}`);
