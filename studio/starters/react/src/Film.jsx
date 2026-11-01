import { loadFont } from "@remotion/fonts";
import { AbsoluteFill, Easing, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

// A studio film, written for Remotion: a React component drawn once per
// frame from useCurrentFrame(). The studio plays it in the Remotion Player
// and renders it with Remotion's renderer; film.json's params arrive as
// props, and its size, fps and length through useVideoConfig().
//
// THE FIGURE (5 s)
//   0.40  the accent arrives from the right, line by line, as a bar as long
//         as the figure (40% of the width for 40)
//   0.40  the figure counts up with it, the label rising in under it
//   1.60  cover: everything has landed
//   3.60  black slides back in from the middle lines outwards
//   5.00  all black again: it loops

// Bricolage Grotesque, from public/fonts. Remotion waits for it before a
// frame is drawn.
loadFont({
  family: "Bricolage Grotesque",
  url: staticFile("fonts/BricolageGrotesque-Variable.ttf"),
  weight: "200 800",
});

// The Aerchain line texture: an 8px line on a 12px pitch, each colour a
// flat field with a slightly darker partner in the gaps.
const PITCH = 12;
const STROKE = 8;
const BLACK = { lit: "#1E1E1E", gap: "#141414" };
const TEXT = "#E9E5DD";

const darker = (hex, k = 0.895) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

// Sets off at half speed and eases into place, like the post's bands.
const landing = (p) => {
  const q = Math.min(1, Math.max(0, p));
  return 0.5 * q + 2 * q * q - 1.5 * q ** 3;
};

export default function Film({ figure = 40, unit = "%", label = "faster sourcing", accent = "#F55A00" }) {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const t = frame / fps;
  const ACCENT = { lit: accent, gap: darker(accent) };
  const share = Math.min(100, Math.max(0, Number(figure) || 0)) / 100;

  // The bar fills the lower half of the frame; the words sit above it.
  const rows = Math.ceil(H / PITCH);
  const firstBar = Math.floor(rows * 0.5);
  const middle = (firstBar + rows) / 2;
  const to = W - Math.round((W * share) / PITCH) * PITCH;

  const runs = [];
  for (let r = firstBar; r < rows; r++) {
    const fromBottom = rows - 1 - r;
    const accentX = W + (to - W) * landing((t - 0.4 - fromBottom * 0.006) / 0.9);
    const blackX = W - W * landing((t - 3.6 - Math.abs(r + 0.5 - middle) * 0.006) / 0.5);
    for (const [x, fill] of [[accentX, ACCENT], [blackX, BLACK]]) {
      if (x >= W) continue;
      const top = r * PITCH;
      runs.push(
        <rect key={`${r}${fill.lit}g`} x={x} y={top} width={W - x} height={PITCH} fill={fill.gap} />,
        <rect key={`${r}${fill.lit}l`} x={x} y={top + (PITCH - STROKE) / 2} width={W - x} height={STROKE} fill={fill.lit} />,
      );
    }
  }

  const counted = Math.round(Number(figure) * Easing.out(Easing.cubic)(interpolate(t, [0.4, 1.4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })));
  const rise = interpolate(t, [0.55, 1.15], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.exp) });
  const out = interpolate(t, [3.5, 3.9], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: BLACK.gap }}>
      <svg data-part="lines" viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block", position: "absolute" }}>
        {Array.from({ length: rows }, (_, r) => (
          <rect key={r} x={0} y={r * PITCH + (PITCH - STROKE) / 2} width={W} height={STROKE} fill={BLACK.lit} />
        ))}
        {runs}
      </svg>
      <div style={{ position: "absolute", left: 72, top: 72, color: TEXT, fontFamily: "Bricolage Grotesque", opacity: out }}>
        <div
          data-part="figure"
          style={{
            fontSize: 220,
            fontWeight: 600,
            lineHeight: 0.9,
            letterSpacing: "-0.03em",
            fontVariationSettings: '"opsz" 96',
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {counted}
          <span style={{ color: accent }}>{unit}</span>
        </div>
        <div style={{ overflow: "hidden", marginTop: 16 }}>
          <div
            data-part="label"
            style={{ fontSize: 56, fontWeight: 400, transform: `translateY(${rise * 110}%)`, fontVariationSettings: '"opsz" 56' }}
          >
            {label}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
