"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Engine, Picked, StageInbound, StageOutbound } from "@/lib/studio/contract";
import type { StageEditMessage } from "@/lib/studio/edit";
import { stageUrl } from "./api";

// The stage: the film's own page in an iframe, at the film's pixel size,
// scaled to fit the room the panels leave. The studio talks to it by
// postMessage (StageInbound / StageOutbound in contract.ts).

export type Insets = { top: number; right: number; bottom: number; left: number };
export type Fit = { x: number; y: number; scale: number; width: number; height: number };

// Holds the current iframe so anything (the clock, the inspector) can send
// it a message without passing refs around.
export type Bridge = {
  attach: (frame: HTMLIFrameElement | null) => void;
  detach: (frame: HTMLIFrameElement | null) => void;
  post: (message: StageInbound | StageEditMessage) => void;
  frame: () => HTMLIFrameElement | null; // the stage itself (same site), e.g. to quiet its sound
};

export function createBridge(): Bridge {
  let current: HTMLIFrameElement | null = null;
  return {
    attach(frame) {
      current = frame;
    },
    detach(frame) {
      if (current === frame) current = null;
    },
    post(message) {
      current?.contentWindow?.postMessage(message, window.location.origin);
    },
    frame: () => current,
  };
}

const subscribeResize = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};
const windowSize = () => `${window.innerWidth}x${window.innerHeight}`;

// Where the film sits: as large as fits inside the insets, centred, never
// above its own size times two.
export function useFit(width: number, height: number, insets: Insets): Fit {
  const size = useSyncExternalStore(subscribeResize, windowSize, () => "1440x900");
  const [w, h] = size.split("x").map(Number);
  const roomW = Math.max(160, w - insets.left - insets.right);
  const roomH = Math.max(90, h - insets.top - insets.bottom);
  const scale = Math.min(roomW / width, roomH / height, 2);
  const fw = width * scale;
  const fh = height * scale;
  return {
    x: insets.left + (roomW - fw) / 2,
    y: insets.top + (roomH - fh) / 2,
    scale,
    width: fw,
    height: fh,
  };
}

export type StageStatus = { state: "loading" } | { state: "ready" } | { state: "error"; message: string };

export function Stage({
  id,
  engine,
  width,
  height,
  fit,
  bridge,
  version,
  pointing,
  ownPick = false,
  words = false,
  onMessage,
}: {
  id: string;
  engine: Engine;
  ownPick?: boolean; // the studio works out what was clicked
  words?: boolean; // the film's words can be clicked and edited in place
  width: number;
  height: number;
  fit: Fit;
  bridge: Bridge;
  version: number; // bumped to load the stage page afresh
  pointing: boolean;
  onMessage: (message: StageOutbound) => void;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const handler = useRef(onMessage);
  useEffect(() => {
    handler.current = onMessage;
  });

  useEffect(() => {
    const frame = ref.current;
    bridge.attach(frame);
    const listen = (event: MessageEvent) => {
      if (event.source !== frame?.contentWindow || event.origin !== window.location.origin) return;
      const data = event.data as StageOutbound;
      if (data && typeof data === "object" && typeof data.type === "string" && data.type.startsWith("studio:")) {
        handler.current(data);
      }
    };
    window.addEventListener("message", listen);
    return () => {
      window.removeEventListener("message", listen);
      bridge.detach(frame);
    };
  }, [bridge, version]);

  useEffect(() => {
    bridge.post({ type: "studio:point", on: pointing });
  }, [bridge, pointing]);

  // A press on the film lands in the film's own page, where the studio's
  // pop-ups can't hear it. The film taking the focus means it was pressed,
  // so that's passed on as a press on the frame, and pop-ups close just as
  // they do for a press anywhere else outside them.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const blur = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const frame = ref.current;
        if (!frame || document.activeElement !== frame) return;
        const at = { bubbles: true, cancelable: true, composed: true, button: 0 };
        frame.dispatchEvent(new PointerEvent("pointerdown", { ...at, pointerType: "mouse", isPrimary: true }));
        frame.dispatchEvent(new MouseEvent("click", at));
      }, 0);
    };
    window.addEventListener("blur", blur);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // A rust film can't tell what's under the pointer, and a video film's parts
  // are known from its edit, so for those the studio takes the click itself
  // and passes on only where it was.
  const overlay = pointing && (engine === "rust" || ownPick);

  // The frame is drawn at its size on screen and glides to a new size and
  // place (a new frame size, or panels folding); the film inside is drawn
  // at its own pixels and scaled. When the frame's shape changes the film
  // is rebuilt, so it fades in once the frame has settled instead of
  // stretching on the way.
  return (
    <div
      data-film-stage=""
      className="absolute top-0 left-0 overflow-hidden rounded-[3px] bg-black shadow-[0_30px_80px_-20px_rgb(0_0_0_/_calc(0.8*var(--shade)))] transition-[transform,width,height] duration-[450ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
      style={{ width: fit.width, height: fit.height, transform: `translate(${fit.x}px, ${fit.y}px)` }}
    >
      <div
        key={`${width}x${height}`}
        className="relative origin-top-left transition-transform duration-[450ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
        style={{
          width,
          height,
          // A hair larger than the frame, from just outside its corner, so
          // rounding never leaves a sub-pixel seam of the frame showing at
          // an edge (it read as a thin light line).
          transform: `translate(-0.5px, -0.5px) scale(${Math.max((fit.width + 1) / width, (fit.height + 1) / height)})`,
          animation: "studio-frame-in 260ms ease-out 300ms both",
        }}
      >
      <iframe
        key={version}
        ref={ref}
        src={`${stageUrl(id)}?v=${version}`}
        title="The film"
        width={width}
        height={height}
        className="block border-0"
        // The film takes the pointer while pointing, and whenever its words
        // can be edited in place (motion films).
        style={{ width, height, pointerEvents: (pointing && !overlay) || (words && !pointing) ? "auto" : "none" }}
        onLoad={() => {
          bridge.attach(ref.current);
          bridge.post({ type: "studio:point", on: pointing });
        }}
      />
      {overlay ? (
        <button
          type="button"
          aria-label="Point"
          className="absolute inset-0 cursor-crosshair"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const pick: Picked = {
              x: ((e.clientX - r.left) / r.width) * width,
              y: ((e.clientY - r.top) / r.height) * height,
              id: null,
              tag: null,
              text: null,
              rect: null,
            };
            handler.current({ type: "studio:picked", pick });
          }}
        />
      ) : null}
      </div>
    </div>
  );
}
