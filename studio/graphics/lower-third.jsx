import { useCurrentFrame, useVideoConfig } from "remotion";
import { clamp01, landing, LineBlock, useBrandFont, usePalette, useTexture } from "studio-kit";

// LOWER THIRD: a speaker's name and role over a stone panel.
//   0.00  the stone panel arrives from the right, line by line, bottom first
//   0.35  the name rises in, then the role
//   0.55  a short orange edge lands on the panel's left (orange once)
//   end-0.6  the words fade, the lines leave the way they came
// Props: values (name, role, side), duration (seconds on the film).
export default function LowerThird({ values, duration }) {
  const FONT = useBrandFont();
  const PALETTE = usePalette();
  const { pitch: PITCH } = useTexture();
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const u = Math.min(W, H) / 1080;
  const t = frame / fps;
  const leave = Math.max(1, duration - 0.6);

  const nameSize = Math.round(44 * u);
  const roleSize = Math.round(26 * u);
  // Wide enough for the words: a rough measure, 0.55 em per letter.
  const textW = Math.max(String(values.name).length * nameSize * 0.55, String(values.role).length * roleSize * 0.52);
  const padX = Math.round(36 * u);
  const edge = Math.round(PITCH * u);
  const pitch = Math.max(6, Math.round(PITCH * u));
  const height = Math.ceil((nameSize * 1.1 + roleSize * 1.3 + 44 * u) / pitch) * pitch;
  const width = Math.round(textW + padX * 2 + edge);
  const portrait = H > W;
  const margin = Math.round(72 * u);
  const y = Math.round(H - margin - height - (portrait ? H * 0.12 : 0));
  const x = values.side === "Right" ? W - margin - width : margin;

  const words = (start) => {
    const p = landing((t - start) / 0.5);
    const out = clamp01((t - leave) / 0.3);
    return { opacity: p * (1 - out), transform: `translateY(${(1 - p) * 14 * u}px)` };
  };

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <LineBlock x={x} y={y} width={width} height={height} color={PALETTE.stone} enter={0} leave={leave + 0.15} travel={0.55} pitch={pitch} stroke={Math.round(pitch * 0.67)} />
        <LineBlock x={x} y={y} width={edge} height={height} color={PALETTE.accent.lit} enter={0.55} leave={leave} travel={0.35} pitch={pitch} stroke={Math.round(pitch * 0.67)} />
      </svg>
      <div style={{ position: "absolute", left: x + edge + padX, top: y + Math.round(20 * u), fontFamily: FONT, color: PALETTE.ink, whiteSpace: "nowrap" }}>
        <div data-part="name" style={{ fontSize: nameSize, fontWeight: 600, fontVariationSettings: '"opsz" 48', letterSpacing: "-0.01em", lineHeight: 1.1, ...words(0.35) }}>
          {values.name}
        </div>
        <div data-part="role" style={{ fontSize: roleSize, fontWeight: 400, color: PALETTE.muted, lineHeight: 1.3, marginTop: Math.round(4 * u), ...words(0.48) }}>
          {values.role}
        </div>
      </div>
    </div>
  );
}
