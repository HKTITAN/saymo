"use client";

import { type Ref, useEffect, useRef, useState } from "react";
import type { PostContent } from "@/components/post/content";
import { type MotionId, PANEL_W } from "@/components/post/lines";
import { LEFT_W, Post, POST_H, POST_W } from "@/components/post/post";
import type { Placement } from "@/lib/tool/doc";

type PreviewProps = {
  content: PostContent;
  motion: MotionId;
  playing: boolean;
  // Dragging the landmark moves it; pinching or scrolling with Command
  // held makes it bigger or smaller.
  onPlace?: (place: Placement) => void;
  postRef?: Ref<HTMLDivElement>;
};

// The post, live and fitted to the space it has.
export function Preview({ content, motion, playing, onPlace, postRef }: PreviewProps) {
  const stage = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 0, dpr: 1 });
  const drag = useRef<{ x: number; y: number; place: Placement } | null>(null);
  const place = content.skyline?.place;

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      setFit({ scale: Math.min(width / POST_W, height / POST_H), dpr: window.devicePixelRatio || 1 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel events have to be caught by hand to stop the page zooming.
  const latest = useRef({ place, onPlace });
  useEffect(() => {
    latest.current = { place, onPlace };
  });
  const movable = Boolean(place && onPlace);
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const { place, onPlace } = latest.current;
      if (!place || !onPlace || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const scale = Math.min(4, Math.max(0.1, place.scale * Math.exp(-e.deltaY * 0.01)));
      onPlace({ ...place, scale: Math.round(scale * 1000) / 1000 });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [fit.scale, movable]);

  const { scale, dpr } = fit;
  return (
    <div ref={stage} className="relative size-full min-h-0">
      {scale > 0 && (
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 shadow-2xl shadow-black/40"
          style={{ width: POST_W * scale, height: POST_H * scale }}
        >
          <div ref={postRef} style={{ transform: `scale(${scale})`, transformOrigin: "0 0" }}>
            <Post motion={motion} playing={playing} pixelScale={scale * dpr} content={content} />
          </div>
          {place && onPlace && (
            <div
              ref={panel}
              className="absolute top-0 cursor-grab touch-none active:cursor-grabbing"
              style={{ left: LEFT_W * scale, width: PANEL_W * scale, height: POST_H * scale }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = { x: e.clientX, y: e.clientY, place };
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d) return;
                onPlace({
                  ...d.place,
                  x: Math.round(d.place.x + (e.clientX - d.x) / scale),
                  y: Math.round(d.place.y - (e.clientY - d.y) / scale),
                });
              }}
              onPointerUp={() => {
                drag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
              aria-hidden="true"
            />
          )}
        </div>
      )}
    </div>
  );
}
