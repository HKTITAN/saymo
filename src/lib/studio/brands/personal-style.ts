// Personal style: a two-minute brand kit for someone with a personal brand
// who posts reels. A name or handle, an optional photo or mark, three or four
// colours, a heading and a text face, and a few rules (energy, captions,
// voice, one line of their own). It is saved as an ordinary brand.json kit
// (brand.ts), so renders and Claude's context read it like any other; the
// rules and notes written here are the brief Claude follows.
//
// Plain TypeScript with no Node imports: the form (personal-style.tsx) and
// the route (/api/studio/brands/personal) both use it.

import type { BrandKit, ColorRoles, Hex, Ramp } from "./brand";

// ─── The fonts the studio ships (studio/fonts/<folder>/, each with OFL.txt) ───

export type ShippedFont = {
  id: string; // the folder in studio/fonts/
  family: string;
  file: string; // inside the folder
  weights: string; // "100 900", or "400" for a single weight
  axes?: string;
  kind: "Sans" | "Serif";
};

export const SHIPPED_FONTS: ShippedFont[] = [
  { id: "inter", family: "Inter", file: "Inter-Variable.ttf", weights: "100 900", axes: "opsz 14-32, wght 100-900", kind: "Sans" },
  { id: "geist", family: "Geist", file: "Geist-Variable.ttf", weights: "100 900", axes: "wght 100-900", kind: "Sans" },
  { id: "dm-sans", family: "DM Sans", file: "DMSans-Variable.ttf", weights: "100 900", axes: "opsz 9-40, wght 100-1000", kind: "Sans" },
  { id: "space-grotesk", family: "Space Grotesk", file: "SpaceGrotesk-Variable.ttf", weights: "300 700", axes: "wght 300-700", kind: "Sans" },
  {
    id: "bricolage-grotesque",
    family: "Bricolage Grotesque",
    file: "BricolageGrotesque-Variable.ttf",
    weights: "200 800",
    axes: "opsz 12-96, wdth 75-100, wght 200-800",
    kind: "Sans",
  },
  { id: "fraunces", family: "Fraunces", file: "Fraunces-Variable.ttf", weights: "100 900", axes: "opsz 9-144, wght 100-900, SOFT 0-100, WONK 0-1", kind: "Serif" },
  { id: "instrument-serif", family: "Instrument Serif", file: "InstrumentSerif-Regular.ttf", weights: "400", kind: "Serif" },
];

export const shippedFontUrl = (f: ShippedFont) => `/api/studio/fonts/${f.id}/${encodeURIComponent(f.file)}`;

// ─── What the form sends ────────────────────────────────────────────────────

export type Energy = "calm" | "punchy";
export type CaptionStyle = "plain" | "boxed" | "highlight";
export type Voice = "casual" | "formal";

// A face: one the studio ships (by id), or the file uploaded in the same
// request under this name ("heading" or "text"), with what was read from it.
export type FacePick =
  | { shipped: string }
  | { upload: "heading" | "text"; family: string; weights: string; axes?: string };

export type PersonalStyle = {
  name: string;
  colors: { ground: Hex; text: Hex; accent: Hex; accent2?: Hex };
  heading: FacePick;
  body: FacePick;
  energy: Energy;
  captions: { on: boolean; style: CaptionStyle };
  voice: Voice;
  line: string; // one rule of their own, "lowercase captions, no emojis"
};

export const CAPTION_STYLES: { value: CaptionStyle; label: string; says: string }[] = [
  { value: "plain", label: "Plain", says: "plain words in the text colour" },
  { value: "boxed", label: "Boxed", says: "words on a solid box in the text colour, with the type in the ground colour" },
  { value: "highlight", label: "Highlight", says: "words in the text colour, with the word being spoken in the accent" },
];

// ─── Colour ─────────────────────────────────────────────────────────────────

const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (v: unknown): v is Hex => typeof v === "string" && HEX.test(v);

type Rgb = [number, number, number]; // 0..1, sRGB
const toRgb = (hex: Hex): Rgb => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const toHex = ([r, g, b]: Rgb): Hex =>
  `#${[r, g, b]
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`.toUpperCase();

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

