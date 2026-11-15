import type { PostContent } from "@/components/post/content";
import { post } from "./post";
import { TEAM_SLUG } from "./team-slug";

// The "Meet the Team" post: the speaker post's right side (lines, logos,
// India Gate) with the team on the left. Each photo is made with
// `node scripts/team-photo.mjs ...` (see the script); null leaves the
// orange tile empty.
//
// Everyone is at Aerchain, so the roles leave the company off.
//
// Black and white lines (the steps rise in stone on black and black wipes
// them away, so the logos always read). The panel gives 202px to the words
// (718 wide), India Gate is drawn at 90% to suit, and the logo row at 77% so
// it fits with even margins.
export const team: PostContent = {
  ...post,
  centred: false,
  shift: 0,
  panelCut: 202,
  panelColors: "no-orange",
  // The softer landings: bands ease into place rather than stop hard.
  look: "refined",
  logoScale: 0.77,
  skyline: { ...post.skyline, place: { ...post.skyline.place, scale: 0.9 } },
  team: {
    heading: "Meet the Team",
    members: [
      {
        name: "Darshan Kadam",
        role: "Principal Advisor, AI Procurement Strategy",
        photo: { x1: "/team/darshan-kadam-200.png", x2: "/team/darshan-kadam-400.png" },
      },
      {
        name: "Suket Seth",
        role: "Advisor, AI Procurement Strategy",
        photo: { x1: "/team/suket-seth-200.png", x2: "/team/suket-seth-400.png" },
      },
      {
        name: "Amit Sahu",
        role: "Senior Procurement Consultant",
        photo: { x1: "/team/amit-sahu-200.png", x2: "/team/amit-sahu-400.png" },
      },
      {
        name: "Harshit Manaktala",
        role: "Global Field Marketing Manager",
        photo: { x1: "/team/harshit-manaktala-200.png", x2: "/team/harshit-manaktala-400.png" },
      },
      {
        name: "Kartik Malik",
        role: "Advisor, AI Procurement Strategy",
        photo: { x1: "/team/kartik-malik-200.png", x2: "/team/kartik-malik-400.png" },
      },
    ],
    details: ["25th November 2026", "Hyatt Regency, New Delhi"],
  },
  slug: TEAM_SLUG,
};
