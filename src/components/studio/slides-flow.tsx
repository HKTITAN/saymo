"use client";

import { Popover } from "@base-ui/react/popover";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckTickCircleIcon, ChevronDownIcon, MultipleCrossCancelIcon, PlusIcon, UploadUpIcon } from "@/components/icons";
import { DialGroup, DialNote, DialSlider, DialText, DialToggle, LABEL, ROW, ROW_BUTTON, SURFACE } from "@/components/tool/dial";
import { Kbd } from "@/components/ui/kbd";
import { SIZES } from "@/lib/studio/contract";
import { isImageFile, isSlideFile, SECONDS, SLIDE_ACCEPTS, type Slide, type SlideImport, type SlidesWay } from "@/lib/studio/slides-shared";
import { cn } from "@/lib/utils";
import { StudioError } from "./api";
import { BrandRow } from "./brand-row";
import { CARD, Hint, ICON_BUTTON, PILL_BUTTON } from "./panel";
import { addSlides, dropSlides, listVoices, makeSlidesFilm, slideImage, type VoiceChoice } from "./slides-api";

// Turn slides into a video, from the studio's home page. One card:
//   1. drop a deck (PDF, PowerPoint, Keynote, OpenDocument) or pictures;
//      the studio turns each slide into a picture with its words and notes
//   2. look through them, reorder them, drop the ones she doesn't want
//   3. pick a way (keep the slides' look, or retell the story as a motion
//      film) and the options, and make it: the film opens with Claude
//      building it, slide by slide.

const PRIMARY = cn(PILL_BUTTON, "bg-studio text-[#1f0612] hover:bg-studio-hover");
const SECONDARY = cn(PILL_BUTTON, "bg-white/[0.08] text-white/85 hover:bg-white/[0.12]");
const TEXT_BUTTON =
  "cursor-pointer rounded-[6px] text-[12px] text-white/45 underline decoration-white/20 underline-offset-4 outline-none transition-colors hover:text-white/75 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const POPUP =
  "origin-(--transform-origin) outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0";
const HIDE_SCROLLBAR = "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

const WAYS: { id: SlidesWay; label: string; note: string }[] = [
  { id: "animate", label: "Animate my slides", note: "Keeps each slide's look, part by part." },
  { id: "motion", label: "Make it a motion film", note: "Claude retells the story in your brand." },
];

