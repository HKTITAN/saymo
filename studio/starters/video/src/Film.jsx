import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import graphics from "studio-graphics";
import { Captions, useBrandFont, usePalette } from "studio-kit";

// A VIDEO FILM: an edit of footage, played from edit.json (see
// src/lib/studio/edit.ts for its shape). The studio gives it two props:
//   edit   the timeline: tracks of clips and graphics, and captions
//   media  { [media id]: { src, kind, width, height } }: where each file is.
//          The stage gets the smooth preview copies, a render the originals.
// The timeline, Claude and the render all change edit.json, never this file;
// change this file only to change how every edit is drawn.

export default function Film({ edit, media = {} }) {
  useBrandFont();
  if (!edit) return null;
  return (
    <AbsoluteFill style={{ backgroundColor: edit.background ?? "#141414" }}>
      {edit.tracks.map((track) =>
        track.hidden ? null : (
          <AbsoluteFill key={track.id}>
            {track.items.map((item) =>
              item.type === "clip" ? (
                <Clip key={item.id} clip={item} file={media[item.media]} muted={track.muted} soundOnly={track.kind === "audio"} />
              ) : (
                <Graphic key={item.id} item={item} />
              ),
            )}
          </AbsoluteFill>
        ),
      )}
      {edit.captions?.on ? (
        <Captions words={edit.captions.words} style={edit.captions.style} position={edit.captions.position} />
      ) : null}
    </AbsoluteFill>
  );
}

// Where a clip sits on the film, in frames.
function span(start, length, fps) {
  const from = Math.round(start * fps);
  return { from, durationInFrames: Math.max(1, Math.round((start + length) * fps) - from) };
}

// The clip covers the frame, scaled by zoom, with the source point (x, y)
// (0..1) as near the centre as covering allows: how a 16:9 interview turns
// into a 9:16 story with the speaker kept in view.
function framing(file, clip, W, H) {
  const w = file.width || W;
  const h = file.height || H;
  const s = Math.max(W / w, H / h) * Math.max(1, clip.zoom ?? 1);
  const width = w * s;
  const height = h * s;
  const left = Math.min(0, Math.max(W - width, W / 2 - (clip.x ?? 0.5) * width));
  const top = Math.min(0, Math.max(H - height, H / 2 - (clip.y ?? 0.5) * height));
  return { position: "absolute", left, top, width, height };
}

function Clip({ clip, file, muted, soundOnly }) {
  const { fps } = useVideoConfig();
  const speed = clip.speed ?? 1;
  const length = (clip.to - clip.from) / speed;
  const where = span(clip.start, length, fps);
  return (
    <Sequence {...where} layout="none" name={file?.name ?? "Clip"}>
      {file ? <ClipBody clip={clip} file={file} muted={muted} soundOnly={soundOnly} length={length} /> : <Missing />}
    </Sequence>
  );
}

function ClipBody({ clip, file, muted, soundOnly, length }) {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const speed = clip.speed ?? 1;
  const fade = (t) => {
    let k = 1;
    if (clip.fadeIn) k *= Math.min(1, t / clip.fadeIn);
    if (clip.fadeOut) k *= Math.min(1, (length - t) / clip.fadeOut);
    return Math.max(0, Math.min(1, k));
  };
  const volume = (f) => (muted ? 0 : (clip.volume ?? 1) * fade(f / fps));
  // Trims are in frames of the source at the film's frame rate.
  const trim = { trimBefore: Math.round(clip.from * fps), trimAfter: Math.max(Math.round(clip.from * fps) + 1, Math.round(clip.to * fps)) };

  if (file.kind === "audio" || soundOnly) {
    return <Audio src={file.src} {...trim} playbackRate={speed} volume={volume} />;
  }
  const opacity = fade(frame / fps);
  // A clip with a box fills that part of the frame only (a split screen,
  // the top half of a half-and-half reel); it's framed inside the box as
  // it would be inside the whole frame.
  const box = clip.box;
  const bw = box ? box.w * W : W;
  const bh = box ? box.h * H : H;
  const picture =
    file.kind === "image" ? (
      <Img src={file.src} style={{ ...framing(file, clip, bw, bh), objectFit: "cover", opacity }} />
    ) : (
      <OffthreadVideo
        src={file.src}
        {...trim}
        playbackRate={speed}
        volume={volume}
        style={{ ...framing(file, clip, bw, bh), objectFit: "cover", opacity }}
      />
    );
  if (!box) return picture;
  return (
    <div style={{ position: "absolute", left: box.x * W, top: box.y * H, width: bw, height: bh, overflow: "hidden" }}>{picture}</div>
  );
}

// A clip whose file isn't ready yet (still being brought in).
function Missing() {
  const { width: W, height: H } = useVideoConfig();
  const u = Math.min(W, H) / 1080;
  const family = useBrandFont();
  const palette = usePalette();
  return (
    <AbsoluteFill style={{ background: palette.black.lit, alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: family, fontSize: Math.round(28 * u), color: palette.muted }}>Getting this clip ready</div>
    </AbsoluteFill>
  );
}

function Graphic({ item }) {
  const { fps } = useVideoConfig();
  const found = graphics[item.graphic];
  if (!found) return null;
  const values = Object.fromEntries((found.meta.params ?? []).map((p) => [p.key, p.value]));
  Object.assign(values, item.values);
  const where = span(item.start, item.duration, fps);
  const Component = found.Component;
  return (
    <Sequence {...where} layout="none" name={found.meta.label}>
      <AbsoluteFill data-part={`graphic-${item.id}`}>
        <Component values={values} duration={where.durationInFrames / fps} />
      </AbsoluteFill>
    </Sequence>
  );
}
