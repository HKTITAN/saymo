"use client";

import { useEffect, useRef, useState } from "react";
import { DeleteDustbin01Icon, PlusIcon } from "@/components/icons";
import { LABEL, ROW } from "@/components/ui/dial";
import type { Rule, RuleScope } from "@/lib/studio/agent/rules";
import { cn } from "@/lib/utils";
import { api, StudioError } from "../api/studio";
import { ICON_BUTTON, PILL_BUTTON } from "../ui/panel";

// The studio's standing rules: Claude follows them in every film unless a
// prompt says otherwise, and the whole team shares them. Set like
// Settings: each rule a card with its Off | On pair; changes save on
// their own.

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

  const on = rules?.filter((r) => r.on).length ?? 0;
  return (
    // A page in the home's main panel, set like Settings: each rule its own
    // quiet card, open to edit, with its Off | On pair at the top; two
    // columns when there's room.
    <section aria-labelledby="rules-heading" className="mx-auto flex w-full max-w-[1080px] flex-col gap-6 px-8 pt-10 pb-20">
      <div className="flex items-end gap-4 px-1">
        <div className="flex flex-col gap-1.5">
          <h1 id="rules-heading" className="font-medium text-[20px] text-white/95 tracking-[-0.01em]">
            Rules
          </h1>
          <p className="text-[12.5px] text-white/50 tabular-nums">
            Claude follows these in every film, for the whole team.{rules ? ` ${on} of ${rules.length} on.` : ""}
          </p>
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
          {problem ? <p className="text-[12px] text-danger">{problem}</p> : null}
        </div>
      ) : null}
      {rules === null ? (
        <p className="px-1 text-[12.5px]">
          <span className="studio-shimmer">Loading the rules</span>
        </p>
      ) : (
        <ul className="gap-3 lg:columns-2 [&>li]:mb-3 [&>li]:break-inside-avoid">
          {rules.map((r) => (
            <RuleCard key={r.id} rule={r} onChange={(part) => change(r.id, part)} onRemove={() => remove(r)} />
          ))}
        </ul>
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

function RuleCard({ rule: r, onChange, onRemove }: { rule: Rule; onChange: (part: Partial<Rule>) => void; onRemove: () => void }) {
  const name = r.title.trim() || "Untitled rule";
  return (
    <li className="group/rule flex flex-col gap-1.5 rounded-[16px] bg-white/[0.025] p-2 shadow-[inset_0_0_0_1px_rgb(var(--hi)_/_0.05)]">
      <div className="flex items-center gap-2 ps-1">
        <input
          data-rule-title={r.id}
          value={r.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Name this rule"
          aria-label="Rule name"
          className={cn(
            "-ms-1 h-8 min-w-0 flex-1 rounded-[8px] bg-transparent px-1.5 font-medium text-[13px] outline-none transition-colors placeholder:text-white/30 hover:bg-white/[0.04] focus:bg-white/[0.06]",
            r.on ? "text-white/90" : "text-white/40",
          )}
        />
        <button
          type="button"
          className={cn(ICON_BUTTON, "size-7 opacity-0 hover:bg-[#e5484d]/12 hover:text-danger focus-visible:opacity-100 group-hover/rule:opacity-100 [&_svg]:size-3.5")}
          onClick={onRemove}
          aria-label={`Delete ${name}`}
        >
          <DeleteDustbin01Icon aria-hidden="true" />
        </button>
        <Slide label={`${name}, on or off`} value={r.on} options={ON_OFF} onChange={(v) => onChange({ on: v })} segment={40} />
      </div>
      <div className={cn("flex flex-col gap-1.5 transition-opacity", !r.on && "opacity-50")}>
        <label className="flex flex-col rounded-[10px] bg-white/[0.05] px-3 py-2 text-[12px] focus-within:bg-white/[0.08]">
          <textarea
            value={r.body}
            onChange={(e) => onChange({ body: e.target.value })}
            placeholder="Keep every move slow and eased"
            aria-label={`${name}, what Claude should do`}
            rows={2}
            className="resize-none bg-transparent text-[12.5px] text-white/75 leading-relaxed outline-none [field-sizing:content] placeholder:text-white/30"
          />
        </label>
        <div className={cn(ROW, "gap-3 ps-3 pe-1")}>
          <span className={LABEL}>For</span>
          <span className="ms-auto">
            <Slide label={`${name} applies to`} value={r.scope} options={SCOPE_OPTIONS} onChange={(v) => onChange({ scope: v })} segment={76} />
          </span>
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
        className="absolute top-0.5 bottom-0.5 left-0.5 rounded-[7px] bg-white/[0.12] shadow-[0_1px_2px_rgb(0_0_0_/_calc(0.3*var(--shade)))] transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
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
