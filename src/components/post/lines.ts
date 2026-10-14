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

export type MotionId = "scenes" | "climb" | "breathe" | "signal";

type Motion = {
  id: MotionId;
  label: string;
  hint: string;
  duration: number; // seconds per loop; every motion is seamless
  still: number; // the moment used for the PNG and the first video frame
  line: (r: number, t: number) => LineState;
};

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (e0: number, e1: number, x: number) => {
  const k = clamp((x - e0) / (e1 - e0));
  return k * k * (3 - 2 * k);
};
const wrap = (t: number, d: number) => ((t % d) + d) % d;
const easeOut = (x: number) => 1 - (1 - x) ** 3;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
// Out over `rise` seconds, back over `fall` seconds, zero outside.
const pulse = (x: number, rise: number, fall: number) => {
  if (x <= 0 || x >= rise + fall) return 0;
  return x < rise ? easeOut(x / rise) : 1 - easeInOut((x - rise) / fall);
};
// Stable pseudo-random number in [0, 1) for a line.
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const bandOf = (r: number) => Math.floor(r / BAND);
const lineInBand = (r: number) => r % BAND; // 0 is the band's top line

// ---------------------------------------------------------------------------
// Scenes: after the reference video. The panel moves between black, orange
// and stone in stepped band wipes, ten bands of nine lines.
//   black to orange: a staircase rises from the bottom-right corner
//   orange to stone: bands sweep down from the top
//   stone to orange: a stepped circle bursts out of the right edge
//   orange to black: bands slide back in from the middle outwards
// Timings are measured from the reference, frame by frame.

const SCENES = {
  duration: 6,
  still: 1.25, // mid-climb, the staircase from the reference still
  cross: 0.43, // seconds for one band to cross the panel
  lineLag: 0.004, // lines inside a band trail each other, softening its edge
  rise: { at: 0.6, gap: 0.095 },
  sweep: { at: 2.68, gap: 0.088 },
  burst: { at: 4.05, gap: 0.075, grow: 0.75 },
  back: { at: 4.62, gap: 0.09 },
};

// Distance of a band from the middle of the panel: 0 for the two middle bands.
const ringOf = (b: number) => (b < BANDS / 2 ? BANDS / 2 - 1 - b : b - BANDS / 2);
// Lines nearer the middle lead when a wipe spreads outwards from it.
const outwardLag = (r: number) =>
  bandOf(r) < BANDS / 2 ? BAND - 1 - lineInBand(r) : lineInBand(r);

// Mostly linear, with a little ease at both ends.
const glide = (p: number) => 0.5 * p + 0.5 * p * p * (3 - 2 * p);
const crossing = (t: number, start: number) =>
  PANEL_W * (1 - glide(clamp((t - start) / SCENES.cross)));

const scenes: Motion["line"] = (r, t) => {
  const b = bandOf(r);
  const i = lineInBand(r);
  const { rise, sweep, burst, back, lineLag } = SCENES;
  const ring = ringOf(b);
  const grown = clamp((t - burst.at - ring * burst.gap) / burst.grow);
  return {
    base: BLACK,
    layers: [
      // bottom band first, and inside a band its bottom line first
      { color: ORANGE, edge: crossing(t, rise.at + (BANDS - 1 - b) * rise.gap + (BAND - 1 - i) * lineLag) },
      // top band first, top line first
      { color: STONE, edge: crossing(t, sweep.at + b * sweep.gap + i * lineLag) },
      // a crisp stepped circle centred on the right edge, slowing as it grows
      { color: ORANGE, edge: PANEL_W * (1 - grown) ** 2 },
      // middle bands first, spreading out
      { color: BLACK, edge: crossing(t, back.at + ring * back.gap + outwardLag(r) * lineLag) },
    ],
  };
};

// ---------------------------------------------------------------------------
// The other motions keep one fixed staircase: orange steps on a stone base.
// Bands 0 and 1 stay clear for the logo.

const EDGES = [920, 920, 840, 700, 560, 420, 280, 140, 0, 0];
const TOP_STEP = 2;
const LAST_STEP = 7; // lowest band that still has a step edge
const isStep = (b: number) => b >= TOP_STEP && b <= LAST_STEP;
const stepFromBottom = (b: number) => LAST_STEP - b; // 0 is the lowest step

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a: string, b: string, h: number) => {
  const [x, y] = [rgb(a), rgb(b)];
  const c = x.map((v, k) => Math.round(v + (y[k] - v) * h));
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
};
// 0 is stone, 1 is orange. In between only while a line changes colour.
function heatFill(h: number): Fill {
  if (h <= 0) return STONE;
  if (h >= 1) return ORANGE;
  return { lit: mix(STONE.lit, ORANGE.lit, h), gap: mix(STONE.gap, ORANGE.gap, h) };
}
const staircase = (edge: number, heat: number): LineState => ({
  base: BLACK,
  layers: [{ edge, color: heatFill(heat) }],
});
const fixed = (r: number) => staircase(EDGES[bandOf(r)], isStep(bandOf(r)) ? 1 : 0);

// Climb: the steps reach out one after another, lowest first, like someone
// walking up them. Inside a step the bottom line leads by a hair.
const CLIMB = { start: 1, gap: 0.36, rise: 0.38, fall: 0.9, reach: 84, lineLag: 0.014 };
const climb: Motion["line"] = (r, t) => {
  const b = bandOf(r);
  if (!isStep(b)) return fixed(r);
  const lag = (BAND - 1 - lineInBand(r)) * CLIMB.lineLag;
  const x = t - CLIMB.start - stepFromBottom(b) * CLIMB.gap - lag;
  return staircase(EDGES[b] - CLIMB.reach * pulse(x, CLIMB.rise, CLIMB.fall), 1);
};

