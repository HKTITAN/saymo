"use client";

import { type RefObject, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  type Accuracy,
  type DictationError,
  type DictationLanguage,
  type DictationStatus,
  type HindiScript,
  isAccuracy,
  isLanguage,
  isScript,
  MAX_RECORDING_SECONDS,
  type PieceResult,
} from "@/lib/studio/dictation-shared";
import { STUDIO_HEADERS } from "@/lib/studio/contract";
import { MicError, Recorder } from "./dictation-recorder";

// Talking into a prompt box. Click the mic (or press ⌘ ⇧ D, or hold
// ⌥ Space) and talk; click again or press Enter to stop, Esc to throw it
// away. What you said is written down on this Mac (dictation.ts) and put
// in the box where the cursor was, a piece at a time on long recordings.
// It is never sent by itself.
//
// Nothing said is lost: a piece stays here, in memory, until it has been
// written down, and on the studio's disk too; if writing fails, "Try
// again" sends it again. One box listens at a time across the page.

// ─── Settings, per person, in this browser ───────────────────────────────────

export type DictationSettings = { language: DictationLanguage; script: HindiScript; accuracy: Accuracy };
const KEY = "studio.dictation";
// Roman letters by default: how most people type Hinglish prompts.
const DEFAULTS: DictationSettings = { language: "auto", script: "roman", accuracy: "best" };
let settings: DictationSettings | null = null;
const settingsListeners = new Set<() => void>();

function readSettings(): DictationSettings {
  if (settings) return settings;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<DictationSettings> | null;
    settings = {
      language: isLanguage(raw?.language) ? raw.language : DEFAULTS.language,
      script: isScript(raw?.script) ? raw.script : DEFAULTS.script,
      accuracy: isAccuracy(raw?.accuracy) ? raw.accuracy : DEFAULTS.accuracy,
    };
  } catch {
    settings = DEFAULTS;
  }
  return settings;
}

export function setDictationSettings(change: Partial<DictationSettings>) {
  settings = { ...readSettings(), ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
  for (const l of settingsListeners) l();
}

export function useDictationSettings() {
  return useSyncExternalStore(
    (l) => {
      settingsListeners.add(l);
      return () => settingsListeners.delete(l);
    },
    readSettings,
    () => DEFAULTS,
  );
}

// ─── The studio's side ───────────────────────────────────────────────────────

class Unreachable extends Error {}

async function call<T>(init: RequestInit & { headers?: Record<string, string> }, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/studio/dictation", { ...init, signal, headers: { ...STUDIO_HEADERS, ...init.headers } });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Unreachable();
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as (T & Partial<DictationError>) | null;
  if (!res.ok || !body) {
    throw Object.assign(new Error(body?.error ?? "Writing this down failed. Your recording is kept here, so you can try again."), {
      code: body?.code ?? "failed",
    });
  }
  return body;
}

export const dictationApi = {
  status: () => call<DictationStatus>({ method: "GET" }),
  act: (action: string, extra: Record<string, unknown> = {}) =>
    call<DictationStatus>({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) }),
  retry: (id: string, extra: DictationSettings & { context: string }) =>
    call<PieceResult & { error: string | null }>({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retry", id, ...extra }),
    }),
};

// ─── One box's dictation ─────────────────────────────────────────────────────

export type DictationPhase = "idle" | "starting" | "recording" | "writing";
export type DictationView = {
  phase: DictationPhase;
  seconds: number; // recorded so far, whole seconds
  // Pieces waiting to be written down (the shimmering line shows while > 0).
  waiting: number;
  // Something to say: a problem, or what happened. `retry` when the
  // recording is kept and can be sent again; `setup` when listening needs
  // setting up first.
  notice: { text: string; tone: "error" | "info"; retry?: boolean; setup?: boolean } | null;
  // Esc on a recording over ten seconds asks first.
  asking: boolean;
  // Another box on the page is listening.
  elsewhere: boolean;
  // Setting up listening, as it goes.
  setupStep: string | null;
  // Recording with the browser's plain recorder (no level meter).
  plain: boolean;
};

type Io = { value: () => string; set: (value: string) => void; textarea: () => HTMLTextAreaElement | null };
type Piece = { n: number; blob: Blob; seconds: number };

const IDLE: DictationView = { phase: "idle", seconds: 0, waiting: 0, notice: null, asking: false, elsewhere: false, setupStep: null, plain: false };
const ASK_AFTER = 10;
const SILENT = 0.0015;

// The box that's listening, if any; every box hears when it changes.
let active: Dictation | null = null;
const boxes = new Set<Dictation>();
const claim = (d: Dictation | null) => {
  active = d;
  for (const b of boxes) b.refresh();
};

