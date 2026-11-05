"use client";

import { type ComponentType, type CSSProperties, type SVGProps, useEffect, useRef, useState } from "react";
import {
  CalendarIcon,
  DeleteDustbin01Icon,
  GridDashboard02SolidIcon,
  MultipleCrossCancelIcon,
  PencilEditIcon,
  PhoneSolidIcon,
  RefreshIcon,
  VideoCallSolidIcon,
} from "@/components/icons";
import type { Idea, IdeaKind, IdeaState } from "@/lib/studio/ideas";
import { cn } from "@/lib/utils";
import { Glide } from "./slide-mark";

// The Ideas page: what to make next. Each kind (reels, demos, videos) is a
// pocket, a glossy squircle tray with its next ideas tucked in as paper
// cards, the way an app icon shows what's inside. Pick one and its list
// opens below: a little dark widget with today's date on a coloured tab, a
// faint dot grid, and ideas to tick off. Saved on this Mac through
// /api/studio/ideas; "Make it" starts the film.

type Look = {
  kind: IdeaKind;
  title: string;
  add: string;
  tab: string; // the list's date tab
  accent: string; // its ticks and dates
  rim: [string, string]; // the pocket's back, top to bottom
  face: [string, string]; // its front
  well: string; // the dark inside
  glyph: string; // the mark pressed into the front
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
};
const REELS: Look = {
  kind: "reel",
  title: "Reels",
  add: "Add a reel idea",
  tab: "#a79dff",
  accent: "#958aff",
  rim: ["#cdc6ff", "#8577f6"],
  face: ["#bab0ff", "#7464ee"],
  well: "#1d1938",
  glyph: "#4a3db5",
  Icon: PhoneSolidIcon,
};
const LOOKS: Look[] = [
  REELS,
  {
    kind: "demo",
    title: "Demos",
    add: "Add a demo idea",
    tab: "#ffa6c8",
    accent: "#ff86b6",
    rim: ["#ffd2e3", "#f27aa3"],
    face: ["#ffbcd4", "#ea6492"],
    well: "#361524",
    glyph: "#a8325c",
    Icon: GridDashboard02SolidIcon,
  },
  {
    kind: "video",
    title: "Videos",
    add: "Add a video idea",
    tab: "#93e3b9",
    accent: "#5fd59c",
    rim: ["#caf4dd", "#52c98f"],
    face: ["#b2eecf", "#3cbc7d"],
    well: "#11301f",
    glyph: "#1d7447",
    Icon: VideoCallSolidIcon,
  },
];
const ORDER: Record<IdeaState, number> = { todo: 0, made: 1, skip: 2 };
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(-12);
const send = (list: Idea[], keepalive = false) =>
  fetch("/api/studio/ideas", { method: "PUT", keepalive, headers: { "Content-Type": "application/json", "x-studio": "1" }, body: JSON.stringify(list) });
const day = (iso: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(iso));
const oldestFirst = (a: Idea, b: Idea) => a.at.localeCompare(b.at);

// A top-to-bottom gradient eased in and out (a sine) by hand, so its
// middle doesn't band.
const STOPS = [0, 0.2, 0.35, 0.5, 0.65, 0.8, 1];
const eased = ([from, to]: [string, string]) =>
  `linear-gradient(180deg, ${STOPS.map((p) => `color-mix(in oklab, ${to} ${Math.round(((1 - Math.cos(Math.PI * p)) / 2) * 100)}%, ${from}) ${Math.round(p * 100)}%`).join(", ")})`;

