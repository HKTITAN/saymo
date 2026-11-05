// Counter: one stat rolls up to $48,200; another drops from 1,200 ms to 95 ms.
window.preview = (stage) => {
  stage.insertAdjacentHTML(
    "beforeend",
    `<div style="position:absolute;left:180px;top:300px;display:flex;gap:140px">
      <div><div id="c1" style="font-size:150px;font-weight:650;letter-spacing:-0.03em;line-height:1;color:#f2f2f2"></div><p style="margin:28px 0 0;font-size:44px;color:#8a8a8a">saved this quarter</p></div>
      <div><div id="c2" style="font-size:150px;font-weight:650;letter-spacing:-0.03em;line-height:1;color:#f2f2f2"></div><p style="margin:28px 0 0;font-size:44px;color:#8a8a8a">to match an invoice</p></div>
    </div>`,
  );
  const saved = filmCounter(stage.querySelector("#c1"), { to: 48200, at: 0.4, duration: 1.8, format: { style: "currency", currency: "USD", maximumFractionDigits: 0 } });
  const speed = filmCounter(stage.querySelector("#c2"), { from: 1200, to: 95, at: 0.8, duration: 1.8, suffix: " ms" });
  return { duration: 4.5, still: 3, parts: [saved, speed] };
};