// While a box listens, Esc and ⌘ ⇧ D reach it from anywhere on the page,
// before anything else: one listener for the page, added with the first
// prompt box, so it's heard before a pop-up's own Esc (which would close
// the pop-up mid-recording).
let keysAdded = false;
function addKeys() {
  if (keysAdded) return;
  keysAdded = true;
  window.addEventListener(
    "keydown",
    (e) => {
      const d = active;
      if (!d?.listening()) return;
      if (e.key === "Escape" && !e.isComposing) {
        if (!d.escape()) return;
      } else if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "d") {
        void d.stop();
      } else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
}

const newId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
};

export class Dictation {
  recorder: Recorder | null = null;
  private view: DictationView = IDLE;
  private listeners = new Set<() => void>();
  private id = "";
  private pieces: Piece[] = [];
  private nextPiece = 0;
  private sending: AbortController | null = null;
  private stalled = false;
  private cancelled = false;
  private sentAny = false;
  // Where the words go: after `prefix`, replacing `replace` characters the
  // first time (a selection when you started).
  private prefix = "";
  private replace = 0;
  private context = "";
  private wroteAny = false;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private setupPoll: ReturnType<typeof setTimeout> | null = null;

  // The box: its words now, a way to change them, and its text area.
  constructor(private readonly box: RefObject<Io>) {}
  private get io() {
    return this.box.current;
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  get = () => this.view;

  attach() {
    addKeys();
    boxes.add(this);
    this.refresh();
    return () => {
      boxes.delete(this);
      // A box closed mid-recording (a pop-up closed by a click outside)
      // stops listening, and what was said is kept by the studio, listed in
      // the mic's menu as not written down yet.
      void this.keepForLater();
      this.stopTimers();
    };
  }

  refresh() {
    this.patch({ elsewhere: active !== null && active !== this });
  }

  private patch(change: Partial<DictationView>) {
    const next = { ...this.view, ...change };
    if (Object.keys(change).every((k) => this.view[k as keyof DictationView] === next[k as keyof DictationView])) return;
    this.view = next;
    for (const l of this.listeners) l();
  }

  private busy = () => this.view.phase !== "idle" || this.pieces.length > 0;
  listening = () => this.view.phase === "recording" || this.view.phase === "starting";

  toggle() {
    if (this.view.phase === "recording") void this.stop();
    else if (this.view.phase === "idle") void this.start();
  }

  async start() {
    if (active && active !== this) return;
    if (this.view.phase !== "idle") return;
    // A recording that couldn't be written down is dealt with first (Try
    // again or Discard, under the box); starting again would put words out
    // of order.
    if (this.pieces.length) return;
    claim(this);
    this.id = newId();
    this.nextPiece = 0;
    this.cancelled = false;
    this.sentAny = false;
    this.wroteAny = false;
    this.context = "";
    const box = this.io.textarea();
    const value = this.io.value();
    const from = box && document.activeElement === box ? box.selectionStart : value.length;
    const to = box && document.activeElement === box ? box.selectionEnd : value.length;
    this.prefix = value.slice(0, from);
    this.replace = to - from;
    this.patch({ phase: "starting", notice: null, seconds: 0, asking: false, plain: false });

    const recorder = new Recorder();
    this.recorder = recorder;
    recorder.onPiece = (blob, seconds, loudest) => {
      // Dead silence (the meter flat) isn't worth sending.
      if (this.cancelled || loudest < SILENT) return;
      this.pieces.push({ n: this.nextPiece++, blob, seconds });
      this.patch({ waiting: this.pieces.length });
      void this.send();
    };
    recorder.onLost = () => {
      this.endRecording();
      this.patch({ notice: { text: "The mic was disconnected, so recording stopped. What you said until then is kept.", tone: "info" } });
    };
    try {
      await recorder.start();
    } catch (error) {
      this.recorder = null;
      claim(null);
      this.patch({ phase: "idle", notice: { text: error instanceof MicError ? error.message : "The mic couldn't start. Try again.", tone: "error" } });
      return;
    }
    if (this.cancelled || active !== this) {
      recorder.abort();
      return;
    }
    this.patch({ phase: "recording" });
    window.addEventListener("beforeunload", this.keepOnLeave);
    this.ticker = setInterval(() => {
      const seconds = Math.floor(recorder.seconds);
      this.patch({ seconds, plain: recorder.fallback });
      if (recorder.seconds >= MAX_RECORDING_SECONDS) {
        void this.stop().then(() =>
          this.patch({ notice: { text: "Recording stops after 15 minutes. What you said is being written down.", tone: "info" } }),
        );
      }
    }, 250);
    this.io.textarea()?.focus();
  }

  async stop() {
    if (this.view.phase === "starting") return this.cancel(true);
    if (this.view.phase !== "recording") return;
    const recorder = this.recorder;
    await recorder?.stop();
    this.endRecording();
    // A mic that heard nothing at all is worth saying, rather than writing
    // down nothing.
    if (recorder && recorder.peak < SILENT && !this.wroteAny) {
      this.patch({ notice: { text: "The mic didn't pick up any sound. Check the input in System Settings, under Sound.", tone: "error" } });
    }
    this.io.textarea()?.focus();
  }

  private endRecording() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.recorder = null;
    const writing = !this.stalled && (this.pieces.length > 0 || this.sending !== null);
    this.patch({ phase: writing ? "writing" : "idle", asking: false });
    if (!writing) this.release();
  }

