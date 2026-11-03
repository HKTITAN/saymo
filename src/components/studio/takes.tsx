"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProviderId } from "@/lib/studio/ai-types";
import type { ChatContext, Film } from "@/lib/studio/contract";
import type { Takes } from "@/lib/studio/takes-shared";
import { api, StudioError } from "./api";

// Three versions of one prompt, made at once (takes.ts on the server): how
// they're going, starting them, keeping one and throwing them all away.
// takes-canvas.tsx shows them, full screen, after a spin of the slot
// machine. Keeping one makes the film that version (one step, undoable).

// For now Try 3 is a preview of the experience only: nothing is sent to
// Claude and no versions are made. The three cards are the current film,
// "made" on timers, and picking one just brings the editor back. Set to
// false to make real versions again (takes.ts on the server).
export const TAKES_DEMO = true;
const DEMO_STEPS = ["Reading the film", "Sketching the idea", "Moving things into place", "Checking the frames"];
const DEMO_DONE_MS = [7000, 9500, 12000]; // after the slot machine's spin

// A demo version's id is the film's id plus "~n"; its preview is the film.
export const takeFilm = (takeId: string) => takeId.split("~")[0];

export function useTakes(id: string, onPicked: (film: Film) => void, onDemoPicked?: () => void) {
  const [takes, setTakes] = useState<Takes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const picked = useRef(onPicked);
  const demoPicked = useRef(onDemoPicked);
  useEffect(() => {
    picked.current = onPicked;
    demoPicked.current = onDemoPicked;
  });
  const demoTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const stopDemo = () => {
    for (const t of demoTimers.current) clearTimeout(t);
    demoTimers.current = [];
  };
  useEffect(() => stopDemo, []);

  // How they're going: once on opening, then every 1.5 s while any is
  // still being made.
  const working = Boolean(takes?.takes.some((t) => t.state === "working"));
  useEffect(() => {
    if (TAKES_DEMO) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      const next = await api.takes(id).catch(() => undefined);
      if (!live || next === undefined) return;
      setTakes(next);
      if (next?.takes.some((t) => t.state === "working")) timer = setTimeout(ask, 1500);
    };
    void ask();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id, working]);

  // Resolves true once the three are under way. Any earlier set is
  // replaced on the server, so it's let go of here at once.
  const start = useCallback(
    async (prompt: string, context: ChatContext, provider: ProviderId) => {
      setError(null);
      setTakes(null);
      if (TAKES_DEMO) {
        stopDemo();
        const set = (n: number, take: Partial<Takes["takes"][number]>) =>
          setTakes((s) => (s ? { ...s, takes: s.takes.map((t) => (t.n === n ? { ...t, ...take } : t)) } : s));
        setTakes({
          prompt,
          at: new Date().toISOString(),
          provider,
          takes: [1, 2, 3].map((n) => ({ id: `${id}~${n}`, n, state: "working", step: DEMO_STEPS[0], reply: "", error: null })),
        });
        for (const n of [1, 2, 3]) {
          const done = DEMO_DONE_MS[n - 1];
          DEMO_STEPS.slice(1).forEach((step, i) => {
            demoTimers.current.push(setTimeout(() => set(n, { step }), ((i + 1) * done) / DEMO_STEPS.length));
          });
          demoTimers.current.push(setTimeout(() => set(n, { state: "done", step: null }), done));
        }
        return true;
      }
      try {
        setTakes(await api.startTakes(id, { prompt, context, provider }));
        return true;
      } catch (e) {
        setError(e instanceof StudioError ? e.message : "Unable to start the three versions. Try again.");
        return false;
      }
    },
    [id],
  );

  const pick = useCallback(
    async (take: string) => {
      setBusy(true);
      setError(null);
      if (TAKES_DEMO) {
        await new Promise((r) => setTimeout(r, 450));
        stopDemo();
        setTakes(null);
        setBusy(false);
        demoPicked.current?.();
        return;
      }
      try {
        const film = await api.pickTake(id, take);
        setTakes(null);
        picked.current(film);
      } catch (e) {
        setError(e instanceof StudioError ? e.message : "Unable to use that version. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [id],
  );

  const discard = useCallback(async () => {
    setTakes(null);
    setError(null);
    if (TAKES_DEMO) return stopDemo();
    await api.discardTakes(id).catch(() => {});
  }, [id]);

  return { takes, error, busy, start, pick, discard, clearError: () => setError(null) };
}

export type TakesState = ReturnType<typeof useTakes>;
