// Text reveal: a headline rises in word by word, then a prompt types itself out.
window.preview = (stage) => {
  stage.insertAdjacentHTML(
    "beforeend",
    `<h1 id="headline" style="position:absolute;left:180px;top:250px;width:1500px;margin:0;font-size:112px;line-height:1.04;font-weight:650;letter-spacing:-0.025em;color:#f2f2f2">Teams close the books <span style="color:#c4d4ff">four days</span> sooner</h1>
    <div style="position:absolute;left:180px;top:720px;padding:34px 46px;border-radius:999px;background:#1e1e1e;box-shadow:0 0 0 2px #2a2a2a;font-size:46px;color:#f2f2f2;white-space:nowrap"><span id="prompt">Make the title come in from the left</span></div>`,
  );
  const headline = textReveal(stage.querySelector("#headline"), { by: "words", at: 0.3, leave: { at: 5.4 } });
  const prompt = textReveal(stage.querySelector("#prompt"), { effect: "type", at: 1.4, leave: { at: 5 } });
  return { duration: 6.2, still: 4.2, parts: [headline, prompt] };
};
