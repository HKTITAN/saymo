// Grid field: one set of tiles through a grid, a ring, a sphere and a scatter.
window.preview = (stage) => {
  const PASTEL = ["#c4d4ff", "#ffcfe1", "#cdeedd"];
  const grid = gridField(stage, {
    items: Array.from({ length: 24 }, (_, i) => ({ style: { background: PASTEL[i % 3] } })),
    card: 120,
    corner: 0.24,
    enter: { at: 0.1, duration: 0.9 },
    morphs: [
      { at: 1.6, duration: 1.2, to: { type: "ring", radius: 380 } },
      { at: 3.4, duration: 1.4, to: { type: "sphere", radius: 400, spin: 0.08 } },
      { at: 5.6, duration: 1.2, to: { type: "scatter", seed: 9 }, from: "random" },
    ],
    leave: { at: 7.2, duration: 0.6 },
  });
  return { duration: 8, still: 2.9, parts: [grid] };
};
