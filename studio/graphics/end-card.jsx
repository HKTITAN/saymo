import { useCurrentFrame, useVideoConfig } from "remotion";
import { clamp01, FONT, LineBlock, landing, PALETTE, PITCH, useBrandFont, Wordmark } from "studio-kit";

// END CARD: the Aerchain wordmark to close a film.
//   0.00  the ground sweeps in from the right, bottom line first
//   0.45  the wordmark rises in, its "ai" in orange (orange once)
//   0.70  the line under it (aerchain.io) follows
//   it holds to the end; nothing leaves, as the film ends here
export default function EndCard({ values }) {
  useBrandFont();
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const u = Math.min(W, H) / 1080;
  const t = frame / fps;
  const stone = values.ground === "Stone";
  const pitch = Math.max(6, Math.round(PITCH * u));
  const rows = Math.ceil(H / pitch);
  const markH = Math.round(64 * u);

  const rise = (start) => {
    const p = landing((t - start) / 0.6);
    return { opacity: clamp01(p * 1.2), transform: `translateY(${(1 - p) * 16 * u}px)` };
  };

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <LineBlock x={0} y={0} width={W} height={rows * pitch} color={stone ? PALETTE.stone : PALETTE.black.lit} enter={0} travel={0.6} lag={0.004} pitch={pitch} stroke={Math.round(pitch * 0.67)} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: Math.round(28 * u) }}>
        <div data-part="wordmark" style={rise(0.45)}>
          <Wordmark height={markH} letters={stone ? PALETTE.ink : PALETTE.stone} />
        </div>
        {values.line ? (
          <div data-part="line" style={{ fontFamily: FONT, fontSize: Math.round(30 * u), fontWeight: 500, color: stone ? PALETTE.muted : PALETTE.stone, opacity: 0.75, ...rise(0.7) }}>
            {values.line}
          </div>
        ) : null}
      </div>
    </div>
  );
}