// "q3-board_deck.pdf" becomes "Q3 board deck".
const titleFromFile = (name: string) => {
  const words = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Slides";
};
const byName = (a: File, b: File) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function SlidesFlow({
  folder,
  onClose,
  onOpenFilm,
}: {
  folder: string | null;
  onClose: () => void;
  onOpenFilm: (id: string, prompt: string, attach: File[]) => void;
}) {
  const [imp, setImp] = useState<SlideImport | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [dropped, setDropped] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [making, setMaking] = useState<{ label: string; problem: string | null } | null>(null);

  const [way, setWay] = useState<SlidesWay>("animate");
  const [size, setSize] = useState<(typeof SIZES)[number]>(SIZES[0]);
  const [seconds, setSeconds] = useState(SECONDS.normal);
  const [voiceOn, setVoiceOn] = useState(false);
  const [fit, setFit] = useState(true);
  const [voice, setVoice] = useState("Rishi");
  const [music, setMusic] = useState(true);
  const [brand, setBrand] = useState("aerchain");
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);

  const live = useRef(true);
  const impRef = useRef<SlideImport | null>(null);
  const made = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      // Closed without making a film: the slides brought in go too.
      if (impRef.current && !made.current) dropSlides(impRef.current.id);
    };
  }, []);

  const byKey = useMemo(() => new Map((imp?.slides ?? []).map((s) => [s.key, s])), [imp]);
  const kept = order.map((k) => byKey.get(k)).filter((s): s is Slide => !!s);
  const current = (selected && byKey.get(selected)) || kept[0] || null;
  const withNotes = kept.filter((s) => s.notes.trim()).length;
  const voiceUsable = withNotes > 0;
  const voiceover = voiceOn && voiceUsable;

  // Files are turned into slides one after another, so they land in the
  // order they were dropped (pictures by name).
  const add = useCallback(
    (list: FileList | File[] | null) => {
      const all = [...(list ?? [])];
      const files = all.filter((f) => isSlideFile(f.name));
      const refused = all.filter((f) => !isSlideFile(f.name));
      setNotice(refused.length ? `${refused.map((f) => f.name).join(", ")} ${refused.length === 1 ? "isn't" : "aren't"} slides. Drop a PDF, PowerPoint, Keynote or OpenDocument file, or pictures.` : null);
      if (!files.length) return;
      const decks = files.filter((f) => !isImageFile(f.name));
      const pictures = files.filter((f) => isImageFile(f.name)).sort(byName);
      if (!titleTouched && !impRef.current) setTitle(titleFromFile((decks[0] ?? pictures[0]).name));
      for (const file of [...decks, ...pictures]) {
        queue.current = queue.current.then(async () => {
          if (!live.current) return;
          setWorking(`Opening ${file.name}`);
          try {
            const next = await addSlides(file, impRef.current?.id ?? null, (label) => live.current && setWorking(label));
            if (!live.current) return;
            const before = new Set(impRef.current?.slides.map((s) => s.key) ?? []);
            impRef.current = next;
            setImp(next);
            const fresh = next.slides.filter((s) => !before.has(s.key)).map((s) => s.key);
            setOrder((o) => [...o, ...fresh]);
            setSelected((s) => s ?? fresh[0] ?? null);
          } catch (e) {
            if (live.current) setNotice(e instanceof StudioError ? e.message : `${file.name} couldn't be turned into slides. Try exporting it as a PDF.`);
          }
        });
      }
      void queue.current.then(() => live.current && setWorking(null));
    },
    [titleTouched],
  );

  const drop = (key: string) => {
    const i = order.indexOf(key);
    const next = order.filter((k) => k !== key);
    setOrder(next);
    setDropped((d) => [...d, key]);
    if (selected === key) setSelected(next[Math.min(i, next.length - 1)] ?? null);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [k] = next.splice(from, 1);
    next.splice(to, 0, k);
    setOrder(next);
  };

  const make = async () => {
    const id = impRef.current?.id;
    if (!id || !kept.length) return;
    setMaking({ label: "Making the film", problem: null });
    try {
      const film = await makeSlidesFilm(
        id,
        {
          keys: kept.map((s) => s.key),
          way,
          width: size.width,
          height: size.height,
          seconds: voiceover && fit ? "voice" : seconds,
          voice: voiceover ? voice : null,
          music,
          brand,
          folder,
          title: title.trim() || "Slides",
        },
        (label) => live.current && setMaking({ label, problem: null }),
      );
      made.current = true;
      if (live.current) onOpenFilm(film.id, film.prompt, []);
    } catch (e) {
      if (live.current) setMaking({ label: "", problem: e instanceof StudioError ? e.message : "The film couldn't be made. Try again." });
    }
  };

  // Esc (or a press outside the card) closes; with slides in, it asks first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      if (making && !making.problem) return; // the film is being made; it opens when ready
      if (confirm) setConfirm(false);
      else if (imp?.slides.length) setConfirm(true);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, imp, making, onClose]);

  const [over, setOver] = useState(false);
  const dropZone = {
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
    },
    onDrop: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      setOver(false);
      add(e.dataTransfer.files);
    },
  };

  const fileInput = (
    <input
      ref={picker}
      type="file"
      multiple
      accept={SLIDE_ACCEPTS}
      className="hidden"
      tabIndex={-1}
      onChange={(e) => {
        add(e.target.files);
        e.target.value = "";
      }}
    />
  );

  const close = (
    <Hint label="Close" keys={["Esc"]}>
      <button type="button" onClick={() => (imp?.slides.length ? setConfirm(true) : onClose())} className={cn(CARD, ICON_BUTTON, "absolute top-4 right-4 z-10 size-11 rounded-[14px]")} aria-label="Close">
        <MultipleCrossCancelIcon aria-hidden="true" />
      </button>
    </Hint>
  );

  const confirmBar = confirm ? (
    <div className="flex items-center gap-2 rounded-[12px] bg-white/[0.06] py-1.5 ps-3.5 pe-1.5" role="alertdialog" aria-label="Close and lose these slides?">
      <p className="me-auto text-[12.5px] text-white/85">Close and lose these slides?</p>
      <button type="button" onClick={() => setConfirm(false)} className={cn(PILL_BUTTON, "h-7 text-white/70 hover:bg-white/[0.08] hover:text-white")}>
        Keep them
      </button>
      <button
        type="button"
        // biome-ignore lint/a11y/noAutofocus: the one choice that needs a decision
        autoFocus
        onClick={onClose}
        className={cn(PILL_BUTTON, "h-7 bg-[#ff9592]/15 text-[#ffb3b0] hover:bg-[#ff9592]/25")}
      >
        Close
      </button>
    </div>
  ) : null;

  // ─── Making the film ──────────────────────────────────────────────────────
  if (making) {
    return (
      <div data-backdrop="" className="absolute inset-0 flex items-center justify-center p-6">
        <section aria-label="Making your video" className={cn(CARD, "flex w-full max-w-[420px] flex-col gap-3 p-5")}>
          <h1 className="font-medium text-[15px] text-white/95">Making your video</h1>
          {making.problem ? (
            <>
              <p className="text-[12.5px] text-[#ff9592] leading-relaxed">{making.problem}</p>
              <div className="flex gap-2">
                <button type="button" className={PRIMARY} onClick={() => void make()}>
                  Try again
                </button>
                <button type="button" className={SECONDARY} onClick={() => setMaking(null)}>
                  Back
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[12.5px]" aria-live="polite">
                <span key={making.label} className="studio-shimmer animate-in fade-in duration-200">
                  {making.label}
                </span>
              </p>
              <p className="text-[12px] text-white/40 leading-relaxed">
                Stay on this page, the film opens when it’s ready.
              </p>
            </>
          )}
        </section>
      </div>
    );
  }

  // ─── Before there are slides ─────────────────────────────────────────────
  if (!imp?.slides.length) {
    return (
      <div data-backdrop="" className="absolute inset-0 flex items-center justify-center p-6">
        {close}
        {fileInput}
        <section aria-labelledby="slides-title" className={cn(CARD, "flex w-full max-w-[560px] flex-col gap-4 p-5")} {...dropZone}>
          <div className="flex flex-col gap-1.5">
            <h1 id="slides-title" className="font-medium text-[15px] text-white/95">
              Turn slides into a video
            </h1>
            <p className="text-pretty text-[12.5px] text-white/55 leading-relaxed">
              Claude turns your deck into a film.
            </p>
          </div>
          <div
            className={cn(
              "flex min-h-44 flex-col items-center justify-center gap-2.5 rounded-[12px] border border-dashed p-5 text-center transition-colors",
              over ? "border-white/50 bg-white/[0.07]" : "border-white/15 bg-white/[0.02]",
            )}
          >
            {working ? (
              <p className="text-[12.5px]" aria-live="polite">
                <span key={working} className="studio-shimmer animate-in fade-in duration-200">
                  {working}
                </span>
              </p>
            ) : (
              <>
                <p className="text-[12.5px] text-white/75">Drop your slides here</p>
                <p className="max-w-[380px] text-pretty text-[11.5px] text-white/40 leading-relaxed">
                  A PDF, PowerPoint, Keynote or OpenDocument file, or pictures.
                </p>
                <button type="button" onClick={() => picker.current?.click()} className={cn(SECONDARY, "mt-1.5")}>
                  <UploadUpIcon aria-hidden="true" />
                  Choose files
                </button>
              </>
            )}
          </div>
          {notice ? <p className="text-[12px] text-[#ff9592] leading-relaxed">{notice}</p> : null}
          {confirmBar}
        </section>
      </div>
    );
  }

  // ─── The slides and the options ──────────────────────────────────────────
  const total = voiceover && fit ? null : Math.round(kept.length * seconds);
  const sources = [...new Set(imp.slides.map((s) => s.from))];
  return (
    <div data-backdrop="" className={cn("absolute inset-0 flex items-center justify-center overflow-y-auto p-6", HIDE_SCROLLBAR)}>
      {close}
      {fileInput}
      <section aria-labelledby="slides-title" className={cn(CARD, "relative my-auto flex w-full max-w-[1000px] flex-col")} {...dropZone}>
        {over ? <div className="pointer-events-none absolute inset-0 z-10 rounded-[16px] bg-white/[0.04] ring-2 ring-white/40 ring-inset" aria-hidden="true" /> : null}
        <header className="flex flex-col gap-1 px-5 pt-5 pb-4">
          <h1 id="slides-title" className="font-medium text-[15px] text-white/95">
            Turn slides into a video
          </h1>
          <p className="text-[12px] text-white/45">
            <span className="tabular-nums">{kept.length}</span> {kept.length === 1 ? "slide" : "slides"} from {sources.join(", ")}
          </p>
        </header>

        <div className="px-5 pb-4">
          <WayChoice value={way} onChange={setWay} />
        </div>

        <div className="grid gap-5 px-5 pb-5 md:grid-cols-[minmax(0,1fr)_288px]">
          {/* The slide in view, its words and notes, and the strip. */}
          <div className="flex min-w-0 flex-col gap-3">
            <Preview importId={imp.id} slide={current} n={current ? kept.indexOf(current) + 1 : 0} />
            <Strip
              importId={imp.id}
              slides={kept}
              selected={current?.key ?? null}
              onSelect={setSelected}
              onDrop={drop}
              onMove={move}
              onAdd={() => picker.current?.click()}
              working={working}
            />
            <div className="flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-white/40">
              {working ? (
                <span aria-live="polite" key={working} className="studio-shimmer animate-in fade-in duration-200">
                  {working}
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  Drag to reorder.
                  <Kbd>⌫</Kbd>
                  drops a slide.
                </span>
              )}
              {dropped.length ? (
                <button
                  type="button"
                  className={TEXT_BUTTON}
                  onClick={() => {
                    setOrder((o) => [...o, ...dropped]);
                    setDropped([]);
                  }}
                >
                  Put back {plural(dropped.length, "slide")}
                </button>
              ) : null}
            </div>
            {[notice, ...imp.notes].filter(Boolean).map((n) => (
              <p key={n} className="text-pretty text-[12px] text-[#ffcf99] leading-relaxed">
                {n}
              </p>
            ))}
          </div>

          {/* The options, as DialKit rows. */}
          <div className="flex flex-col gap-4">
            <DialGroup title="Film">
              <DialText label="Name" value={title} placeholder="Slides" onChange={(v) => {
                setTitleTouched(true);
                setTitle(v);
              }} />
              <SizeRow value={size} onChange={setSize} />
              <BrandRow value={brand} onChange={setBrand} />
            </DialGroup>
            <DialGroup title="Timing and sound">
              {voiceover && fit ? (
                <div className={cn(ROW, "gap-3 px-3")}>
                  <span className={LABEL}>Each slide</span>
                  <span className="ms-auto text-white/55">As long as its voice</span>
                </div>
              ) : (
                <DialSlider
                  label="Each slide"
                  value={seconds}
                  min={SECONDS.min}
                  max={SECONDS.max}
                  step={0.5}
                  format={(v) => `${v.toFixed(v % 1 ? 1 : 0)} s`}
                  onChange={setSeconds}
                />
              )}
              <DialToggle label="Voiceover" checked={voiceover} disabled={!voiceUsable} onChange={setVoiceOn} />
              {voiceover ? (
                <>
                  <VoiceRow value={voice} onChange={setVoice} />
                  <DialToggle label="Fit each slide to its voice" checked={fit} onChange={setFit} />
                </>
              ) : null}
              <DialToggle label="Music" checked={music} onChange={setMusic} />
              <DialNote>
                {voiceUsable
                  ? `Reads the speaker notes on ${withNotes} of ${plural(kept.length, "slide")}.`
                  : "No speaker notes, so no voiceover."}
              </DialNote>
            </DialGroup>
          </div>
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-white/[0.06] border-t px-5 py-3.5">
          {confirmBar ? <div className="w-full pb-1">{confirmBar}</div> : null}
          <p className="text-[12px] text-white/45">
            {total === null ? "Each slide stays on screen for its voice." : (
              <>
                About <span className="tabular-nums">{total}</span> s in all.
              </>
            )}
          </p>
          <span className="ms-auto" />
          <button type="button" className={PRIMARY} disabled={!kept.length || !!working} onClick={() => void make()}>
            Make the video
          </button>
        </footer>
      </section>
    </div>
  );
}