// OKLab, so ramps step evenly to the eye.
type Lab = [number, number, number];
function toLab(hex: Hex): Lab {
  const [r, g, b] = toRgb(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function labToRgb([L, a, b]: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
const inGamut = (rgb: Rgb) => rgb.every((c) => c >= -0.0005 && c <= 1.0005);

// A colour at lightness L with the hue of `lab`, its strength cut back
// until it fits in sRGB.
function atLightness(lab: Lab, L: number, strength: number): Hex {
  let [a, b] = [lab[1] * strength, lab[2] * strength];
  for (let i = 0; i < 24; i++) {
    const rgb = labToRgb([L, a, b]);
    if (inGamut(rgb)) return toHex(rgb);
    a *= 0.9;
    b *= 0.9;
  }
  return toHex(labToRgb([L, 0, 0]));
}

// Mixes two colours in OKLab: t = 0 is `a`, 1 is `b`.
export function mix(a: Hex, b: Hex, t: number): Hex {
  const x = toLab(a);
  const y = toLab(b);
  return toHex(labToRgb([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]));
}

const luminance = (hex: Hex) => {
  const [r, g, b] = toRgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: Hex, b: Hex) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
export const lightness = (hex: Hex) => toLab(hex)[0];

const STEPS = 12;
// Light to dark, with the picked colour itself at the step nearest its
// lightness, marked "(picked)".
function rampOf(name: string, hex: Hex): Ramp {
  const lab = toLab(hex);
  const ls = Array.from({ length: STEPS }, (_, i) => 0.97 - (i * (0.97 - 0.2)) / (STEPS - 1));
  const at = ls.reduce((best, L, i) => (Math.abs(L - lab[0]) < Math.abs(ls[best] - lab[0]) ? i : best), 0);
  return {
    name,
    steps: ls.map((L, i) =>
      i === at
        ? { name: `${name} ${i + 1} (picked)`, hex: hex.toUpperCase() }
        : { name: `${name} ${i + 1}`, hex: atLightness(lab, L, i < at ? 0.35 + (0.65 * i) / Math.max(1, at) : 1) },
    ),
  };
}

// The neutrals between the ground and the text, carrying the ground's tint.
function neutralRamp(ground: Hex, text: Hex): Ramp {
  const [light, dark] = lightness(ground) >= lightness(text) ? [ground, text] : [text, ground];
  return {
    name: "Neutral",
    steps: Array.from({ length: STEPS }, (_, i) => {
      const hex = i === 0 ? light.toUpperCase() : i === STEPS - 1 ? dark.toUpperCase() : mix(light, dark, i / (STEPS - 1));
      const end = i === 0 || i === STEPS - 1 ? (hex === ground.toUpperCase() ? " (ground)" : " (text)") : "";
      return { name: `Neutral ${i + 1}${end}`, hex };
    }),
  };
}

export function rolesOf(c: PersonalStyle["colors"]): ColorRoles {
  const onAccent = contrast(c.accent, c.text) >= contrast(c.accent, c.ground) ? c.text : c.ground;
  return {
    background: c.ground,
    surface: mix(c.ground, c.text, 0.07),
    ink: c.text,
    muted: mix(c.text, c.ground, 0.42),
    accent: c.accent,
    onAccent,
    line: mix(c.ground, c.text, 0.16),
  };
}

// ─── The kit ────────────────────────────────────────────────────────────────

export type KitFont = { family: string; file: string; weights: string; axes?: string; licence: string };

const sentence = (s: string) => {
  const t = s.trim().replace(/\s+/g, " ");
  if (!t) return "";
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

// The brand.json the style becomes, less its id and date (the route adds
// them, and checks it like any other kit).
export function kitOf(
  style: PersonalStyle,
  fonts: { heading: KitFont; body: KitFont },
  logo: { file: string; kind: "Photo" | "Mark" } | null,
): Omit<BrandKit, "id" | "updatedAt"> {
  const c = style.colors;
  const roles = rolesOf(c);
  const name = style.name.trim();
  const caption = CAPTION_STYLES.find((s) => s.value === style.captions.style) ?? CAPTION_STYLES[0];
  const same = fonts.heading.family === fonts.body.family;
  const accents = c.accent2 ? `${c.accent} as the accent and ${c.accent2} as a second accent` : `${c.accent} as the accent`;
  const textOnGround = contrast(c.text, c.ground);

  const visual = [
    `Ground ${c.ground}, text ${c.text}, ${accents}. Flat colour; nothing else unless a film asks for it.`,
    "The accent marks one thing per frame: the word, number or shape that matters most.",
    ...(c.accent2 ? [`The second accent (${c.accent2}) is for small supporting details, such as a tag or a part number. It never competes with the main accent.`] : []),
    same
      ? `Set everything in ${fonts.heading.family}: headings heavy and large, other text lighter and smaller.`
      : `Headings in ${fonts.heading.family}, everything else in ${fonts.body.family}.`,
    style.captions.on
      ? `Captions on every reel with speech: ${caption.says}, set in ${fonts.body.family}, in the lower third and clear of the app's buttons.`
      : "No burned-in captions. Leave captions to the app.",
    "Made for 9:16 reels first: keep words and faces inside the safe area, away from the top and bottom edges.",
    ...(logo ? [`Sign off with the ${logo.kind === "Photo" ? "photo" : "mark"} and ${name}, small and steady, not on every frame.`] : [`Sign off with ${name}, small and steady, not on every frame.`]),
  ];
  const motion =
    style.energy === "calm"
      ? [
          "Calm energy: slow, smooth moves that ease in and settle. Nothing shakes, flashes or bounces.",
          "Hold each idea long enough to read it twice; about 2 to 4 seconds a shot.",
          "Words fade or rise gently into place, a line at a time.",
        ]
      : [
          "Punchy energy: quick cuts, about every 1 to 2 seconds, and words that snap in on the beat.",
          "The hook lands in the first second. No slow fades at the start.",
          "Bold changes of size and position, tight timing, and a clean settle at the end of each move.",
        ];
  const sound =
    style.energy === "calm"
      ? ["Soft, warm music under the voice, ducked well below speech.", "Few sound effects: a gentle tick or swell at the turns, never more."]
      : ["Upbeat music with clear hits on the cuts, ducked under speech.", "Short, crisp sound effects on key moments, never busy."];
  const words = [
    style.voice === "casual"
      ? "Casual voice: write the way you talk. Short sentences, contractions and first person."
      : "Formal voice: clear, complete sentences. No slang, polished but plain.",
    ...(sentence(style.line) ? [`Always: ${sentence(style.line)}`] : []),
    `Write the name as ${name}, exactly like that.`,
  ];

  const ramps: Ramp[] = [
    {
      name: "Picked",
      steps: [
        { name: "Ground", hex: c.ground },
        { name: "Text", hex: c.text },
        { name: "Accent", hex: c.accent },
        ...(c.accent2 ? [{ name: "Second accent", hex: c.accent2 }] : []),
      ],
    },
    rampOf("Accent", c.accent),
    ...(c.accent2 ? [rampOf("Second accent", c.accent2)] : []),
    neutralRamp(c.ground, c.text),
  ];

  const licence = (f: KitFont) => `${f.family}: ${f.licence}.`;
  const fontList = [
    same ? `**${fonts.heading.family}** for everything.` : `**${fonts.heading.family}** for headings and **${fonts.body.family}** for everything else.`,
    "",
    `Licences. ${same ? licence(fonts.heading) : `${licence(fonts.heading)} ${licence(fonts.body)}`}`,
  ].join("\n");

  const notes = [
    `# ${name}: personal style`,
    "",
    `A personal brand for short vertical reels, set up in the studio's personal style form. It is small on purpose: a name, ${logo ? `a ${logo.kind === "Photo" ? "photo" : "mark"}, ` : ""}${c.accent2 ? "four" : "three"} colours, two faces and a few rules. Follow it closely, and keep each film simple enough that the person is the star.`,
    "",
    "## Colours",
    "",
    "| Role | Hex | Use it for |",
    "| --- | --- | --- |",
    `| Ground | ${c.ground} | The background of most frames |`,
    `| Text | ${c.text} | Words, captions, outlines |`,
    `| Accent | ${c.accent} | One thing per frame: the word, number or shape that matters most |`,
    ...(c.accent2 ? [`| Second accent | ${c.accent2} | Small supporting details, never competing with the accent |`] : []),
    "",
    `Text on the ground has a contrast of ${textOnGround.toFixed(1)}:1.${textOnGround < 4.5 ? " That's low, so keep text large." : ""} Type on the accent uses ${roles.onAccent}. The ramps were made from the picked colours, light to dark, with each picked colour marked.`,
    "",
    "## Type",
    "",
    fontList,
    "",
    "## Energy",
    "",
    ...motion.map((m) => `- ${m}`),
    ...sound.map((m) => `- ${m}`),
    "",
    "## Captions",
    "",
    style.captions.on
      ? `On, in the ${caption.label.toLowerCase()} style: ${caption.says}. Set in ${fonts.body.family}, a few words at a time, in the lower third and clear of the app's buttons.`
      : "Off. Don't burn captions into the film.",
    "",
    "## Words",
    "",
    ...words.map((w) => `- ${w}`),
    ...(sentence(style.line) ? ["", `The "Always" line is the person's own rule, kept in their words. It wins over the others.`] : []),
    "",
    "## Look",
    "",
    "Flat colour: no line fields, gradients or glows unless the person asks.",
    "",
  ].join("\n");

  return {
    name,
    source: "Personal style, made in the studio",
    colors: { roles, ramps },
    fonts: [
      { family: fonts.heading.family, role: "display", file: fonts.heading.file, weights: fonts.heading.weights, ...(fonts.heading.axes ? { axes: fonts.heading.axes } : {}), licence: fonts.heading.licence },
      { family: fonts.body.family, role: "text", file: fonts.body.file, weights: fonts.body.weights, ...(fonts.body.axes ? { axes: fonts.body.axes } : {}), licence: fonts.body.licence },
    ],
    logos: logo ? [{ name: logo.kind, kind: "mark", file: logo.file, on: "any" }] : [],
    rules: { visual, motion, sound, words },
    notes,
  };
}

// Checks what the form sent; a sentence saying what's wrong, or the style.
export function checkStyle(v: unknown): PersonalStyle | string {
  if (typeof v !== "object" || v === null) return "Send the style as an object.";
  const o = v as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim().slice(0, 80) : "";
  if (!name) return "Add your name or handle.";
  const c = (typeof o.colors === "object" && o.colors) || {};
  const { ground, text, accent, accent2 } = c as Record<string, unknown>;
  if (!isHex(ground) || !isHex(text) || !isHex(accent)) return "Pick a ground, text and accent colour.";
  if (accent2 !== undefined && !isHex(accent2)) return "The second accent must be a hex colour like #F55A00.";
  const face = (f: unknown): FacePick | null => {
    if (typeof f !== "object" || f === null) return null;
    const x = f as Record<string, unknown>;
    if (typeof x.shipped === "string" && SHIPPED_FONTS.some((s) => s.id === x.shipped)) return { shipped: x.shipped };
    if ((x.upload === "heading" || x.upload === "text") && typeof x.family === "string" && x.family.trim()) {
      return {
        upload: x.upload,
        family: x.family.trim().slice(0, 80),
        weights: typeof x.weights === "string" && /^\d{3}( \d{3})?$/.test(x.weights) ? x.weights : "400",
        ...(typeof x.axes === "string" && x.axes.trim() ? { axes: x.axes.trim().slice(0, 120) } : {}),
      };
    }
    return null;
  };
  const heading = face(o.heading);
  const body = face(o.body);
  if (!heading || !body) return "Pick a heading face and a text face.";
  const cap = (typeof o.captions === "object" && o.captions) || {};
  const capStyle = (cap as Record<string, unknown>).style;
  return {
    name,
    colors: { ground: ground.toUpperCase(), text: text.toUpperCase(), accent: accent.toUpperCase(), ...(isHex(accent2) ? { accent2: accent2.toUpperCase() } : {}) },
    heading,
    body,
    energy: o.energy === "punchy" ? "punchy" : "calm",
    captions: {
      on: (cap as Record<string, unknown>).on !== false,
      style: capStyle === "boxed" || capStyle === "highlight" ? capStyle : "plain",
    },
    voice: o.voice === "formal" ? "formal" : "casual",
    line: typeof o.line === "string" ? o.line.trim().replace(/\s+/g, " ").slice(0, 200) : "",
  };
}
