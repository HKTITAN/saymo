"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, DeleteDustbin01Icon, PlusIcon } from "@/components/icons";
import { LABEL, ROW } from "@/components/tool/dial";
import type { Rule, RuleScope } from "@/lib/studio/rules";
import { cn } from "@/lib/utils";
import { api, StudioError } from "./api";
import { PILL_BUTTON } from "./panel";

// The studio's standing rules: Claude follows them in every film unless a
// prompt says otherwise, and the whole team shares them. Set like
// Settings: each rule a row with its Off | On pair, unfolding to edit;
// changes save on their own.

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
  const [openId, setOpenId] = useState<string | null>(null);

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
    setOpenId(id);
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

  const on = rules?.filter((r) => r.on).length ?? 0;
  return (
    // A page in the home's main panel, set like Settings: one quiet card of
    // rows, each rule a name with its Off | On pair. Press a rule to unfold
    // it and edit its words and which films it's for.
    <section aria-labelledby="rules-heading" className="mx-auto flex w-full max-w-[660px] flex-col gap-6 px-8 pt-10 pb-20">
      <div className="flex items-end gap-4 px-1">
        <div className="flex flex-col gap-1.5">
          <h1 id="rules-heading" className="font-medium text-[20px] text-white/95 tracking-[-0.01em]">
            Rules
          </h1>
          <p className="text-[12.5px] text-white/50">Claude follows these in every film, for the whole team.</p>
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
        <div className="-mt-2 flex flex-wrap items-center gap-3 px-1">
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
        <div className="flex flex-col gap-1.5 rounded-[16px] bg-white/[0.025] p-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]">
          <p className="px-1 pt-0.5 pb-1 text-[12px] text-white/45 tabular-nums">
            {on} of {rules.length} on
          </p>
          <ul className="flex flex-col gap-1">
            {rules.map((r) => (
              <RuleRow
                key={r.id}
                rule={r}
                open={openId === r.id}
                onToggle={() => setOpenId((id) => (id === r.id ? null : r.id))}
                onChange={(part) => change(r.id, part)}
                onRemove={() => remove(r)}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// Short names for which films a rule is for.
const SHORT: Record<RuleScope, string> = { all: "Every film", motion: "Motion", video: "Video" };
const SCOPE_OPTIONS = SCOPES.map((s) => ({ value: s.value, label: SHORT[s.value] }));
const ON_OFF = [
  { value: false, label: "Off" },
  { value: true, label: "On" },
];

function RuleRow({
  rule: r,
  open,
  onToggle,
  onChange,
  onRemove,
}: {
  rule: Rule;
  open: boolean;
  onToggle: () => void;
  onChange: (part: Partial<Rule>) => void;
  onRemove: () => void;
}) {
  const name = r.title.trim() || "Untitled rule";
  return (
    <li className={cn("flex flex-col rounded-[10px] bg-white/[0.05] transition-colors", open && "bg-white/[0.065]")}>
      <div className="flex h-10 items-center gap-2 ps-1 pe-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[8px] px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDownIcon
            aria-hidden="true"
            className={cn("size-3.5 shrink-0 text-white/40 transition-transform duration-200 motion-reduce:transition-none", !open && "-rotate-90")}
          />
          <span className={cn("truncate text-[12.5px] transition-colors", r.on ? "text-white/90" : "text-white/40", !r.title.trim() && "text-white/40")}>{name}</span>
          {r.scope !== "all" ? <span className="shrink-0 text-[11.5px] text-white/35">{SHORT[r.scope]}</span> : null}
        </button>
        <Slide label={`${name}, on or off`} value={r.on} options={ON_OFF} onChange={(v) => onChange({ on: v })} segment={40} />
      </div>
      {/* Unfolds smoothly; closed, its fields can't be reached. */}
      <div className={cn("grid transition-[grid-template-rows] duration-250 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="overflow-hidden" inert={!open}>
          <div className="flex flex-col gap-1.5 px-1.5 pt-0.5 pb-1.5">
            <label className={cn(ROW, "gap-3 bg-white/[0.04] px-3 focus-within:bg-white/[0.07]")}>
              <span className={LABEL}>Name</span>
              <input
                data-rule-title={r.id}
                value={r.title}
                onChange={(e) => onChange({ title: e.target.value })}
                placeholder="Calm motion"
                className="h-full min-w-0 flex-1 bg-transparent text-right text-white/90 outline-none placeholder:text-white/30"
              />
            </label>
            <label className="flex flex-col gap-1 rounded-[10px] bg-white/[0.04] px-3 pt-2 pb-1.5 text-[12px] focus-within:bg-white/[0.07]">
              <span className={LABEL}>Rule</span>
              <textarea
                value={r.body}
                onChange={(e) => onChange({ body: e.target.value })}
                placeholder="Keep every move slow and eased"
                rows={2}
                className="resize-none bg-transparent text-[12.5px] text-white/80 leading-relaxed outline-none [field-sizing:content] placeholder:text-white/30"
              />
            </label>
            <div className={cn(ROW, "gap-3 bg-white/[0.04] ps-3 pe-1")}>
              <span className={LABEL}>For</span>
              <span className="ms-auto">
                <Slide label={`${name} applies to`} value={r.scope} options={SCOPE_OPTIONS} onChange={(v) => onChange({ scope: v })} segment={76} />
              </span>
            </div>
            <button
              type="button"
              onClick={onRemove}
              className={cn(ROW, "cursor-pointer justify-center gap-2 bg-white/[0.04] px-3 text-white/55 outline-none hover:bg-[#e5484d]/12 hover:text-[#ff9592] focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5")}
            >
              <DeleteDustbin01Icon aria-hidden="true" />
              Delete rule
            </button>
          </div>
        </div>
      </div>
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