// ─── The two ways ─────────────────────────────────────────────────────────────

// A sliding choice of two: the lit pill moves across to the one picked.
function WayChoice({ value, onChange }: { value: SlidesWay; onChange: (way: SlidesWay) => void }) {
  const i = WAYS.findIndex((w) => w.id === value);
  return (
    <div className="relative grid grid-cols-2 gap-1 rounded-[12px] bg-white/[0.04] p-1" role="radiogroup" aria-label="How to make it">
      <span
        aria-hidden="true"
        className="absolute top-1 bottom-1 left-1 w-[calc(50%-6px)] rounded-[9px] bg-white/[0.11] transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
        style={{ transform: `translateX(${i === 0 ? "0" : "calc(100% + 4px)"})` }}
      />
      {WAYS.map((w) => (
        <button
          key={w.id}
          type="button"
          role="radio"
          aria-checked={value === w.id}
          onClick={() => onChange(w.id)}
          className="relative flex cursor-pointer flex-col items-start gap-0.5 rounded-[9px] px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className={cn("font-medium text-[12.5px] transition-colors", value === w.id ? "text-white" : "text-white/60")}>{w.label}</span>
          <span className="text-pretty text-[11.5px] text-white/40">{w.note}</span>
        </button>
      ))}
    </div>
  );
}

