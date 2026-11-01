# Aerchain bands (fframes)

The studio's sample film in [fframes](https://github.com/dmtrKovalenko/fframes): a
3840x2160, 60 fps video drawn in Rust as SVG and rendered on the GPU (Skia on Metal). The
same film exists in Remotion and HyperFrames; see "Motion engines" in the project README.

| file | what |
| --- | --- |
| `src/lib.rs` | the video: the line field, its moves and the words |
| `src/main.rs` | the command line (`fframes::cli`), with a `--master` flag |
| `media/` | two cuts of Bricolage Grotesque, embedded into the binary (`OFL.txt`) |

The first build takes about 2.5 minutes and fills `target/` (about 2 GB, ignored by git);
later builds take seconds.

## Work on it

```sh
cargo run --release -- timeline                 # duration and frame count
cargo run --release -- inspect                  # missing fonts, clipped text, bad shapes
cargo run --release -- strip -n 8 --columns 4   # contact sheet, writes strip.png
cargo run --release -- frame 2s                 # full-size PNG into frames/
cargo run --release -- preview                  # real-time window (space, h/l, j/k, q)
cargo run --release -- render --draft           # 1080p, in under a second
cargo run --release -- render                   # 4K MP4, H.264 CRF 14, tagged BT.709
```

`node scripts/studio/render.mjs aerchain-bands-fframes` (from the project root) renders a
lossless master with `render --master` and makes the 4K and 1080p files from it, like the
other engines.
