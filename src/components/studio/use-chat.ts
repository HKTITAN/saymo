"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_PROVIDER, type ProviderId } from "@/lib/studio/ai-types";
import type { ChatContext, ChatMessage, Film, Version } from "@/lib/studio/contract";
import { useAiChoice } from "./ai-api";
import { api, chat, StudioError } from "./api";

// One film's conversation with Claude, shared by the chat panel and the
// prompt bubble on the film. A turn streams in as words and plain steps;
// when Claude writes the film's files, the stage reloads.
//
// A turn keeps going on the server if the page closes or reloads. Coming
// back to a film mid-turn shows Claude as working and checks every couple
// of seconds until the turn is over.
//
// Prompts sent while Claude works wait in a queue and run one by one, each
// with the moment and the part they were sent with. Stop halts the current
// turn and pauses the queue; the queue survives a reload (this browser only).
// A waiting prompt can be rewritten in place, and so can any prompt you
// sent (rewrite): Claude stops if it's still working, the film goes back to
// the version saved just before that prompt, and the new words run from the
// same moment. While a prompt is being rewritten, the queue holds still.

export type Turn = {
  running: boolean;
  text: string;
  steps: string[];
  error: string | null;
  resumed: boolean; // working on a turn started before this page loaded
};

const IDLE: Turn = { running: false, text: "", steps: [], error: null, resumed: false };

export type Queued = { key: string; prompt: string; context: ChatContext; provider?: ProviderId };

const queueKey = (id: string) => `studio:queue:${id}`;
const loadQueue = (id: string): Queued[] => {
  try {
    const raw = window.localStorage.getItem(queueKey(id));
    return raw ? (JSON.parse(raw) as Queued[]) : [];
  } catch {
    return [];
  }
};
const saveQueue = (id: string, queue: Queued[]) => {
  try {
    if (queue.length) window.localStorage.setItem(queueKey(id), JSON.stringify(queue));
    else window.localStorage.removeItem(queueKey(id));
  } catch {}
};

