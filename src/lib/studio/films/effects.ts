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
    id: "magnet",
    name: "Magnetic grid",
    note: "Dots that swell as a cursor passes and ripple when it clicks",
    parts: ["grid.js", "cursor.js"],
    start:
      "A 7 second film: a grid of dots swells and lights up as a teammate's cursor moves through it, and each click sends a ripple across the dots. Use the grid field and cursor effects.",
    add: "Add a magnetic grid of dots behind everything that swells as a cursor passes and ripples when it clicks. Use the grid field and cursor effects.",
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
  {
    id: "carousel",
    name: "Carousel",
    note: "Cards stepping past, turning like a shelf of records",
    parts: ["carousel.js"],
    start: "A 8 second film: seven product shots step past one at a time, the ones at the sides turned away like a shelf of records. Use the carousel effect.",
    add: "Add a carousel of the product shots that steps one card at a time. Use the carousel effect.",
  },
  {
    id: "cursor",
    name: "Cursors",
    note: "Teammates' pointers with name tags and cursor chat",
    parts: ["cursor.js"],
    start:
      "A 6 second film: two teammates' cursors with name tags move over a product card; one clicks the main button and the other says “love this” in a cursor chat. Use the cursor effect.",
    add: "Add a teammate's cursor with a name tag that glides to the main button and clicks it. Use the cursor effect.",
  },
  {
    id: "counter",
    name: "Counter",
    note: "A number that rolls up to its value",
    parts: ["counter.js"],
    start: "A 5 second film: “saved this quarter” with a number that rolls up to $48,200. Use the counter effect.",
    add: "Add a stat that rolls up to $48,200 with a short label under it. Use the counter effect.",
  },
  {
    id: "reveal",
    name: "Text reveal",
    note: "Words that rise, fade or sharpen in",
    parts: ["reveal.js"],
    start:
      "A 5 second film: the line “Teams close the books four days sooner” rises in word by word, then a prompt types itself out below it. Use the text reveal effect.",
    add: "Make the headline rise in word by word. Use the text reveal effect.",
  },
  {
    id: "typing",
    name: "Typing",
    note: "A typewriter, letters that glow as they land, or letters that decode",
    parts: ["reveal.js"],
    start: "A 5 second film: a search box where the words “Show me last month's spend” type themselves out, each new letter glowing. Use the typing effect.",
    add: "Make the main line type itself out like a typewriter. Use the typing effect.",
  },
  {
    id: "exploder",
    name: "Exploder",
    note: "Letters, words or lines that fly together, then blow apart",
    parts: ["reveal.js"],
    start: "A 4 second film: the words “Blow it up” fly together from all over, hold, then blow apart. Use the exploder effect.",
    add: "Make the headline fly together letter by letter and blow apart at the end. Use the exploder effect.",
  },
  {
    id: "stagger",
    name: "UI stagger",
    note: "Interface pieces landing one by one, with a bounce",
    parts: ["stagger.js"],
    start: "A 5 second film: a checklist whose rows land one by one with a little spring, then a “Done” badge bounces in. Use the UI stagger effect.",
    add: "Make the interface pieces land one after another with a little bounce. Use the UI stagger effect.",
  },
  {
    id: "wipe",
    name: "Wipe",
    note: "A picture or panel wiped on behind a band of colour",
    parts: ["wipe.js"],
    start: "A 6 second film: a product card wipes on behind a band of colour, then a second panel opens as a growing circle. Use the wipe effect.",
    add: "Bring the main picture in with a slanted wipe led by a band of colour. Use the wipe effect.",
  },
  {
    id: "glitch",
    name: "Glitch and soft wipes",
    note: "A wipe that glitches in slices, or one with a feathered edge",
    parts: ["wipe.js"],
    start: "A 5 second film: one card glitches on in jittering slices, then a second wipes on with a soft feathered edge. Use the glitch and soft wipe effects.",
    add: "Bring the main panel in with a glitch wipe. Use the glitch wipe effect.",
  },
  {
    id: "glass",
    name: "Glass",
    note: "A frosted panel over colour drifting behind it",
    parts: ["gradient.js", "glass.js"],
    start: "A 6 second film: a frosted glass card with one line of text floats over soft colour drifting behind it, and a sheen crosses it once. Use the glass and gradients effects.",
    add: "Turn the main card into frosted glass over what's behind it. Use the glass effect.",
  },
  {
    id: "liquid",
    name: "Liquid glass",
    note: "Clear glass that bends whatever is behind it at its edges",
    parts: ["liquid.js"],
    start: "A 6 second film: a pill of clear liquid glass glides over bold type, bending it at its edges under a rim of light. Use the liquid glass effect.",
    add: "Add a pill of liquid glass that glides over the headline, bending it at its edges. Use the liquid glass effect.",
  },
  {
    id: "gradient",
    name: "Gradients",
    note: "Seven looks and a starburst, drifting behind the film",
    parts: ["gradient.js"],
    start: "A 6 second loop: the aurora gradient drifting behind one bold line, with a little grain. Use the gradients effect.",
    add: "Put a gradient behind the film, with a little grain. Use the gradients effect.",
  },
  {
    id: "attach",
    name: "Attach and adjust",
    note: "A tag pinned to a moving card, and a blur that clears",
    parts: ["rig.js"],
    start: "A 6 second film: a card drifts across the frame with a label pinned to its corner, and the whole frame sharpens out of a grey blur at the start. Use the attach and adjust effects.",
    add: "Pin a small label to the main card so it follows it as it moves. Use the attach effect.",
  },
  {
    id: "svgdraw",
    name: "SVG draw",
    note: "Line drawings that draw themselves on, then fill",
    parts: ["svg.js"],
    start: "A 5 second film: a simple line drawing of a sun, hills and a house draws itself on, then fills with soft colour. Use the SVG draw effect.",
    add: "Make the illustration draw itself on, then fill. Use the SVG draw effect.",
  },
];
