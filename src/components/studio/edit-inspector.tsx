"use client";

import { type KeyboardEvent, type PointerEvent, useId, useRef, useState } from "react";
import { DialButton, DialGroup, DialNote, DialSlider, DialToggle, LABEL, ROW } from "@/components/tool/dial";
import type { CaptionStyle, Clip, Graphic, Media } from "@/lib/studio/edit";
import { cn } from "@/lib/utils";
import { StudioError } from "./api";
import { formatTime } from "./clock";
import { captionLines, captionsFromClips, endOf, findItem, lengthOf, remove, retypeLine, updateItem } from "./edit-ops";
import { Choice, ParamRow } from "./inspector";
import { CAPTIONS, clipNumber, defaults } from "./multitrack";
import { Panel } from "./panel";
import type { EditState } from "./use-edit";
import { mediaUrl, videoApi } from "./video-api";

// The right-hand panel of a video film when something on the timeline is
// selected: a clip's speed, sound, fades and framing; a graphic's own
// settings; or the captions. Every change shows at once and can be undone.

export function EditInspector({
  id,
  ed,
  filmWidth,
  filmHeight,
  folded,
  onFold,
  hidden,
  style,
}: {
  id: string;
  ed: EditState;
  filmWidth: number;
  filmHeight: number;
  folded: boolean;
  onFold: (folded: boolean) => void;
  hidden: boolean;
  style?: React.CSSProperties;
}) {
  const { edit, selected } = ed;
  if (!edit) return null;
  const ids = [...selected];
  const one = ids.length === 1 ? ids[0] : null;
  const found = one && one !== CAPTIONS ? findItem(edit, one) : null;

  const title =
    one === CAPTIONS
      ? "Captions"
      : found?.item.type === "clip"
        ? `Clip ${clipNumber(edit, found.item) || ""}`.trim()
        : found?.item.type === "graphic"
          ? (ed.graphics.find((g) => g.name === (found.item as Graphic).graphic)?.label ?? "Graphic")
          : `${ids.length} items`;

  return (
    <Panel
      title={title}
      folded={folded}
      onFold={onFold}
      hidden={hidden}
      className="top-[68px] right-4 w-[300px]"
      pillClassName="top-[68px] right-4"
      style={style}
      bodyClassName="flex flex-col gap-4 overflow-y-auto px-3 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {one === CAPTIONS ? (
        <CaptionsPanel id={id} ed={ed} />
      ) : found?.item.type === "clip" ? (
        <ClipPanel
          id={id}
          ed={ed}
          clip={found.item}
          media={ed.mediaById.get(found.item.media)}
          audioOnly={found.track.kind === "audio"}
          filmWidth={filmWidth}
          filmHeight={filmHeight}
        />
      ) : found?.item.type === "graphic" ? (
        <GraphicPanel ed={ed} graphic={found.item} />
      ) : (
        <>
          <DialNote>
            {ids.length} items are selected. Drag any of them to move them together, or press S to split them at the
            playhead.
          </DialNote>
          <DialButton
            onClick={() => {
              ed.change((e) => remove(e, new Set(ids)), { label: `Deleted ${ids.length} items` });
              ed.setSelected(new Set());
            }}
          >
            Delete {ids.length} items
          </DialButton>
        </>
      )}
    </Panel>
  );
}

// ─── A clip ─────────────────────────────────────────────────────────────────

