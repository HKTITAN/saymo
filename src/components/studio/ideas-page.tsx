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
import { Caveat } from "next/font/google";

// The Ideas page: what to make next. Each kind (reels, demos, videos) is a
// pocket, a glossy squircle tray with its next ideas listed on one paper
// page, the way an app icon shows what's inside. Pick one and its list
// opens below: a little dark widget with today's date on a coloured tab and
// ideas to tick off, made ones crossed out by hand. Saved on this Mac through
// /api/studio/ideas.

// The notepad's handwriting, as in Settings' "Bring your own AI".
const hand = Caveat({ subsets: ["latin"], weight: ["600"], display: "swap" });

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

export function IdeasPage() {
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
    // One centred column, as wide as the list, like Settings: the pockets
    // span it edge to edge and the list sits right under them.
    <section aria-labelledby="ideas-heading" className="mx-auto flex w-full max-w-[664px] flex-col gap-8 px-8 pt-10 pb-20">
      <header className="flex flex-col gap-1.5 px-1">
        <h1 id="ideas-heading" className="font-medium text-[20px] text-white/95 tracking-[-0.01em]">
          Ideas
        </h1>
        <p className="text-[12.5px] text-white/50">What to make next.</p>
      </header>
      {problem ? (
        <p role="alert" className="px-1 text-[12px] text-[#ff9592]">
          {problem}
        </p>
      ) : null}

      <div role="tablist" aria-label="Kinds of idea" className="flex justify-between gap-6">
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

      <div id="ideas-list" role="tabpanel" aria-labelledby={`ideas-tab-${kind}`} className="-mt-2 w-full">
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
            />
          </div>
        </Glide>
      </div>
    </section>
  );
}

