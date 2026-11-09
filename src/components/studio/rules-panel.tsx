"use client";

import { useEffect, useRef, useState } from "react";
import { DeleteDustbin01Icon, PlusIcon } from "@/components/icons";
import type { Rule, RuleScope } from "@/lib/studio/rules";
import { cn } from "@/lib/utils";
import { api, StudioError } from "./api";
import { ICON_BUTTON, PILL_BUTTON } from "./panel";

// The studio's standing rules: Claude follows them in every film unless a
// prompt says otherwise, and the whole team shares them. Each rule is a
// tile you type straight into, lit when it's on; changes save on their own.

// Each scope's colour when a rule is on, from the Ideas page's pockets:
// lavender for every film, mint for motion graphics, pink for video edits.
const TILES: Record<RuleScope, { face: [string, string]; dot: string }> = {
  all: { face: ["#d6d0ff", "#9d90fb"], dot: "#4a3db5" },
  motion: { face: ["#cdf5df", "#6fd6a2"], dot: "#1d7447" },
  video: { face: ["#ffd6e6", "#f28cb2"], dot: "#a8325c" },
};

const SCOPES: { value: RuleScope; label: string }[] = [
  { value: "all", label: "Every film" },
  { value: "motion", label: "Motion graphics" },
  { value: "video", label: "Video edits" },
];