export function useChat(
  id: string,
  { onChanged, onFilm }: { onChanged: () => void; onFilm: (film: Film) => void },
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [turn, setTurn] = useState<Turn>(IDLE);
  const [undoing, setUndoing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [paused, setPaused] = useState(false);
  // What's being rewritten: a waiting prompt's key, a sent prompt's `at`,
  // or null. Nothing in the queue starts meanwhile.
  const [editing, setEditing] = useState<string | null>(null);
  // When the studio will carry on by itself (after the 15-minute cap or a
  // usage limit), and why.
  const [carryOn, setCarryOn] = useState<{ reason: "time" | "limit"; at: string } | null>(null);
  const follow = useRef<() => void>(() => {});
  // Which AI the next prompt goes to: the one chosen in Settings.
  const { provider } = useAiChoice();
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once per film from this browser
    setQueue(loadQueue(id));
    setPaused(false);
  }, [id]);
  useEffect(() => {
    saveQueue(id, queue);
  }, [id, queue]);
  // False until the chat so far has been read: the panel draws shapes until then.
  const [loaded, setLoaded] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const callbacks = useRef({ onChanged, onFilm });
  useEffect(() => {
    callbacks.current = { onChanged, onFilm };
  });

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // While an earlier turn is still running, check back until it ends,
    // then show the film as Claude left it.
    const check = async (first: boolean) => {
      const h = await api.history(id).catch(() => null);
      if (!live) return;
      if (first) setLoaded(true);
      if (!h) {
        if (first) setMessages([]);
        return;
      }
      setMessages(h.messages);
      setCarryOn(h.carryOn);
      if (h.running) {
        setTurn((t) => (t.running ? t : { ...IDLE, running: true, resumed: true }));
        timer = setTimeout(() => check(false), 2000);
      } else if (h.carryOn) {
        // Waiting to carry on: look again soon, so the next turn shows when it starts.
        setTurn((t) => (t.resumed ? IDLE : t));
        const wait = Math.min(Math.max(Date.parse(h.carryOn.at) - Date.now(), 1500), 30_000);
        timer = setTimeout(() => check(false), wait);
      } else if (!first) {
        setTurn(IDLE);
        const film = await api.get(id).catch(() => null);
        if (live && film) callbacks.current.onFilm(film);
        callbacks.current.onChanged();
      }
    };
    void check(true);
    follow.current = () => {
      clearTimeout(timer);
      void check(false);
    };
    return () => {
      live = false;
      clearTimeout(timer);
      abort.current?.abort();
    };
  }, [id]);

  const run = useCallback(
    async (prompt: string, context: ChatContext, provider: ProviderId = DEFAULT_PROVIDER) => {
      const words = prompt.trim();
      if (!words || abort.current) return;
      const controller = new AbortController();
      abort.current = controller;
      setMessages((m) => [...m, { role: "you", text: words, at: new Date().toISOString(), context, provider }]);
      setTurn({ ...IDLE, running: true });
      let text = "";
      let steps: string[] = [];
      let error: string | null = null;
      try {
        await chat(
          id,
          { prompt: words, context, provider },
          (event) => {
            switch (event.kind) {
              case "text":
                text += event.text;
                setTurn((t) => ({ ...t, text }));
                break;
              case "step":
                steps = [...steps, event.label];
                setTurn((t) => ({ ...t, steps }));
                break;
              case "changed":
                callbacks.current.onChanged();
                break;
              case "done":
                callbacks.current.onFilm(event.film);
                break;
              case "carry-on":
                setCarryOn({ reason: event.reason, at: event.at });
                break;
              case "error":
                error = event.message;
                setTurn((t) => ({ ...t, error: event.message }));
                break;
            }
          },
          controller.signal,
        );
      } catch (e) {
        error = e instanceof StudioError ? e.message : "Claude stopped unexpectedly. Try again.";
      }
      const stopped = controller.signal.aborted;
      abort.current = null;
      setTurn(IDLE);
      // The server keeps the history; read it back so both sides agree.
      const saved = await api.history(id).catch(() => null);
      const hasReply = saved?.messages.at(-1)?.role === "claude";
      if (saved && hasReply) setMessages(saved.messages);
      else
        setMessages((m) => [
          ...(saved?.messages ?? m),
          {
            role: "claude",
            text: error ?? (stopped ? `${text}${text ? "\n\n" : ""}Stopped.` : text || "Done."),
            at: new Date().toISOString(),
            steps,
          },
        ]);
      // The studio is carrying on by itself: follow the next turn too.
      if (saved?.carryOn || saved?.running) {
        setCarryOn(saved.carryOn);
        follow.current();
      }
    },
    [id],
  );

  // Sends now, or queues it while Claude is working.
  const busy = turn.running || undoing || restoring;
  const send = useCallback(
    async (prompt: string, context: ChatContext) => {
      const words = prompt.trim();
      if (!words) return;
      if (abort.current || busy || queue.length) {
        setQueue((q) => [...q, { key: `${Date.now().toString(36)}-${q.length}`, prompt: words, context, provider }]);
        return;
      }
      await run(words, context, provider);
    },
    [busy, queue.length, run, provider],
  );

  // When a turn ends, the next queued prompt starts on its own, on the AI
  // it was sent to.
  useEffect(() => {
    if (busy || paused || editing || abort.current || !queue.length) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    void run(next.prompt, next.context, next.provider);
  }, [busy, paused, editing, queue, run]);

  const editQueued = useCallback((key: string, prompt: string) => {
    const words = prompt.trim();
    if (words) setQueue((q) => q.map((x) => (x.key === key ? { ...x, prompt: words } : x)));
  }, []);

  const removeQueued = useCallback((key: string) => setQueue((q) => q.filter((x) => x.key !== key)), []);
  const clearQueue = useCallback(() => {
    setQueue([]);
    setPaused(false);
  }, []);
  const resume = useCallback(() => setPaused(false), []);

  const stop = useCallback(async () => {
    // Stopping halts this turn and pauses whatever is waiting behind it,
    // and the studio won't carry on by itself.
    setPaused(true);
    setCarryOn(null);
    await api.stop(id).catch(() => {});
    abort.current?.abort();
  }, [id]);
  // Keeps things as they are instead of carrying on by itself later.
  const cancelCarryOn = useCallback(async () => {
    setCarryOn(null);
    await api.stop(id).catch(() => {});
  }, [id]);

  const undo = useCallback(async () => {
    setUndoing(true);
    try {
      const film = await api.undo(id);
      callbacks.current.onFilm(film);
      callbacks.current.onChanged();
      const saved = await api.history(id).catch(() => null);
      if (saved) setMessages(saved.messages);
      return null;
    } catch (e) {
      return e instanceof StudioError ? e.message : "Unable to undo. Try again.";
    } finally {
      setUndoing(false);
    }
  }, [id]);


  // Goes back to an earlier version of the film (the film as it was is kept
  // as a version too). Returns an error to show, or null.
  const restore = useCallback(
    async (n: number, t: number) => {
      setRestoring(true);
      try {
        const film = await api.restore(id, n, t);
        callbacks.current.onFilm(film);
        callbacks.current.onChanged();
        const saved = await api.history(id).catch(() => null);
        if (saved) setMessages(saved.messages);
        return null;
      } catch (e) {
        return e instanceof StudioError ? e.message : "Unable to go back. Try again.";
      } finally {
        setRestoring(false);
      }
    },
    [id],
  );

  // Runs new words in place of a prompt you sent. Returns a note to show
  // (a problem, or that there was no version to go back to), or null.
  const rewrite = useCallback(
    async (sent: ChatMessage, prompt: string) => {
      const words = prompt.trim();
      if (!words || sent.role !== "you") return null;
      // Still running: stop it, and wait until the studio has let go of the film.
      if (abort.current || turn.running) {
        await stop();
        for (let i = 0; i < 60; i++) {
          const h = abort.current ? null : await api.history(id).catch(() => null);
          if (!abort.current && h && !h.running) break;
          await new Promise((r) => setTimeout(r, 250));
        }
      }
      // The version saved just before that prompt (each Claude turn saves
      // one as it starts; the newest 30 are kept).
      const versions = await api.versions(id).catch(() => [] as Version[]);
      const sentAt = Date.parse(sent.at);
      const before = versions.find((v) => v.n !== null && v.next?.prompt === sent.text && Math.abs(Date.parse(v.next.at) - sentAt) < 120_000);
      const t = sent.context?.t ?? 0;
      let note: string | null = null;
      if (before?.n != null) {
        const problem = await restore(before.n, t);
        if (problem) return problem;
      } else {
        note = "There was no saved version from before that prompt, so this ran on the film as it is now.";
      }
      const started = run(words, sent.context ?? { t, pick: null }, sent.provider ?? provider);
      setPaused(false);
      await started;
      return note;
    },
    [id, turn.running, stop, restore, run, provider],
  );

  // The chat as the server has it now (after picking one of three
  // versions, say).
  const reloadHistory = useCallback(async () => {
    const saved = await api.history(id).catch(() => null);
    if (saved) setMessages(saved.messages);
  }, [id]);

  return {
    messages,
    reloadHistory,
    turn,
    send,
    stop,
    undo,
    restore,
    undoing,
    restoring,
    loaded,
    queue,
    paused,
    removeQueued,
    editQueued,
    editing,
    setEditing,
    rewrite,
    clearQueue,
    resume,
    provider,
    carryOn,
    cancelCarryOn,
  };
}

export type ChatState = ReturnType<typeof useChat>;
