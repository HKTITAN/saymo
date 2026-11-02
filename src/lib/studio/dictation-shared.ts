// What the page and the studio agree on for talking into a prompt box
// (dictation.ts on the studio's side, use-dictation.ts on the page's).

export type DictationLanguage = "auto" | "en" | "hi" | "hinglish";
export type HindiScript = "devanagari" | "roman";
export type Accuracy = "fast" | "best";
export type ExtraModel = "best" | "hinglish";

export const LANGUAGES: { id: DictationLanguage; label: string }[] = [
  { id: "auto", label: "Detect" },
  { id: "en", label: "English" },
  { id: "hi", label: "Hindi" },
  { id: "hinglish", label: "Hinglish" },
];

export const SCRIPTS: { id: HindiScript; label: string }[] = [
  { id: "devanagari", label: "Devanagari" },
  { id: "roman", label: "Roman" },
];

export const ACCURACIES: { id: Accuracy; label: string }[] = [
  { id: "fast", label: "Fast" },
  { id: "best", label: "Most accurate" },
];

export const isLanguage = (v: unknown): v is DictationLanguage => v === "auto" || v === "en" || v === "hi" || v === "hinglish";
export const isScript = (v: unknown): v is HindiScript => v === "devanagari" || v === "roman";
export const isAccuracy = (v: unknown): v is Accuracy => v === "fast" || v === "best";
export const isExtra = (v: unknown): v is ExtraModel => v === "best" || v === "hinglish";

// A recording is sent in pieces of about 30 seconds, cut where you pause,
// so long ones are written down as you go. A piece is 16 kHz mono WAV from
// the page, well under this; the cap keeps a stray upload from filling the
// disk.
export const MAX_PIECE_BYTES = 24 * 1024 * 1024;
export const MAX_RECORDING_SECONDS = 15 * 60;

// The ids the page makes for a recording: 16 letters and digits.
export const RECORDING_ID = /^[a-z0-9]{16}$/;

// The optional speech models' sizes.
export const EXTRA_MB: Record<ExtraModel, number> = { best: 1081, hinglish: 874 };
// The standard speech model, part of setting up listening.
export const STANDARD_MB = 1550;

export type DictationStatus = {
  // whisper.cpp and the standard model are on this Mac.
  ready: boolean;
  setup: { running: boolean; step: string | null; error: string | null };
  models: Record<ExtraModel, { installed: boolean; percent: number | null; error: string | null }>;
  // Recordings kept because they couldn't be written down yet.
  leftovers: { id: string; pieces: number; seconds: number; made: number }[];
};

export type PieceResult = { text: string; language: string | null };

// Why a piece couldn't be written down; the page words what to do next.
export type DictationErrorCode = "setup" | "audio" | "failed" | "gone";
export type DictationError = { error: string; code: DictationErrorCode; kept: boolean };
