// Magnetic grid: dots answer maya's cursor and ripple where she clicks; dev chats.
window.preview = (stage) => {
  const dots = document.createElement("div");
  dots.style.cssText = "position:absolute;inset:0";
  const pointers = document.createElement("div");
  pointers.style.cssText = "position:absolute;inset:0;z-index:5";
  stage.append(dots, pointers);
  const maya = filmCursor(pointers, {
    scale: 2.2,
    color: filmCursor.colors.pink,
    label: { text: "maya" },
    keys: [
      { at: 0, x: 2050, y: 1150 },
      { at: 1, x: 1400, y: 760 },
      { at: 2.2, x: 620, y: 420, click: true },
      { at: 3.6, x: 1180, y: 300 },
      { at: 4.8, x: 1320, y: 640, click: true },
      { at: 6.4, x: 2050, y: 1150 },
    ],
  });
  const dev = filmCursor(pointers, {
    scale: 2.2,
    color: filmCursor.colors.green,
    label: { text: "dev" },
    keys: [
      { at: 0, x: -160, y: 1180 },
      { at: 3, x: 330, y: 840 },
      { at: 6.6, x: 330, y: 840 },
    ],
    chats: [{ at: 3.3, text: "ooh ripples", duration: 2.4 }],
  });
  const grid = gridField(dots, {
    items: 120,
    card: 46,
    corner: 0.5,
    layout: { type: "grid", cols: 15, gap: 61 },
    cardStyle: { background: "#2f2f33" },
    field: { follow: maya.pointAt, radius: 380, scale: [2.4, 1], color: { near: "#FF24BD", far: "#2f2f33" } },
    waves: maya.clicks.map((c) => ({ at: c.at, x: c.x, y: c.y, speed: 1100, width: 140, scale: 1.7 })),
  });
  return { duration: 7, still: 2.3, parts: [grid, dev, maya] };
};
