// Gradients: four of the looks side by side: aurora, dusk, mint and the starburst.
window.preview = (stage) => {
  const parts = ["aurora", "dusk", "mint", "star"].map((preset, i) => {
    const cell = document.createElement("div");
    cell.style.cssText = `position:absolute;left:${(i % 2) * 960}px;top:${Math.floor(i / 2) * 540}px;width:960px;height:540px`;
    stage.appendChild(cell);
    return meshGradient(cell, { preset, grain: 0.3, period: 6 });
  });
  return { duration: 6, still: 1.5, parts };
};
