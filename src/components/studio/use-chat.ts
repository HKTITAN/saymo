"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatContext, ChatMessage, Film } from "@/lib/studio/contract";
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

export type Turn = {
  running: boolean;
  text: string;
  steps: string[];
  error: string | null;
  resumed: boolean; // working on a turn started before this page loaded
};

const IDLE: Turn = { running: false, text: "", steps: [], error: null, resumed: false };

export type Queued = { key: string; prompt: string; context: ChatContext };

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
  const [queue, setQueue] = useState<Queued[]>([]);
  const [paused, setPaused] = useState(false);
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
      if (h.running) {
        setTurn((t) => (t.running ? t : { ...IDLE, running: true, resumed: true }));
        timer = setTimeout(() => check(false), 2000);
      } else if (!first) {
        setTurn(IDLE);
        const film = await api.get(id).catch(() => null);
        if (live && film) callbacks.current.onFilm(film);
        callbacks.current.onChanged();
      }
    };
    void check(true);
    return () => {
      live = false;
      clearTimeout(timer);
      abort.current?.abort();
    };
  }, [id]);

  const run = useCallback(
    async (prompt: string, context: ChatContext) => {
      const words = prompt.trim();
      if (!words || abort.current) return;
      const controller = new AbortController();
      abort.current = controller;
      setMessages((m) => [...m, { role: "you", text: words, at: new Date().toISOString(), context }]);
      setTurn({ ...IDLE, running: true });
      let text = "";
      let steps: string[] = [];
      let error: string | null = null;
      try {
        await chat(
          id,
          { prompt: words, context },
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
    },
    [id],
  );

  // Sends now, or queues it while Claude is working.
  const busy = turn.running || undoing;
  const send = useCallback(
    async (prompt: string, context: ChatContext) => {
      const words = prompt.trim();
      if (!words) return;
      if (abort.current || busy || queue.length) {
        setQueue((q) => [...q, { key: `${Date.now().toString(36)}-${q.length}`, prompt: words, context }]);
        return;
      }
      await run(words, context);
    },
    [busy, queue.length, run],
  );

  // When a turn ends, the next queued prompt starts on its own.
  useEffect(() => {
    if (busy || paused || abort.current || !queue.length) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    void run(next.prompt, next.context);
  }, [busy, paused, queue, run]);

  const removeQueued = useCallback((key: string) => setQueue((q) => q.filter((x) => x.key !== key)), []);
  const clearQueue = useCallback(() => {
    setQueue([]);
    setPaused(false);
  }, []);
  const resume = useCallback(() => setPaused(false), []);

  const stop = useCallback(async () => {
    // Stopping halts this turn and pauses whatever is waiting behind it.
    setPaused(true);
    await api.stop(id).catch(() => {});
    abort.current?.abort();
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

  return { messages, turn, send, stop, undo, undoing, loaded, queue, paused, removeQueued, clearQueue, resume };
}

export type ChatState = ReturnType<typeof useChat>;
