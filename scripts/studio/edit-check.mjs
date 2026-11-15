// Checks words as the timeline (src/lib/studio/films/anchors.ts) and word
// cuts (cuts.ts) without a browser: graphics, caption fixes and sound marks that hang on words land
// where those words play, after cuts, splits, speed changes and a file
// transcribed again, and an edit without anchors comes back unchanged.
//
//   node scripts/studio/edit-check.mjs

import { applyFixes, remapAnchors, resolveEdit, wordRef } from "../../src/lib/studio/films/anchors.ts";
import { cutPauses, cutWords, fillers, filmEnd, quietest } from "../../src/lib/studio/films/cuts.ts";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
};
const near = (a, b) => Math.abs(a - b) < 0.002;

// One file, "take": ten words, one a second, each 0.6 s long with a 0.4 s
// gap after it.
const SAID = ["so", "um", "today", "we", "launch", "the", "new", "machine", "for", "everyone"];
const take = SAID.map((text, i) => ({ text, start: i, end: i + 0.6 }));
const transcripts = { take };
const ref = (word) => wordRef("take", SAID.indexOf(word));

const clip = (id, from, to, start, extra = {}) => ({ id, type: "clip", media: "take", start, from, to, ...extra });
const graphic = (id, extra = {}) => ({ id, type: "graphic", graphic: "lower-third", start: 0, duration: 2, values: {}, ...extra });
const edit = (clips, graphics = [], more = {}) => ({
  version: 2,
  tracks: [
    { id: "v1", kind: "video", name: "Footage", items: clips },
    { id: "g1", kind: "graphics", name: "Graphics", items: graphics },
  ],
  captions: { on: true, style: "lines", words: [], position: "bottom" },
  background: "#141414",
  ...more,
});
const g1 = (r) => r.edit.tracks[1].items[0];

// 1. A graphic on a word lands where that word plays.
{
  const r = resolveEdit(edit([clip("c1", 0, 10, 0)], [graphic("t", { at: { word: ref("launch") } })]), transcripts);
  check("anchor: lands on its word", near(g1(r).start, 4), `start ${g1(r).start}`);
  check("anchor: no notes when nothing moved", r.notes.length === 0, r.notes.join(" | "));
}

// 2. Cutting "so um" from the front moves the graphic 2 s earlier.
{
  const r = resolveEdit(edit([clip("c1", 1.8, 10, 0)], [graphic("t", { at: { word: ref("launch") } })]), transcripts);
  check("cut before it: the graphic moves with its word", near(g1(r).start, 4 - 1.8), `start ${g1(r).start}`);
}

// 3. A split with the gap closed: words after the split follow it.
{
  const clips = [clip("a", 0, 3.8, 0), clip("b", 5.8, 10, 3.8)]; // "launch the" cut out
  const r = resolveEdit(edit(clips, [graphic("t", { at: { word: ref("new") } })]), transcripts);
  check("split and close the gap: lands on its word in the second clip", near(g1(r).start, 3.8 + (6 - 5.8)), `start ${g1(r).start}`);
}

// 4. Speed: at 2x, a word 4 s into the source is 2 s into the film.
{
  const r = resolveEdit(edit([clip("c1", 0, 10, 1, { speed: 2 })], [graphic("t", { at: { word: ref("launch") } })]), transcripts);
  check("speed: twice as fast halves the time", near(g1(r).start, 1 + 4 / 2), `start ${g1(r).start}`);
}

// 5. Edges and offsets.
{
  const r = resolveEdit(
    edit([clip("c1", 0, 10, 0)], [graphic("t", { at: { word: ref("launch"), edge: "end", offset: 0.25 } })]),
    transcripts,
  );
  check("edge and offset: end of the word plus 0.25 s", near(g1(r).start, 4.6 + 0.25), `start ${g1(r).start}`);
}