  // Esc. Over ten seconds, the first Esc asks; a second one discards it.
  escape() {
    if (this.view.phase !== "recording" && this.view.phase !== "starting") return false;
    if (this.view.asking || (this.recorder?.seconds ?? 0) < ASK_AFTER) this.cancel(true);
    else this.patch({ asking: true });
    return true;
  }

  dismiss() {
    this.patch({ notice: null });
  }

  keepRecording() {
    this.patch({ asking: false });
    this.io.textarea()?.focus();
  }

  // Throws the recording away: nothing more is written into the box.
  cancel(quietly = false) {
    this.cancelled = true;
    this.recorder?.abort();
    this.recorder = null;
    this.sending?.abort();
    this.sending = null;
    this.pieces = [];
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    if (this.sentAny) void dictationApi.act("discard", { id: this.id }).catch(() => {});
    this.patch({ phase: "idle", waiting: 0, asking: false, notice: quietly ? null : this.view.notice });
    this.release();
    this.io.textarea()?.focus();
  }

  // After an error: send the kept pieces again.
  retry() {
    if (!this.pieces.length) return this.patch({ notice: null });
    if (active && active !== this) return;
    this.patch({ notice: null });
    claim(this);
    if (this.view.phase === "idle") this.patch({ phase: "writing" });
    window.addEventListener("beforeunload", this.keepOnLeave);
    this.stalled = false;
    void this.send();
  }

  // After an error: give up on the kept pieces (deleted from the studio too).
  discard() {
    this.cancel(true);
  }

  // Listening isn't set up: set it up, then send what's waiting.
  async setUp() {
    this.patch({ notice: null, setupStep: "Setting up listening on this Mac" });
    try {
      await dictationApi.act("setup");
    } catch {
      this.patch({ setupStep: null, notice: { text: "Unable to reach the studio. Check that it's still running, then try again.", tone: "error", setup: true } });
      return;
    }
    const poll = async () => {
      try {
        const s = await dictationApi.status();
        if (s.setup.running) {
          this.patch({ setupStep: s.setup.step ?? "Setting up listening on this Mac" });
          this.setupPoll = setTimeout(poll, 1200);
          return;
        }
        this.patch({ setupStep: null });
        if (s.setup.error || !s.ready) {
          this.patch({ notice: { text: s.setup.error ?? "Setting up listening didn't finish. Try again.", tone: "error", setup: true } });
          return;
        }
        this.retry();
      } catch {
        this.setupPoll = setTimeout(poll, 2000);
      }
    };
    this.setupPoll = setTimeout(poll, 800);
  }

  // A recording kept by the studio from before (the menu's list).
  async writeKept(id: string) {
    if (active && active !== this) return;
    if (this.busy()) return;
    claim(this);
    this.prefixAtCursor();
    this.patch({ phase: "writing", waiting: 1, notice: null });
    try {
      const said = await dictationApi.retry(id, { ...readSettings(), context: this.prefix.slice(-200) });
      if (said.text) this.insert(said.text);
      if (said.error) this.patch({ notice: { text: `${said.error} The rest is still kept in the mic's menu.`, tone: "error" } });
    } catch (error) {
      this.patch({ notice: { text: this.wordsFor(error, false), tone: "error" } });
    } finally {
      this.patch({ phase: "idle", waiting: 0 });
      this.release();
    }
  }

  private prefixAtCursor() {
    const box = this.io.textarea();
    const value = this.io.value();
    const at = box && document.activeElement === box ? box.selectionStart : value.length;
    this.prefix = value.slice(0, at);
    this.replace = 0;
  }

  // Pieces go one at a time, in order; one that fails holds the rest.
  private async send() {
    if (this.sending || this.stalled) return;
    while (this.pieces.length && !this.cancelled) {
      const piece = this.pieces[0];
      const abort = new AbortController();
      this.sending = abort;
      try {
        this.sentAny = true;
        const said = await call<PieceResult>(
          {
            method: "POST",
            headers: {
              "Content-Type": piece.blob.type || "audio/wav",
              "x-dictation": this.id,
              "x-piece": String(piece.n),
              ...this.askHeaders(),
              "x-context": encodeURIComponent(this.context.slice(-200)),
            },
            body: piece.blob,
          },
          abort.signal,
        );
        if (this.cancelled) break;
        this.pieces.shift();
        if (said.text) this.insert(said.text);
        this.patch({ waiting: this.pieces.length });
      } catch (error) {
        if (abort.signal.aborted || this.cancelled) break;
        this.stalled = true;
        const code = (error as { code?: string }).code;
        this.patch({ notice: { text: this.wordsFor(error, true), tone: "error", retry: code !== "setup", setup: code === "setup" } });
        // Still recording: it carries on, and its pieces wait their turn.
        if (!this.recorder) {
          this.patch({ phase: "idle" });
          this.release();
        }
        break;
      } finally {
        if (this.sending === abort) this.sending = null;
      }
    }
    if (!this.pieces.length && !this.recorder && !this.cancelled) this.finish();
  }

