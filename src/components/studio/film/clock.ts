"use client";

import { useSyncExternalStore } from "react";

// The studio owns time. The stage never plays on its own: while playing,
// the clock moves the playhead every animation frame and tells the stage
// where to be, so every engine plays the same way.
//
// It is a small store outside React, so the timeline can redraw 60 times a
// second without redrawing the whole studio.

type State = { t: number; playing: boolean; loop: boolean; duration: number };
type Listener = () => void;

export type Clock = ReturnType<typeof createClock>;

export function createClock(onTime: (t: number) => void) {
  let state: State = { t: 0, playing: false, loop: true, duration: 4 };
  const listeners = new Set<Listener>();
  let frame = 0;
  let last = 0;

  const set = (next: Partial<State>) => {
    state = { ...state, ...next };
    for (const l of listeners) l();
  };

  const tick = (now: number) => {
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    let t = state.t + dt;
    if (t >= state.duration) {
      if (state.loop) t %= state.duration || 1;
      else {
        t = state.duration;
        set({ t, playing: false });
        onTime(t);
        return;
      }
    }
    set({ t });
    onTime(t);
    frame = requestAnimationFrame(tick);
  };

  return {
    get: () => state,
    subscribe(l: Listener) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    play() {
      if (state.playing) return;
      // From the end, play starts over.
      if (state.t >= state.duration - 1e-3) set({ t: 0 });
      last = 0;
      set({ playing: true });
      frame = requestAnimationFrame(tick);
    },
    pause() {
      cancelAnimationFrame(frame);
      set({ playing: false });
    },
    toggle() {
      if (state.playing) this.pause();
      else this.play();
    },
    seek(t: number) {
      const clamped = Math.min(state.duration, Math.max(0, t));
      set({ t: clamped });
      onTime(clamped);
    },
    setDuration(duration: number) {
      set({ duration, t: Math.min(state.t, duration) });
    },
    setLoop(loop: boolean) {
      set({ loop });
    },
    dispose() {
      cancelAnimationFrame(frame);
      listeners.clear();
    },
  };
}

export function useClock<T>(clock: Clock, pick: (s: State) => T): T {
  return useSyncExternalStore(
    clock.subscribe,
    () => pick(clock.get()),
    () => pick(clock.get()),
  );
}

// 2.58 → "0:02.58"
export const formatTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
};
