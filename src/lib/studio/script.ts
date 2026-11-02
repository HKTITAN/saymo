// A script for a reel or a film, as Claude writes it and the storyboard
// edits it: a title and a list of beats. Each beat is one thing said (the
// spoken line) and one thing seen (a short visual idea). The teleprompter
// reads the lines; the reel's motion graphics come from the visuals.
//
// POST /api/studio/script  { idea, seconds, keep }  streams ScriptEvents
// (text/event-stream, one JSON event per `data:` line).

export type Beat = { line: string; visual: string };
export type Script = { title: string; beats: Beat[] };

export type ScriptRequest = {
  idea: string; // a topic, notes, or a whole script
  seconds: number; // how long the reel should run when read aloud
  keep: boolean; // true: keep their words exactly and only split them into beats
};

export type ScriptEvent =
  | { kind: "step"; label: string } // one plain line: "Thinking it through", "Writing beat 3"
  | { kind: "draft"; title: string; beats: Beat[] } // the beats so far, as they're written
  | { kind: "done"; script: Script }
  | { kind: "error"; message: string };

export const LENGTHS = [15, 30, 45, 60] as const;

export const MAX_IDEA = 6000;
export const MAX_BEATS = 30;

// Only what the storyboard needs, trimmed, from whatever came back.
export function cleanScript(raw: unknown): Script | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { title?: unknown; beats?: unknown };
  if (!Array.isArray(r.beats)) return null;
  const beats = r.beats
    .map((b) => {
      const x = (b ?? {}) as { line?: unknown; visual?: unknown };
      return {
        line: typeof x.line === "string" ? tidy(x.line).slice(0, 600) : "",
        visual: typeof x.visual === "string" ? tidy(x.visual).slice(0, 300) : "",
      };
    })
    .filter((b) => b.line)
    .slice(0, MAX_BEATS);
  if (!beats.length) return null;
  const title = typeof r.title === "string" && tidy(r.title) ? tidy(r.title).slice(0, 80) : "Untitled reel";
  return { title, beats };
}

// One line of words: no em dashes (house rule), no doubled spaces.
export const tidy = (s: string) =>
  s
    .replace(/\s*\u2014\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();

// Read aloud at about 150 words a minute.
export const WORDS_PER_SECOND = 2.5;
export const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;
export const readSeconds = (beats: Beat[]) => beats.reduce((t, b) => t + wordCount(b.line), 0) / WORDS_PER_SECOND;

// Does pasted text read as a finished script (keep its words) rather than
// a topic or notes (write one)?
export const looksLikeScript = (text: string) => wordCount(text) >= 35 && (text.match(/[.!?](\s|$)/g)?.length ?? 0) >= 2;

// ─── What the new film's first message says ──────────────────────────────────

// The file the script travels in, saved in the film's refs/ for Claude.
export const SCRIPT_FILE = "script.json";

// The first prompt of a reel film. Kept short, since it shows in the chat
// as the person's own message; the aerchain-video-edit skill holds the
// craft ("Half-and-half reels").
export function reelPrompt(script: Script | null, takes: number) {
  const who = takes > 1 ? "the speaker" : "me";
  if (!script) {
    return `Make this a half-and-half reel: ${who} on the top half, filling it, and motion graphics on the bottom half that show what's being said, one per idea, timed to the words. Add captions.`;
  }
  const beats = script.beats.map((b, i) => `${i + 1}. "${b.line}" Visual: ${b.visual || "your call"}`).join("\n");
  return `Make this a half-and-half reel: ${who} on the top half, filling it, and a motion graphic for each beat of my script on the bottom half, timed to when I say that line. Add captions. The script is attached; here are the beats:\n${beats}`.slice(0, 7800);
}

// The first prompt of a motion graphics film made from a script.
export function motionPrompt(script: Script) {
  const seconds = Math.max(6, Math.round(readSeconds(script.beats)));
  const beats = script.beats.map((b, i) => `${i + 1}. Says: "${b.line}" Shows: ${b.visual || "your call"}`).join("\n");
  return `Make a motion graphics film from this script, "${script.title}": one scene per beat, about ${seconds} s in all, each scene as long as its line takes to read. Put each line on screen as the type, and draw what "Shows" describes.\n${beats}`.slice(0, 7800);
}
