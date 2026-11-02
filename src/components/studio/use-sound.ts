"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Film } from "@/lib/studio/contract";
import type { SoundStatus } from "@/lib/studio/sound";
import type { Clock } from "./clock";
import { soundApi, soundOf, soundUrl } from "./sound-api";
import type { Bridge } from "./stage";

// A film's sound design, as the studio plays it. The stage stays silent;
// the studio plays sound.wav itself, locked to its own clock, so every
// engine sounds the same: it starts and stops with the film, jumps when you
// seek, and comes back round when the film loops. "Mute while I work" is
// only for listening here; the film's own Sound On | Off decides what goes
// into renders.

const MUTED_KEY = "studio:muted";
// How far the sound may drift from the playhead before it's put back, and
// how long to leave it after starting or jumping (a fresh start needs a
// moment before its own time is worth comparing).
const DRIFT = 0.04;
const JUMP = 0.2;
const SETTLE_MS = 300;

const readMuted = () => {
  try {
    return localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
};

export type SoundState = ReturnType<typeof useSound>;

export function useSound({
  id,
  film,
  clock,
  bridge,
  claudeRunning,
}: {
  id: string;
  film: Film | null;
  clock: Clock;
  bridge: Bridge;
  claudeRunning: boolean;
}) {
  const [status, setStatus] = useState<SoundStatus>({ state: "none" });
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [muted, setMutedState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = status.state === "ready" ? status.at : null;
  const sound = soundOf(film);

  // ─── Status: once on opening, while a render runs, and after Claude ───

  const refresh = useCallback(async () => {
    const next = await soundApi.status(id);
    setStatus(next);
    return next;
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the listening mute is this computer's own choice
    setMutedState(readMuted());
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (status.state !== "rendering") return;
    const timer = setInterval(() => void refresh(), 1000);
    return () => clearInterval(timer);
  }, [status.state, refresh]);

  // A Claude turn that changed the score starts a new render on the server
  // as it ends; look a few times in the seconds after.
  const wasRunning = useRef(claudeRunning);
  useEffect(() => {
    const ended = wasRunning.current && !claudeRunning;
    wasRunning.current = claudeRunning;
    if (!ended) return;
    const timers = [400, 1500, 4000].map((ms) => setTimeout(() => void refresh(), ms));
    return () => timers.forEach(clearTimeout);
  }, [claudeRunning, refresh]);

  useEffect(() => {
    if (!version) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no rendered sound, so no waveform
      setPeaks(null);
      return;
    }
    let live = true;
    soundApi.peaks(id, version).then(
      (p) => live && setPeaks(Array.isArray(p) ? p : null),
      () => live && setPeaks(null),
    );
    return () => {
      live = false;
    };
  }, [id, version]);

  // The music and the effects on their own, for the timeline's two lanes.
  const stemList = status.state === "ready" ? status.stems : undefined;
  const hasStems = Boolean(stemList);
  const [stems, setStems] = useState<{ music: number[] | null; effects: number[] | null } | null>(null);
  useEffect(() => {
    if (!version || !hasStems) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no stems rendered, so no lanes
      setStems(null);
      return;
    }
    let live = true;
    const one = (stem: "music" | "effects") =>
      soundApi.stemPeaks(id, stem, version).then(
        (p) => (Array.isArray(p) ? p : null),
        () => null,
      );
    void Promise.all([one("music"), one("effects")]).then(([music, effects]) => {
      if (live) setStems({ music, effects });
    });
    return () => {
      live = false;
    };
  }, [id, version, hasStems]);

  const render = useCallback(async () => {
    setError(null);
    try {
      setStatus(await soundApi.render(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to make the sound. Try again.");
    }
  }, [id]);

  // A sound rendered before the studio kept stems is rendered once more,
  // which splits it into music and effects (it sounds the same).
  const split = useRef<string | null>(null);
  useEffect(() => {
    if (!version || hasStems || claudeRunning || split.current === id) return;
    split.current = id;
    void render();
  }, [id, version, hasStems, claudeRunning, render]);

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    try {
      localStorage.setItem(MUTED_KEY, next ? "1" : "0");
    } catch {}
  }, []);

  // ─── Playback ─────────────────────────────────────────────────────────

  const audio = useRef<{ el: HTMLAudioElement; ctx: AudioContext; gain: GainNode } | null>(null);
  const settleUntil = useRef(0);

  // Made on first use: an audio element through a gain, so the volume can
  // go above 100%.
  const graph = useCallback(() => {
    if (audio.current) return audio.current;
    const el = new Audio();
    el.preload = "auto";
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    ctx.createMediaElementSource(el).connect(gain).connect(ctx.destination);
    audio.current = { el, ctx, gain };
    return audio.current;
  }, []);

  useEffect(
    () => () => {
      const a = audio.current;
      if (!a) return;
      a.el.pause();
      a.el.removeAttribute("src");
      void a.ctx.close();
      audio.current = null;
    },
    [],
  );

  // A new render: load it, and land on the playhead.
  useEffect(() => {
    if (!version) {
      audio.current?.el.pause();
      return;
    }
    const { el } = graph();
    el.src = soundUrl(id, version);
    el.load();
    const land = () => {
      el.currentTime = Math.min(clock.get().t, el.duration || 0);
    };
    el.addEventListener("loadedmetadata", land, { once: true });
    return () => el.removeEventListener("loadedmetadata", land);
  }, [id, version, graph, clock]);

  const audible = Boolean(version) && sound.on && !muted;
  const gainValue = sound.on && !muted ? sound.volume : 0;
  useEffect(() => {
    const a = audio.current;
    if (a) a.gain.gain.setTargetAtTime(gainValue, a.ctx.currentTime, 0.015);
  }, [gainValue, version]);

  // Follows the clock: every tick while playing, every seek while paused.
  useEffect(() => {
    if (!version) return;
    const follow = () => {
      const a = audio.current;
      if (!a) return;
      const { el, ctx } = a;
      const s = clock.get();
      const end = Number.isFinite(el.duration) ? el.duration : 0;
      if (!s.playing || !audible || s.t >= end - 0.02) {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - s.t) > 0.01 && s.t < end) el.currentTime = s.t;
        return;
      }
      const now = performance.now();
      if (el.paused) {
        el.currentTime = s.t;
        if (ctx.state !== "running") void ctx.resume();
        void el.play().catch(() => {});
        settleUntil.current = now + SETTLE_MS;
        return;
      }
      const drift = Math.abs(el.currentTime - s.t);
      // A loop or a jump: straight away. A small drift: once it has settled.
      if (drift > JUMP || (drift > DRIFT && now > settleUntil.current)) {
        el.currentTime = s.t;
        settleUntil.current = now + SETTLE_MS;
      }
    };
    follow();
    const off = clock.subscribe(follow);
    return () => {
      off();
    };
  }, [clock, version, audible]);

  // ─── The listening mute reaches the footage too ───────────────────────

  // Video films play their footage's own sound in the stage; while muted,
  // every sound in it stays quiet (it's the same site, so the studio can
  // reach in). Checked as the film plays, since players make new elements.
  useEffect(() => {
    const quiet = (on: boolean) => {
      const doc = bridge.frame()?.contentDocument;
      if (!doc) return;
      for (const m of doc.querySelectorAll<HTMLMediaElement>("video, audio")) {
        if (on) {
          if (!m.muted) {
            m.dataset.studioMuted = "1";
            m.muted = true;
          }
        } else if (m.dataset.studioMuted) {
          delete m.dataset.studioMuted;
          m.muted = false;
        }
      }
    };
    if (!muted) {
      quiet(false);
      return;
    }
    quiet(true);
    const off = clock.subscribe(() => quiet(true));
    return () => {
      off();
      quiet(false);
    };
  }, [muted, clock, bridge]);

  return {
    status,
    peaks,
    stems,
    sound,
    muted,
    setMuted,
    render,
    refresh,
    // The status a mix edit answered with: a new sound to load.
    adopt: setStatus,
    error,
    clearError: () => setError(null),
  };
}
