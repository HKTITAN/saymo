// Glass: a frosted panel over colour drifting behind it, with one sheen across.
window.preview = (stage) => {
  const ground = document.createElement("div");
  ground.style.cssText = "position:absolute;inset:0";
  stage.appendChild(ground);
  const mesh = meshGradient(ground, { preset: "dusk", period: 6, drift: 0.16, size: 0.7 });
  stage.insertAdjacentHTML(
    "beforeend",
    `<div id="pane" style="position:absolute;left:560px;top:240px;width:800px;height:600px;border-radius:44px;padding:64px;color:#ffffff;display:flex;flex-direction:column;gap:22px">
      <div style="font-size:56px;font-weight:650;letter-spacing:-0.02em">Frosted</div>
      <div style="font-size:32px;opacity:0.82;line-height:1.4">Glass that blurs whatever moves behind it.</div>
    </div>`,
  );
  const pane = glassPanel(stage.querySelector("#pane"), { at: 0.4, tint: "rgba(255, 255, 255, 0.12)", sheen: { at: 1.6, duration: 1.4 }, leave: { at: 5.2 } });
  return { duration: 6, still: 2.2, parts: [mesh, pane] };
};