// One kind as a pocket: the dark inside, one paper page with its next
// ideas listed down it, and the front with the kind's mark pressed in.
// Hovering lifts the page a little; the open pocket has it pulled up.
function Pocket({ look, ideas, loading, on, onPick }: { look: Look; ideas: Idea[]; loading: boolean; on: boolean; onPick: () => void }) {
  const open = ideas.filter((i) => i.state === "todo").sort(oldestFirst);
  const lines = open.slice(0, 3);
  return (
    <button
      type="button"
      role="tab"
      id={`ideas-tab-${look.kind}`}
      aria-selected={on}
      aria-controls="ideas-list"
      onClick={onPick}
      className="group/pocket flex cursor-pointer flex-col items-center gap-3 rounded-[24px] text-center outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-[#0e0e0e]"
    >
      {/* The open pocket in full colour; the others quieter until hovered. */}
      <span
        aria-hidden="true"
        className={cn(
          "relative block size-[168px] overflow-hidden rounded-[38px] shadow-[0_16px_30px_-14px_rgba(0,0,0,0.75)] transition-[filter,opacity] duration-300 supports-[corner-shape:squircle]:rounded-[58px] supports-[corner-shape:squircle]:[corner-shape:squircle]",
          on ? "" : "opacity-55 saturate-[0.55] group-hover/pocket:opacity-90 group-hover/pocket:saturate-100",
        )}
        style={{ background: eased(look.rim) }}
      >
        {/* The inside. */}
        <span
          className="absolute inset-x-[14px] top-[14px] h-[96px] rounded-[22px] shadow-[inset_0_7px_12px_rgba(0,0,0,0.5)] supports-[corner-shape:squircle]:rounded-[32px] supports-[corner-shape:squircle]:[corner-shape:squircle]"
          style={{ background: look.well }}
        />
        {/* The page drops in on the way in. */}
        <span className="absolute inset-0 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-3 motion-safe:duration-500">
          {loading ? null : (
            // A little spiral notepad: coil along the top, a margin line,
            // "To do" and the next ideas written by hand on ruled lines.
            <span
              className={cn(
                "absolute top-[16px] left-[26px] block h-[100px] w-[116px] rounded-[8px] bg-[#fbfaf5] shadow-[0_-1px_3px_rgba(0,0,0,0.2),0_1px_2px_rgba(0,0,0,0.12)]",
                "[transform:translateY(var(--lift))_rotate(-1.5deg)] transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
                on ? "[--lift:-6px]" : "[--lift:0px] group-hover/pocket:[--lift:-3px]",
              )}
            >
              <span className="absolute inset-x-[10px] top-[-4px] flex justify-between">
                {[0, 1, 2, 3, 4, 5, 6].map((k) => (
                  <span key={k} className="relative block h-[11px] w-[5px]">
                    <span className="absolute bottom-0 left-1/2 size-[4px] -translate-x-1/2 rounded-full bg-[#2a2833]/70" />
                    <span className="absolute top-0 left-0 h-[8px] w-[5px] rounded-full border-[#a9a8b2] border-[1.5px] border-b-transparent" />
                  </span>
                ))}
              </span>
              <span className="absolute top-[12px] bottom-[6px] left-[17px] w-px" style={{ background: look.accent, opacity: 0.45 }} />
              <span className={cn(hand.className, "absolute top-[10px] left-[22px] text-[13px] leading-[14px]")} style={{ color: look.glyph }}>
                To do
              </span>
              <span className="absolute inset-x-0 top-[26px] flex flex-col">
                {/* Always three ruled lines with boxes; the ideas fill them from the top. */}
                {[0, 1, 2].map((k) => {
                  const idea = lines[k];
                  const hint = !lines.length && k === 0;
                  return (
                    <span key={idea?.id ?? `blank-${k}`} className="flex h-[14px] min-w-0 items-center gap-[5px] border-[#1d2b5a]/[0.08] border-b ps-[22px] pe-2">
                      <span className="size-[7px] shrink-0 rounded-[2px] border-[1.2px]" style={{ borderColor: look.accent }} />
                      {idea || hint ? (
                        <span className={cn(hand.className, "min-w-0 truncate pe-1 text-[12px] leading-[14px]", idea ? "text-[#2a2a2e]" : "text-[#a3a3aa]")}>
                          {idea ? idea.text : look.add}
                        </span>
                      ) : null}
                    </span>
                  );
                })}
              </span>
            </span>
          )}
        </span>
        {/* The front, its top casting a soft shadow down onto the page. */}
        <span
          className="absolute inset-x-0 top-[86px] bottom-0 flex items-end justify-center pb-[16px] shadow-[0_-10px_18px_-10px_rgba(0,0,0,0.5)]"
          style={{ background: eased(look.face), color: look.glyph }}
        >
          <look.Icon width={26} height={26} aria-hidden="true" />
        </span>
      </span>
      <span className="flex flex-col items-center gap-0.5 px-1">
        <span className={cn("font-medium text-[13.5px] transition-colors duration-200", on ? "text-white" : "text-white/60 group-hover/pocket:text-white/85")}>
          {look.title}
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
}: {
  look: Look;
  today: string;
  ideas: Idea[];
  loading: boolean;
  addField: React.RefObject<HTMLInputElement | null>;
  onAdd: (text: string) => void;
  onChange: (id: string, patch: Partial<Idea>) => void;
  onRemove: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  // Still to make first, then made, then the ones let go; oldest first in each.
  const sorted = [...ideas].sort((a, b) => ORDER[a.state] - ORDER[b.state] || oldestFirst(a, b));
  return (
    <section aria-label={look.title} className="relative pt-7" style={{ "--accent": look.accent } as CSSProperties}>
      {/* The coloured tab behind the card's top, today's date on its left and how many are left on its right, peeking out above and in its corners. */}
      <div className="absolute inset-x-0 top-0 flex h-16 items-start justify-between rounded-t-[22px] px-4 pt-[6px] font-medium text-[12px] text-black/55" style={{ background: look.tab }}>
        <span aria-hidden="true">{today}</span>
      </div>
      <div className="relative overflow-hidden rounded-[22px] bg-[#1a1a1d] shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_18px_36px_-18px_rgba(0,0,0,0.8)]">
        <header className="relative flex items-baseline gap-2 px-4 pt-4 pb-1.5">
          <h2 className="font-semibold text-[22px] text-white tracking-[-0.015em]">{look.title}</h2>
        </header>
        <ul className="relative flex flex-col px-2 pb-1.5">
          {sorted.map((idea, k) => (
            <IdeaRow key={idea.id} idea={idea} doodle={k} onChange={(patch) => onChange(idea.id, patch)} onRemove={() => onRemove(idea.id)} />
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

function IdeaRow({ idea, doodle, onChange, onRemove }: { idea: Idea; doodle: number; onChange: (patch: Partial<Idea>) => void; onRemove: () => void }) {
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
            {made ? (
              <span className="relative inline-block max-w-full">
                {idea.text}
                <Scribble n={doodle} text={idea.text} />
              </span>
            ) : (
              idea.text
            )}
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

      <span className="flex shrink-0 items-center gap-0.5 self-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/idea:opacity-100">
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

// Hand-drawn cross-outs for made ideas, drawn to the length of the words
// (about 7.2 px a letter) so short ones don't squash. Which one an idea gets
// comes from its place in the list, so neighbours never match.
const n1 = (v: number) => Math.round(v * 10) / 10;
const SCRIBBLES: ((w: number) => string)[] = [
  // Zigzag
  (w) => {
    let d = "M0 11";
    for (let x = 5, k = 0; x < w; x += 5, k++) d += ` L${n1(x)} ${k % 2 ? 14 : 6}`;
    return `${d} L${n1(w)} 10`;
  },
  // Wave
  (w) => {
    let d = "M0 10";
    for (let x = 0, k = 0; x < w; x += 6, k++) d += ` Q${n1(x + 3)} ${k % 2 ? 16 : 4} ${n1(Math.min(w, x + 6))} 10`;
    return d;
  },
  // Loops
  (w) => {
    let d = "M0 13";
    for (let x = 0; x + 9 <= w; x += 9) d += ` C${n1(x + 6)} 13 ${n1(x + 9)} 4 ${n1(x + 6)} 4 C${n1(x + 3)} 4 ${n1(x + 3)} 14 ${n1(x + 9)} 12`;
    return d;
  },
  // Double strike
  (w) => `M0 9 C${n1(w * 0.3)} 7 ${n1(w * 0.65)} 9 ${n1(w)} 7 M2 13 C${n1(w * 0.35)} 12 ${n1(w * 0.7)} 14 ${n1(w - 1)} 11`,
  // Back and forth
  (w) => `M1 9 C${n1(w * 0.35)} 7 ${n1(w * 0.7)} 8 ${n1(w - 1)} 8 C${n1(w * 0.7)} 10 ${n1(w * 0.35)} 11 3 13 C${n1(w * 0.35)} 13 ${n1(w * 0.7)} 12 ${n1(w - 2)} 12`,
  // Slashes
  (w) => {
    let d = "";
    for (let x = 1; x + 5 <= w; x += 6) d += `M${n1(x)} 16 L${n1(x + 5)} 4 `;
    return d.trim();
  },
];

function Scribble({ n, text }: { n: number; text: string }) {
  const w = Math.max(18, Math.round(text.length * 7.2) + 8);
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${w} 20`} preserveAspectRatio="none" className="pointer-events-none absolute -inset-x-1 top-1/2 h-[0.9em] w-[calc(100%+0.5rem)] -translate-y-1/2 overflow-visible text-(--accent)">
      <path
        d={SCRIBBLES[n % SCRIBBLES.length](w)}
        pathLength={1}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className="[stroke-dasharray:1] motion-safe:animate-[scribble_450ms_cubic-bezier(0.23,1,0.32,1)_both]"
      />
    </svg>
  );
}
