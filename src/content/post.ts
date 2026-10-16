// Everything that changes from one speaker post to the next lives here.
// To make the next post: swap the title lines and the speaker, then run
// `node scripts/photo.mjs ...` for the new photo (see README).

export const post = {
  // Each entry is one line of the headline, broken where it reads best, in
  // sentence case: capitals only for names and the first word after the colon.
  // All in SemiBold: the first line at full strength, the others at 60%.
  title: ["SpendOS:", "Redefining how", "procurement thinks,", "decides & acts"],
  speaker: {
    name: "Darshan Kadam",
    role: "Principal Advisor, AI Procurement Strategy",
    company: "Aerchain",
    photo: {
      x1: "/speakers/darshan-kadam-240.png",
      x2: "/speakers/darshan-kadam-480.png",
    },
  },
  // When and where, above the speaker: each with an icon, a small label and
  // two lines, written as they should read. `accent` is set in orange.
  event: [
    { id: "date", label: "Date", lines: ["Tuesday,", "20th & 21st October 2026"] },
    {
      id: "location",
      label: "Location",
      lines: ["Renaissance Kuala Lumpur", "Hotel & Convention Centre"],
      accent: "Kuala Lumpur",
    },
  ],
  // The landmark stands at the foot of the line panel. Make its files with
  // `node scripts/skyline.mjs ...` (see README).
  skyline: {
    landmark: "Petronas Towers",
    x1: "/places/kuala-lumpur-920.png",
    x2: "/places/kuala-lumpur-1840.png",
    // Where it stands, in post pixels: x moves it sideways, y lifts it (below
    // zero it sinks), and scale grows it from its foot. The viewer and the
    // export both read it from here.
    place: { x: 0, y: -121, scale: 1.01 },
  },
  // Used for the exported file names.
  slug: "darshan-kadam",
} as const;

export type Post = typeof post;
