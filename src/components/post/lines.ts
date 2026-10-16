// The right-hand panel of the post: a field of horizontal scanlines drawn in
// the rhythm of the Aerchain line texture (a line, then a thin darker gap),
// with the Aerchain wordmark on top. Every line is straight and runs off the
// right edge; colour only ever arrives from the right, so all motion happens
// along the lines, never across them.

import { PALETTE } from "./palette";
import { WORDMARK } from "./wordmark-paths";

export const PANEL_W = 920;
export const PANEL_H = 1080;

const PITCH = 12; // one line every 12px
const STROKE = 8; // height of each line, leaving a 4px darker gap
const ROWS = PANEL_H / PITCH; // 90 lines
const BAND = 9; // lines per band (108px)
const BANDS = ROWS / BAND; // 10 bands

// What one stretch of a line looks like: its lit stroke and the thin gap
// around it. As in the Aerchain texture, the gap is a shade darker than the
// line, so every colour reads as a flat field with fine lines through it.
type Fill = { lit: string; gap: string };
const BLACK: Fill = { lit: PALETTE.sky, gap: PALETTE.gap };
const ORANGE: Fill = { lit: PALETTE.orange, gap: PALETTE.orangeLine };
const STONE: Fill = { lit: PALETTE.stoneField, gap: PALETTE.stoneLine };

// A line is its base fill across the full width, with each layer painted
// over it from `edge` to the right edge, in order.
type Layer = { edge: number; color: Fill };
type LineState = { base: Fill; layers: Layer[] };

export type MotionId = "scenes";

// How Scenes moves: with softer landings (the post's own), or as measured
// from the reference (the Before switch).
export type Look = "reference" | "refined";

type Motion = {
  id: MotionId;
  label: string;
  duration: number; // seconds per loop; every motion is seamless
  still: number; // the moment used for the PNG and the first video frame
  line: (r: number, t: number, look: Look) => LineState;
};

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const wrap = (t: number, d: number) => ((t % d) + d) % d;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);

const bandOf = (r: number) => Math.floor(r / BAND);
const lineInBand = (r: number) => r % BAND; // 0 is the band's top line

// ---------------------------------------------------------------------------
// Scenes: the panel moves between black, orange and stone in stepped band
// wipes, ten bands of nine lines, after the reference video.

/* ─────────────────────────────────────────────────────────
 * SCENES STORYBOARD
 *
 * Read top to bottom. Times are ms into the 6000ms loop. Every change of
 * scene sets off on a 1500ms beat, every wipe sets its bands off across
 * the same 630ms, and each band takes 500ms to cross. So the loop keeps
 * one steady pulse, about 1150ms of motion then about 350ms of rest, four
 * times round, with no longer pause where it loops.
 *
 *    0ms   orange rises as a staircase from the bottom-right corner,
 *          bottom band first (70ms apart)
 *  560ms   the still: mid-rise, the frame every export opens on
 * 1500ms   stone sweeps down, top band first (70ms apart)
 * 3000ms   an orange pixel burst grows out of the right edge ring by
 *          ring from the middle (75ms apart), exactly as the reference
 *          has it, and fills the panel by 4050ms
 * 4500ms   black slides back in from the middle bands outwards
 *          (rings 157.5ms apart, the same 630ms spread)
 * 6000ms   loop: orange rises again
 *
 * The Before switch plays the reference video's own timing instead
 * (REFERENCE below).
 * ───────────────────────────────────────────────────────── */

const BEAT = 1500; // ms between changes of scene

const SCENE_TIMING = {
  rise:  0 * BEAT,  // orange sets off, bottom band
  still: 560,       // the still every export opens on, mid-rise
  sweep: 1 * BEAT,  // stone sets off, top band
  burst: 2 * BEAT,  // the pixel circle sets off
  back:  3 * BEAT,  // black sets off, middle bands
  loop:  4 * BEAT,  // 6000: the end matches the start
};

