use aerchain_bands::{AerchainBandsMedia, AerchainBandsVideo, HEIGHT, WIDTH};
use fframes::cli::clap; // the derive below expands to `clap::...`
use fframes::ffmpeg_sys_fframes::AVCodecID;
use fframes::pix_fmt::YuvMatrix;
use fframes::{AVPixelFormat, EncoderOptions, RenderOptions, StaticMediaProvider, cli};
use fframes_skia_renderer::{
    SkiaFFramesRenderer, SkiaPipelineConcurrencyPolicy, SkiaPipelineConfig, metal::SkiaMetalCtx,
};
use std::process::ExitCode;

/// Flags of this video next to the standard ones of `fframes::cli` (render, frame, strip,
/// inspect, audio, ...). Run `cargo run --release -- --help`.
#[derive(Debug, clap::Args)]
struct VideoArgs {
    /// Encode losslessly (FFV1, full RGB) for scripts/studio/render.mjs, which makes the
    /// 4K and 1080p files from it. Use with `-o master.mkv`.
    #[arg(long, global = true)]
    master: bool,
}

fn main() -> ExitCode {
    let args = cli::parse::<VideoArgs>();
    let media = AerchainBandsMedia::prepare().expect("media");
    let video = AerchainBandsVideo::new(&media);
    let gpu = SkiaMetalCtx::new(WIDTH, HEIGHT).expect("GPU context");

    let video_encoder_options = if args.app.master {
        EncoderOptions {
            codec: Some(AVCodecID::AV_CODEC_ID_FFV1),
            preferred_encoder: Some("ffv1"),
            pixel_format: AVPixelFormat::AV_PIX_FMT_BGR0,
            ..Default::default()
        }
    } else {
        // On its own, `render` writes the house MP4: H.264 at CRF 14, tagged BT.709 like
        // `npm run export`, so the orange plays back as the same orange everywhere.
        EncoderOptions {
            preferred_encoder: Some("libx264"),
            codec_params: Some(&[("crf", "14"), ("preset", "slow"), ("tune", "animation")]),
            color_matrix: YuvMatrix::Bt709,
            qmin: 0,
            gop_size: 120,
            ..Default::default()
        }
    };

    cli::new(&video, RenderOptions { media: Some(&media), video_encoder_options, ..Default::default() })
        .args(args)
        // Frame previews (frame, strip, onion) render with the same Skia backend.
        .backend(
            SkiaFFramesRenderer::new_metal(
                &gpu,
                SkiaPipelineConfig {
                    concurrency_policy: SkiaPipelineConcurrencyPolicy::MaxPerformance,
                    ..Default::default()
                },
            )
            .expect("skia renderer"),
        )
        // `preview` opens the real-time GPU player.
        .preview(fframes_native_player::cli_preview)
        .run()
}