export function RulesPage() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ rule: Rule; at: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const known = useRef(new Set<string>()); // every rule this page has seen

  useEffect(() => {
    api
      .rules()
      .then((list) => {
        for (const r of list) known.current.add(r.id);
        setRules(list);
      })
      .catch(() => setProblem("Unable to load the rules. Reload the page to try again."));
  }, []);

  const save = (next: Rule[]) => {
    for (const r of next) known.current.add(r.id);
    setRules(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api
        .saveRules(next, [...known.current])
        .then((saved) => {
          setProblem(null);
          // Rules added elsewhere come back after ours; show them too.
          if (saved.length !== next.length) {
            for (const r of saved) known.current.add(r.id);
            setRules(saved);
          }
        })
        .catch((e) => setProblem(e instanceof StudioError ? e.message : "Unable to save the rules. Make any change to try again."));
    }, 450);
  };
  const change = (id: string, part: Partial<Rule>) => rules && save(rules.map((r) => (r.id === id ? { ...r, ...part } : r)));
  const add = () => {
    if (!rules) return;
    let n = rules.length + 1;
    while (rules.some((r) => r.id === `rule-${n}`)) n++;
    const id = `rule-${n}`;
    save([...rules, { id, title: "", body: "", scope: "all", on: true }]);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-rule-title="${id}"]`)?.focus());
  };
  const remove = (rule: Rule) => {
    if (!rules) return;
    const at = rules.findIndex((r) => r.id === rule.id);
    save(rules.filter((r) => r.id !== rule.id));
    setRemoved({ rule, at });
  };
  const undoRemove = () => {
    if (!rules || !removed) return;
    const next = [...rules];
    next.splice(removed.at, 0, removed.rule);
    save(next);
    setRemoved(null);
  };

  return (
    // A page in the home's main panel. Each rule is a tile that is also its
    // own switch: on, it's lit in its kind's colour (lavender for every
    // film, mint for motion graphics, pink for video edits); off, it goes
    // dark. Three to a row.
    <section aria-labelledby="rules-heading" className="mx-auto flex w-full max-w-[980px] flex-col gap-8 px-8 pt-10 pb-20">
      <div className="flex items-end gap-4 px-1">
        <div className="flex flex-col gap-1.5">
          <h1 id="rules-heading" className="font-medium text-[20px] text-white/95 tracking-[-0.01em]">
            Rules
          </h1>
          <p className="text-[12.5px] text-white/50 leading-relaxed">Claude follows these in every film, for the whole team.</p>
        </div>
        <button
          type="button"
          disabled={rules === null}
          onClick={add}
          className={cn(PILL_BUTTON, "ms-auto bg-white/[0.06] text-white/80 hover:bg-white/[0.1] hover:text-white")}
        >
          <PlusIcon aria-hidden="true" />
          Add a rule
        </button>
      </div>
      {removed || problem ? (
        <div className="-mt-4 flex flex-wrap items-center gap-3 px-1">
          {removed ? (
            <p className="text-[12px] text-white/50" role="status">
              Rule deleted.{" "}
              <button type="button" onClick={undoRemove} className="cursor-pointer text-white/85 underline-offset-2 hover:underline">
                Undo
              </button>
            </p>
          ) : null}
          {problem ? <p className="text-[12px] text-[#ff9592]">{problem}</p> : null}
        </div>
      ) : null}
      {rules === null ? (
        <p className="px-1 text-[12.5px]">
          <span className="studio-shimmer">Loading the rules</span>
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rules.map((r, i) => (
            <RuleTile
              key={r.id}
              rule={r}
              n={i + 1}
              onChange={(part) => change(r.id, part)}
              onRemove={() => remove(r)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// A gradient eased top to bottom (a sine), so its middle doesn't band.
const STOPS = [0, 0.2, 0.35, 0.5, 0.65, 0.8, 1];
const eased = ([from, to]: [string, string]) =>
  `linear-gradient(160deg, ${STOPS.map((p) => `color-mix(in oklab, ${to} ${Math.round(((1 - Math.cos(Math.PI * p)) / 2) * 100)}%, ${from}) ${Math.round(p * 100)}%`).join(", ")})`;

function RuleTile({ rule: r, n, onChange, onRemove }: { rule: Rule; n: number; onChange: (part: Partial<Rule>) => void; onRemove: () => void }) {
  const look = TILES[r.scope] ?? TILES.all;
  const scope = SCOPES.findIndex((s) => s.value === r.scope);
  const next = SCOPES[(scope + 1) % SCOPES.length];
  const on = r.on;
  return (
    <li
      className={cn(
        "group/rule relative flex min-h-[240px] flex-col overflow-hidden rounded-[28px] p-[18px] transition-[background,box-shadow,color] duration-300 supports-[corner-shape:squircle]:rounded-[44px] supports-[corner-shape:squircle]:[corner-shape:squircle]",
        on
          ? "text-[#1d1b1a] shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_18px_34px_-18px_rgba(0,0,0,0.85)]"
          : "bg-[#18181b] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]",
      )}
      style={on ? { background: eased(look.face) } : undefined}
    >
      {/* Its number, large and faint, in the corner. */}
      <span aria-hidden="true" className={cn("pointer-events-none absolute -right-1 -bottom-6 font-semibold text-[120px] leading-none tracking-[-0.06em] tabular-nums", on ? "text-black/[0.07]" : "text-white/[0.04]")}>
        {n}
      </span>
      <div className="relative flex items-center gap-2">
        {/* Which films it's for: press to change. */}
        <button
          type="button"
          onClick={() => onChange({ scope: next.value })}
          aria-label={`Rule ${n} applies to ${SCOPES[scope]?.label ?? "every film"}. Change to ${next.label}`}
          className={cn(
            "flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-2.5 font-medium text-[11.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
            on ? "bg-black/[0.08] text-black/65 hover:bg-black/[0.13]" : "bg-white/[0.06] text-white/55 hover:bg-white/[0.1]",
          )}
        >
          <span aria-hidden="true" className="size-[7px] rounded-full" style={{ background: on ? look.dot : look.face[1] }} />
          {SCOPES[scope]?.label ?? "Every film"}
        </button>
        <button
          type="button"
          className={cn(
            ICON_BUTTON,
            "ms-auto size-7 opacity-0 focus-visible:opacity-100 group-hover/rule:opacity-100 [&_svg]:size-3.5",
            on ? "text-black/45 hover:bg-black/[0.08] hover:text-[#b4232a]" : "hover:bg-[#e5484d]/12 hover:text-[#ff9592]",
          )}
          onClick={onRemove}
          aria-label={`Delete rule ${n}`}
        >
          <DeleteDustbin01Icon aria-hidden="true" />
        </button>
        {/* The switch: the whole tile lights up when it's on. */}
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={`Rule ${n}, ${r.title || "untitled"}`}
          onClick={() => onChange({ on: !on })}
          className={cn(
            "relative h-[26px] w-[44px] shrink-0 cursor-pointer rounded-full outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring",
            on ? "bg-black/80" : "bg-white/[0.14]",
            "ms-1",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "absolute top-[3px] left-[3px] size-5 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.35)] transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
              on ? "translate-x-[18px]" : "translate-x-0 bg-white/80",
            )}
            style={on ? { background: look.face[0] } : undefined}
          />
        </button>
      </div>
      <input
        data-rule-title={r.id}
        value={r.title}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder="Calm motion"
        aria-label={`Rule ${n} name`}
        className={cn(
          "relative -mx-1.5 mt-4 h-9 min-w-0 rounded-[8px] bg-transparent px-1.5 font-semibold text-[19px] tracking-[-0.015em] outline-none",
          on ? "placeholder:text-black/30 hover:bg-black/[0.05] focus:bg-black/[0.07]" : "text-white/70 placeholder:text-white/30 hover:bg-white/[0.04] focus:bg-white/[0.06]",
        )}
      />
      <textarea
        value={r.body}
        onChange={(e) => onChange({ body: e.target.value })}
        placeholder="Keep every move slow and eased"
        aria-label={`Rule ${n}`}
        rows={3}
        className={cn(
          "relative -mx-1.5 mt-1 flex-1 resize-none rounded-[8px] bg-transparent px-1.5 py-1 text-[13px] leading-relaxed outline-none [field-sizing:content]",
          on ? "text-black/70 placeholder:text-black/30 hover:bg-black/[0.04] focus:bg-black/[0.06]" : "text-white/40 placeholder:text-white/25 hover:bg-white/[0.03] focus:bg-white/[0.05]",
        )}
      />
    </li>
  );
}

// Options in a row with one highlight that slides to the chosen one.
// Segments share one width, so the highlight moves by whole segments.
export function Slide<T extends string | boolean>({
  label,
  value,
  options,
  onChange,
  segment,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  segment: number; // each option's width in px
}) {
  const at = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="relative grid h-7 shrink-0 rounded-[9px] bg-white/[0.04] p-0.5 text-[11.5px]"
      style={{ gridTemplateColumns: `repeat(${options.length}, ${segment}px)` }}
    >
      <span
        aria-hidden="true"
        className="absolute top-0.5 bottom-0.5 left-0.5 rounded-[7px] bg-white/[0.12] shadow-[0_1px_2px_rgba(0,0,0,0.3)] transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
        style={{ width: segment, transform: `translateX(${at * segment}px)` }}
      />
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative cursor-pointer rounded-[7px] outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring",
            o.value === value ? "text-white" : "text-white/45 hover:text-white/75",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
