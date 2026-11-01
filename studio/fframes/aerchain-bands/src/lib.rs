//! Aerchain bands: the speaker post's line field, full frame, as a 4 second loop.
//! The same film is made in Remotion and HyperFrames with the same numbers, so
//! the three engines can be compared side by side.
//!
//! 90 lines on a 12px pitch (an 8px line, a 2px darker gap above and below) in
//! 10 bands of 9. Every line is its base black across the full width, with
//! each later colour painted over it from its edge to the right edge, so
//! colour only ever arrives from the right.
//!
//! The film is drawn in the post's 1920x1080 units and rendered at 4K: the
//! SVG's viewBox does the scaling, and `render --draft` gives 1080p.
use fframes::{AudioMap, Color, Duration, FFramesContext, Frame, Svgr, Video, include_media_dir};

// Every file of `media/` is embedded into the binary: two cuts of Bricolage
// Grotesque, the post's typeface, made from the variable font at the optical
// size Chrome uses for each line (so all three engines draw the same glyphs).
include_media_dir!(pub struct AerchainBandsMedia, "media");

pub const WIDTH: usize = 3840;
pub const HEIGHT: usize = 2160;

const W: f32 = 1920.0;
const PITCH: f32 = 12.0;
const STROKE: f32 = 8.0;
const ROWS: usize = 90;
const BAND: usize = 9;
const BANDS: usize = 10;

/// Each colour is a flat field with slightly darker lines through it.
#[derive(Clone, Copy, PartialEq)]
struct Fill {
    lit: &'static str,
    gap: &'static str,
}
const BLACK: Fill = Fill { lit: "#1E1E1E", gap: "#141414" };
const ORANGE: Fill = Fill { lit: "#F55A00", gap: "#DB5000" };
const STONE: Fill = Fill { lit: "#D3CCBF", gap: "#C2BAAC" };
const TEXT: &str = "#E9E5DD";
const FONT: &str = "Bricolage Grotesque";

/// Where each band's colour starts once in place: a stone staircase, with an
/// orange one 240px inside it. The top two bands stay clear for the words.
const STONE_STEPS: [f32; BANDS] = [W, W, 1440., 1200., 960., 720., 480., 240., 0., 0.];

// STORYBOARD (seconds)
//   0.20  stone rises as a staircase from the bottom right, bottom band first
//         (70ms apart), each line 4ms behind the one below it
//   0.65  orange follows it in the same way, 240px short of each step
//   2.60  black slides back in from the middle bands outwards
//   4.00  loop: all black again
const AT_STONE: f32 = 0.2;
const AT_ORANGE: f32 = 0.65;
const AT_BLACK: f32 = 2.6;
const BAND_GAP: f32 = 0.07;
const RING_GAP: f32 = 0.1575;
const LINE_LAG: f32 = 0.004;
const TRAVEL: f32 = 0.8;
const CROSS: f32 = 0.5;

/// Sets off at half speed and eases into its step, like the post's bands.
fn landing(p: f32) -> f32 {
    let p = p.clamp(0.0, 1.0);
    0.5 * p + 2.0 * p * p - 1.5 * p * p * p
}

/// Distance of a band from the middle of the frame: 0 for the two middle bands.
fn ring_of(b: usize) -> usize {
    if b < BANDS / 2 { BANDS / 2 - 1 - b } else { b - BANDS / 2 }
}

/// Lines nearer the middle lead when black spreads outwards.
fn outward_lag(r: usize) -> usize {
    if r / BAND < BANDS / 2 { BAND - 1 - r % BAND } else { r % BAND }
}

/// The colours of line `r` that can be seen at `t`, left to right, as
/// (x, colour): each reaches to the right edge and the next covers it from its
/// own start, so a moving edge blends its two neighbours and nothing hidden
/// shows through.
fn runs(r: usize, t: f32) -> Vec<(f32, Fill)> {
    let b = r / BAND;
    let mut out = vec![(0.0, BLACK)];
    if STONE_STEPS[b] >= W {
        return out;
    }
    let up = (BANDS - 1 - b) as f32 * BAND_GAP + (BAND - 1 - r % BAND) as f32 * LINE_LAG;
    let black_at = AT_BLACK + ring_of(b) as f32 * RING_GAP + outward_lag(r) as f32 * LINE_LAG;
    // (colour, start, duration, to x), in paint order; every move sets off at the right edge.
    let moves = [
        (STONE, AT_STONE + up, TRAVEL, STONE_STEPS[b]),
        (ORANGE, AT_ORANGE + up, TRAVEL, (STONE_STEPS[b] + 240.).min(W)),
        (BLACK, black_at, CROSS, 0.0),
    ];
    for (fill, start, duration, to) in moves {
        let x = W + (to - W) * landing((t - start) / duration);
        out.retain(|(a, _)| *a < x);
        out.push((x, fill));
    }
    out.retain(|(a, _)| *a < W);
    out
}

pub struct AerchainBandsVideo<'a> {
    pub media: &'a AerchainBandsMedia,
}

impl<'a> AerchainBandsVideo<'a> {
    pub fn new(media: &'a AerchainBandsMedia) -> Self {
        Self { media }
    }
}

impl std::fmt::Debug for AerchainBandsVideo<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AerchainBandsVideo").finish()
    }
}

impl Video for AerchainBandsVideo<'_> {
    const FPS: usize = 60;
    const WIDTH: usize = WIDTH;
    const HEIGHT: usize = HEIGHT;
    const BACKGROUND_COLOR: Color = Color::BLACK;

    fn duration(&self) -> Duration<'_> {
        Duration::Seconds(4.0)
    }

    fn audio(&self) -> AudioMap<'_> {
        AudioMap::none()
    }

    fn render_frame<'a>(&'a self, frame: Frame, _ctx: &FFramesContext<'a, '_>) -> Svgr<'a> {
        let t = frame.seconds();

        // The base black lines, then every other visible run on top.
        let mut lines: Vec<Svgr<'a>> = Vec::with_capacity(ROWS * 3);
        for r in 0..ROWS {
            let lit_top = r as f32 * PITCH + (PITCH - STROKE) / 2.;
            lines.push(fframes::svgr!(<rect x="0" y={lit_top} width={W} height={STROKE} fill={BLACK.lit} />));
        }
        for r in 0..ROWS {
            let top = r as f32 * PITCH;
            let lit_top = top + (PITCH - STROKE) / 2.;
            for (x, fill) in runs(r, t) {
                if x == 0.0 && fill == BLACK {
                    continue;
                }
                let width = W - x;
                lines.push(fframes::svgr!(<rect x={x} y={top} width={width} height={PITCH} fill={fill.gap} />));
                lines.push(fframes::svgr!(<rect x={x} y={lit_top} width={width} height={STROKE} fill={fill.lit} />));
            }
        }

        // Cap tops on y 72, as on the post (cap height is 0.66 em).
        fframes::svgr!(
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width={WIDTH} height={HEIGHT}>
                <rect width="1920" height="1080" fill={BLACK.gap} />
                {lines}
                <text x="72" y="128.76" font-family={FONT} font-size="86" font-weight="600" letter-spacing="-0.86" fill={TEXT}>
                    "One film, three engines"
                </text>
                <text x="72" y="180" font-family={FONT} font-size="32" font-weight="400" fill={TEXT} fill-opacity="0.5">
                    "Rendered in fframes"
                </text>
            </svg>
        )
    }
}