export function IdeasPage({ onMake }: { onMake: (idea: Idea) => void }) {
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [kind, setKind] = useState<IdeaKind>("reel");
  const [problem, setProblem] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Idea[] | null>(null);
  const addField = useRef<HTMLInputElement>(null);
  const [today] = useState(() => new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(new Date()));

  useEffect(() => {
    let live = true;
    fetch("/api/studio/ideas", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Idea[]) => live && setIdeas(list))
      .catch(() => live && setIdeas([]));
    return () => {
      live = false;
      // A change made just before leaving still gets saved.
      if (timer.current) clearTimeout(timer.current);
      if (pending.current) void send(pending.current, true).catch(() => {});
    };
  }, []);

  // Saved a moment after the last change, so a run of ticks is one save.
  const save = (next: Idea[]) => {
    setIdeas(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const list = pending.current;
      pending.current = null;
      if (!list) return;
      send(list)
        .then((r) => setProblem(r.ok ? null : "Unable to save your ideas. Try again in a moment."))
        .catch(() => setProblem("Unable to save your ideas. Check that the studio is running."));
    }, 300);
  };
  const all = ideas ?? [];
  const change = (id: string, patch: Partial<Idea>) => save(all.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const look = LOOKS.find((l) => l.kind === kind) ?? REELS;

  return (
    <section aria-labelledby="ideas-heading" className="mx-auto flex max-w-[1180px] flex-col gap-8 px-8 pt-10 pb-20">
      <header className="flex flex-col gap-1.5 px-1">
        <h1 id="ideas-heading" className="font-medium text-[20px] text-white/95 tracking-[-0.01em]">
          Ideas
        </h1>
        <p className="text-[12.5px] text-white/50">Reels, demos and videos you want to make. Pick a pocket, make one from it, then tick it off.</p>
      </header>
      {problem ? (
        <p role="alert" className="px-1 text-[12px] text-[#ff9592]">
          {problem}
        </p>
      ) : null}

      <div role="tablist" aria-label="Kinds of idea" className="flex flex-wrap gap-x-8 gap-y-6">
        {LOOKS.map((l) => (
          <Pocket
            key={l.kind}
            look={l}
            ideas={all.filter((i) => i.kind === l.kind)}
            loading={ideas === null}
            on={kind === l.kind}
            onPick={() => {
              // A second press on the open one goes straight to adding.
              if (kind === l.kind) addField.current?.focus();
              else setKind(l.kind);
            }}
          />
        ))}
      </div>

      <div id="ideas-list" role="tabpanel" aria-labelledby={`ideas-tab-${kind}`} className="w-full max-w-[600px]">
        <Glide at={kind}>
          <div key={kind} className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300">
            <Widget
              look={look}
              today={today}
              ideas={all.filter((i) => i.kind === kind)}
              loading={ideas === null}
              addField={addField}
              onAdd={(text) => save([...all, { id: newId(), kind, text, state: "todo", at: new Date().toISOString() }])}
              onChange={change}
              onRemove={(id) => save(all.filter((i) => i.id !== id))}
              onMake={onMake}
            />
          </div>
        </Glide>
      </div>
    </section>
  );
}

// Where the cards rest in a pocket, back to front: how far down (px), how
// far each is turned (so the stack looks dropped in by hand), and its
// delay, so they settle one after another, the front one first.
type Slot = { top: number; tilt: number; delay: string };
const FRONT: Slot = { top: 60, tilt: 0, delay: "delay-0" };
const SLOTS: Slot[] = [{ top: 20, tilt: -1.5, delay: "delay-[60ms]" }, { top: 40, tilt: 1, delay: "delay-[30ms]" }, FRONT];

// One kind as a pocket: the dark inside, up to three of its next ideas as
// paper cards (the next one in front), and the front with the kind's mark
// pressed in. Hovering lifts the cards a little; the open one has them
// pulled up, the front card clear of the pocket.
function Pocket({ look, ideas, loading, on, onPick }: { look: Look; ideas: Idea[]; loading: boolean; on: boolean; onPick: () => void }) {
  const open = ideas.filter((i) => i.state === "todo").sort(oldestFirst);
  const made = ideas.some((i) => i.state === "made");
  // Back to front, so the next one is drawn last, on top.
  const cards = open.slice(0, 3).reverse();
  const slots = SLOTS.slice(SLOTS.length - Math.max(1, cards.length));
  const card = (slot: Slot) =>
    cn(
      "absolute left-[24px] flex h-[30px] w-[120px] items-start gap-1.5 rounded-[7px] bg-[#f7f6f2] px-2 pt-[9px] shadow-[0_-1px_3px_rgba(0,0,0,0.2),0_1px_2px_rgba(0,0,0,0.12)]",
      "[transform:translateY(var(--lift))_rotate(var(--tilt))] transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
      on ? "[--lift:-8px]" : "[--lift:0px] group-hover/pocket:[--lift:-4px]",
      slot.delay,
    );
  return (
    <button
      type="button"
      role="tab"
      id={`ideas-tab-${look.kind}`}
      aria-selected={on}
      aria-controls="ideas-list"
      onClick={onPick}
      className="group/pocket flex cursor-pointer flex-col items-start gap-3 rounded-[24px] text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-[#0e0e0e]"
    >
      <span
        aria-hidden="true"
        className="relative block size-[168px] overflow-hidden rounded-[38px] shadow-[0_16px_30px_-14px_rgba(0,0,0,0.75)] supports-[corner-shape:squircle]:rounded-[58px] supports-[corner-shape:squircle]:[corner-shape:squircle]"
        style={{ background: eased(look.rim) }}
      >
        {/* The inside. */}
        <span
          className="absolute inset-x-[14px] top-[14px] h-[96px] rounded-[22px] shadow-[inset_0_7px_12px_rgba(0,0,0,0.5)] supports-[corner-shape:squircle]:rounded-[32px] supports-[corner-shape:squircle]:[corner-shape:squircle]"
          style={{ background: look.well }}
        />
        {/* The cards drop in on the way in, all together. */}
        <span className="absolute inset-0 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-3 motion-safe:duration-500">
          {loading ? null : cards.length ? (
            cards.map((idea, i) => {
              const slot = slots[i] ?? FRONT;
              return (
                <span key={idea.id} className={card(slot)} style={{ top: slot.top, "--tilt": `${slot.tilt}deg` } as CSSProperties}>
                  <span className="size-[10px] shrink-0 rounded-[3px] border-[1.25px] border-[#c4c4ca]" />
                  <span className="min-w-0 truncate font-semibold text-[#232326] text-[10px] leading-[12px]">{idea.text}</span>
                </span>
              );
            })
          ) : (
            // Empty: one blank card, waiting.
            <span className={card(FRONT)} style={{ top: FRONT.top, "--tilt": "0deg" } as CSSProperties}>
              <span className="size-[10px] shrink-0 rounded-[3px] border-[1.25px] border-[#d4d4d9]" />
              <span className="min-w-0 truncate font-medium text-[#9d9da4] text-[10px] leading-[12px]">{look.add}</span>
            </span>
          )}
        </span>
        {/* The front, its top casting a soft shadow down onto the cards. */}
        <span
          className="absolute inset-x-0 top-[86px] bottom-0 flex items-end justify-center pb-[16px] shadow-[0_-10px_18px_-10px_rgba(0,0,0,0.5)]"
          style={{ background: eased(look.face), color: look.glyph }}
        >
          <look.Icon width={26} height={26} aria-hidden="true" />
        </span>
      </span>
      <span className="flex flex-col gap-0.5 px-1">
        <span className={cn("font-medium text-[13.5px] transition-colors duration-200", on ? "text-white" : "text-white/60 group-hover/pocket:text-white/85")}>
          {look.title}
        </span>
        <span className="text-[11.5px] text-white/40 tabular-nums">
          {loading ? " " : open.length ? `${open.length} to make` : made ? "All made" : "Empty"}
        </span>
      </span>
    </button>
  );
}

