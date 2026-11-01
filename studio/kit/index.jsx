// The studio's kit for React films: the Aerchain look in pieces, shared by
// the graphics library (studio/graphics/), captions and video films.
// Import it as "studio-kit"; the studio's bundlers point that name here.
//
//   PALETTE, PITCH, STROKE   the post's colours and line texture
//   useUnit()                1 at 1080 on the short side; scale sizes by it
//   landing(p)               the post's ease: sets off, then settles
//   LineBlock                a block of the line texture that arrives from
//                            the right, line by line, and leaves the way it came
//   Wordmark                 the Aerchain wordmark (letters + orange "ai")
//   Captions                 captions in three styles (edit.ts CaptionStyle)
//   useBrandFont()           loads Bricolage Grotesque from the film's public/fonts

import { loadFont } from "@remotion/fonts";
import { staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { WORDMARK } from "../../src/components/post/wordmark-paths.ts";
import { captionLines } from "../../src/lib/studio/captions.ts";

export const PALETTE = {
  stone: "#E9E5DD",
  ink: "#141414",
  muted: "#6B665E",
  black: { lit: "#1E1E1E", gap: "#141414" },
  orange: { lit: "#F55A00", gap: "#DB5000" },
  stoneField: { lit: "#D3CCBF", gap: "#C2BAAC" },
};
export const PITCH = 12;
export const STROKE = 8;
export const FONT = "Bricolage Grotesque";

// A colour's slightly darker partner, for the gaps between its lines.
export const darker = (hex, k = 0.895) => {
  const n = parseInt(String(hex).slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};
export const field = (hex) =>
  hex === PALETTE.orange.lit ? PALETTE.orange : hex === PALETTE.stone ? PALETTE.stoneField : { lit: hex, gap: darker(hex) };

// Sets off at half speed and eases into place, like the post's bands.
export const landing = (p) => {
  const q = Math.min(1, Math.max(0, p));
  return 0.5 * q + 2 * q * q - 1.5 * q ** 3;
};
export const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Sizes are designed at 1080 on the short side; this scales them.
export function useUnit() {
  const { width, height } = useVideoConfig();
  return Math.min(width, height) / 1080;
}

let fontLoaded = false;
export function useBrandFont() {
  if (fontLoaded) return;
  fontLoaded = true;
  loadFont({ family: FONT, url: staticFile("fonts/BricolageGrotesque-Variable.ttf"), weight: "200 800" }).catch(() => {});
}

// A block of lines in one colour, x/y/width/height in pixels. Each line
// arrives from the right edge of the block, the bottom line first (a
// staircase), over `travel` seconds from `enter`; from `leave` they go back
// out to the right, top line first. Times are seconds on the caller's own
// clock (a graphic's Sequence starts at 0).
export function LineBlock({ x, y, width, height, color = PALETTE.orange.lit, enter = 0, leave = Infinity, travel = 0.6, lag = 0.012, pitch = PITCH, stroke = STROKE, solid = false }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const f = field(color);
  const rows = Math.max(1, Math.round(height / pitch));
  const runs = [];
  for (let r = 0; r < rows; r++) {
    const fromBottom = rows - 1 - r;
    const inP = landing((t - enter - fromBottom * lag) / travel);
    const outP = landing((t - leave - r * lag) / (travel * 0.8));
    const left = x + width * (1 - inP) + width * outP;
    const right = x + width;
    if (right - left <= 0.01 || inP <= 0) continue;
    const top = y + r * pitch;
    runs.push(
      <rect key={`g${r}`} x={left} y={top} width={right - left} height={pitch} fill={solid ? f.lit : f.gap} />,
      solid ? null : <rect key={`l${r}`} x={left} y={top + (pitch - stroke) / 2} width={right - left} height={stroke} fill={f.lit} />,
    );
  }
  return <>{runs}</>;
}

// The Aerchain wordmark at `height` pixels tall. `letters` colours the
// letters; the "ai" mark stays orange unless `mark` says otherwise.
export function Wordmark({ height = 40, letters = PALETTE.ink, mark = PALETTE.orange.lit, style }) {
  const width = (WORDMARK.width / WORDMARK.height) * height;
  return (
    <svg viewBox={`0 0 ${WORDMARK.width} ${WORDMARK.height}`} width={width} height={height} style={{ display: "block", ...style }} aria-label="Aerchain">
      {WORDMARK.letters.map((d, i) => (
        <path key={`l${i}`} d={d} fill={letters} />
      ))}
      {WORDMARK.mark.map((d, i) => (
        <path key={`m${i}`} d={d} fill={mark} />
      ))}
    </svg>
  );
}
export const WORDMARK_RATIO = WORDMARK.width / WORDMARK.height;

// Captions on the film. `words` are on the film's timeline (edit.json's
// captions.words). Styles:
//   lines    a line at a time
//   words    one word at a time, big
//   karaoke  a line at a time, the word being said in orange
export function Captions({ words = [], style = "lines", position = "bottom" }) {
  useBrandFont();
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const u = Math.min(W, H) / 1080;
  const t = frame / fps;
  if (!words.length) return null;
  const portrait = H > W;
  const bottom = position === "middle" ? undefined : Math.round(H * (portrait ? 0.2 : 0.09));
  const box = (children, key) => (
    <div
      key={key}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        ...(bottom === undefined ? { top: "50%", transform: "translateY(-50%)" } : { bottom }),
        display: "flex",
        justifyContent: "center",
        padding: `0 ${Math.round(72 * u)}px`,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontFamily: FONT,
          fontVariationSettings: '"opsz" 48',
          fontWeight: 600,
          color: PALETTE.stone,
          background: "rgba(20,20,20,0.88)",
          borderRadius: Math.round(10 * u),
          padding: `${Math.round(10 * u)}px ${Math.round(22 * u)}px ${Math.round(14 * u)}px`,
          lineHeight: 1.15,
          letterSpacing: "-0.01em",
          textAlign: "center",
          maxWidth: "100%",
        }}
      >
        {children}
      </div>
    </div>
  );

  if (style === "words") {
    const w = words.find((x, i) => t >= x.start && t < Math.max(x.end, words[i + 1]?.start ?? x.end));
    if (!w) return null;
    return box(<span style={{ fontSize: Math.round(84 * u) }}>{w.text}</span>, "w");
  }
  const lines = captionLines(words, { maxChars: portrait ? 22 : 34 });
  const line = lines.find((l, i) => t >= l.start && t < Math.min(l.end + 0.4, lines[i + 1]?.start ?? Infinity));
  if (!line) return null;
  const size = Math.round((portrait ? 58 : 52) * u);
  return box(
    <span style={{ fontSize: size }}>
      {line.words.map((w, i) => (
        <span key={i} style={{ color: style === "karaoke" && t >= w.start && t < w.end + 0.05 ? PALETTE.orange.lit : undefined }}>
          {i ? " " : ""}
          {w.text}
        </span>
      ))}
    </span>,
    "l",
  );
}
