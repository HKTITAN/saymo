"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// One undo history for everything you do to a film: timeline edits,
// settings, size, length, the title, and Claude's turns. ⌘Z (Ctrl+Z) steps
// back through all of it in order; ⇧⌘Z (Ctrl+Shift+Z, Ctrl+Y) steps forward.
//
// A change by hand is undone here, in the page. A Claude turn is undone by
// the server (the chat's Undo route), which puts the film's files back; it
// can't be redone.

export type Entry = {
  label: string; // "Speed 1.40 ×", "Split", "Moved a clip"
  // Puts things back as they were and returns how to redo it.
  undo: () => (() => void) | void;
  group?: string; // changes with the same group in quick succession are one step
  at: number;
};
type Step = Entry | { claude: true; label: string; at: number };

const GROUP_MS = 800;

export function useHistory({ undoClaude, claudeBusy }: { undoClaude: () => Promise<string | null>; claudeBusy: () => boolean }) {
  const back = useRef<Step[]>([]);
  const forward = useRef<{ label: string; redo: () => void }[]>([]);
  const [note, setNote] = useState<{ text: string; key: number } | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deps = useRef({ undoClaude, claudeBusy });
  useEffect(() => {
    deps.current = { undoClaude, claudeBusy };
  });

  const say = useCallback((text: string) => {
    setNote({ text, key: Date.now() });
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 1800);
  }, []);
  useEffect(() => () => void (noteTimer.current && clearTimeout(noteTimer.current)), []);

  // Records a change made by hand. A change in the same group as the last
  // one, moments later (a slider being dragged), joins it: one undo puts it
  // back to before the drag began; the label follows the latest value.
  const record = useCallback((entry: Omit<Entry, "at">) => {
    const top = back.current.at(-1);
    const now = Date.now();
    if (entry.group && top && "undo" in top && top.group === entry.group && now - top.at < GROUP_MS) {
      top.label = entry.label;
      top.at = now;
      return;
    }
    back.current = [...back.current.slice(-199), { ...entry, at: now }];
    forward.current = [];
  }, []);

  // Records that one of Claude's turns changed the film.
  const recordClaude = useCallback(() => {
    back.current = [...back.current, { claude: true, label: "Claude’s change", at: Date.now() }];
    forward.current = [];
  }, []);

  // The chat's own Undo button undid Claude's last turn: forget it here too.
  const forgetClaude = useCallback(() => {
    const i = back.current.findLastIndex((s) => "claude" in s);
    if (i >= 0) back.current = back.current.filter((_, n) => n !== i);
  }, []);

  const undo = useCallback(async () => {
    const step = back.current.at(-1);
    if (!step) {
      // Nothing done on this visit, but Claude may have changed the film
      // earlier: the server still keeps those steps.
      if (deps.current.claudeBusy()) return;
      const error = await deps.current.undoClaude();
      say(error ? "Nothing to undo" : "Undid Claude’s last change");
      return;
    }
    if ("claude" in step) {
      // Claude is still working: leave it be.
      if (deps.current.claudeBusy()) return;
      back.current = back.current.slice(0, -1);
      const error = await deps.current.undoClaude();
      say(error ?? "Undid Claude’s last change");
      return;
    }
    back.current = back.current.slice(0, -1);
    const redo = step.undo();
    if (redo) forward.current = [...forward.current, { label: step.label, redo }];
    say(`Undid: ${step.label}`);
  }, [say]);

  const redo = useCallback(() => {
    const step = forward.current.at(-1);
    if (!step) {
      say("Nothing to redo");
      return;
    }
    forward.current = forward.current.slice(0, -1);
    step.redo();
    // Redone, it can be undone again: by putting back what was there.
    say(`Redid: ${step.label}`);
  }, [say]);

  return useMemo(
    () => ({ record, recordClaude, forgetClaude, undo, redo, note }),
    [record, recordClaude, forgetClaude, undo, redo, note],
  );
}

export type History = ReturnType<typeof useHistory>;

// ⌘Z / Ctrl+Z, ⇧⌘Z / Ctrl+Shift+Z, Ctrl+Y. In a text field the browser's
// own text undo stays in charge.
export function undoKey(e: KeyboardEvent): "undo" | "redo" | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (key === "z") return e.shiftKey ? "redo" : "undo";
  if (key === "y" && e.ctrlKey && !e.metaKey) return "redo";
  return null;
}