/* Every wipe */
const WIPES = {
  spread:  630,  // ms from a wipe's first band setting off to its last
  cross:   500,  // ms for one band to cross the panel
  lineLag: 4,    // ms each line trails the one ahead of it in its band
};

/* The pixel burst, centred on the right edge, one step per band: the
   reference's own, in both looks */
const BURST = {
  ringGap: 75,   // ms between rings, middle first
  grow:    750,  // ms for a ring to reach the left edge, slowing as it goes
};

/* The reference video's own timing, frame by frame (the Before switch) */
const REFERENCE = {
  at:      { rise: 600, sweep: 2680, burst: 4050, back: 4620 },  // ms each change sets off
  gap:     { rise: 95, sweep: 88, back: 90 },  // ms between bands, rings for black
  cross:   430,  // ms for one band to cross the panel
};

// Distance of a band from the middle of the panel: 0 for the two middle bands.
const ringOf = (b: number) => (b < BANDS / 2 ? BANDS / 2 - 1 - b : b - BANDS / 2);
// Lines nearer the middle lead when a wipe spreads outwards from it.
const outwardLag = (r: number) =>
  bandOf(r) < BANDS / 2 ? BAND - 1 - lineInBand(r) : lineInBand(r);

// Mostly linear, with a little ease at both ends: the reference's crossing.
// A band reaches the left edge at half speed and stops there at once.
const glide = (p: number) => 0.5 * p + 0.5 * p * p * (3 - 2 * p);
// Sets off like glide, then eases into the left edge: its speed falls to
// nothing as it arrives, so it lands instead of hitting the edge.
const landing = (p: number) => 0.5 * p + 2 * p * p - 1.5 * p ** 3;
// The burst: each ring of bands grows out of the right edge, fast at first,
// slowing as it reaches the left edge; the middle rings lead.
const burstRings = (b: number, ms: number) =>
  PANEL_W * (1 - clamp((ms - ringOf(b) * BURST.ringGap) / BURST.grow)) ** 2;

type SceneLook = {
  at: { rise: number; sweep: number; burst: number; back: number }; // ms each change sets off
  gap: { rise: number; sweep: number; back: number }; // ms between bands, rings for black
  cross: number; // ms for one band to cross the panel
  curve: (p: number) => number; // how far across it is, 0 to 1
  burst: (b: number, ms: number) => number; // a band's circle edge, ms after it sets off
};

const SCENE_LOOKS: Record<Look, SceneLook> = {
  // The post's own: on the beat, bands easing into the left edge, and the
  // reference's own burst.
  refined: {
    at: SCENE_TIMING,
    gap: {
      rise: WIPES.spread / (BANDS - 1), // 70: ten bands
      sweep: WIPES.spread / (BANDS - 1),
      back: WIPES.spread / (BANDS / 2 - 1), // 157.5: five rings
    },
    cross: WIPES.cross,
    curve: landing,
    burst: burstRings,
  },
  // The reference: changes when the video made them, and bands crossing at a
  // near constant speed.
  reference: {
    at: REFERENCE.at,
    gap: REFERENCE.gap,
    cross: REFERENCE.cross,
    curve: glide,
    burst: burstRings,
  },
};

const scenes: Motion["line"] = (r, t, look) => {
  const { at, gap, cross, curve, burst } = SCENE_LOOKS[look];
  const ms = t * 1000;
  const b = bandOf(r);
  const i = lineInBand(r);
  const lag = WIPES.lineLag;
  // Where a band that set off at `start` ms has got to, right edge to left.
  const across = (start: number) => PANEL_W * (1 - curve(clamp((ms - start) / cross)));
  return {
    base: BLACK,
    layers: [
      // bottom band first, and inside a band its bottom line first
      { color: ORANGE, edge: across(at.rise + (BANDS - 1 - b) * gap.rise + (BAND - 1 - i) * lag) },
      // top band first, top line first
      { color: STONE, edge: across(at.sweep + b * gap.sweep + i * lag) },
      // the pixel circle out of the right edge
      { color: ORANGE, edge: burst(b, ms - at.burst) },
      // middle bands first, spreading out
      { color: BLACK, edge: across(at.back + ringOf(b) * gap.back + outwardLag(r) * lag) },
    ],
  };
};

