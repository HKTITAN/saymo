// SVG draw: a small line drawing (sun, hills, a house) draws itself on, then fills.
window.preview = (stage) => {
  stage.insertAdjacentHTML(
    "beforeend",
    `<svg id="scene" viewBox="0 0 1920 1080" width="1920" height="1080" style="position:absolute;inset:0" fill="none" stroke="#f2f2f2" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="1400" cy="330" r="110" fill="#ffcfe1" stroke="none"/>
      <path d="M120 760 C 420 560, 700 560, 980 720 S 1520 860, 1800 640"/>
      <path d="M120 860 C 520 700, 860 760, 1180 820 S 1600 900, 1800 820"/>
      <rect x="560" y="520" width="300" height="230" rx="18" fill="#c4d4ff" stroke="none"/>
      <path d="M540 530 L710 400 L880 530"/>
      <rect x="660" y="630" width="90" height="120" rx="10" fill="#cdeedd" stroke="none"/>
    </svg>`,
  );
  const drawing = svgDraw(stage.querySelector("#scene"), { at: 0.3, duration: 1.4, stagger: 0.25, leave: { at: 4.4 } });
  return { duration: 5.4, still: 1.2, parts: [drawing] };
};