// ─── The slide in view ────────────────────────────────────────────────────────

function Preview({ importId, slide, n }: { importId: string; slide: Slide | null; n: number }) {
  if (!slide) return null;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-[12px] bg-[#0e0e0e] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
        {slide.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local slide picture, shown as it is
          <img key={slide.key} src={slideImage(importId, slide.image)} alt={`Slide ${n}: ${slide.title}`} className="size-full object-contain animate-in fade-in duration-200" />
        ) : (
          <p className="max-w-[70%] text-balance text-center text-[14px] text-white/60">{slide.title || "This slide has no picture yet"}</p>
        )}
        <span className="absolute bottom-2 left-2 rounded-[6px] bg-black/55 px-1.5 py-0.5 tabular-nums text-[11px] text-white/80">{n}</span>
      </div>
      <dl className="grid gap-x-4 gap-y-1 text-[12px] sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-[11px] text-white/35">Words</dt>
          <dd className="line-clamp-3 whitespace-pre-line text-pretty text-white/65 leading-snug">{slide.text || "No words on this slide"}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] text-white/35">Speaker notes</dt>
          <dd className={cn("line-clamp-3 text-pretty leading-snug", slide.notes ? "text-white/65" : "text-white/30")}>{slide.notes || "None"}</dd>
        </div>
      </dl>
      {slide.charts.length || slide.pictures.length ? (
        <p className="text-[11.5px] text-white/40">
          {[slide.charts.length ? `${plural(slide.charts.length, "chart")} rebuilt from its data` : "", slide.pictures.length ? `${plural(slide.pictures.length, "picture")} taken from the deck` : ""]
            .filter(Boolean)
            .join(", ")}
        </p>
      ) : null}
    </div>
  );
}

