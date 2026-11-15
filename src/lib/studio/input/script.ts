// A script for a reel or a film, as Claude writes it and the storyboard
// edits it: a title and a list of beats. Each beat is one thing said (the
// spoken line) and one thing seen (a short visual idea). The teleprompter
// reads the lines; the reel's motion graphics come from the visuals.
//
// POST /api/studio/script  { idea, seconds, keep }  streams ScriptEvents
// (text/event-stream, one JSON event per `data:` line).

// How a beat of a reel fills the frame: the split (you on the top half,
// the beat's graphic below), the pop-out (the graphic on the top 70%, you
// on the bottom 30%, your head rising over the line into the graphic), the
// fade (you filling the frame, its top fading smoothly to dark with the
// graphic in it, you in front), the graphic alone while you talk, or you
// alone.
export type ReelLayout = "split" | "popout" | "fade" | "graphic" | "you";
export const REEL_LAYOUTS: readonly (readonly [ReelLayout, string])[] = [
  ["split", "Split"],
  ["popout", "Pop-out"],
  ["fade", "Fade"],
  ["graphic", "Graphic"],
  ["you", "You"],
];
export type Beat = { line: string; visual: string; layout?: ReelLayout };
// `captions`: "serif" for one big serif word at a time (bold, the usual,
// when missing); `tag`: a small series line under them.
export type Script = { title: string; beats: Beat[]; captions?: "serif"; tag?: string };

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
  const r = raw as { title?: unknown; beats?: unknown; captions?: unknown; tag?: unknown };
  if (!Array.isArray(r.beats)) return null;
  const beats = r.beats
    .map((b) => {
      const x = (b ?? {}) as { line?: unknown; visual?: unknown; layout?: unknown };
      // A layout other than the usual split is kept; anything unknown is dropped.
      const layout = REEL_LAYOUTS.find(([k]) => k === x.layout)?.[0];
      return {
        line: typeof x.line === "string" ? tidy(x.line).slice(0, 600) : "",
        visual: typeof x.visual === "string" ? tidy(x.visual).slice(0, 300) : "",
        ...(layout && layout !== "split" ? { layout } : {}),
      };
    })
    .filter((b) => b.line)
    .slice(0, MAX_BEATS);
  if (!beats.length) return null;
  const title = typeof r.title === "string" && tidy(r.title) ? tidy(r.title).slice(0, 80) : "Untitled reel";
  const tag = typeof r.tag === "string" ? tidy(r.tag).slice(0, 60) : "";
  return { title, beats, ...(r.captions === "serif" ? { captions: "serif" as const } : {}), ...(tag ? { tag } : {}) };
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
// as the person's own message; the saymo-video-edit skill holds the
// craft ("Half-and-half reels").
export function reelPrompt(script: Script | null, takes: number) {
  const who = takes > 1 ? "the speaker" : "me";
  const talks = takes > 1 ? "the speaker keeps talking" : "I keep talking";
  if (!script) {
    return `Make this a half-and-half reel: ${who} on the top half, filling it, and motion graphics on the bottom half that show what's being said, one per idea, timed to the words. Add captions.`;
  }
  const extra = [
    script.captions === "serif" ? "Use serif captions, marking the key words as hits." : "",
    script.tag ? `Put the series tag "${script.tag}" under the captions.` : "",
  ]
    .filter(Boolean)
    .map((x) => ` ${x}`)
    .join("");
  const layouts = script.beats.map((b) => b.layout ?? "split");
  if (layouts.every((l) => l === "split")) {
    const beats = script.beats.map((b, i) => `${i + 1}. "${b.line}" Visual: ${b.visual || "your call"}`).join("\n");
    return `Make this a half-and-half reel: ${who} on the top half, filling it, and a motion graphic for each beat of my script on the bottom half, timed to when I say that line. Add captions.${extra} The script is attached; here are the beats:\n${beats}`.slice(0, 7800);
  }
  const named: Record<ReelLayout, string> = { split: "split", popout: "pop-out", fade: "fade", graphic: "graphic only", you: "speaker only" };
  const meaning: Record<ReelLayout, string> = {
    split: `split is ${who} on the top half and the beat's graphic below`,
    popout: `pop-out is the graphic on the top 70% and ${who} on the bottom 30%, the head rising over the line into it`,
    fade: `fade is ${who} filling the frame, its top fading smoothly to dark with the graphic in it, ${who} in front`,
    graphic: `graphic only is the graphic filling the frame while ${talks}`,
    you: `speaker only is ${who} filling the frame`,
  };
  // Only the layouts this reel uses, so the message stays short.
  const used = REEL_LAYOUTS.map(([k]) => k).filter((k) => layouts.includes(k));
  const beats = script.beats.map((b, i) => `${i + 1}. "${b.line}" Visual: ${b.visual || "your call"}. Layout: ${named[layouts[i]]}`).join("\n");
  const cut = layouts.some((l) => l === "popout" || l === "fade") ? " Make the cutout first, with the media tool's cutout command." : "";
  return `Make this a reel with its own layout for each beat (see Reel layouts in the video edit skill): ${used.map((k) => meaning[k]).join("; ")}.${cut} Time each beat to when I say its line, cut between layouts on the beat, and add captions.${extra} The script is attached; here are the beats:\n${beats}`.slice(0, 7800);
}

// The first prompt of a motion graphics film made from a script.
export function motionPrompt(script: Script) {
  const seconds = Math.max(6, Math.round(readSeconds(script.beats)));
  const beats = script.beats.map((b, i) => `${i + 1}. Says: "${b.line}" Shows: ${b.visual || "your call"}`).join("\n");
  return `Make a motion graphics film from this script, "${script.title}": one scene per beat, about ${seconds} s in all, each scene as long as its line takes to read. Put each line on screen as the type, and draw what "Shows" describes.\n${beats}`.slice(0, 7800);
}
