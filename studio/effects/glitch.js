// Glitch and soft wipes: a card glitches on; a second wipes on with a feathered edge.
window.preview = (stage) => {
  stage.insertAdjacentHTML(
    "beforeend",
    `<div id="g1" style="position:absolute;left:160px;top:200px;width:760px;height:680px;border-radius:40px;background:#c4d4ff;color:#141414;display:flex;align-items:center;justify-content:center;font-size:120px;font-weight:700">Glitch</div>
    <div id="g2" style="position:absolute;left:1000px;top:200px;width:760px;height:680px;border-radius:40px;background:#ffcfe1;color:#141414;display:flex;align-items:center;justify-content:center;font-size:120px;font-weight:700">Soft</div>`,
  );
  return {
    duration: 5,
    still: 0.75,
    parts: [
      wipeReveal(stage.querySelector("#g1"), { at: 0.3, duration: 1, style: "glitch", leave: { at: 3.8, duration: 0.8 } }),
      wipeReveal(stage.querySelector("#g2"), { at: 0.9, duration: 1.2, style: "soft", softness: 0.35, leave: { at: 4, duration: 0.8 } }),
    ],
  };
};