function ClipPanel({
  id,
  ed,
  clip,
  media,
  audioOnly,
  filmWidth,
  filmHeight,
}: {
  id: string;
  ed: EditState;
  clip: Clip;
  media: Media | undefined;
  audioOnly: boolean;
  filmWidth: number;
  filmHeight: number;
}) {
  const set = (patch: Partial<Clip>, label: string, group: string) =>
    ed.change((e) => updateItem(e, clip.id, patch), { label, group: `${group}-${clip.id}` });
  const length = lengthOf(clip);
  const speed = clip.speed ?? 1;
  const isPhoto = media?.kind === "image";
  const hasSound = !isPhoto && (media?.hasAudio ?? true);

  return (
    <>
      <DialNote>
        {media?.name ?? "This footage is missing from Media. Delete the clip, or ask Claude to replace it."}
        <br />
        <span className="tabular-nums">
          {formatTime(clip.start)} to {formatTime(endOf(clip))}
        </span>
        {!isPhoto ? (
          <span className="text-white/30">
            {" "}
            · from {formatTime(clip.from)} of the original
          </span>
        ) : null}
      </DialNote>
      <DialGroup title="Timing">
        {!isPhoto ? (
          <DialSlider
            label="Speed"
            value={speed}
            min={0.25}
            max={4}
            step={0.05}
            format={(v) => `${v.toFixed(2)} ×`}
            onChange={(v) => set({ speed: v }, `Speed ${v.toFixed(2)} ×`, "speed")}
          />
        ) : (
          <DialSlider
            label="Length"
            value={length}
            min={0.5}
            max={Math.max(20, Math.ceil(length))}
            step={0.1}
            format={(v) => `${v.toFixed(1)} s`}
            onChange={(v) => set({ to: clip.from + v }, `Length ${v.toFixed(1)} s`, "length")}
          />
        )}
        <DialSlider
          label="Fade in"
          value={clip.fadeIn ?? 0}
          min={0}
          max={Math.max(0.1, Math.min(3, length / 2))}
          step={0.05}
          format={(v) => (v ? `${v.toFixed(2)} s` : "None")}
          onChange={(v) => set({ fadeIn: v || undefined }, `Fade in ${v.toFixed(2)} s`, "fadein")}
        />
        <DialSlider
          label="Fade out"
          value={clip.fadeOut ?? 0}
          min={0}
          max={Math.max(0.1, Math.min(3, length / 2))}
          step={0.05}
          format={(v) => (v ? `${v.toFixed(2)} s` : "None")}
          onChange={(v) => set({ fadeOut: v || undefined }, `Fade out ${v.toFixed(2)} s`, "fadeout")}
        />
      </DialGroup>
      {hasSound ? (
        <DialGroup title="Sound">
          <DialSlider
            label="Volume"
            value={clip.volume ?? 1}
            min={0}
            max={2}
            step={0.05}
            format={(v) => (v === 0 ? "Off" : `${Math.round(v * 100)}%`)}
            onChange={(v) => set({ volume: v }, `Volume ${Math.round(v * 100)}%`, "volume")}
          />
        </DialGroup>
      ) : null}
      {!audioOnly && media && media.kind !== "audio" ? (
        <DialGroup title="Framing">
          <DialSlider
            label="Zoom"
            value={clip.zoom ?? 1}
            min={1}
            max={4}
            step={0.01}
            format={(v) => `${v.toFixed(2)} ×`}
            onChange={(v) => set({ zoom: v }, `Zoom ${v.toFixed(2)} ×`, "zoom")}
          />
          <FramingPad
            id={id}
            clip={clip}
            media={media}
            filmAspect={(filmWidth * (clip.box?.w ?? 1)) / (filmHeight * (clip.box?.h ?? 1))}
            onMove={(x, y) => set({ x, y }, "Moved the framing", "frame")}
          />
          <DialNote>Drag the box to choose what the frame shows, such as the speaker when a wide shot becomes a story.</DialNote>
        </DialGroup>
      ) : null}
      <DialButton
        onClick={() => {
          ed.change((e) => remove(e, new Set([clip.id])), { label: "Deleted a clip" });
          ed.setSelected(new Set());
        }}
      >
        Delete clip
      </DialButton>
    </>
  );
}

// The original frame with a box over the part the film shows. Drag the box,
// or use the arrow keys once it has focus.
function FramingPad({
  id,
  clip,
  media,
  filmAspect,
  onMove,
}: {
  id: string;
  clip: Clip;
  media: Media;
  filmAspect: number;
  onMove: (x: number, y: number) => void;
}) {
  const pad = useRef<HTMLDivElement>(null);
  const grab = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const label = useId();
  const sourceAspect = media.width && media.height ? media.width / media.height : 16 / 9;
  const zoom = clip.zoom ?? 1;
  // The share of the original the film shows, across and down.
  const vw = (sourceAspect > filmAspect ? filmAspect / sourceAspect : 1) / zoom;
  const vh = (sourceAspect > filmAspect ? 1 : sourceAspect / filmAspect) / zoom;
  const clampX = (x: number) => Math.min(1 - vw / 2, Math.max(vw / 2, x));
  const clampY = (y: number) => Math.min(1 - vh / 2, Math.max(vh / 2, y));
  const x = clampX(clip.x ?? 0.5);
  const y = clampY(clip.y ?? 0.5);
  const thumb = media.thumbs ? mediaUrl(id, media.id, media.thumbs) : null;

  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    grab.current = { px: e.clientX, py: e.clientY, x, y };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const g = grab.current;
    const r = pad.current?.getBoundingClientRect();
    if (!g || !r) return;
    onMove(clampX(g.x + (e.clientX - g.px) / r.width), clampY(g.y + (e.clientY - g.py) / r.height));
  };
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    onMove(clampX(x + d[0]), clampY(y + d[1]));
  };

  return (
    <div ref={pad} className="relative w-full overflow-hidden rounded-[10px] bg-white/[0.05]" style={{ aspectRatio: sourceAspect }}>
      {thumb ? (
        <div
          className="absolute inset-0 bg-no-repeat opacity-60"
          style={{ backgroundImage: `url(${thumb})`, backgroundSize: "auto 100%", backgroundPosition: "0 0" }}
        />
      ) : null}
      <span id={label} className="sr-only">
        What the film shows of this clip. Use the arrow keys to move it.
      </span>
      <div
        role="slider"
        tabIndex={0}
        aria-labelledby={label}
        aria-valuetext={`${Math.round(x * 100)}% across, ${Math.round(y * 100)}% down`}
        aria-valuenow={Math.round(x * 100)}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => {
          grab.current = null;
        }}
        onKeyDown={keys}
        className="absolute cursor-grab touch-none rounded-[3px] shadow-[0_0_0_999px_rgba(0,0,0,0.45)] outline-none ring-2 ring-white focus-visible:ring-studio active:cursor-grabbing"
        style={{ left: `${(x - vw / 2) * 100}%`, top: `${(y - vh / 2) * 100}%`, width: `${vw * 100}%`, height: `${vh * 100}%` }}
      />
    </div>
  );
}

