// Carousel: numbered cards stepping past, the sides turned like a record shelf.
window.preview = (stage) => {
  const PASTEL = ["#c4d4ff", "#ffcfe1", "#cdeedd"];
  const shelf = carousel(stage, {
    items: Array.from({ length: 7 }, (_, i) => ({ text: String(i + 1).padStart(2, "0"), style: { background: PASTEL[i % 3], color: "#141414", fontWeight: "700" } })),
    style: "coverflow",
    width: 520,
    height: 380,
    every: 1.1,
    duration: 0.6,
  });
  return { duration: 7.7, still: 0.9, parts: [shelf] };
};
