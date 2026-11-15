"use client";

import { type DragEvent, type KeyboardEvent, useState } from "react";
import { DialButton, DialNote } from "@/components/ui/dial";
import { resolveEdit, wordRef } from "@/lib/studio/films/anchors";
import { captionsByWord, cutPauses, cutWords, fillers, restoreWords } from "@/lib/studio/films/cuts";
import type { Clip, Edit, Graphic, Word, WordRef } from "@/lib/studio/films/edit";
import { cn } from "@/lib/utils";
import { type Clock, useClock } from "../film/clock";
import type { EditState } from "./use-edit";
import { videoApi } from "../api/video";

// The edit as words (docs/plans/words-are-the-timeline.md, step 5): every
// word of each take, in the order it was said. Words the film plays are
// bright; words cut out are faded and struck through. Select words and press
// Delete to cut them, or select cut words and press Delete to bring them
// back. Fillers are tinted, long pauses show their length, and each graphic
// fixed to a word sits on it as a chip you can drag to another word.
// Double-click a word to fix how it's spelled in the captions. Clicking a
// word moves the playhead there, and the word being said is lit.

type Row = {
  ref: WordRef;
  word: Word;
  shown: string; // the caption fix, if there is one
  fixed: boolean;
  played: boolean;
  t: number | null; // film time of its start, if it plays
  end: number | null;
  filler: boolean;
  pause: number | null; // a long pause before it, in seconds
};

const middle = (w: Word) => (w.start + w.end) / 2;

function rowsOf(edit: Edit, said: Record<string, Word[] | undefined>, fillerRefs: Set<WordRef>): Row[][] {
  const clips = edit.tracks.flatMap((t) => (t.kind === "graphics" ? [] : t.items.filter((i): i is Clip => i.type === "clip")));
  // Takes in the order they first play.
  const order = [...new Set([...clips].sort((a, b) => a.start - b.start).map((c) => c.media))].filter((m) => said[m]?.length);
  const fixes = edit.captions.fixes ?? {};
  return order.map((media) => {
    const words = said[media] ?? [];
    let lastPlayedEnd: number | null = null;
    return words.map((word, i) => {
      const ref = wordRef(media, i);
      const clip = clips.find((c) => c.media === media && middle(word) >= c.from && middle(word) < c.to);
      const speed = clip?.speed ?? 1;
      const t = clip ? clip.start + (Math.max(word.start, clip.from) - clip.from) / speed : null;
      const end = clip ? clip.start + (Math.min(word.end, clip.to) - clip.from) / speed : null;
      const pause = clip && lastPlayedEnd !== null && t !== null && t - lastPlayedEnd > 0.8 ? t - lastPlayedEnd : null;
      if (end !== null) lastPlayedEnd = end;
      const fix = fixes[ref];
      return {
        ref,
        word,
        shown: fix?.text ?? word.text,
        fixed: Boolean(fix?.text),
        played: Boolean(clip),
        t,
        end,
        filler: fillerRefs.has(ref),
        pause,
      };
    });
  });
}

