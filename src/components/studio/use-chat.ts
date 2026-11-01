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

export type Turn = {
  running: boolean;
  text: string;
  steps: string[];
  error: string | null;
  resumed: boolean; // working on a turn started before this page loaded
};

const IDLE: Turn = { running: false, text: "", steps: [], error: null, resumed: false };

export function useChat(
  id: string,
  { onChanged, onFilm }: { onChanged: () => void; onFilm: (film: Film) => void },
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [turn, setTurn] = useState<Turn>(IDLE);
  const [undoing, setUndoing] = useState(false);
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

  const send = useCallback(
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

  const stop = useCallback(async () => {
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

  return { messages, turn, send, stop, undo, undoing, loaded };
}

export type ChatState = ReturnType<typeof useChat>;