// ─── A graphic ──────────────────────────────────────────────────────────────

function GraphicPanel({ ed, graphic }: { ed: EditState; graphic: Graphic }) {
  const info = ed.graphics.find((g) => g.name === graphic.graphic);
  const values = { ...(info ? defaults(info) : {}), ...graphic.values };
  return (
    <>
      <DialGroup title="Timing">
        <DialSlider
          label="Length"
          value={graphic.duration}
          min={0.5}
          max={Math.max(20, Math.ceil(graphic.duration))}
          step={0.1}
          format={(v) => `${v.toFixed(1)} s`}
          onChange={(v) =>
            ed.change((e) => updateItem(e, graphic.id, { duration: v }), {
              label: `Length ${v.toFixed(1)} s`,
              group: `length-${graphic.id}`,
            })
          }
        />
      </DialGroup>
      {info?.params.length ? (
        <DialGroup title="Settings">
          {info.params.map((p) => (
            <ParamRow
              key={p.key}
              param={p}
              value={values[p.key] ?? p.value}
              onChange={(v) =>
                ed.change((e) => updateItem(e, graphic.id, { values: { ...values, [p.key]: v } }), {
                  label: typeof v === "string" && v.length > 18 ? p.label : `${p.label} ${String(v)}`,
                  group: `${p.key}-${graphic.id}`,
                })
              }
            />
          ))}
        </DialGroup>
      ) : (
        <DialNote>Ask Claude to change this graphic, or point at it on the film.</DialNote>
      )}
      <DialButton
        onClick={() => {
          ed.change((e) => remove(e, new Set([graphic.id])), { label: "Deleted a graphic" });
          ed.setSelected(new Set());
        }}
      >
        Delete graphic
      </DialButton>
    </>
  );
}

// ─── Captions ───────────────────────────────────────────────────────────────

const STYLES: { value: CaptionStyle; label: string; hint: string }[] = [
  { value: "words", label: "Words", hint: "One word at a time" },
  { value: "lines", label: "Lines", hint: "A line at a time" },
  { value: "karaoke", label: "Karaoke", hint: "A line, with the spoken word lit" },
];

