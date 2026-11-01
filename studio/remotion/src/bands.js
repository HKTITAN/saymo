// Aerchain bands: the speaker post's line field, full frame, as a 4 second
// loop. The same film is made in all three engines (HyperFrames and fframes
// have their own copy of these numbers), so they can be compared side by side.
//
// 90 lines on a 12px pitch: an 8px line with a 2px darker gap above and below,
// grouped in 10 bands of 9. Every line is its base black across the full
// width, with each later colour painted over it from its edge to the right
// edge, so colour only ever arrives from the right.

export const W = 1920;
export const H = 1080;
export const FPS = 60;
export const DURATION = 4; // seconds; frame 240 is frame 0 again

const PITCH = 12;
const STROKE = 8;
const ROWS = H / PITCH; // 90
const BAND = 9;
const BANDS = ROWS / BAND; // 10

// Each colour is a flat field with slightly darker lines through it.
export const BLACK = { lit: "#1E1E1E", gap: "#141414" };
const ORANGE = { lit: "#F55A00", gap: "#DB5000" };
const STONE = { lit: "#D3CCBF", gap: "#C2BAAC" };
export const TEXT = "#E9E5DD";

// Where each band's colour starts once it is in place: a stone staircase,
// with an orange one 240px inside it. The top two bands stay clear for the
// words.
const STONE_STEPS = [W, W, 1440, 1200, 960, 720, 480, 240, 0, 0];
const ORANGE_STEPS = STONE_STEPS.map((x) => Math.min(W, x + 240));

/* ─────────────────────────────────────────────────────────
 * STORYBOARD (seconds)
 *   0.20  stone rises as a staircase from the bottom right, bottom band
 *         first (70ms apart), each line 4ms behind the one below it
 *   0.65  orange follows it in the same way, 240px short of each step
 *   2.60  black slides back in from the middle bands outwards
 *   4.00  loop: all black again
 * ───────────────────────────────────────────────────────── */
const T = { stone: 0.2, orange: 0.65, black: 2.6, gap: 0.07, ring: 0.1575, lag: 0.004, travel: 0.8, cross: 0.5 };

const clamp = (v) => Math.min(1, Math.max(0, v));
// Sets off at half speed and eases into its step, like the post's bands.
export const landing = (p) => 0.5 * p + 2 * p * p - 1.5 * p ** 3;

const bandOf = (r) => Math.floor(r / BAND);
const lineInBand = (r) => r % BAND;
// Distance of a band from the middle of the frame: 0 for the two middle bands.
const ringOf = (b) => (b < BANDS / 2 ? BANDS / 2 - 1 - b : b - BANDS / 2);
// Lines nearer the middle lead when black spreads outwards.
const outwardLag = (r) => (bandOf(r) < BANDS / 2 ? BAND - 1 - lineInBand(r) : lineInBand(r));

// Every move of line `r`, in paint order: [colour, start, duration, from x, to x].
export function moves(r) {
  const b = bandOf(r);
  if (STONE_STEPS[b] >= W) return [];
  const up = (BANDS - 1 - b) * T.gap + (BAND - 1 - lineInBand(r)) * T.lag;
  return [
    [STONE, T.stone + up, T.travel, W, STONE_STEPS[b]],
    [ORANGE, T.orange + up, T.travel, W, ORANGE_STEPS[b]],
    [BLACK, T.black + ringOf(b) * T.ring + outwardLag(r) * T.lag, T.cross, W, 0],
  ];
}

// Where a move's edge is at `t` seconds.
const edgeAt = ([, start, duration, from, to], t) => from + (to - from) * landing(clamp((t - start) / duration));

// The colours of line `r` that can be seen at `t`, left to right, as
// [x, colour]: each reaches to the right edge and the next covers it from its
// own start, so a moving edge blends its two neighbours and nothing hidden
// shows through.
export function runs(r, t) {
  let out = [[0, BLACK]];
  for (const move of moves(r)) {
    const x = edgeAt(move, t);
    out = out.filter(([a]) => a < x);
    out.push([x, move[0]]);
  }
  return out.filter(([a]) => a < W);
}

export const line = (r) => ({
  top: r * PITCH,
  litTop: r * PITCH + (PITCH - STROKE) / 2,
});
export { ROWS, PITCH, STROKE };
