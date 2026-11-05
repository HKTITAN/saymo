// Cursors: maya clicks Upgrade (it lights while she's on it); dev chats.
window.preview = (stage) => {
  stage.insertAdjacentHTML(
    "beforeend",
    `<style>#upgrade[data-cursor="over"]{background:#a463ff}#upgrade[data-cursor="press"]{background:#7d33e0}</style>
    <div style="position:absolute;left:560px;top:190px;width:800px;height:700px;border-radius:40px;background:#1e1e1e;box-shadow:0 0 0 2px #2a2a2a;padding:64px;display:flex;flex-direction:column;gap:28px">
      <div style="font-size:52px;font-weight:600;color:#f2f2f2;letter-spacing:-0.02em">Pro plan</div>
      <div style="font-size:30px;color:#8a8a8a;line-height:1.4">Unlimited films, brand kits and 4K renders for the whole team.</div>
      <div style="display:flex;flex-direction:column;gap:18px;margin-top:12px">
        <div style="height:18px;width:78%;border-radius:9px;background:#2a2a2a"></div>
        <div style="height:18px;width:64%;border-radius:9px;background:#2a2a2a"></div>
        <div style="height:18px;width:70%;border-radius:9px;background:#2a2a2a"></div>
      </div>
      <div id="upgrade" style="margin-top:auto;height:96px;border-radius:24px;background:#9747FF;color:#fff;font-size:34px;font-weight:600;display:flex;align-items:center;justify-content:center">Upgrade</div>
    </div>`,
  );
  const pointers = document.createElement("div");
  pointers.style.cssText = "position:absolute;inset:0;z-index:5";
  stage.appendChild(pointers);
  const maya = filmCursor(pointers, {
    scale: 2.4,
    color: filmCursor.colors.blue,
    label: { text: "maya" },
    keys: [
      { at: 0, x: 2080, y: 1200 },
      { at: 1.1, x: 1420, y: 640 },
      { at: 2.2, to: "#upgrade", dx: 60, dy: 6, click: true },
      { at: 4.6, to: "#upgrade", dx: 60, dy: 6 },
      { at: 5.8, x: 2080, y: 1200 },
    ],
  });
  const dev = filmCursor(pointers, {
    scale: 2.4,
    color: filmCursor.colors.orange,
    label: { text: "dev" },
    keys: [
      { at: 0, x: -160, y: -120 },
      { at: 1.6, x: 440, y: 300 },
      { at: 5.8, x: 440, y: 300 },
      { at: 6.4, x: -160, y: -120 },
    ],
    chats: [{ at: 2.6, text: "love this", duration: 2.4 }],
  });
  return { duration: 6.6, still: 3.2, parts: [maya, dev] };
};
