// Liquid glass: a pill of clear glass glides over bold stripes and type, bending them at its edges.
window.preview = (stage) => {
  stage.insertAdjacentHTML(
    "beforeend",
    `<div style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,#c4d4ff 0 60px,#141414 60px 120px)"></div>
    <div style="position:absolute;left:0;right:0;top:330px;text-align:center;font-size:260px;font-weight:800;letter-spacing:-0.04em;color:#ffcfe1">LIQUID</div>
    <div id="lens" style="position:absolute;left:560px;top:380px;width:800px;height:320px;border-radius:160px"></div>`,
  );
  const lens = liquidGlass(stage.querySelector("#lens"), { at: 0.3, depth: 60, keys: [{ at: 0.3, x: -380 }, { at: 3, x: 380 }, { at: 5.7, x: -380 }] });
  return { duration: 6, still: 1.6, parts: [lens] };
};
