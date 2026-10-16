"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { post } from "@/content/post";
import { cn } from "@/lib/utils";
import { EVENT_ICONS } from "./icons";
import { drawPanel, type Look, MOTION_BY_ID, PANEL_H, PANEL_W, type MotionId } from "./lines";
import { PALETTE } from "./palette";

// The post is laid out at its export size, 1920 x 1080, in post pixels.
export const POST_W = 1920;
export const POST_H = 1080;
const LEFT_W = POST_W - PANEL_W; // 1000
const MARGIN = 72;
const PHOTO = 240; // the speaker's square photo, as scripts/photo.mjs makes it
// The headline: placed so its cap height lines up with the top of the logo.
const HEADLINE = { top: MARGIN - 16, size: 86, leading: 1.04 };

export type PostHandle = { renderAt: (seconds: number) => void };

// Ordinal endings after a number (20th, 21st) set small and raised, their
// tops level with the figures. Tailwind's base styles already keep a <sup>
// from opening up the line.
function ordinals(text: string) {
  return text.split(/(?<=\d)(st|nd|rd|th)\b/).map((part, i) =>
    i % 2 ? (
      <sup key={`${i}-${part}`} style={{ fontSize: "0.6em", top: "-0.48em" }}>
        {part}
      </sup>
    ) : (
      part
    ),
  );
}

// A line with its accent words in orange and its ordinals raised.
function accented(line: string, accent?: string) {
  const at = accent ? line.indexOf(accent) : -1;
  if (!accent || at < 0) return ordinals(line);
  return (
    <>
      {ordinals(line.slice(0, at))}
      <span style={{ color: PALETTE.orangeLine }}>{ordinals(accent)}</span>
      {ordinals(line.slice(at + accent.length))}
    </>
  );
}

type PostProps = {
  motion: MotionId;
  playing: boolean;
  // Canvas pixels per post pixel: 1 when exporting, more on a sharp screen.
  pixelScale: number;
  // When false nothing runs on its own and the exporter sets each frame.
  live?: boolean;
  // The viewer's Before/After switch; softer landings otherwise.
  look?: Look;
  ref?: Ref<PostHandle>;
};

