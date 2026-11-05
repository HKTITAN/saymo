// UI stagger: rows land one by one with a little spring; a badge bounces in.
window.preview = (stage) => {
  const DOTS = ["#c4d4ff", "#ffcfe1", "#cdeedd", "#c4d4ff"];
  const rows = ["Invoices matched", "Suppliers paid", "Books closed", "Report sent"]
    .map((t, i) => `<div class="row" style="display:flex;align-items:center;gap:28px;height:110px;padding:0 40px;border-radius:28px;background:#1e1e1e;box-shadow:0 0 0 2px #2a2a2a;font-size:44px;color:#f2f2f2"><span style="width:44px;height:44px;border-radius:50%;background:${DOTS[i]}"></span>${t}</div>`)
    .join("");
  stage.insertAdjacentHTML(
    "beforeend",
    `<div style="position:absolute;left:560px;top:200px;width:800px;display:flex;flex-direction:column;gap:22px">${rows}</div>
    <div id="badge" style="position:absolute;left:1250px;top:150px;padding:18px 34px;border-radius:999px;background:#9747FF;color:#fff;font-size:40px;font-weight:600">Done</div>`,
  );
  return {
    duration: 4.6,
    still: 2.6,
    parts: [staggerIn(stage.querySelectorAll(".row"), { at: 0.3, stagger: 0.12, bounce: 0.3, leave: { at: 3.7 } }), bounceIn(stage.querySelector("#badge"), { at: 1.2, leave: { at: 3.6 } })],
  };
};