// ─── The strip ────────────────────────────────────────────────────────────────

function Strip({
  importId,
  slides,
  selected,
  onSelect,
  onDrop,
  onMove,
  onAdd,
  working,
}: {
  importId: string;
  slides: Slide[];
  selected: string | null;
  onSelect: (key: string) => void;
  onDrop: (key: string) => void;
  onMove: (from: number, to: number) => void;
  onAdd: () => void;
  working: string | null;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const focus = (key: string | undefined) => key && requestAnimationFrame(() => refs.current.get(key)?.focus());

  return (
    <ol className={cn("-mx-1 flex gap-2 overflow-x-auto px-1 py-1", HIDE_SCROLLBAR)} aria-label="Slides, in order">
      {slides.map((s, i) => (
        <li
          key={s.key}
          onDragOver={(e) => {
            if (dragging === null) return;
            e.preventDefault();
            setOver(i);
          }}
          onDrop={(e) => {
            if (dragging === null) return;
            e.preventDefault();
            e.stopPropagation();
            onMove(dragging, i);
            setDragging(null);
            setOver(null);
          }}
          className="group/slide relative shrink-0"
        >
          <div
            ref={(el) => {
              if (el) refs.current.set(s.key, el);
              else refs.current.delete(s.key);
            }}
            role="button"
            tabIndex={0}
            draggable
            aria-label={`Slide ${i + 1}: ${s.title || "untitled"}`}
            aria-pressed={selected === s.key}
            onClick={() => onSelect(s.key)}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", String(i));
              setDragging(i);
            }}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Backspace" || e.key === "Delete") {
                e.preventDefault();
                onDrop(s.key);
                focus(slides[i + 1]?.key ?? slides[i - 1]?.key);
              } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const to = e.key === "ArrowRight" ? i + 1 : i - 1;
                if (e.altKey) {
                  onMove(i, to);
                  focus(s.key);
                } else if (slides[to]) {
                  onSelect(slides[to].key);
                  focus(slides[to].key);
                }
              } else if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(s.key);
              }
            }}
            className={cn(
              "relative block h-[72px] w-[128px] cursor-grab overflow-hidden rounded-[8px] bg-[#0e0e0e] outline-none transition-[box-shadow,opacity,scale] duration-150 active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring",
              selected === s.key ? "shadow-[0_0_0_2px_rgba(255,255,255,0.85)]" : "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)]",
              dragging === i && "opacity-40",
              over === i && dragging !== null && dragging !== i && "scale-[0.96]",
            )}
          >
            {s.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local slide picture
              <img src={slideImage(importId, s.image)} alt="" draggable={false} loading="lazy" className="pointer-events-none size-full object-contain" />
            ) : (
              <span className="flex size-full items-center justify-center p-2 text-center text-[10px] text-white/45 leading-tight">{s.title || "No picture"}</span>
            )}
            <span className="absolute bottom-1 left-1 rounded-[4px] bg-black/60 px-1 tabular-nums text-[10px] text-white/80">{i + 1}</span>
            {s.notes ? <span className="absolute right-1 bottom-1 size-1.5 rounded-full bg-white/70" title="Has speaker notes" /> : null}
          </div>
          <Hint label="Drop this slide" keys={["⌫"]}>
            <button
              type="button"
              onClick={() => onDrop(s.key)}
              aria-label={`Drop slide ${i + 1}`}
              className={cn(
                ICON_BUTTON,
                "absolute top-1 right-1 size-6 rounded-[6px] bg-black/65 text-white/80 opacity-0 transition-opacity hover:bg-black/80 group-hover/slide:opacity-100 focus-visible:opacity-100 [&_svg]:size-3.5",
              )}
            >
              <MultipleCrossCancelIcon aria-hidden="true" />
            </button>
          </Hint>
        </li>
      ))}
      <li className="shrink-0">
        {working ? (
          <div className="flex h-[72px] w-[128px] items-center justify-center rounded-[8px] bg-white/[0.04] text-[11px]" aria-hidden="true">
            <span className="studio-shimmer">Adding</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={onAdd}
            className="flex h-[72px] w-[128px] cursor-pointer flex-col items-center justify-center gap-1 rounded-[8px] border border-white/15 border-dashed text-[11px] text-white/50 outline-none transition-colors hover:border-white/30 hover:text-white/80 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4"
          >
            <PlusIcon aria-hidden="true" />
            Add slides
          </button>
        )}
      </li>
    </ol>
  );
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