export function Transcript({ id, ed, clock }: { id: string; ed: EditState; clock: Clock }) {
  const now = useClock(clock, (s) => s.t);
  const [selected, setSelected] = useState<ReadonlySet<WordRef>>(new Set());
  const [anchor, setAnchor] = useState<WordRef | null>(null);
  const [fixing, setFixing] = useState<WordRef | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const edit = ed.edit;
  if (!edit) return null;
  void ed.saidVersion; // redraw as each transcript arrives
  const said = ed.transcriptsNow();
  const fillerRefs = new Set(fillers(edit, said));
  const takes = rowsOf(edit, said, fillerRefs);
  const all = takes.flat();
  const pauses = cutPauses(edit, said, ed.peaks).removed.length;
  const notes = resolveEdit(edit, said).notes;

  // Graphics by the word they start on.
  const chips = new Map<WordRef, Graphic[]>();
  for (const t of edit.tracks) {
    for (const i of t.items) {
      if (i.type === "graphic" && i.at) chips.set(i.at.word, [...(chips.get(i.at.word) ?? []), i]);
    }
  }
  const label = (g: Graphic) => ed.graphics.find((x) => x.name === g.graphic)?.label ?? g.graphic.replace(/-/g, " ");

  // Speech on the timeline that hasn't been written down yet.
  const speaking = [
    ...new Set(edit.tracks.filter((t) => t.kind !== "graphics").flatMap((t) => t.items.flatMap((i) => (i.type === "clip" ? [i.media] : [])))),
  ]
    .map((m) => ed.mediaById.get(m))
    .filter((m) => m && m.kind !== "image" && m.hasAudio && m.status === "ready");
  const unwritten = speaking.filter((m) => m && !m.transcript && !m.transcribing);
  const writing = speaking.some((m) => m?.transcribing);

  const quote = (refs: WordRef[]) => {
    const text = all.filter((r) => refs.includes(r.ref)).map((r) => r.shown).join(" ");
    return text.length > 40 ? `${text.slice(0, 38)}…` : text;
  };
  const cut = (refs: WordRef[]) => {
    if (!refs.length) return;
    const result = cutWords(edit, said, ed.peaks, refs);
    if (!result.removed.length) return;
    ed.change(() => result.edit, { label: `Cut “${quote(refs)}”` });
    setSelected(new Set());
  };
  const restore = (refs: WordRef[]) => {
    const result = restoreWords(edit, said, ed.peaks, refs);
    if (!result.removed.length) return;
    ed.change(() => result.edit, { label: `Brought back “${quote(refs)}”` });
    setSelected(new Set());
  };
  const onKey = (e: KeyboardEvent) => {
    if (fixing) return;
    if (e.key === "Escape") setSelected(new Set());
    if ((e.key === "Delete" || e.key === "Backspace") && selected.size) {
      e.preventDefault();
      const picked = all.filter((r) => selected.has(r.ref));
      if (picked.every((r) => !r.played)) restore(picked.map((r) => r.ref));
      else cut(picked.filter((r) => r.played).map((r) => r.ref));
    }
  };
  const pick = (row: Row, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    if (e.shiftKey && anchor) {
      const a = all.findIndex((r) => r.ref === anchor);
      const b = all.findIndex((r) => r.ref === row.ref);
      setSelected(new Set(all.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.ref)));
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selected);
      if (next.has(row.ref)) next.delete(row.ref);
      else next.add(row.ref);
      setSelected(next);
    } else setSelected(new Set([row.ref]));
    setAnchor(row.ref);
    if (row.t !== null) clock.seek(row.t);
  };
  const fix = (ref: WordRef, text: string) => {
    setFixing(null);
    const row = all.find((r) => r.ref === ref);
    if (!row || !text.trim() || text.trim() === row.shown) return;
    ed.change(
      (e) => {
        const base = captionsByWord(e, said);
        const fixes = base.captions.fixes ?? {};
        return { ...base, version: 2, captions: { ...base.captions, fixes: { ...fixes, [ref]: { ...fixes[ref], text: text.trim() } } } };
      },
      { label: `Fixed “${row.word.text}”` },
    );
  };
  const moveChip = (e: DragEvent, ref: WordRef) => {
    const gid = e.dataTransfer.getData("text/x-saymo-graphic");
    if (!gid) return;
    e.preventDefault();
    ed.change(
      (cur) => ({
        ...cur,
        version: 2,
        tracks: cur.tracks.map((t) => ({
          ...t,
          items: t.items.map((i) => (i.id === gid && i.type === "graphic" ? { ...i, at: { word: ref } } : i)),
        })),
      }),
      { label: "Moved a graphic to another word" },
    );
  };
  const transcribe = async () => {
    setError(null);
    setBusy("Writing down what’s said");
    try {
      await Promise.all(unwritten.map((m) => videoApi.transcribe(id, m!.id)));
      await ed.refreshMedia();
    } catch {
      setError("Unable to start writing down what’s said. Try again.");
    } finally {
      setBusy(null);
    }
  };

  if (!all.length) {
    return (
      <div className="flex flex-col gap-2 px-1 pt-1">
        <DialNote>
          {writing || busy
            ? "Writing down what’s said. The words appear here when it’s done."
            : speaking.length
              ? "The words of your footage show here once they’re written down."
              : "Add footage where someone speaks, and its words show here."}
        </DialNote>
        {unwritten.length && !writing ? (
          <DialButton onClick={() => void transcribe()} loading={busy !== null}>
            Write down what’s said
          </DialButton>
        ) : null}
        {error ? <p className="px-1 text-[11.5px] text-danger leading-relaxed">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-col gap-1">
        {fillerRefs.size ? (
          <DialButton onClick={() => cut([...fillerRefs])}>
            Cut {fillerRefs.size} filler{fillerRefs.size > 1 ? "s" : ""}
          </DialButton>
        ) : null}
        {pauses ? (
          <DialButton
            onClick={() => {
              const result = cutPauses(edit, said, ed.peaks);
              ed.change(() => result.edit, { label: `Shortened ${pauses} pause${pauses > 1 ? "s" : ""}` });
            }}
          >
            Shorten {pauses} long pause{pauses > 1 ? "s" : ""}
          </DialButton>
        ) : null}
        {notes.slice(0, 3).map((n) => (
          <DialNote key={n}>{n}</DialNote>
        ))}
      </div>

      <div
        tabIndex={0}
        onKeyDown={onKey}
        aria-label="The words of the edit. Select words and press Delete to cut them or bring them back."
        className="min-h-0 flex-1 overflow-y-auto rounded-[10px] bg-white/[0.03] px-2.5 py-2 text-[12.5px] leading-[1.9] outline-none focus-visible:ring-2 focus-visible:ring-ring [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {takes.map((rows) => (
          <p key={rows[0]?.ref} className="mb-3 last:mb-0">
            {rows.map((row) => {
              const lit = row.t !== null && row.end !== null && now >= row.t && now < row.end;
              return (
                <span key={row.ref}>
                  {row.pause ? (
                    <span className="mx-0.5 rounded-[5px] bg-white/[0.07] px-1 py-px text-[10.5px] text-white/45 tabular-nums">
                      {row.pause.toFixed(1)} s
                    </span>
                  ) : null}
                  {(chips.get(row.ref) ?? []).map((g) => (
                    <span
                      key={g.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/x-saymo-graphic", g.id)}
                      title="Drag onto another word to move it"
                      className="mx-0.5 cursor-grab rounded-full bg-studio/25 px-1.5 py-px text-[10.5px] text-white/90 active:cursor-grabbing"
                    >
                      {label(g)}
                    </span>
                  ))}
                  {fixing === row.ref ? (
                    <input
                      autoFocus
                      defaultValue={row.shown}
                      aria-label={`Fix how "${row.word.text}" is spelled in the captions`}
                      onBlur={(e) => fix(row.ref, e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") fix(row.ref, e.currentTarget.value);
                        if (e.key === "Escape") setFixing(null);
                      }}
                      className="field-sizing-content mx-px rounded-[5px] bg-white/[0.12] px-1 text-white outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => pick(row, e)}
                      onDoubleClick={() => row.played && setFixing(row.ref)}
                      onDragOver={(e) => e.dataTransfer.types.includes("text/x-saymo-graphic") && e.preventDefault()}
                      onDrop={(e) => moveChip(e, row.ref)}
                      className={cn(
                        "cursor-pointer rounded-[5px] px-[3px] text-left transition-colors duration-100",
                        row.played ? "text-white/85 hover:bg-white/[0.08]" : "text-white/30 line-through decoration-white/30 hover:bg-white/[0.05]",
                        row.filler && row.played && "bg-amber-300/[0.12] text-amber-100/90",
                        row.fixed && "underline decoration-white/40 decoration-dotted underline-offset-[3px]",
                        lit && "bg-white/[0.14] text-white",
                        selected.has(row.ref) && "bg-studio/35 text-white",
                      )}
                    >
                      {row.shown}
                    </button>
                  )}{" "}
                </span>
              );
            })}
          </p>
        ))}
      </div>
    </div>
  );
}
