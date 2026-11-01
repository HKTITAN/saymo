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

// A part of a video film's edit (a clip or a graphic, picked by the studio
// from the timeline): its name is already readable, and times read like the
// timeline's, "Clip 2 · 0:12.40".
const fromEdit = (pick: Picked) => pick.tag === "clip" || pick.tag === "graphic";

const clockTime = (t: number) => {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(2).padStart(5, "0")}`;
};

export const chipLabel = (pick: Picked | null, t: number) =>
  pick
    ? fromEdit(pick)
      ? `${(pick.text ?? "This part").split(" (")[0]} · ${clockTime(t)}`
      : `${pickName(pick)} · ${seconds(t)}`
    : `At ${clockTime(t)}`;