export const MOTIONS: Motion[] = [
  {
    id: "scenes",
    label: "Scenes",
    duration: SCENE_TIMING.loop / 1000,
    still: SCENE_TIMING.still / 1000,
    line: scenes,
  },
];

export const MOTION_BY_ID = Object.fromEntries(MOTIONS.map((m) => [m.id, m])) as Record<
  MotionId,
  Motion
>;

// ---------------------------------------------------------------------------
// The wordmark, top right. It is drawn line by line: wherever a wipe has
// reached, the letters take the colours for the new background, so the logo
// changes exactly with the panel behind it. The orange "ai" flips edge-on
// whenever the colour behind it changes, and swaps colour while it is thin.

const LOGO_W = 250;
const LOGO_X = PANEL_W - 72 - LOGO_W;
const LOGO_Y = 72;
const LOGO_SCALE = LOGO_W / WORDMARK.width;
const LOGO_H = WORDMARK.height * LOGO_SCALE;
// The "ai" sits at x 136.7 to 172.4 of the 201-wide wordmark.
const MARK_X = LOGO_X + ((136.7 + 172.4) / 2) * LOGO_SCALE;
const MARK_Y = LOGO_Y + LOGO_H / 2;
const MARK_LINE = Math.floor(MARK_Y / PITCH);
const FLIP = 0.36; // seconds for the "ai" to turn over

// Original colours on stone, all black on orange, reversed on black.
function logoColors(behind: Fill) {
  if (behind === ORANGE) return { letters: PALETTE.ink, mark: PALETTE.ink };
  if (behind === STONE) return { letters: PALETTE.ink, mark: PALETTE.orange };
  return { letters: PALETTE.stone, mark: PALETTE.orange };
}

// Created on first use: Path2D only exists in the browser.
let paths: { letters: Path2D[]; mark: Path2D[] } | null = null;
const getPaths = () =>
  (paths ??= {
    letters: WORDMARK.letters.map((d) => new Path2D(d)),
    mark: WORDMARK.mark.map((d) => new Path2D(d)),
  });

// The visible runs of colour along one line, left to right.
function runs(s: LineState): [number, number, Fill][] {
  let out: [number, number, Fill][] = [[0, PANEL_W, s.base]];
  for (const { edge, color } of s.layers) {
    const e = clamp(edge, 0, PANEL_W);
    if (e >= PANEL_W) continue;
    out = out.flatMap(([a, b, c]): [number, number, Fill][] =>
      b <= e ? [[a, b, c]] : a >= e ? [] : [[a, e, c]],
    );
    out.push([e, PANEL_W, color]);
  }
  return out;
}
const colorAt = (s: LineState, x: number) =>
  runs(s).find(([a, b]) => x >= a && x < b)?.[2] ?? s.base;

// Moments in the loop when the colour behind the "ai" changes.
const flipTimes = new Map<string, number[]>();
function flipsFor(m: Motion, look: Look) {
  const key = `${m.id}:${look}`;
  let times = flipTimes.get(key);
  if (!times) {
    times = [];
    const step = 1 / 600;
    let prev = colorAt(m.line(MARK_LINE, 0, look), MARK_X);
    for (let t = step; t <= m.duration; t += step) {
      const now = colorAt(m.line(MARK_LINE, t, look), MARK_X);
      if (now !== prev) times.push(t - step / 2);
      prev = now;
    }
    flipTimes.set(key, times);
  }
  return times;
}

