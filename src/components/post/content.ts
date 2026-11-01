// What a speaker post shows. The original post's words live in
// src/content/post.ts; each post made in the tool lives in posts/<id>/.
export type PostContent = {
  // Each entry is one line of the headline, broken where it reads best.
  title: readonly string[];
  // The headline's size in post pixels: 86, unless the tool shrank a long
  // headline to fit.
  titleSize?: number;
  speaker: {
    name: string;
    role: string;
    company: string;
    // The square tile at 1x and 2x; null leaves an empty tile.
    photo: { x1: string; x2: string } | null;
  };
  // When and where: each with a small label and two lines. `accent` is set
  // in orange: a run of text as written ("Kuala Lumpur"), or a list of
  // words picked in the tool, each orange wherever it appears.
  event: readonly {
    id: "date" | "location";
    label: string;
    lines: readonly string[];
    accent?: string | readonly string[];
  }[];
  // The landmark at the foot of the line panel, or null for lines only.
  skyline: {
    landmark: string;
    x1: string;
    x2: string;
    // Its size on the post at a scale of 1, in post pixels, standing centred
    // on the panel's bottom edge. Left out, it is the whole panel.
    width?: number;
    height?: number;
    // x moves it sideways, y lifts it (below zero it sinks), and scale grows
    // it from its foot.
    place: { x: number; y: number; scale: number };
  } | null;
  // Used for the exported file names.
  slug: string;
};
