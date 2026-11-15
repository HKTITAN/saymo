// The ready-made effects HTML films are built with (the parts in
// studio/starters/html/assets/parts), as the studio offers them: on the
// Effects page, where a tile previews each one and starts a film with it,
// and in a film's Effects menu, which asks Claude to add one. Each prompt
// names the effect, and the film skill tells Claude which part that is.
//
// A preview is a scene in studio/effects/<id>.js, played on the part files
// listed here by /api/studio/effects/<id>.

export type Effect = {
  id: string;
  name: string;
  note: string; // one line under the name
  parts: string[]; // the part files its preview loads, in order
  start: string; // the prompt for a new film made with it
  add: string; // the prompt to add it to the film that's open
};

export const EFFECTS: Effect[] = [
  {
    id: "grid",
    name: "Grid field",
    note: "Cards fall into a grid, then fold into a ring or a sphere",
    parts: ["grid.js"],
    start: "A 7 second film: 24 soft tiles drop into a grid, fold into a ring, then into a slowly turning sphere. Use the grid field effect.",
    add: "Add the grid field effect: tiles that drop into a grid, then fold into a ring.",
  },
  {
    id: "sphere",
    name: "Sphere carousel",
    note: "Cards orbiting a turning sphere, joined to a centre card",
    parts: ["sphere.js"],
    start:
      "A 6 second film: our logos orbit a turning sphere around a centre card, with a line from the centre to each. Use the sphere carousel effect.",
    add: "Add a sphere of cards orbiting the main element, with a line from it to each. Use the sphere carousel effect.",
  },
];