// Edges land on whole device pixels. When the canvas is scaled to fit a
// window, an edge between pixels would be blended and let colours bleed.
type Snap = (v: number) => number;

function drawLogo(
  ctx: CanvasRenderingContext2D,
  m: Motion,
  t: number,
  lines: LineState[],
  snap: Snap,
  look: Look,
) {
  const { letters, mark } = getPaths();
  const base = ctx.getTransform();
  const place = () => {
    ctx.setTransform(base);
    ctx.translate(LOGO_X, LOGO_Y);
    ctx.scale(LOGO_SCALE, LOGO_SCALE);
  };

  // Letters, one line-high slice at a time, split wherever the colour
  // changes. The slices meet exactly, so no letter is painted twice.
  const first = Math.floor(LOGO_Y / PITCH);
  const last = Math.ceil((LOGO_Y + LOGO_H) / PITCH);
  for (let r = first; r < last; r++) {
    const top = snap(r * PITCH);
    const bottom = snap((r + 1) * PITCH);
    for (const [a, b, color] of runs(lines[r])) {
      if (b <= LOGO_X || a >= LOGO_X + LOGO_W) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(snap(a), top, snap(b) - snap(a), bottom - top);
      ctx.clip();
      place();
      ctx.fillStyle = logoColors(color).letters;
      for (const p of letters) ctx.fill(p);
      ctx.restore();
    }
  }

  // The "ai": flat, or mid-flip around a change of colour behind it.
  let turn = 1;
  for (const at of flipsFor(m, look)) {
    const d = wrap(t - at + m.duration / 2, m.duration) - m.duration / 2;
    if (Math.abs(d) < FLIP / 2) turn = Math.abs(Math.cos(Math.PI * easeInOut(d / FLIP + 0.5)));
  }
  ctx.save();
  ctx.setTransform(base);
  ctx.translate(MARK_X, MARK_Y);
  ctx.scale(Math.max(turn, 0.02), 1);
  ctx.translate(-MARK_X, -MARK_Y);
  ctx.translate(LOGO_X, LOGO_Y);
  ctx.scale(LOGO_SCALE, LOGO_SCALE);
  ctx.fillStyle = logoColors(colorAt(lines[MARK_LINE], MARK_X)).mark;
  for (const p of mark) ctx.fill(p);
  ctx.restore();
}

// Draws one frame. `ctx` is expected to be scaled so 1 unit = 1 post pixel.
export function drawPanel(
  ctx: CanvasRenderingContext2D,
  motion: MotionId,
  seconds: number,
  look: Look = "reference",
) {
  const m = MOTION_BY_ID[motion];
  const t = wrap(seconds, m.duration);
  const k = ctx.getTransform().d || 1;
  const snap: Snap = (v) => Math.round(v * k) / k;

  ctx.fillStyle = PALETTE.gap;
  ctx.fillRect(0, 0, PANEL_W, PANEL_H);
  const lines: LineState[] = [];
  for (let r = 0; r < ROWS; r++) {
    const s = m.line(r, t, look);
    lines.push(s);
    const top = snap(r * PITCH);
    const litTop = snap(r * PITCH + (PITCH - STROKE) / 2);
    const litBottom = snap(r * PITCH + (PITCH + STROKE) / 2);
    const bottom = snap((r + 1) * PITCH);
    // Only the colours that are actually visible, left to right. Each run
    // reaches to the right edge and the next one covers it from its start,
    // so a moving edge blends its two neighbours and nothing hidden shows.
    for (const [a, , f] of runs(s)) {
      ctx.fillStyle = f.gap;
      ctx.fillRect(a, top, PANEL_W - a, litTop - top);
      ctx.fillRect(a, litBottom, PANEL_W - a, bottom - litBottom);
      ctx.fillStyle = f.lit;
      ctx.fillRect(a, litTop, PANEL_W - a, litBottom - litTop);
    }
  }
  drawLogo(ctx, m, t, lines, snap, look);
}
