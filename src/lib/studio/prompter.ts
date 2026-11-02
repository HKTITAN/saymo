// The teleprompter follows your voice: the words the browser hears are
// lined up against the script's words, and the prompter moves to just after
// the last word you said. Speech recognition mishears, drops and adds
// words, so the match is fuzzy and anchored on the last few words heard:
// it tolerates skipped and misheard words, prefers moving forward a little
// over jumping far, and only goes back when you clearly repeat a phrase.

export type PromptWord = { text: string; norm: string; beat: number };

const NUMBERS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16",
  seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20", thirty: "30", forty: "40", fifty: "50",
  sixty: "60", seventy: "70", eighty: "80", ninety: "90", hundred: "100",
};

// A word as it's compared: lower case, letters and digits only.
export function normWord(word: string) {
  const w = word
    .toLowerCase()
    .replace(/%/g, "percent")
    .replace(/&/g, "and")
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");
  return NUMBERS[w] ?? w;
}

// The script's words, in reading order, each with the beat it's in.
export function promptWords(lines: string[]): PromptWord[] {
  const out: PromptWord[] = [];
  lines.forEach((line, beat) => {
    for (const text of line.split(/\s+/).filter(Boolean)) out.push({ text, norm: normWord(text), beat });
  });
  return out;
}

// What was heard, as compared words (empty ones dropped).
export function heardWords(transcript: string) {
  return transcript.split(/\s+/).map(normWord).filter(Boolean);
}

// How alike two words are, 0..1: equal, one the start of the other (a
// plural, "procure" for "procurement"), or a few letters apart.
export function similar(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const short = a.length < b.length ? a : b;
  const long = a.length < b.length ? b : a;
  if (short.length >= 3 && long.startsWith(short)) return 0.85;
  const d = distance(a, b);
  return Math.max(0, 1 - d / Math.max(a.length, b.length));
}

function distance(a: string, b: string) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

const MATCH = 0.72; // how alike a heard word and a script word must be
const TAIL = 7; // how many of the last heard words are lined up
const AHEAD = 30; // how far forward the prompter looks
const BEHIND = 12; // how far back, for a repeated phrase

// Short common words ("the", "a", "to") say little about where you are.
const weight = (w: string) => (w.length <= 2 ? 0.35 : w.length === 3 ? 0.6 : 1);

// Lines up `heard` (most recent last) with the script and returns where the
// prompter should be: the index of the next word to say. `pos` is where it
// is now. Returns `pos` when nothing fits well enough.
export function follow(script: PromptWord[], pos: number, heard: string[]): number {
  const tail = heard.slice(-TAIL);
  const m = tail.length;
  if (!m || !script.length) return pos;
  const lo = Math.max(0, pos - BEHIND);
  const hi = Math.min(script.length, pos + AHEAD);
  let best = { score: 0, end: -1, matched: 0 };

  // Each candidate: the last word heard is script word `e`. The words heard
  // before it are lined up backwards, allowing skips on either side.
  for (let e = lo; e < hi; e++) {
    const last = similar(tail[m - 1], script[e].norm);
    if (last < MATCH) continue;
    const { score, matched } = lineUp(tail, script, e, lo);
    // Forward a little is likeliest; far ahead less so; going back needs a
    // clear repeat of several words.
    const step = e + 1 - pos;
    const back = step < 0;
    if (back && (matched < 3 || -step > BEHIND)) continue;
    const cost = back ? -step * 0.2 : Math.max(0, step - 3) * 0.04;
    const total = score - cost;
    if (total > best.score) best = { score: total, end: e, matched };
  }
  if (best.end < 0) return pos;
  // One matching word moves the prompter only if it's a distinctive word
  // close to where you are.
  if (best.matched < 2) {
    const word = script[best.end].norm;
    if (word.length < 4 || best.end + 1 - pos > 4 || best.end + 1 < pos) return pos;
  }
  return best.end + 1;
}

// The best alignment of the heard tail ending on script word `e`, as a
// weighted count of matched words, with small costs for skipped words.
function lineUp(tail: string[], script: PromptWord[], e: number, lo: number) {
  const m = tail.length;
  const span = Math.min(e - lo + 1, m + 4);
  const start = e - span + 1;
  // score[i][j]: tail[0..i) against script[start..start+j), with the
  // alignment free to begin anywhere (a local alignment) and forced to end
  // with tail[m-1] on script[e].
  const NEG = -1e9;
  const score: number[][] = Array.from({ length: m + 1 }, () => new Array(span + 1).fill(0));
  const count: number[][] = Array.from({ length: m + 1 }, () => new Array(span + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= span; j++) {
      const s = script[start + j - 1].norm;
      const sim = similar(tail[i - 1], s);
      let v = NEG;
      let c = 0;
      if (sim >= MATCH) {
        v = score[i - 1][j - 1] + sim * weight(s);
        c = count[i - 1][j - 1] + 1;
      }
      // A heard word that isn't in the script (misheard, or an "um").
      if (score[i - 1][j] - 0.25 > v) {
        v = score[i - 1][j] - 0.25;
        c = count[i - 1][j];
      }
      // A script word that wasn't heard (skipped, or dropped by the browser).
      if (score[i][j - 1] - 0.3 > v) {
        v = score[i][j - 1] - 0.3;
        c = count[i][j - 1];
      }
      if (v < 0) {
        v = 0;
        c = 0;
      }
      score[i][j] = v;
      count[i][j] = c;
    }
  }
  // Forced end: the last heard word matched the last script word.
  const s = script[e].norm;
  const endScore = score[m - 1][span - 1] + similar(tail[m - 1], s) * weight(s);
  return { score: endScore, matched: count[m - 1][span - 1] + 1 };
}
