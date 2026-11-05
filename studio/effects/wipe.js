// Wipe: a card wipes on behind a band of colour, then a panel opens as a circle.
window.preview = (stage) => {
  const PASTEL = ["#c4d4ff", "#ffcfe1", "#cdeedd"];
  const bars = [62, 88, 46, 74, 96, 58].map((h, i) => `<div style="flex:1;height:${h}%;border-radius:18px;background:${PASTEL[i % 3]}"></div>`).join("");
  stage.insertAdjacentHTML(
    "beforeend",
    `<div id="card" style="position:absolute;left:160px;top:200px;width:900px;height:680px;border-radius:40px;background:#1e1e1e;box-shadow:0 0 0 2px #2a2a2a;padding:64px">
      <p style="margin:0;font-size:46px;font-weight:600;color:#f2f2f2">Spend by category</p>
      <div style="display:flex;align-items:flex-end;gap:32px;height:400px;margin-top:64px">${bars}</div>
    </div>
    <div id="tile" style="position:absolute;left:1160px;top:200px;width:600px;height:680px;border-radius:40px;background:#cdeedd;color:#141414;display:flex;align-items:center;justify-content:center;font-size:130px;font-weight:650;letter-spacing:-0.02em">Live</div>`,
  );
  const card = wipeReveal(stage.querySelector("#card"), { at: 0.3, duration: 1.1, from: "left", angle: 12, band: { color: "#9747FF" }, leave: { at: 4.6, duration: 0.9 } });
  const tile = wipeReveal(stage.querySelector("#tile"), { at: 1.4, duration: 1, from: "circle", origin: { x: 0.8, y: 0.85 }, band: { color: "#ffcfe1", width: 0.1 }, leave: { at: 4.9, duration: 0.8, reverse: true } });
  return { duration: 6, still: 0.85, parts: [card, tile] };
};