function CaptionsPanel({ id, ed }: { id: string; ed: EditState }) {
  const [making, setMaking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const edit = ed.edit;
  if (!edit) return null;
  const captions = edit.captions;
  const setCaptions = (patch: Partial<typeof captions>, label: string, group?: string) =>
    ed.change((e) => ({ ...e, captions: { ...e.captions, ...patch } }), { label, group });
  const lines = captionLines(captions.words);

  // The footage whose speech becomes captions: clips with sound on the
  // footage tracks. Music tracks join only when there's no such footage
  // (a voice-over laid over photos, say).
  const speaking = (kind: "video" | "audio") => [
    ...new Set(
      edit.tracks
        .filter((t) => t.kind === kind && !t.muted)
        .flatMap((t) => t.items)
        .map((i) => (i.type === "clip" ? i.media : ""))
        .filter((m) => {
          const media = ed.mediaById.get(m);
          return media && media.kind !== "image" && media.hasAudio && media.status === "ready";
        }),
    ),
  ];

  // Writes down what's said in those clips, then lays the words along the
  // timeline as captions.
  const make = async () => {
    setError(null);
    setNote(null);
    const footage = speaking("video");
    const used = footage.length ? footage : speaking("audio");
    if (!used.length) {
      setError("Add footage with speech to the timeline first.");
      return;
    }
    try {
      const missing = used.filter((m) => !ed.mediaById.get(m)?.transcript);
      let failed: string[] = [];
      let latest = ed.media;
      if (missing.length) {
        setMaking(missing.length === 1 ? "Writing down what’s said in 1 clip" : `Writing down what’s said in ${missing.length} clips`);
        await Promise.all(missing.map((m) => videoApi.transcribe(id, m)));
        // Check back until every transcript is written or has given up.
        for (;;) {
          await new Promise((r) => setTimeout(r, 1500));
          const list = await ed.refreshMedia();
          if (!list) continue;
          latest = list;
          const mine = list.filter((m) => missing.includes(m.id));
          if (mine.some((m) => m.transcribing)) continue;
          failed = mine.filter((m) => !m.transcript).map((m) => m.name);
          break;
        }
      }
      setMaking("Laying the words along the timeline");
      const said = await ed.transcripts(used, latest);
      const words = captionsFromClips(edit, said);
      if (!words.length) {
        throw new StudioError(
          failed.length
            ? `Unable to write down what’s said in ${failed.join(", ")}. Try again.`
            : "No speech was found in the clips on the timeline. Add footage where someone speaks, then try again.",
        );
      }
      // Laid along the edit as it is now, in case it changed meanwhile.
      ed.change((e) => ({ ...e, captions: { ...e.captions, on: true, words: captionsFromClips(e, said) } }), {
        label: "Made captions from the speech",
      });
      if (failed.length) setNote(`No words came from ${failed.join(", ")}.`);
    } catch (e) {
      setError(e instanceof StudioError ? e.message : "Unable to make captions. Try again.");
    } finally {
      setMaking(null);
    }
  };

  return (
    <>
      <DialGroup title="Look">
        <DialToggle label="Show captions" checked={captions.on} onChange={(on) => setCaptions({ on }, on ? "Captions on" : "Captions off")} />
        <Choice
          label="Style"
          value={captions.style}
          options={STYLES}
          onChange={(v) => setCaptions({ style: v as CaptionStyle }, `Caption style: ${STYLES.find((s) => s.value === v)?.label}`)}
        />
        <Choice
          label="Position"
          value={captions.position}
          options={[
            { value: "bottom", label: "Bottom" },
            { value: "middle", label: "Middle" },
          ]}
          onChange={(v) => setCaptions({ position: v as "bottom" | "middle" }, `Captions at the ${v}`)}
        />
      </DialGroup>
      <DialGroup title="Words">
        <DialButton onClick={() => void make()} loading={making !== null}>
          {captions.words.length ? "Make the captions again from the speech" : "Make captions from the speech"}
        </DialButton>
        {making ? (
          <p key={making} className="studio-shimmer px-1 text-[11.5px] text-white/55">
            {making}
          </p>
        ) : null}
        {error ? <p className="px-1 text-[11.5px] text-[#ff9592] leading-relaxed">{error}</p> : null}
        {note && !making ? <DialNote>{note}</DialNote> : null}
        {lines.length ? (
          <div className="flex flex-col gap-1">
            {lines.map((line) => (
              <CaptionRow
                key={`${line.first}-${line.start.toFixed(2)}`}
                time={line.start}
                text={line.text}
                onChange={(text) =>
                  ed.change((e) => ({ ...e, captions: { ...e.captions, words: retypeLine(e.captions.words, line, text) } }), {
                    label: "Changed a caption",
                    group: `caption-${line.first}`,
                  })
                }
              />
            ))}
          </div>
        ) : !making ? (
          <DialNote>Captions are made from what’s said in the footage. Fix any word here afterwards.</DialNote>
        ) : null}
      </DialGroup>
    </>
  );
}

// One caption line: its time, and its words to fix in place.
function CaptionRow({ time, text, onChange }: { time: number; text: string; onChange: (text: string) => void }) {
  const id = useId();
  const [draft, setDraft] = useState(text);
  const [was, setWas] = useState(text);
  if (text !== was) {
    setWas(text);
    setDraft(text);
  }
  return (
    <label
      htmlFor={id}
      className={cn(
        ROW,
        "h-auto min-h-9 cursor-text items-start gap-2.5 px-3 py-2 hover:bg-white/[0.07] has-[:focus-visible]:bg-white/[0.08] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
      )}
    >
      <span className={cn(LABEL, "pt-px text-[11px] text-white/40 tabular-nums")}>{formatTime(time)}</span>
      <textarea
        id={id}
        rows={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim() && draft !== text && onChange(draft.trim())}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            setDraft(text);
            e.currentTarget.blur();
          }
        }}
        className="field-sizing-content min-w-0 flex-1 resize-none bg-transparent text-[12px] text-white/90 leading-snug outline-none"
      />
    </label>
  );
}