function SizeRow({ value, onChange }: { value: (typeof SIZES)[number]; onChange: (s: (typeof SIZES)[number]) => void }) {
  return (
    <div className={cn(ROW, "ps-3 pe-1")}>
      <span className={LABEL}>Size</span>
      <div className="ms-auto flex gap-0.5" role="radiogroup" aria-label="Size">
        {SIZES.map((s) => (
          <Hint key={s.label} label={s.label}>
            <button
              type="button"
              role="radio"
              aria-checked={value.label === s.label}
              aria-label={s.label}
              onClick={() => onChange(s)}
              className={cn(
                "flex h-7 cursor-pointer items-center gap-1.5 rounded-[7px] px-2 tabular-nums text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                value.label === s.label ? "bg-white/[0.13] text-white" : "text-white/45 hover:text-white/75",
              )}
            >
              <span
                aria-hidden="true"
                className="rounded-[1.5px] shadow-[inset_0_0_0_1.25px_currentColor]"
                style={{ width: (s.width / Math.max(s.width, s.height)) * 11, height: (s.height / Math.max(s.width, s.height)) * 11 }}
              />
              {s.label.split(" ")[1]}
            </button>
          </Hint>
        ))}
      </div>
    </div>
  );
}

function VoiceRow({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [voices, setVoices] = useState<VoiceChoice[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let on = true;
    listVoices()
      .then((v) => {
        if (!on) return;
        setVoices(v.voices);
        if (!v.voices.find((x) => x.id === value)?.installed) {
          const first = v.voices.find((x) => x.installed);
          if (first) onChange(first.id);
        }
      })
      .catch(() => on && setVoices([]));
    return () => {
      on = false;
    };
    // Once, when the row appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const current = voices?.find((v) => v.id === value);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={ROW_BUTTON}>
        <span className={LABEL}>Voice</span>
        <span className="ms-auto flex min-w-0 items-center gap-2 text-white/90">
          <span className="truncate">{current ? `${current.label}, ${current.accent}` : value}</span>
          <ChevronDownIcon className="size-3.5 shrink-0 text-white/40" aria-hidden="true" />
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={12} className="z-50">
          <Popover.Popup className={cn(SURFACE, POPUP, "flex w-[260px] flex-col gap-0.5 p-1.5")}>
            <p className="px-2 pt-1.5 pb-1 font-medium text-[11.5px] text-white/40">Voice</p>
            {(voices ?? []).map((v) => (
              <button
                key={v.id}
                type="button"
                disabled={!v.installed}
                onClick={() => {
                  setOpen(false);
                  onChange(v.id);
                }}
                className="flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-2 text-left text-[12.5px] text-white/80 outline-none transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:bg-white/[0.07] disabled:cursor-default disabled:opacity-40"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span>{v.label}</span>
                  <span className="text-[11px] text-white/40">{v.installed ? v.accent : `${v.accent}, not on this Mac`}</span>
                </span>
                {v.id === value ? <CheckTickCircleIcon className="size-4 text-white/70" aria-label="Chosen" /> : null}
              </button>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

