"use client";

import { useEffect, useRef } from "react";
import type { PostContent } from "@/components/post/content";
import { MOTIONS, type MotionId } from "@/components/post/lines";
import { Post, POST_H, POST_W, type PostHandle } from "@/components/post/post";

declare global {
  interface Window {
    __post?: {
      ready: boolean;
      motions: { id: MotionId; duration: number; still: number }[];
      renderAt: (seconds: number) => void;
      // Where the video starts, if not on the still frame.
      start: number | null;
    };
  }
}

// The bare post at its export size, for scripts/post/export.mjs to step through
// frame by frame with window.__post.
export function ExportStage({ motion, content }: { motion: MotionId; content?: PostContent }) {
  const handle = useRef<PostHandle>(null);
  // The exporter opens this page at 2x for 4K, so the lines draw at 2x too.
  const pixelScale = window.devicePixelRatio || 1;

  useEffect(() => {
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (cancelled || !handle.current) return;
      const h = handle.current;
      window.__post = {
        ready: true,
        motions: MOTIONS.map(({ id, duration, still }) => ({ id, duration, still })),
        renderAt: (s) => h.renderAt(s),
        start: content?.videoStart ?? null,
      };
    });
    return () => {
      cancelled = true;
    };
  }, [motion]);

  return (
    <div style={{ position: "fixed", inset: 0, width: POST_W, height: POST_H }}>
      <Post
        ref={handle}
        motion={motion}
        playing={false}
        pixelScale={pixelScale}
        live={false}
        content={content}
      />
    </div>
  );
}
