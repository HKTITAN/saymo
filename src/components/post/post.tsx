"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { post } from "@/content/post";
import { cn } from "@/lib/utils";
import { drawPanel, MOTION_BY_ID, PANEL_H, PANEL_W, type MotionId } from "./lines";
import { PALETTE } from "./palette";
import type { VersionId } from "./versions";

// The post is laid out at its export size, 1920 x 1080, in post pixels.
export const POST_W = 1920;
export const POST_H = 1080;
const LEFT_W = POST_W - PANEL_W; // 1000
const MARGIN = 72;
const PHOTO = 240;

export type PostHandle = { renderAt: (seconds: number) => void };

type PostProps = {
  motion: MotionId;
  version: VersionId;
  playing: boolean;
  // Canvas pixels per post pixel: 1 when exporting, more on a sharp screen.
  pixelScale: number;
  // When false nothing runs on its own and the exporter sets each frame.
  live?: boolean;
  ref?: Ref<PostHandle>;
};

export function Post({ motion, version, playing, pixelScale, live = true, ref }: PostProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elapsed = useRef(0);

  const render = (seconds: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
    drawPanel(ctx, motion, seconds);
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
  }, [live, playing, motion, pixelScale]);

  const { title, speaker, skyline } = post;

  return (
    <div
      className="relative overflow-hidden"
      style={{ width: POST_W, height: POST_H, background: PALETTE.stone }}
      data-post
    >
      {/* Left: headline and speaker on stone */}
      <div className="absolute inset-y-0 left-0" style={{ width: LEFT_W }}>
        <h1
          className="absolute font-semibold"
          // Nudged so the letter stems line up with the photo's left edge and
          // the cap height lines up with the top of the logo.
          style={{
            left: MARGIN - 4.3,
            top: MARGIN - 16,
            fontSize: 86,
            lineHeight: 1.04,
            letterSpacing: "-0.01em",
            color: PALETTE.ink,
          }}
        >
          {/* The first line leads at full strength; the rest sits back at half opacity. */}
          {title.map((line, i) => (
            <span key={line} className={cn("block whitespace-nowrap", i > 0 && "opacity-50")}>
              {line}
            </span>
          ))}
        </h1>

        <div
          className="absolute flex items-center"
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
          {/* Centred on the photo. At these sizes the name's cap height and
              the last baseline also sit 75px from its top and bottom edges. */}
          <div>
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
        className="absolute inset-y-0 right-0"
        style={{ width: PANEL_W, background: PALETTE.gap }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 block"
          style={{ width: PANEL_W, height: PANEL_H }}
          role="img"
          aria-label="Aerchain"
        />
        {/* Version 2: the landmark rises from the bottom edge in front of
            the lines, its tallest point halfway up the post. */}
        {version === "skyline" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={skyline.x1}
            srcSet={`${skyline.x1} 1x, ${skyline.x2} 2x`}
            width={PANEL_W}
            height={PANEL_H}
            alt={skyline.landmark}
            className="absolute inset-0 block"
            draggable={false}
          />
        )}
      </div>
    </div>
  );
}
