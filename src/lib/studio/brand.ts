// Brand kits: everything that makes a film look and sound like its brand,
// set up once and used by every film, every graphic and Claude. The studio
// ships with Aerchain's full kit; more can be made by hand, made by Claude
// from a guideline (PDF, screenshots, logo and font files, a website), or
// imported from a kit another studio exported.

// brands/<id>/            git ignores brands/ (kits may belong to clients)
//   brand.json            BrandKit
//   fonts/                font files named in BrandKit.fonts
//   logos/                logo files named in BrandKit.logos
//   guide/                what it was made from (PDFs, images), kept for Claude
//   .history/<n>/         a copy before each Claude turn, for undo
// studio/brands/aerchain/ the Aerchain kit as shipped (tracked in git); the
//                         first visit copies it into brands/aerchain/.

export type Hex = string; // "#F55A00"

export type ColorRoles = {
  background: Hex; // the ground most films sit on
  surface: Hex; // panels, cards, bars
  ink: Hex; // main type
  muted: Hex; // secondary type
  accent: Hex; // the one colour that means "this matters"
  onAccent: Hex; // type on the accent, if it's ever allowed
  line: Hex; // rules, strokes, the line field
};

export type Ramp = { name: string; steps: { name: string; hex: Hex }[] }; // light to dark

export type BrandFont = {
  family: string; // "Bricolage Grotesque"
  role: "display" | "text" | "mono";
  file: string; // "fonts/BricolageGrotesque-Variable.ttf"
  weights: string; // "200 800" for a variable font, "400" for a single weight
  axes?: string; // e.g. "opsz 12-96"
  licence?: string; // "OFL", "Commercial (Aerchain)"
};

export type BrandLogo = {
  name: string; // "Wordmark"
  kind: "wordmark" | "mark" | "lockup";
  file: string; // "logos/wordmark.svg"
  on: "light" | "dark" | "any"; // which grounds it is drawn for
};

export type BrandKit = {
  id: string; // 8 lowercase letters/digits, or "aerchain"
  name: string; // "Aerchain"
  updatedAt: string; // ISO
  source?: string; // where it came from: "Framer brand guideline /home-ets", a PDF name, a URL
  colors: { roles: ColorRoles; ramps: Ramp[] };
  fonts: BrandFont[];
  logos: BrandLogo[];
  // Short, plain rules, each one sentence, as the brand words them where it
  // can. Claude follows them; the kit page shows them.
  rules: {
    visual: string[]; // "Flat colour only, no gradients."
    motion: string[]; // "Colour arrives from the right."
    sound: string[]; // "Clean and minimal: soft ticks, filtered whooshes."
    words: string[]; // "Write Aerchain, never AERCHAIN, in copy."
  };
  // The line field and similar structural numbers, when the brand has them.
  // `fields`: a colour used as a line field, and the exact line and gap
  // colours to draw it with (otherwise the gap is a step darker).
  texture?: { stroke: number; gap: number; note?: string; fields?: Record<Hex, { lit: Hex; gap: Hex }> }; // px at 1080p
  notes: string; // the longer guideline in plain Markdown, for Claude
};

// What the studio hands a film so its graphics follow the kit:
//   html  window.__brand (BrandTokens), set before the film's scripts
//   react the `brand` prop, and useBrand() from "studio-kit"
//   rust  brand.json beside Cargo.toml (copied in when the film is built)
// Fonts are served at /studio/brand/<id>/<file>, and @font-face rules for
// them are added to every stage page.
export type BrandTokens = Pick<BrandKit, "id" | "name" | "colors" | "texture"> & {
  fonts: (BrandFont & { url: string })[];
  logos: (BrandLogo & { url: string })[];
};

export type BrandSummary = Pick<BrandKit, "id" | "name" | "updatedAt" | "source"> & {
  swatches: Hex[]; // background, surface, ink, accent
  font: string | null; // display family
  logo: string | null; // URL of the first logo for a light ground
};

// film.json gains `brand?: string` (a kit id). Films without one use
// "aerchain".

// ─── Routes ─────────────────────────────────────────────────────────────────
//
// GET    /api/studio/brands                      → BrandSummary[]
// POST   /api/studio/brands  {name}              → BrandKit (blank, from Aerchain's shape)
// GET    /api/studio/brands/<id>                 → BrandKit
// PUT    /api/studio/brands/<id>  BrandKit       → BrandKit (validated)
// DELETE /api/studio/brands/<id>                 → 204 (refused for the last kit)
// POST   /api/studio/brands/<id>/duplicate       → BrandKit
// POST   /api/studio/brands/<id>/files           body = file, `x-file-name`;
//        fonts go to fonts/, logos (svg/png) to logos/, PDFs/images to guide/
// GET    /api/studio/brands/<id>/export          → a .zip of the kit
// POST   /api/studio/brands/import               body = a kit .zip → BrandKit
// POST   /api/studio/brands/<id>/chat  {prompt, url?}  → ChatEvent stream:
//        Claude builds or tidies the kit from guide/ (and the url, if given)
// GET    /studio/brand/<id>/<file>               → a font or logo file
