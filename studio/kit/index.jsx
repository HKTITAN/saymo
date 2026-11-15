// The studio's kit for React films: the film's brand in pieces, shared by
// the graphics library (studio/graphics/), captions and video films.
// Import it as "studio-kit"; the studio's bundlers point that name here.
//
//   useBrand()               the film's brand kit tokens (brand.ts BrandTokens)
//   usePalette()             its colours in the shape graphics draw with
//   useTexture()             its line texture: { pitch, stroke }
//   useBrandFont()           loads its fonts; returns the display family
//   BrandLogo                its logo for a light or dark ground
//   useUnit()                1 at 1080 on the short side; scale sizes by it
//   landing(p)               the house ease: sets off, then settles
//   LineBlock                a block of the line texture that arrives from
//                            the right, line by line, and leaves the way it came
//   Captions                 captions in three styles (edit.ts CaptionStyle)
//
// The brand comes from the page (window.__brand on the stage) or the
// render's input props (`brand`); without either it is the clean kit
// (studio/brands/clean). PITCH, STROKE and FONT are the fallbacks for a kit
// that leaves them out.

import { loadFont } from "@remotion/fonts";
import { getInputProps, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import CLEAN_KIT from "../brands/clean/brand.json";
import { captionLines } from "../../src/lib/studio/films/captions.ts";

export const PITCH = 12;
export const STROKE = 8;
export const FONT = "Geist";

// A colour's slightly darker partner, for the gaps between its lines.
export const darker = (hex, k = 0.895) => {
  const n = parseInt(String(hex).slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

// ─── The brand ──────────────────────────────────────────────────────────────

// The clean kit, its files found in the film's own public/ folder.
const CLEAN = {
  id: CLEAN_KIT.id,
  name: CLEAN_KIT.name,
  colors: CLEAN_KIT.colors,
  texture: CLEAN_KIT.texture,
  fonts: CLEAN_KIT.fonts.map((f) => ({ ...f, url: f.file })),
  logos: CLEAN_KIT.logos.map((l) => ({ ...l, url: l.file })),
};

export function currentBrand() {
  if (typeof window !== "undefined" && window.__brand) return window.__brand;
  try {
    const props = getInputProps();
    if (props && props.brand) return props.brand;
  } catch {}
  return CLEAN;
}
// The brand never changes while a film plays, so this needs no state.
export const useBrand = currentBrand;

// A file of the brand: absolute URLs as they are, others from the film's
// public/ folder (where a render puts the kit's files).
export const brandUrl = (url) => (/^(https?:|data:|\/)/.test(url) ? url : staticFile(url));

// A colour as a line field: the exact pair the brand gives, else the colour
// with a step darker gap. Lines are a kit's own texture: a kit
// without a texture, like the clean default, gets flat colour, the line and
// its gap the same, so nothing reads as lines.
export const fieldOf = (brand, hex) => {
  if (!brand.texture) return { lit: hex, gap: hex };
  const exact = brand.texture.fields?.[String(hex).toUpperCase()];
  return exact ?? { lit: hex, gap: darker(hex) };
};

// How much two colours stand apart (WCAG contrast ratio).
const luminance = (hex) => {
  const n = parseInt(String(hex).slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
export const field = (hex) => fieldOf(currentBrand(), hex);

export function paletteOf(brand) {
  const r = brand.colors.roles;
  const accent = fieldOf(brand, r.accent);
  return {
    stone: r.surface,
    ink: r.ink,
    muted: r.muted,
    black: brand.texture ? { lit: r.line, gap: r.background } : { lit: r.background, gap: r.background },
    // Type on the ground: whichever of ink and surface stands out more on it.
    text: contrast(r.ink, r.background) >= contrast(r.surface, r.background) ? r.ink : r.surface,
    accent,
    stoneField: fieldOf(brand, r.surface),
    background: r.background,
    onAccent: r.onAccent,
  };
}
export const usePalette = () => paletteOf(currentBrand());

export function useTexture() {
  const t = currentBrand().texture;
  const stroke = t?.stroke ?? STROKE;
  return { pitch: stroke + (t?.gap ?? stroke / 2), stroke };
}

const loaded = new Set();
// Loads the brand's fonts (once each) and returns the display family.
export function useBrandFont() {
  const brand = currentBrand();
  for (const f of brand.fonts) {
    const key = `${f.family}|${f.url}`;
    if (loaded.has(key)) continue;
    loaded.add(key);
    loadFont({ family: f.family, url: brandUrl(f.url), weight: f.weights }).catch(() => {});
  }
  return (brand.fonts.find((f) => f.role === "display") ?? brand.fonts[0])?.family ?? FONT;
}
export function useTextFont() {
  useBrandFont();
  const brand = currentBrand();
  return (brand.fonts.find((f) => f.role === "text") ?? brand.fonts.find((f) => f.role === "display") ?? brand.fonts[0])?.family ?? FONT;
}

// The brand's logo, `height` pixels tall, for a light or dark ground.
// `letters` colours the name when the kit has no logo for that ground.
export function BrandLogo({ height = 40, ground = "light", letters, style }) {
  const brand = currentBrand();
  const fits = (l) => l.on === ground || l.on === "any";
  const logo = brand.logos.find((l) => fits(l) && l.kind !== "mark") ?? brand.logos.find(fits);
  if (logo) return <Img src={brandUrl(logo.url)} style={{ height, width: "auto", display: "block", ...style }} />;
  // No logo drawn for this ground: the brand's name, set in its own type.
  const P = paletteOf(brand);
  const family = (brand.fonts.find((f) => f.role === "display") ?? brand.fonts[0])?.family ?? FONT;
  return (
    <span style={{ display: "block", fontFamily: family, fontWeight: 600, fontSize: height * 0.9, lineHeight: 1, color: letters ?? (ground === "dark" ? P.stone : P.ink), ...style }}>
      {brand.name}
    </span>
  );
}

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


// A block of lines in one colour, x/y/width/height in pixels. Each line
// arrives from the right edge of the block, the bottom line first (a
// staircase), over `travel` seconds from `enter`; from `leave` they go back
// out to the right, top line first. Times are seconds on the caller's own
// clock (a graphic's Sequence starts at 0).
export function LineBlock({ x, y, width, height, color, enter = 0, leave = Infinity, travel = 0.6, lag = 0.012, pitch = PITCH, stroke = STROKE, solid = false }) {
  const frame = useCurrentFrame();
  const brand = currentBrand();
  const fill = color ?? brand.colors.roles.accent;
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const f = fieldOf(brand, fill);
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


// Captions on the film. `words` are on the film's timeline (edit.json's
// captions.words). Styles:
//   lines    a line at a time
//   words    one word at a time, big
//   karaoke  a line at a time, the word being said in the accent
// The serif captions' face: Apple's New York where the Mac has it.
const SERIF = '"New York", "Iowan Old Style", Georgia, serif';

export function Captions({ words = [], style = "lines", position = "bottom", tag = "" }) {
  const family = useBrandFont();
  const P = usePalette();
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const u = Math.min(W, H) / 1080;
  const t = frame / fps;
  if (!words.length && !tag) return null;
  const portrait = H > W;
  const bottom = position === "middle" ? undefined : Math.round(H * (portrait ? 0.2 : 0.09));
  const place = bottom === undefined ? { top: "50%", transform: "translateY(-50%)" } : { bottom };
  // The series tag, small under where the captions sit, all through the film.
  const withTag = (caption) =>
    tag ? (
      <>
        {caption}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            textAlign: "center",
            ...(bottom === undefined ? { top: `calc(50% + ${Math.round(66 * u)}px)` } : { bottom: bottom - Math.round(46 * u) }),
            fontFamily: family,
            fontWeight: 500,
            fontSize: Math.round(26 * u),
            color: "rgba(255,255,255,0.8)",
            textShadow: `0 ${Math.round(2 * u)}px ${Math.round(10 * u)}px rgba(0,0,0,0.55)`,
            pointerEvents: "none",
          }}
        >
          {tag}
        </div>
      </>
    ) : (
      caption
    );
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
          fontFamily: family,
          fontVariationSettings: '"opsz" 48',
          fontWeight: 600,
          color: P.stone,
          background: withAlpha(P.background, 0.88),
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

  if (style === "serif") {
    // One big word at a time, no box, a soft shadow; key words in colour.
    const w = words.find((x, i) => t >= x.start && t < Math.max(x.end, words[i + 1]?.start ?? x.end));
    return withTag(
      w ? (
        <div key="s" style={{ position: "absolute", left: 0, right: 0, ...place, display: "flex", justifyContent: "center", padding: `0 ${Math.round(72 * u)}px`, pointerEvents: "none" }}>
          <span
            style={{
              fontFamily: SERIF,
              fontWeight: 700,
              fontSize: Math.round(104 * u),
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              color: w.hit ? P.accent.lit : "#ffffff",
              textShadow: `0 ${Math.round(4 * u)}px ${Math.round(28 * u)}px rgba(0,0,0,0.5)`,
            }}
          >
            {w.text}
          </span>
        </div>
      ) : null,
    );
  }
  if (style === "words") {
    const w = words.find((x, i) => t >= x.start && t < Math.max(x.end, words[i + 1]?.start ?? x.end));
    return withTag(w ? box(<span style={{ fontSize: Math.round(84 * u) }}>{w.text}</span>, "w") : null);
  }
  const lines = captionLines(words, { maxChars: portrait ? 22 : 34 });
  const line = lines.find((l, i) => t >= l.start && t < Math.min(l.end + 0.4, lines[i + 1]?.start ?? Infinity));
  if (!line) return withTag(null);
  const size = Math.round((portrait ? 58 : 52) * u);
  return withTag(box(
    <span style={{ fontSize: size }}>
      {line.words.map((w, i) => (
        <span key={i} style={{ color: style === "karaoke" && t >= w.start && t < w.end + 0.05 ? P.accent.lit : undefined }}>
          {i ? " " : ""}
          {w.text}
        </span>
      ))}
    </span>,
    "l",
  ));
}

// "#141414", 0.88 → "rgba(20,20,20,0.88)"
function withAlpha(hex, a) {
  const n = parseInt(String(hex).slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
