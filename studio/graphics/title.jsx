import { useCurrentFrame, useVideoConfig } from "remotion";
import { clamp01, landing, LineBlock, useBrandFont, usePalette, useTexture } from "studio-kit";

// TITLE CARD: a full-frame card that opens a film or a chapter.
//   0.00  the ground (black or stone lines) sweeps in from the right,
//         bottom line first
//   0.35  the small line, then the title, rise in
//   0.60  a short orange staircase climbs in at the bottom right (orange once)
//   end-0.6  the words fade and the lines leave the way they came
export default function Title({ values, duration }) {
  const FONT = useBrandFont();
  const PALETTE = usePalette();
  const { pitch: PITCH } = useTexture();
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const u = Math.min(W, H) / 1080;
  const t = frame / fps;
  const leave = Math.max(1.2, duration - 0.6);
  const stone = values.ground === "Stone";
  const pitch = Math.max(6, Math.round(PITCH * u));
  const stroke = Math.round(pitch * 0.67);
  const rows = Math.ceil(H / pitch);
  const margin = Math.round(96 * u);

  const rise = (start) => {
    const p = landing((t - start) / 0.55);
    const out = clamp01((t - leave) / 0.3);
    return { opacity: p * (1 - out), transform: `translateY(${(1 - p) * 18 * u}px)` };
  };

  // The orange steps: four, each a step higher and a step shorter.
  const stepH = pitch * 4;
  const steps = [0, 1, 2, 3].map((i) => {
    const width = Math.round(W * (0.26 - i * 0.05));
    return (
      <LineBlock key={i} x={W - width} y={rows * pitch - stepH * (i + 1)} width={width} height={stepH} color={PALETTE.accent.lit} enter={0.6 + i * 0.07} leave={leave + 0.05} travel={0.5} pitch={pitch} stroke={stroke} />
    );
  });

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <LineBlock x={0} y={0} width={W} height={rows * pitch} color={stone ? PALETTE.stone : PALETTE.black.lit} enter={0} leave={leave + 0.1} travel={0.6} lag={0.004} pitch={pitch} stroke={stroke} />
        {steps}
      </svg>
      <div style={{ position: "absolute", left: margin, right: margin, top: Math.round(H * 0.34), fontFamily: FONT, color: stone ? PALETTE.ink : PALETTE.stone }}>
        {values.kicker ? (
          <div data-part="kicker" style={{ fontSize: Math.round(30 * u), fontWeight: 500, opacity: 0.6, marginBottom: Math.round(18 * u), ...rise(0.35) }}>
            {values.kicker}
          </div>
        ) : null}
        <div data-part="title" style={{ fontSize: Math.round((H > W ? 96 : 112) * u), fontWeight: 600, fontVariationSettings: '"opsz" 96', letterSpacing: "-0.015em", lineHeight: 1.02, maxWidth: W * 0.78, ...rise(0.45) }}>
          {values.title}
        </div>
      </div>
    </div>
  );
}
