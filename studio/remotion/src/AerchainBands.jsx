import { loadFont } from "@remotion/fonts";
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { BLACK, H, line, PITCH, ROWS, runs, STROKE, TEXT, W } from "./bands.js";

// Bricolage Grotesque, the post's typeface. Remotion waits for it before
// it renders a frame.
loadFont({
  family: "Bricolage Grotesque",
  url: staticFile("fonts/BricolageGrotesque-Variable.ttf"),
  weight: "200 800",
});

// Words sit in the top two bands, which colour never reaches. The title's
// cap tops line up with y 72, as on the post (cap height is 0.66 em).
const TITLE = { x: 72, y: 72 + 0.66 * 86, size: 86 };
const CAPTION = { x: 72, y: 180, size: 32 };

export const AerchainBands = ({ engine }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const rects = [];
  for (let r = 0; r < ROWS; r++) {
    const { top, litTop } = line(r);
    // The base black is drawn once below; only the other runs are added.
    for (const [x, fill] of runs(r, t)) {
      if (x === 0 && fill === BLACK) continue;
      rects.push(
        <rect key={`${r}g${x}`} x={x} y={top} width={W - x} height={PITCH} fill={fill.gap} />,
        <rect key={`${r}l${x}`} x={x} y={litTop} width={W - x} height={STROKE} fill={fill.lit} />,
      );
    }
  }

  return (
    <AbsoluteFill style={{ backgroundColor: BLACK.gap }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block" }}>
        {Array.from({ length: ROWS }, (_, r) => (
          <rect key={r} x={0} y={line(r).litTop} width={W} height={STROKE} fill={BLACK.lit} />
        ))}
        {rects}
        <text
          x={TITLE.x}
          y={TITLE.y}
          fill={TEXT}
          fontFamily="Bricolage Grotesque"
          fontWeight={600}
          fontSize={TITLE.size}
          letterSpacing={-0.01 * TITLE.size}
          style={{ fontVariationSettings: `"opsz" ${TITLE.size}` }}
        >
          One film, three engines
        </text>
        <text
          x={CAPTION.x}
          y={CAPTION.y}
          fill={TEXT}
          fillOpacity={0.5}
          fontFamily="Bricolage Grotesque"
          fontWeight={400}
          fontSize={CAPTION.size}
          style={{ fontVariationSettings: `"opsz" ${CAPTION.size}` }}
        >
          Rendered in {engine}
        </text>
      </svg>
    </AbsoluteFill>
  );
};