// 6. `until` sets the length.
{
  const r = resolveEdit(
    edit([clip("c1", 0, 10, 0)], [graphic("t", { at: { word: ref("launch") }, until: { word: ref("machine"), edge: "end" } })]),
    transcripts,
  );
  check("until: lasts from one word to the end of another", near(g1(r).duration, 7.6 - 4), `duration ${g1(r).duration}`);
}

// 7. The word itself was cut: the graphic moves to the next word and says so.
{
  const clips = [clip("a", 0, 3.8, 0), clip("b", 4.8, 10, 3.8)]; // "launch" cut out
  const r = resolveEdit(edit(clips, [graphic("t", { at: { word: ref("launch") } })]), transcripts);
  check("cut word: moves to the next word still in", near(g1(r).start, 3.8 + (5 - 4.8)), `start ${g1(r).start}`);
  check("cut word: a note names both words", r.notes.length === 1 && /"the"/.test(r.notes[0]) && /"launch"/.test(r.notes[0]), r.notes.join(" | "));
}

// 8. The same footage twice: the topmost, earliest clip wins, and `clip` pins it.
{
  const twice = {
    version: 2,
    tracks: [
      { id: "v1", kind: "video", name: "Footage", items: [clip("low", 0, 10, 0)] },
      { id: "v2", kind: "video", name: "Footage 2", items: [clip("high-late", 0, 10, 20), clip("high", 0, 10, 10)] },
      { id: "g1", kind: "graphics", name: "Graphics", items: [graphic("t", { at: { word: ref("launch") } }), graphic("p", { at: { word: ref("launch"), clip: "low" } })] },
    ],
    captions: { on: false, style: "lines", words: [], position: "bottom" },
    background: "#141414",
  };
  const r = resolveEdit(twice, transcripts);
  const [t, p] = r.edit.tracks[2].items;
  check("same footage twice: topmost track, earliest clip", near(t.start, 10 + 4), `start ${t.start}`);
  check("same footage twice: `clip` pins the anchor", near(p.start, 4), `start ${p.start}`);
}

// 9. An edit without anchors comes back as it was.
{
  const old = { ...edit([clip("c1", 0, 10, 0)], [graphic("t", { start: 3, duration: 2 })]), version: 1 };
  const before = JSON.stringify(old);
  const r = resolveEdit(old, transcripts);
  check("version 1: unchanged", JSON.stringify(r.edit) === before && r.marks.length === 0 && r.notes.length === 0);
  check("version 1: input left alone", JSON.stringify(old) === before);
}

// 10. Caption fixes apply by word and survive a cut.
{
  const fixes = { [ref("machine")]: { text: "Machine", hit: true }, [ref("um")]: { hidden: true } };
  const full = resolveEdit(edit([clip("c1", 0, 10, 0)], [], { captions: { on: true, style: "lines", words: [], position: "bottom", fixes } }), transcripts);
  const fixed = full.edit.captions.words.find((w) => w.ref === ref("machine"));
  check("caption fix: new text and key word", fixed?.text === "Machine" && fixed?.hit === true, JSON.stringify(fixed));
  check("caption fix: a hidden word is left out", !full.edit.captions.words.some((w) => w.ref === ref("um")));
  const cut = resolveEdit(edit([clip("c1", 1.8, 10, 0)], [], { captions: { on: true, style: "lines", words: [], position: "bottom", fixes } }), transcripts);
  const after = cut.edit.captions.words.find((w) => w.ref === ref("machine"));
  check("caption fix: survives a cut, at the word's new time", after?.text === "Machine" && near(after.start, 7 - 1.8), JSON.stringify(after));
  check("caption fix: applyFixes keeps unfixed words", applyFixes([{ text: "hi", start: 0, end: 1 }], fixes).length === 1);
}

// 11. Marks for the sound design.
{
  const marks = [
    { label: "Reveal", at: { word: ref("machine") } },
    { label: "Hook", at: { word: ref("today") } },
  ];
  const r = resolveEdit(edit([clip("c1", 1.8, 10, 0)], [], { marks }), transcripts);
  check("marks: in film time, in order", r.marks.length === 2 && r.marks[0].label === "Hook" && near(r.marks[1].t, 7 - 1.8), JSON.stringify(r.marks));
}

