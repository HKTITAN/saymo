// Everything that changes from one speaker post to the next lives here.
// To make the next post: swap the title lines and the speaker, then run
// `node scripts/photo.mjs ...` for the new photo (see README).

export const post = {
  // Each entry is one line of the headline, broken where it reads best.
  // All in SemiBold: the first line at full strength, the others at half opacity.
  title: ["SpendOS:", "Redefining How", "Procurement Thinks,", "Decides & Acts"],
  speaker: {
    name: "Darshan Kadam",
    role: "Principal Advisor, AI Procurement Strategy",
    company: "Aerchain",
    photo: {
      x1: "/speakers/darshan-kadam-240.png",
      x2: "/speakers/darshan-kadam-480.png",
    },
  },
  // Version 2 stands this landmark at the foot of the line panel. Make the
  // files with `node scripts/skyline.mjs ...` (see README).
  skyline: {
    landmark: "Petronas Towers",
    x1: "/places/kuala-lumpur-920.png",
    x2: "/places/kuala-lumpur-1840.png",
  },
  // Used for the exported file names.
  slug: "darshan-kadam",
} as const;

export type Post = typeof post;
