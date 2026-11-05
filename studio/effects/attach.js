// Attach and adjust: a tag pinned to a card that wanders; the frame sharpens out of a grey blur and back.
window.preview = (stage) => {
  stage.insertAdjacentHTML(
    "beforeend",
    `<div id="card" style="position:absolute;left:0;top:0;width:520px;height:340px;border-radius:36px;background:#c4d4ff"></div>
    <div id="tag" style="padding:16px 30px;border-radius:999px;background:#9747FF;color:#fff;font-size:36px;font-weight:600;white-space:nowrap">Pinned to the card</div>`,
  );
  const card = stage.querySelector("#card");
  const wander = {
    draw: (t) => {
      const a = (t / 6) * Math.PI * 2;
      const k = (Math.sin(a - Math.PI / 2) + 1) / 2;
      card.style.transform = `translate(${300 + k * 1000}px, ${380 + Math.sin(a * 2) * 120}px) rotate(${-4 + k * 8}deg)`;
    },
  };
  const tag = attachTo(stage.querySelector("#tag"), card, { anchor: "top right", align: "bottom left", offset: { x: -40, y: 30 } });
  const grade = adjustment(stage, { keys: [{ at: 0, blur: 18, saturate: 0 }, { at: 1 }, { at: 5 }, { at: 6, blur: 18, saturate: 0 }] });
  return { duration: 6, still: 2.5, parts: [wander, tag, grade] };
};