  private wordsFor(error: unknown, kept: boolean) {
    if (error instanceof Unreachable) {
      return kept
        ? "Studio not running, your recording is kept, try again soon"
        : "Unable to reach the studio. Check that it's still running, then try again.";
    }
    if ((error as { code?: string }).code === "setup") {
      return "Set up listening once (1.6 GB) to write this down";
    }
    return error instanceof Error ? error.message : "Writing this down failed. Try again.";
  }

  // Puts words in the box where the cursor was; anything typed meanwhile
  // stays where it is.
  private insert(text: string) {
    const value = this.io.value();
    let before: string;
    let after: string;
    if (value.startsWith(this.prefix)) {
      before = this.prefix;
      after = value.slice(this.prefix.length + this.replace);
    } else {
      before = value;
      after = "";
    }
    this.replace = 0;
    const lead = before && !/\s$/.test(before) ? " " : "";
    text = continuing(before, text);
    const trail = after && !/^[\s.,!?;:)]/.test(after) ? " " : "";
    this.prefix = before + lead + text;
    const next = this.prefix + trail + after;
    this.io.set(next);
    this.context = `${this.context} ${text}`.slice(-400);
    this.wroteAny = true;
    const box = this.io.textarea();
    if (box && document.activeElement === box) {
      const at = this.prefix.length;
      requestAnimationFrame(() => box.setSelectionRange(at, at));
    }
  }

  private finish() {
    this.patch({ phase: "idle", waiting: 0 });
    this.release();
  }

  private async keepForLater() {
    const recorder = this.recorder;
    this.recorder = null;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.sending?.abort();
    this.sending = null;
    if (active === this) claim(null);
    if (this.cancelled) return;
    // Pieces still to come out of the recorder join the queue first.
    if (recorder) {
      recorder.onPiece = (blob, seconds, loudest) => {
        if (loudest >= SILENT) this.pieces.push({ n: this.nextPiece++, blob, seconds });
      };
      await recorder.stop();
    }
    const pieces = this.pieces;
    this.pieces = [];
    window.removeEventListener("beforeunload", this.keepOnLeave);
    for (const piece of pieces) {
      await call(
        {
          method: "POST",
          headers: {
            "Content-Type": piece.blob.type || "audio/wav",
            "x-dictation": this.id,
            "x-piece": String(piece.n),
            "x-keep": "1",
            ...this.askHeaders(),
          },
          body: piece.blob,
        },
      ).catch(() => {});
    }
  }

  private askHeaders() {
    const { language, script, accuracy } = readSettings();
    return { "x-language": language, "x-script": script, "x-accuracy": accuracy };
  }

  // Lets another box listen. Leaving the page still asks first while a
  // recording here hasn't been written down.
  private release() {
    if (!this.pieces.length) window.removeEventListener("beforeunload", this.keepOnLeave);
    if (active === this) claim(null);
  }

  private keepOnLeave = (e: BeforeUnloadEvent) => {
    if (this.busy()) e.preventDefault();
  };

  private stopTimers() {
    if (this.ticker) clearInterval(this.ticker);
    if (this.setupPoll) clearTimeout(this.setupPoll);
    window.removeEventListener("beforeunload", this.keepOnLeave);
  }
}

// Words added mid-sentence don't start with a capital, unless the first
// word is a name or an abbreviation (Aerchain, SpendOS, CPO, I).
const KEEP_CAPITAL = /^(?:I|I'm|I'll|I've|I'd|Aerchain|SpendOS|Aiera)\b/;
function continuing(before: string, text: string) {
  if (!/[\p{L}\p{N},;:]\s*$/u.test(before) || KEEP_CAPITAL.test(text)) return text;
  const first = text.split(/\s/)[0] ?? "";
  if (/[A-Z].*[A-Z]/.test(first)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export function useDictation(io: Io) {
  const box = useRef(io);
  useEffect(() => {
    box.current = io;
  });
  const [d] = useState(() => new Dictation(box));
  useEffect(() => d.attach(), [d]);
  const view = useSyncExternalStore(d.subscribe, d.get, () => IDLE);
  return { d, view };
}
