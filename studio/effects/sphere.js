// Sphere carousel: tiles orbit a centre card, each joined to it by a line.
window.preview = (stage) => {
  const PASTEL = ["#c4d4ff", "#ffcfe1", "#cdeedd"];
  const sphere = sphereCarousel(stage, {
    items: Array.from({ length: 18 }, (_, i) => ({ style: { background: PASTEL[i % 3] } })),
    center: { text: "Studio", style: { background: "#9747FF", color: "#ffffff", fontWeight: "600" } },
    card: 110,
    radius: 360,
    spin: 0.06,
    lines: { color: "#3a3a3a", width: 2 },
    fog: "#141414",
    enter: { at: 0.2, duration: 1.2 },
    cardStyle: { fontFamily: "-apple-system, system-ui, sans-serif" },
  });
  return { duration: 6, still: 2.4, parts: [sphere] };
};