function Widget({
  look,
  today,
  ideas,
  loading,
  addField,
  onAdd,
  onChange,
  onRemove,
  onMake,
}: {
  look: Look;
  today: string;
  ideas: Idea[];
  loading: boolean;
  addField: React.RefObject<HTMLInputElement | null>;
  onAdd: (text: string) => void;
  onChange: (id: string, patch: Partial<Idea>) => void;
  onRemove: (id: string) => void;
  onMake: (idea: Idea) => void;
}) {
  const [draft, setDraft] = useState("");
  // Still to make first, then made, then the ones let go; oldest first in each.
  const sorted = [...ideas].sort((a, b) => ORDER[a.state] - ORDER[b.state] || oldestFirst(a, b));
  const open = ideas.filter((i) => i.state === "todo").length;
  return (
    <section aria-label={look.title} className="relative pt-7" style={{ "--accent": look.accent } as CSSProperties}>
      {/* The coloured tab behind the card's top, today's date on it, peeking out above and in its corners. */}
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-16 rounded-t-[22px] px-4 pt-[6px] font-medium text-[12px] text-black/55" style={{ background: look.tab }}>
        {today}
      </div>
      <div className="relative overflow-hidden rounded-[22px] bg-[#1a1a1d] shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_18px_36px_-18px_rgba(0,0,0,0.8)]">
        {/* A faint dot grid over the right of the card, fading in from the left. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-3/5 [background-image:radial-gradient(rgba(255,255,255,0.075)_1px,transparent_1.3px)] [background-size:12px_12px] [mask-image:linear-gradient(to_right,transparent,#000_45%)]"
        />
        <header className="relative flex items-baseline gap-2 px-4 pt-4 pb-1.5">
          <h2 className="font-semibold text-[22px] text-white tracking-[-0.015em]">{look.title}</h2>
          {ideas.length ? <span className="ms-auto text-[12px] text-white/35 tabular-nums">{open ? `${open} to make` : "All made"}</span> : null}
        </header>
        <ul className="relative flex flex-col px-2 pb-1.5">
          {sorted.map((idea) => (
            <IdeaRow key={idea.id} idea={idea} onChange={(patch) => onChange(idea.id, patch)} onRemove={() => onRemove(idea.id)} onMake={() => onMake(idea)} />
          ))}
          {!loading && !ideas.length ? <li className="px-2 pt-1 pb-2 text-[13px] text-white/35">Nothing here yet. What’s the first one?</li> : null}
        </ul>
        <form
          className="relative flex items-center border-white/[0.06] border-t px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            const text = draft.trim();
            if (!text) return;
            onAdd(text);
            setDraft("");
          }}
        >
          <input
            ref={addField}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={look.add}
            aria-label={look.add}
            maxLength={280}
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-white/90 outline-none placeholder:text-white/30"
          />
        </form>
      </div>
    </section>
  );
}

const ICON = "flex size-6 cursor-pointer items-center justify-center rounded-[7px] text-white/40 outline-none transition-colors hover:bg-white/[0.08] hover:text-white/85 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5";

function IdeaRow({ idea, onChange, onRemove, onMake }: { idea: Idea; onChange: (patch: Partial<Idea>) => void; onRemove: () => void; onMake: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(idea.text);
  const made = idea.state === "made";
  const skip = idea.state === "skip";
  const commit = () => {
    const next = text.replace(/\s+/g, " ").trim();
    if (next && next !== idea.text) onChange({ text: next });
    else setText(idea.text);
    setEditing(false);
  };
  return (
    <li
      className={cn(
        "group/idea relative flex items-start gap-3 rounded-[12px] px-2 py-2.5 transition-colors hover:bg-white/[0.025] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300",
        "not-first:before:absolute not-first:before:top-0 not-first:before:right-2 not-first:before:left-[38px] not-first:before:h-px not-first:before:bg-white/[0.06]",
      )}
    >
      {/* The box: empty to make, filled and ticked once made, crossed when let go. */}
      <button
        type="button"
        role="checkbox"
        aria-checked={made}
        aria-label={made ? `Mark “${idea.text}” as still to make` : skip ? `Bring back “${idea.text}”` : `Mark “${idea.text}” as made`}
        onClick={() => onChange(made || skip ? { state: "todo", doneAt: undefined } : { state: "made", doneAt: new Date().toISOString() })}
        className={cn(
          "mt-px flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[5px] border-[1.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1a1d]",
          made ? "border-(--accent) bg-(--accent)" : skip ? "border-white/20" : "border-white/30 hover:border-white/55",
        )}
      >
        {made ? <span aria-hidden="true" className="mb-0.5 h-[9px] w-[5px] rotate-45 border-[#141414] border-r-2 border-b-2 motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-200" /> : null}
        {skip ? (
          <span aria-hidden="true" className="relative size-2 text-white/45">
            <span className="absolute inset-x-[-1px] top-1/2 h-[1.5px] -translate-y-1/2 rotate-45 rounded-full bg-current" />
            <span className="absolute inset-x-[-1px] top-1/2 h-[1.5px] -translate-y-1/2 -rotate-45 rounded-full bg-current" />
          </span>
        ) : null}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {editing ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: editing starts on purpose
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setText(idea.text);
                setEditing(false);
              }
            }}
            maxLength={280}
            aria-label="The idea"
            className="min-w-0 bg-transparent text-[14px] text-white leading-snug outline-none"
          />
        ) : (
          <p onDoubleClick={() => setEditing(true)} className={cn("text-pretty text-[14px] leading-snug", made ? "text-white/35" : skip ? "text-white/30 line-through decoration-white/30" : "text-white/90")}>
            {idea.text}
          </p>
        )}
        {/* When it went on the list; once made, when it was made. */}
        {skip ? null : made ? (
          idea.doneAt ? <span className="text-[11.5px] text-white/30">Made {day(idea.doneAt)}</span> : null
        ) : (
          <span className="flex items-center gap-1 font-medium text-(--accent) text-[11.5px] [&_svg]:size-3.5">
            <CalendarIcon aria-hidden="true" />
            {day(idea.at)}
          </span>
        )}
      </div>

      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/idea:opacity-100">
        {made || skip ? null : (
          <button type="button" onClick={onMake} className="me-1 h-6 cursor-pointer rounded-full bg-(--accent) px-2.5 font-medium text-[#141414] text-[11.5px] outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring">
            Make it
          </button>
        )}
        <button type="button" className={ICON} onClick={() => setEditing(true)} aria-label={`Edit “${idea.text}”`}>
          <PencilEditIcon aria-hidden="true" />
        </button>
        <button
          type="button"
          className={ICON}
          onClick={() => onChange(skip ? { state: "todo" } : { state: "skip", doneAt: undefined })}
          aria-label={skip ? `Bring back “${idea.text}”` : `Won't make “${idea.text}”`}
        >
          {skip ? <RefreshIcon aria-hidden="true" /> : <MultipleCrossCancelIcon aria-hidden="true" />}
        </button>
        <button type="button" className={cn(ICON, "hover:text-[#ff9592]")} onClick={onRemove} aria-label={`Delete “${idea.text}”`}>
          <DeleteDustbin01Icon aria-hidden="true" />
        </button>
      </span>
    </li>
  );
}
