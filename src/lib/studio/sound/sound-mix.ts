import type { SoundSpan, SoundStem } from "./sound";

// The volume edits on the timeline's Music and Effects lanes (sound.ts
// SoundMix), worked out the same way in the page and on the server: spans
// of one stem never overlap, and a newer span wins where it lands.

export const GAIN_MIN = -24;
export const GAIN_MAX = 6;

const round = (t: number) => Math.round(t * 1000) / 1000;

// Does it change anything?
export const audible = (s: Pick<SoundSpan, "gain" | "mute">) => s.mute || Math.abs(s.gain) >= 0.05;

// The spans with `from` to `to` of `stem` given back to the score.
export function clearSpan(spans: SoundSpan[], stem: SoundStem, from: number, to: number): SoundSpan[] {
  const out: SoundSpan[] = [];
  for (const o of spans) {
    if (o.stem !== stem || o.to <= from || o.from >= to) out.push(o);
    else {
      if (o.from < from - 0.001) out.push({ ...o, to: round(from) });
      if (o.to > to + 0.001) out.push({ ...o, from: round(to) });
    }
  }
  return sorted(out);
}

// The spans with `span` laid over them.
export function placeSpan(spans: SoundSpan[], span: SoundSpan): SoundSpan[] {
  const rest = clearSpan(spans, span.stem, span.from, span.to);
  if (!audible(span)) return rest;
  return sorted([...rest, { ...span, from: round(span.from), to: round(span.to), gain: Math.round(span.gain * 10) / 10 }]);
}

// What the span from `from` to `to` of `stem` is set to: the edit covering
// all of it, if there is one, else as rendered.
export function levelOf(spans: SoundSpan[], stem: SoundStem, from: number, to: number) {
  const whole = spans.find((s) => s.stem === stem && s.from <= from + 0.001 && s.to >= to - 0.001);
  return { gain: whole?.gain ?? 0, mute: whole?.mute ?? false };
}

// Is any of it edited?
export const isEdited = (spans: SoundSpan[], stem: SoundStem, from: number, to: number) =>
  spans.some((s) => s.stem === stem && s.to > from + 0.001 && s.from < to - 0.001);

const sorted = (spans: SoundSpan[]) => [...spans].sort((a, b) => a.stem.localeCompare(b.stem) || a.from - b.from);
