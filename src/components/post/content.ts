// What a speaker post shows. The original post's words live in
// src/content/post.ts.
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
  // Centres the headline, the when and where, and the speaker as one block
  // across the stone side, instead of setting them at the left margin.
  centred?: boolean;
  // Moves the centred block sideways, as a share of the stone side's width:
  // -0.05 is 5% to the left.
  shift?: number;
  // The orange "o" in the wordmark turns over when the colour behind it
  // changes. False keeps it still; it only changes colour.
  logoFlip?: boolean;
  // "no-black" moves the panel between orange and stone only (stone comes in
  // wherever black would); "no-orange" between black and stone only;
  // "orange-low" keeps the top half stone and lets orange into the lower
  // half only.
  // "orange-once" (Scenes only): orange rise, black sweep, stone burst,
  // black back, so orange comes in once a loop.
  panelColors?: "all" | "no-black" | "no-orange" | "orange-low" | "orange-once";
  // Where the viewer and the exported video start, in seconds into the loop.
  // Left out, they start on the motion's still frame.
  videoStart?: number;
  // Draws the logo row smaller (0.9 is 90%), still ending at the right margin.
  logoScale?: number;
  // Post pixels the line panel gives up on its left, to widen the words'
  // side.
  panelCut?: number;
  // How Scenes moves: "refined" (the default, softer landings) or
  // "reference" (as measured from the reference video).
  look?: "reference" | "refined";
  // Used for the exported file names.
  slug: string;
};
