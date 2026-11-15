import { useCurrentFrame, useVideoConfig } from "remotion";
import { clamp01, landing, LineBlock, useBrandFont, usePalette, useTexture } from "studio-kit";

// QUOTE: a pull quote over a black line field.
//   0.00  the black ground sweeps in from the right
//   0.30  an orange bar climbs in down the quote's left (orange once)
//   0.45  the quote rises in, then who said it
//   end-0.6  the words fade and the lines leave the way they came
export default function Quote({ values, duration }) {
  const FONT = useBrandFont();
  const PALETTE = usePalette();
  const { pitch: PITCH } = useTexture();
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const u = Math.min(W, H) / 1080;
  const t = frame / fps;
  const leave = Math.max(1.4, duration - 0.6);
  const pitch = Math.max(6, Math.round(PITCH * u));
  const stroke = Math.round(pitch * 0.67);
  const rows = Math.ceil(H / pitch);
  const margin = Math.round(120 * u);
  const top = Math.round(H * (H > W ? 0.3 : 0.26));
  const barH = Math.round((H > W ? 0.36 : 0.42) * H / pitch) * pitch;

  const rise = (start) => {
    const p = landing((t - start) / 0.6);
    const out = clamp01((t - leave) / 0.3);
    return { opacity: p * (1 - out), transform: `translateY(${(1 - p) * 16 * u}px)` };
  };

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <LineBlock x={0} y={0} width={W} height={rows * pitch} color={PALETTE.black.lit} enter={0} leave={leave + 0.1} travel={0.6} lag={0.004} pitch={pitch} stroke={stroke} />
        <LineBlock x={margin - Math.round(40 * u)} y={Math.round(top / pitch) * pitch} width={pitch} height={barH} color={PALETTE.accent.lit} enter={0.3} leave={leave} travel={0.4} lag={0.01} pitch={pitch} stroke={stroke} />
      </svg>
      <div style={{ position: "absolute", left: margin, right: margin, top, fontFamily: FONT, color: PALETTE.stone }}>
        <div data-part="quote" style={{ fontSize: Math.round((H > W ? 64 : 72) * u), fontWeight: 500, fontVariationSettings: '"opsz" 72', letterSpacing: "-0.01em", lineHeight: 1.12, ...rise(0.45) }}>
          {values.quote}
        </div>
        <div data-part="who" style={{ fontSize: Math.round(28 * u), fontWeight: 500, opacity: 0.6, marginTop: Math.round(32 * u), ...rise(0.7) }}>
          {values.who}
        </div>
      </div>
    </div>
  );
}
