"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SoundSpan, SoundStem } from "@/lib/studio/sound";
import { clearSpan, isEdited, levelOf, placeSpan } from "@/lib/studio/sound-mix";
import type { Entry } from "./history";
import { soundApi } from "./sound-api";
import type { SoundState } from "./use-sound";
import { type SoundPin, soundChipLabel } from "./words";

// Editing part of the sound by hand: a span picked on the timeline's Music
// or Effects lane, made louder, quieter or silent. Each change is saved to
// mix.json and the stems are mixed again on the server (about a second; the
// score isn't played), then the new sound plays here. Each change is one
// step for ⌘Z. The same span can go to Claude instead.

export type SoundPick = { stem: SoundStem; from: number; to: number };

export type SoundEditor = ReturnType<typeof useSoundEdit>;

export function useSoundEdit({
  id,
  sound,
  duration,
  record,
  onAsk,
  onTry,
}: {
  id: string;
  sound: SoundState;
  duration: number;
  record: (entry: Omit<Entry, "at">) => void;
  onAsk: (pin: SoundPin) => void; // pins it to the prompt box
  onTry: (pin: SoundPin) => void; // asks Claude for another take straight away
}) {
  const [spans, setSpansState] = useState<SoundSpan[]>([]);
  const [pick, setPick] = useState<SoundPick | null>(null);
  const [mixing, setMixing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spansRef = useRef(spans);
  const soundRef = useRef(sound);
  useEffect(() => {
    soundRef.current = sound;
  });

  // Saving: the latest edits win; one mix at a time.
  const wanted = useRef<SoundSpan[] | null>(null);
  const sending = useRef(false);
  const flush = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    setMixing(true);
    while (wanted.current) {
      const next = wanted.current;
      wanted.current = null;
      try {
        const { status } = await soundApi.setMix(id, next);
        if (!wanted.current) soundRef.current.adopt(status);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to change the sound. Try again.");
      }
    }
    sending.current = false;
    setMixing(false);
  }, [id]);

  const save = useCallback(
    (next: SoundSpan[]) => {
      spansRef.current = next;
      setSpansState(next);
      wanted.current = next;
      void flush();
    },
    [flush],
  );

  // The edits as saved: on opening, and whenever a new sound arrives (a
  // Claude turn, or undoing one, can bring back other edits).
  const version = sound.status.state === "ready" ? sound.status.at : null;
  useEffect(() => {
    let live = true;
    soundApi.mix(id).then(
      (m) => {
        if (!live || sending.current || wanted.current) return;
        spansRef.current = m.spans;
        setSpansState(m.spans);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [id, version]);

  // Changes by hand, each one a step for ⌘Z.
  const change = useCallback(
    (next: SoundSpan[], label: string) => {
      const before = spansRef.current;
      save(next);
      record({
        label,
        undo: () => {
          const now = spansRef.current;
          save(before);
          return () => save(now);
        },
      });
    },
    [record, save],
  );

  const where = useCallback((p: SoundPick) => soundChipLabel(p, duration), [duration]);

  const setVolume = useCallback(
    (gain: number) => {
      if (!pick) return;
      const { mute } = levelOf(spansRef.current, pick.stem, pick.from, pick.to);
      const db = `${gain > 0 ? "+" : ""}${gain.toFixed(1)} dB`;
      change(placeSpan(spansRef.current, { ...pick, gain, mute }), `${where(pick)}: ${db}`);
    },
    [pick, change, where],
  );

  const setMute = useCallback(
    (mute: boolean) => {
      if (!pick) return;
      const { gain } = levelOf(spansRef.current, pick.stem, pick.from, pick.to);
      change(placeSpan(spansRef.current, { ...pick, gain, mute }), `${where(pick)}: ${mute ? "muted" : "sound on"}`);
    },
    [pick, change, where],
  );

  const reset = useCallback(() => {
    if (!pick) return;
    change(clearSpan(spansRef.current, pick.stem, pick.from, pick.to), `${where(pick)}: reset`);
  }, [pick, change, where]);

  // A click on a lane: the edit under it, else the whole stem.
  const pickAt = useCallback(
    (stem: SoundStem, t: number) => {
      const span = spansRef.current.find((s) => s.stem === stem && t >= s.from && t <= s.to);
      setPick(span ? { stem, from: span.from, to: span.to } : { stem, from: 0, to: duration });
    },
    [duration],
  );

  const level = useMemo(() => (pick ? levelOf(spans, pick.stem, pick.from, pick.to) : { gain: 0, mute: false }), [spans, pick]);
  const edited = pick ? isEdited(spans, pick.stem, pick.from, pick.to) : false;

  return useMemo(
    () => ({
      spans,
      pick,
      setPick,
      pickAt,
      level,
      edited,
      mixing,
      error,
      duration,
      label: pick ? where(pick) : "",
      setVolume,
      setMute,
      reset,
      ask: () => pick && onAsk({ ...pick }),
      tryAnother: () => pick && onTry({ ...pick }),
    }),
    [spans, pick, pickAt, level, edited, mixing, error, duration, where, setVolume, setMute, reset, onAsk, onTry],
  );
}
