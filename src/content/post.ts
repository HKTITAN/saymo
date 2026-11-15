// Everything that changes from one speaker post to the next lives here.
// To make the next post: swap the title lines and the speaker, then run
// `node scripts/post/photo.mjs ...` for the new photo (see README).

export const post = {
  // Each entry is one line of the headline, broken where it reads best, in
  // sentence case: capitals only for names and the first word after the colon.
  // All in SemiBold: the first line at full strength, the others at 60%.
  title: ["Motion by talking:", "How a Small Team", "Ships Launch Films", "Every Week"],
  // 20% under the standard 86px, so the longer headline sits back.
  titleSize: 68.8,
  // The headline, when and where, and speaker sit at the left margin (72),
  // the same as the headline's gap from the top and the photo's from the
  // bottom, so the stone side has one even margin on three sides.
  centred: false,
  shift: 0,
  // The "o" in the wordmark stays still instead of turning over.
  logoFlip: false,
  // Orange comes in once a loop (orange rise, black sweep, stone burst,
  // black back), and the video starts on black, just before the rise.
  panelColors: "orange-once",
  videoStart: 0,
  // The line panel 10% narrower (828 wide); the logo row at 92% to fit it.
  panelCut: 92,
  logoScale: 0.92,
  speaker: {
    name: "Alex Morgan",
    role: "Head of Design",
    company: "Studio North",
    // A square photo at 1x and 2x (make them with `node scripts/post/photo.mjs`);
    // null leaves an empty tile.
    photo: null,
  },
  // When and where, above the speaker: each with an icon, a small label and
  // two lines, written as they should read. `accent` is set in orange.
  event: [
    { id: "date", label: "Date", lines: ["12th March,", "2027"] },
    {
      id: "location",
      label: "Location",
      lines: ["Hyatt Regency,", "New Delhi"],
      accent: "New Delhi",
    },
  ],
  // The landmark stands at the foot of the line panel. Make its files with
  // `node scripts/post/skyline.mjs ...` (see README).
  skyline: {
    landmark: "India Gate",
    x1: "/places/new-delhi-920.png",
    x2: "/places/new-delhi-1840.png",
    // Where it stands, in post pixels: x moves it sideways, y lifts it (below
    // zero it sinks), and scale grows it from its foot. The viewer and the
    // export both read it from here.
    place: { x: 0, y: 0, scale: 1 },
  },
  // Used for the exported file names.
  slug: "alex-morgan",
} as const;

export type Post = typeof post;