// 12. A file transcribed again: anchors follow the overlapping word.
{
  // The new transcript merged "so um" into one word, so every index after it shifts by one.
  const again = [{ text: "so-um", start: 0, end: 1.6 }, ...take.slice(2)];
  const e = edit([clip("c1", 0, 10, 0)], [graphic("t", { at: { word: ref("launch") } })], {
    captions: { on: true, style: "lines", words: [], position: "bottom", fixes: { [ref("machine")]: { text: "Machine" } } },
    marks: [{ label: "Reveal", at: { word: ref("machine") } }],
  });
  const { edit: moved, lost } = remapAnchors(e, "take", take, again);
  check("transcribed again: graphic anchor follows its word", moved.tracks[1].items[0].at.word === "take:3", moved.tracks[1].items[0].at.word);
  check("transcribed again: caption fix follows its word", Object.keys(moved.captions.fixes)[0] === "take:6", Object.keys(moved.captions.fixes).join());
  check("transcribed again: mark follows its word", moved.marks[0].at.word === "take:6", moved.marks[0].at.word);
  check("transcribed again: nothing lost", lost.length === 0, lost.join());
  const r = resolveEdit(moved, { take: again });
  check("transcribed again: still lands on the same moment", near(r.edit.tracks[1].items[0].start, 4), `start ${r.edit.tracks[1].items[0].start}`);
}

// 13. A file the edit doesn't use: the graphic stays put and says why.
{
  const r = resolveEdit(edit([clip("c1", 0, 10, 0)], [graphic("t", { start: 3, at: { word: "other:2" } })]), transcripts);
  check("missing file: keeps its seconds", g1(r).start === 3);
  check("missing file: says so", r.notes.length === 1, r.notes.join(" | "));
}

// ─── Word cuts (cuts.ts) ─────────────────────────────────────────────────────

const allClips = (e) => e.tracks.flatMap((t) => t.items).filter((i) => i.type === "clip");
const items = (e) => e.tracks.flatMap((t) => t.items);

// 14. Cutting "so um" from the front: the cut runs from the clip's start to the quiet before "today".
{
  const before = edit([clip("c1", 0, 10, 0)], [graphic("t", { at: { word: ref("launch") } })]);
  const { edit: after, removed } = cutWords(before, transcripts, {}, [ref("so"), ref("um")]);
  const c = allClips(after);
  check("cut: words at the front go, the clip starts in the quiet before the next", c.length === 1 && near(c[0].from, 1.8) && c[0].start === 0, JSON.stringify(c));
  check("cut: names what it took out", removed.length === 1 && removed[0].said === "so um" && near(removed[0].seconds, 1.8), JSON.stringify(removed));
  const r = resolveEdit(after, transcripts);
  check("cut: a graphic on a later word follows it", near(r.edit.tracks[1].items[0].start, 4 - 1.8), `start ${r.edit.tracks[1].items[0].start}`);
}

// 15. Cutting from the middle splits the clip and closes the gap on every track.
{
  const before = edit([clip("c1", 0, 10, 0)], [graphic("late", { start: 8, duration: 1 })]);
  const { edit: after } = cutWords(before, transcripts, {}, [ref("the"), ref("new")]);
  const c = allClips(after);
  // "the" 5-5.6, "new" 6-6.6: the cut runs from the quiet after "launch" (4.8) to the quiet before "machine" (6.8).
  check("cut: the middle splits the clip in two", c.length === 2 && near(c[0].to, 4.8) && near(c[1].from, 6.8) && near(c[1].start, 4.8), JSON.stringify(c.map((x) => [x.start, x.from, x.to])));
  check("cut: the right piece gets its own id", c[0].id !== c[1].id);
  check("cut: later items on other tracks move up", near(items(after).find((i) => i.id === "late").start, 8 - 2), String(items(after).find((i) => i.id === "late").start));
  check("cut: the film is shorter by the cut", near(filmEnd(after), 10 - 2), String(filmEnd(after)));
}