export function Post({
  motion,
  playing,
  pixelScale,
  live = true,
  look,
  ref,
}: PostProps) {
  const shownLook: Look = look ?? "refined";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elapsed = useRef(0);

  const render = (seconds: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
    drawPanel(ctx, motion, seconds, shownLook);
  };

  useImperativeHandle(ref, () => ({ renderAt: render }));

  // Size the canvas backing store to the pixels it actually covers.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.round(PANEL_W * pixelScale);
    canvas.height = Math.round(PANEL_H * pixelScale);
    render(elapsed.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixelScale]);

  // Each motion starts on its still frame, the same one the export opens on.
  useEffect(() => {
    elapsed.current = MOTION_BY_ID[motion].still;
    render(elapsed.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motion]);

  // A new look redraws the same moment, so Before and After compare frame
  // for frame.
  useEffect(() => {
    render(elapsed.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownLook]);

  useEffect(() => {
    if (!live || !playing) return;
    let raf = 0;
    let last = performance.now();
    const duration = MOTION_BY_ID[motion].duration;
    const tick = (now: number) => {
      elapsed.current = (elapsed.current + (now - last) / 1000) % duration;
      last = now;
      render(elapsed.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, playing, motion, pixelScale, shownLook]);

  const { title, speaker, event, skyline } = post;
  const { place } = skyline;

  return (
    <div
      className="relative overflow-hidden"
      style={{ width: POST_W, height: POST_H, background: PALETTE.stone }}
      data-post
    >
      {/* Left: headline, when and where, and the speaker on stone */}
      <div className="absolute inset-y-0 left-0" style={{ width: LEFT_W }}>
        <h1
          className="absolute font-semibold"
          // Nudged so the letter stems line up with the photo's left edge and
          // the cap height lines up with the top of the logo.
          style={{
            left: MARGIN - 4.3,
            top: HEADLINE.top,
            fontSize: HEADLINE.size,
            lineHeight: HEADLINE.leading,
            letterSpacing: "-0.01em",
            color: PALETTE.ink,
          }}
        >
          {/* The first line leads at full strength; the rest sits back at 60%,
              which still reads at 4.4:1 on stone when the post is seen small. */}
          {title.map((line, i) => (
            <span key={line} className={cn("block whitespace-nowrap", i > 0 && "opacity-60")}>
              {line}
            </span>
          ))}
        </h1>

        {/* When and where, side by side under the headline, laid out like the
            event's own artwork: an outlined tile with the icon, a small
            tracked label, then the detail on two lines. The icons take the
            labels' neutral; the accent words take the palette's deeper
            orange, which reads at 3.2:1 on stone where the brand orange
            would not. */}
        <div
          className="absolute flex"
          style={{
            left: MARGIN,
            top: HEADLINE.top + title.length * HEADLINE.size * HEADLINE.leading + 56,
            gap: 40,
          }}
        >
          {event.map((item) => (
            <div key={item.id} className="flex items-center" style={{ gap: 16 }}>
              <div
                className="flex shrink-0 items-center justify-center"
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 14,
                  border: "1.5px solid rgb(20 20 20 / 0.14)",
                }}
              >
                <HugeiconsIcon
                  icon={EVENT_ICONS[item.id]}
                  size={28}
                  strokeWidth={1.5}
                  color={PALETTE.muted}
                  aria-hidden="true"
                />
              </div>
              <div>
                <p
                  className="font-medium uppercase"
                  style={{ fontSize: 12, lineHeight: 1.2, letterSpacing: "0.16em", color: PALETTE.muted }}
                >
                  {item.label}
                </p>
                <p
                  className="font-semibold"
                  style={{
                    fontSize: 20,
                    lineHeight: 1.2,
                    letterSpacing: "-0.01em",
                    marginTop: 5,
                    color: PALETTE.ink,
                  }}
                >
                  {item.lines.map((line) => (
                    <span key={line} className="block whitespace-nowrap">
                      {accented(line, "accent" in item ? item.accent : undefined)}
                    </span>
                  ))}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div
          className="absolute flex items-end"
          style={{ left: MARGIN, bottom: MARGIN, gap: 40 }}
        >
          {/* A plain img on purpose: the photo is pre-sized for the export
              and must not be resampled again by an image optimiser. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={speaker.photo.x1}
            srcSet={`${speaker.photo.x1} 1x, ${speaker.photo.x2} 2x`}
            width={PHOTO}
            height={PHOTO}
            alt={speaker.name}
            className="block shrink-0"
            draggable={false}
          />
          {/* Bottom-aligned with the photo: the last line's box reaches 8.4px
              below its baseline at these sizes, so hanging the column 8.4px
              low would sit that baseline on the photo's bottom edge; it hangs
              6.4px, nudged 2px up by eye. */}
          <div style={{ marginBottom: -6.4 }}>
            <p
              className="font-medium"
              style={{ fontSize: 30, lineHeight: 1.2, letterSpacing: "-0.01em", color: PALETTE.ink }}
            >
              {speaker.name}
            </p>
            <p
              style={{ fontSize: 24, lineHeight: 1.35, marginTop: 6, color: PALETTE.muted }}
            >
              {speaker.role}
              <br />
              {speaker.company}
            </p>
          </div>
        </div>
      </div>

      {/* Right: the line field and the logo, both drawn on the canvas */}
      <div
        className="absolute inset-y-0 right-0 overflow-hidden"
        style={{ width: PANEL_W, background: PALETTE.gap }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 block"
          style={{ width: PANEL_W, height: PANEL_H }}
          role="img"
          aria-label="Aerchain"
        />
        {/* The landmark stands on the bottom edge, in front of the lines. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={skyline.x1}
          srcSet={`${skyline.x1} 1x, ${skyline.x2} 2x`}
          width={PANEL_W}
          height={PANEL_H}
          alt={skyline.landmark}
          className="absolute inset-0 block"
          style={{
            transform: `translate(${place.x}px, ${-place.y}px) scale(${place.scale})`,
            transformOrigin: "50% 100%",
          }}
          draggable={false}
        />
      </div>
    </div>
  );
}
