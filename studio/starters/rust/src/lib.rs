//! A studio film, written for fframes: Rust that draws one SVG per frame,
//! rendered on the GPU. For heavy, generative scenes; the studio previews it
//! as a quick draft video.
//!
//! Size, fps, length and the panel's params come from film.json and
//! params.json through build.rs, as constants (VIEW_W, P_ACCENT, ...).
//!
//! SWELL (5 s)
//!   0.50  the accent arrives from the right, bottom line first, each line
//!         reaching a little further where a slow wave swells it
//!   1.80  cover: landed, the wave still rolling through the edge
//!   3.60  black slides back in from the middle lines outwards
//!   5.00  all black again: it loops
use fframes::{AudioMap, Color, Duration, FFramesContext, Frame, Svgr, Video, include_media_dir};

include!(concat!(env!("OUT_DIR"), "/film.rs"));

// Every file of `media/` is embedded into the binary: two cuts of Bricolage
// Grotesque (OFL.txt), the speaker post's typeface.
include_media_dir!(pub struct FilmMedia, "media");

// The line texture: an 8px line on a 12px pitch, each colour a flat
// field with a slightly darker partner in the gaps.
const PITCH: f32 = 12.0;
const STROKE: f32 = 8.0;
const BLACK_LIT: &str = "#1E1E1E";
const BLACK_GAP: &str = "#141414";
const TEXT: &str = "#E9E5DD";
const FONT: &str = "Bricolage Grotesque";

/// Sets off at half speed and eases into place, like the post's bands.
fn landing(p: f32) -> f32 {
    let p = p.clamp(0.0, 1.0);
    0.5 * p + 2.0 * p * p - 1.5 * p * p * p
}

/// The accent's darker partner, for the gaps between its lines.
fn darker(hex: &str) -> String {
    let n = u32::from_str_radix(hex.trim_start_matches('#'), 16).unwrap_or(0xF55A00);
    let c = |shift: u32| (((n >> shift) & 255) as f32 * 0.895).round() as u32;
    format!("#{:02X}{:02X}{:02X}", c(16), c(8), c(0))
}

pub struct FilmVideo<'a> {
    pub media: &'a FilmMedia,
    gap: String,
}

impl<'a> FilmVideo<'a> {
    pub fn new(media: &'a FilmMedia) -> Self {
        Self { media, gap: darker(P_ACCENT) }
    }
}

impl std::fmt::Debug for FilmVideo<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FilmVideo").finish()
    }
}

impl Video for FilmVideo<'_> {
    const FPS: usize = FPS;
    const WIDTH: usize = WIDTH;
    const HEIGHT: usize = HEIGHT;
    const BACKGROUND_COLOR: Color = Color::BLACK;

    fn duration(&self) -> Duration<'_> {
        Duration::Seconds(DURATION)
    }

    fn audio(&self) -> AudioMap<'_> {
        AudioMap::none()
    }

    fn render_frame<'a>(&'a self, frame: Frame, _ctx: &FFramesContext<'a, '_>) -> Svgr<'a> {
        let t = frame.seconds();
        let (w, h) = (VIEW_W, VIEW_H);
        let rows = (h / PITCH).ceil() as usize;
        let first = rows * 45 / 100; // the accent fills the lower 55%
        let middle = (first + rows) as f32 / 2.0;

        let mut lines: Vec<Svgr<'a>> = Vec::with_capacity(rows * 5);
        for r in 0..rows {
            let lit_top = r as f32 * PITCH + (PITCH - STROKE) / 2.;
            lines.push(fframes::svgr!(<rect x="0" y={lit_top} width={w} height={STROKE} fill={BLACK_LIT} />));
        }
        for r in first..rows {
            let top = r as f32 * PITCH;
            let lit_top = top + (PITCH - STROKE) / 2.;
            let from_bottom = (rows - 1 - r) as f32;
            let depth = (r - first) as f32 / (rows - first) as f32; // 0 top .. 1 bottom
            // How far in from the right edge the line reaches once landed: a
            // staircase-like ramp, swelled by a wave rolling down the lines.
            let wave = (std::f32::consts::TAU * (depth * 1.3 - t * 0.35)).sin();
            let reach = (w * (0.25 + 0.6 * depth) + P_SWELL * wave).clamp(0.0, w);
            let accent_x = w - reach * landing((t - 0.5 - from_bottom * 0.005) / 0.9);
            let black_x = w - w * landing((t - 3.6 - (r as f32 + 0.5 - middle).abs() * 0.005) / 0.5);
            for (x, gap, lit) in [(accent_x, self.gap.as_str(), P_ACCENT), (black_x, BLACK_GAP, BLACK_LIT)] {
                if x >= w {
                    continue;
                }
                let width = w - x;
                lines.push(fframes::svgr!(<rect x={x} y={top} width={width} height={PITCH} fill={gap} />));
                lines.push(fframes::svgr!(<rect x={x} y={lit_top} width={width} height={STROKE} fill={lit} />));
            }
        }

        // The headline fades up as the accent lands and leaves with the black.
        let shown = landing((t - 0.3) / 0.6) * (1.0 - landing((t - 3.5) / 0.4));
        let lift = 24.0 * (1.0 - landing((t - 0.3) / 0.6));
        let base = 72.0 + 0.66 * 86.0 + lift; // cap tops on y 72, as on the post

        fframes::svgr!(
            <svg xmlns="http://www.w3.org/2000/svg" viewBox={format!("0 0 {w} {h}")} width={WIDTH} height={HEIGHT}>
                <rect width={w} height={h} fill={BLACK_GAP} />
                {lines}
                <text x="72" y={base} font-family={FONT} font-size="86" font-weight="600" letter-spacing="-0.86" fill={TEXT} fill-opacity={shown}>
                    {P_HEADLINE}
                </text>
            </svg>
        )
    }
}