// 16. The cut lands in the real quiet, read from the loudness.
{
  // Loud everywhere except a dip at 4.70 s, between "launch" (ends 4.6) and "the" (starts 5).
  const loud = Array.from({ length: 1000 }, (_, i) => (i === 470 ? 0.01 : 0.5));
  const q = quietest(4.6, 5, loud);
  check("quiet: finds the dip between two words", near(q.t, 4.705) && !q.hard, JSON.stringify(q));
  const touching = quietest(1, 1.03, loud);
  check("quiet: words that touch leave no silence, so the cut gets a short fade", touching.hard, JSON.stringify(touching));
}

// 17. Words that run together get a short fade so the cut doesn't click.
{
  const tight = [{ text: "one", start: 0, end: 1 }, { text: "two", start: 1.02, end: 2 }, { text: "three", start: 2.01, end: 3 }];
  const { edit: after } = cutWords(edit([{ ...clip("c1", 0, 3, 0), media: "tight" }]), { tight }, {}, ["tight:1"]);
  const c = allClips(after);
  check("hard cut: both sides fade for a hundredth of a second", c.length === 2 && c[0].fadeOut === 0.01 && c[1].fadeIn === 0.01, JSON.stringify(c));
}

// 18. Keeping the pause before the cut words.
{
  const { edit: after } = cutWords(edit([clip("c1", 0, 10, 0)]), transcripts, {}, [ref("the")], { keepPause: true });
  check("keep the pause: the cut starts just before the cut word", near(allClips(after)[0].to, 5 - 0.04), JSON.stringify(allClips(after)[0]));
}

// 19. Fillers and long pauses.
{
  const said = [
    { text: "So,", start: 0, end: 0.4 }, { text: "um,", start: 0.5, end: 0.8 }, { text: "this", start: 0.9, end: 1.1 },
    { text: "is,", start: 1.2, end: 1.4 }, { text: "like,", start: 1.5, end: 1.8 }, { text: "you", start: 1.9, end: 2 },
    { text: "know,", start: 2.05, end: 2.3 }, { text: "great", start: 4.5, end: 5 }, { text: "Uhh", start: 5.2, end: 5.5 },
  ];
  const e = edit([{ ...clip("c1", 0, 6, 0), media: "talk" }]);
  const found = fillers(e, { talk: said }).sort();
  check("fillers: um, uhh, a set-off like and you know", JSON.stringify(found) === JSON.stringify(["talk:1", "talk:4", "talk:5", "talk:6", "talk:8"]), found.join(" "));
  const { edit: after, removed } = cutPauses(e, { talk: said }, {}, { longer: 0.8, keep: 0.3 });
  check("pauses: a 2.2 s pause becomes 0.3 s", removed.length === 1 && near(removed[0].seconds, 2.2 - 0.3) && near(filmEnd(after), 6 - 1.9), JSON.stringify(removed));
}

// 20. Captions kept as timed words become fixes by word before a cut, so they follow it.
{
  const words = [
    { text: "today", start: 2, end: 2.6, ref: ref("today") },
    { text: "Machine", start: 7, end: 7.6, ref: ref("machine"), hit: true },
  ];
  const before = edit([clip("c1", 0, 10, 0)], [], { version: 1, captions: { on: true, style: "lines", words, position: "bottom" } });
  const { edit: after } = cutWords(before, transcripts, {}, [ref("so"), ref("um")]);
  check("captions: a retyped word becomes a fix", after.captions.fixes?.[ref("machine")]?.text === "Machine" && after.captions.fixes[ref("machine")].hit === true, JSON.stringify(after.captions.fixes));
  const r = resolveEdit(after, transcripts);
  const fixed = r.edit.captions.words.find((w) => w.ref === ref("machine"));
  check("captions: rebuilt after the cut with the fix kept", fixed?.text === "Machine" && near(fixed.start, 7 - 1.8), JSON.stringify(fixed));
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