// Breathe: one slow, continuous wave runs up the staircase.
const BREATHE = { duration: 8, reach: 64, stepLag: 0.12, lineLag: 0.005 };
const breathe: Motion["line"] = (r, t) => {
  const b = bandOf(r);
  if (!isStep(b)) return fixed(r);
  const phase =
    t / BREATHE.duration -
    stepFromBottom(b) * BREATHE.stepLag -
    (BAND - 1 - lineInBand(r)) * BREATHE.lineLag;
  return staircase(EDGES[b] - BREATHE.reach * (0.5 - 0.5 * Math.cos(2 * Math.PI * phase)), 1);
};

// Signal, in three beats. Thinks: line by line the steps cool to stone and
// start to search, each line at its own length. Decides: they lock back onto
// the steps from the bottom up, turning orange as they land. Acts: the top
// step fires across the panel and returns.
const SIGNAL = {
  cool: [0.9, 1.5], // lines cool to stone one by one inside this window
  coolTime: 0.18, // each line's own fade
  search: [1, 1.9], // searching ramps up over this window
  reach: 110, // how far a searching line wanders, px
  lock: 3.3, // lowest step locks here, the rest follow upward
  lockGap: 0.09,
  lockTime: 0.45,
  fire: 4.05, // top step fires
  fireOut: 0.5,
  fireHold: 0.3,
  fireBack: 0.85,
  fireLineLag: 0.018,
};
const signal: Motion["line"] = (r, t) => {
  const b = bandOf(r);
  if (!isStep(b)) return fixed(r);
  const lockAt = SIGNAL.lock + stepFromBottom(b) * SIGNAL.lockGap;
  const landed = easeOut(clamp((t - lockAt) / SIGNAL.lockTime));
  const searching = smooth(SIGNAL.search[0], SIGNAL.search[1], t) * (1 - landed);
  const wander =
    0.62 * Math.sin(2 * Math.PI * (0.55 * t + hash(r))) +
    0.38 * Math.sin(2 * Math.PI * (1.15 * t + hash(r + 91)));
  let edge = EDGES[b] + SIGNAL.reach * searching * wander;

  const coolAt = SIGNAL.cool[0] + (SIGNAL.cool[1] - SIGNAL.cool[0]) * hash(r + 7);
  const cooled = smooth(coolAt, coolAt + SIGNAL.coolTime, t);
  // Back to orange, line by line, as the step lands.
  const relightAt = lockAt + 0.06 + 0.14 * hash(r + 13);
  const relit = smooth(relightAt, relightAt + SIGNAL.coolTime, t);
  const heat = 1 - cooled * (1 - relit);

  if (b === TOP_STEP) {
    const x = t - SIGNAL.fire - lineInBand(r) * SIGNAL.fireLineLag;
    const { fireOut: out, fireHold: hold, fireBack: back } = SIGNAL;
    let f = 0;
    if (x > 0 && x < out) f = easeOut(x / out);
    else if (x >= out && x < out + hold) f = 1;
    else if (x >= out + hold && x < out + hold + back) f = 1 - easeInOut((x - out - hold) / back);
    edge -= EDGES[b] * f;
  }
  return staircase(edge, heat);
};

export const MOTIONS: Motion[] = [
  {
    id: "scenes",
    label: "Scenes",
    hint: "Like the reference: black, orange and stone in stepped wipes, a rising staircase, a sweep and a pixel burst",
    duration: SCENES.duration,
    still: SCENES.still,
    line: scenes,
  },
  {
    id: "climb",
    label: "Climb",
    hint: "The steps reach out one after another, lowest first",
    duration: 6,
    still: 0,
    line: climb,
  },
  {
    id: "breathe",
    label: "Breathe",
    hint: "One slow wave runs up the staircase",
    duration: BREATHE.duration,
    still: 0,
    line: breathe,
  },
  {
    id: "signal",
    label: "Signal",
    hint: "Thinks, decides, acts: the lines search, lock onto the steps, then the top step fires",
    duration: 7,
    still: 0,
    line: signal,
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
const flipTimes = new Map<MotionId, number[]>();
function flipsFor(m: Motion) {
  let times = flipTimes.get(m.id);
  if (!times) {
    times = [];
    const step = 1 / 600;
    let prev = colorAt(m.line(MARK_LINE, 0), MARK_X);
    for (let t = step; t <= m.duration; t += step) {
      const now = colorAt(m.line(MARK_LINE, t), MARK_X);
      if (now !== prev) times.push(t - step / 2);
      prev = now;
    }
    flipTimes.set(m.id, times);
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
  for (const at of flipsFor(m)) {
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
export function drawPanel(ctx: CanvasRenderingContext2D, motion: MotionId, seconds: number) {
  const m = MOTION_BY_ID[motion];
  const t = wrap(seconds, m.duration);
  const k = ctx.getTransform().d || 1;
  const snap: Snap = (v) => Math.round(v * k) / k;

  ctx.fillStyle = PALETTE.gap;
  ctx.fillRect(0, 0, PANEL_W, PANEL_H);
  const lines: LineState[] = [];
  for (let r = 0; r < ROWS; r++) {
    const s = m.line(r, t);
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
  drawLogo(ctx, m, t, lines, snap);
}
