// Typing: a typewriter, typing with a glow, and letters that decode, one under the other.
window.preview = (stage) => {
  stage.insertAdjacentHTML(
    "beforeend",
    `<div style="position:absolute;left:180px;top:250px;display:flex;flex-direction:column;gap:80px;font-size:78px;font-weight:600;letter-spacing:-0.02em;color:#f2f2f2">
      <div><span id="t1">Typed like a typewriter</span></div>
      <div><span id="t2">Typed with a soft glow</span></div>
      <div><span id="t3">DECODED IN 2026</span></div>
    </div>`,
  );
  return {
    duration: 5.6,
    still: 3.8,
    parts: [
      textReveal(stage.querySelector("#t1"), { effect: "type", at: 0.3, leave: { at: 4.6 } }),
      textReveal(stage.querySelector("#t2"), { effect: "colour", at: 1.2, tint: "#ffcfe1", leave: { at: 4.7 } }),
      textReveal(stage.querySelector("#t3"), { effect: "scramble", at: 2.1, leave: { at: 4.8 } }),
    ],
  };
};
