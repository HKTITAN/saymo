import type { ProviderId } from "./ai-types";

// Three versions of one prompt at once (takes.ts): the shapes the studio
// page and the server share, and how each version differs.

export const TAKE_COUNT = 3;

export type TakeState = "working" | "done" | "failed" | "stopped";
export type Take = { id: string; n: number; state: TakeState; step: string | null; reply: string; error: string | null };
export type Takes = { prompt: string; at: string; provider: ProviderId; takes: Take[] };

// Plain enough to read in the picker too.
export const TAKE_WAYS = [
  { label: "As asked", note: "Do what they asked in the most direct, faithful way, with the most care for craft." },
  { label: "Bolder", note: "Do what they asked, and push it further: bigger moves, stronger contrast and scale, more energy, still on brand." },
  { label: "Another idea", note: "Answer the same request with a different idea: another layout, rhythm or concept than the obvious one." },
] as const;

// A prompt that asks for three versions itself ("give me 3 versions of the
// intro", "try three different takes").
export const asksForThree = (prompt: string) =>
  /\b(3|three)\s+(different\s+|more\s+|alternative\s+)?(versions|takes|options|variations|variants|directions|ideas)\b/i.test(prompt);
