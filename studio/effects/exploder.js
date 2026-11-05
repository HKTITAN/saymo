// Exploder: letters fly together into a word, hold, then blow apart.
window.preview = (stage) => {
  stage.insertAdjacentHTML("beforeend", `<h1 id="boom" style="position:absolute;left:0;right:0;top:390px;margin:0;text-align:center;font-size:160px;font-weight:700;letter-spacing:-0.03em;color:#f2f2f2">Blow it up</h1>`);
  const word = textReveal(stage.querySelector("#boom"), { effect: "explode", by: "letters", at: 0.2, duration: 1, stagger: 0.03, leave: { at: 3.2, duration: 0.8, stagger: 0.02 } });
  return { duration: 4.6, still: 0.5, parts: [word] };
};
