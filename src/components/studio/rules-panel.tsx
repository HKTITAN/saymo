"use client";

import { useEffect, useRef, useState } from "react";
import { DeleteDustbin01Icon, PlusIcon } from "@/components/icons";
import type { Rule, RuleScope } from "@/lib/studio/rules";
import { cn } from "@/lib/utils";
import { api, StudioError } from "./api";
import { ICON_BUTTON, PILL_BUTTON } from "./panel";

// The studio's standing rules: Claude follows them in every film unless a
// prompt says otherwise, and the whole team shares them. Set like a
// rulebook: numbered rules you type straight into; changes save on their own.

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
    // A page in the home's main panel, set like a printed rulebook: one
    // sheet, the rules numbered down it, hairlines between them.
    <section aria-labelledby="rules-heading" className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-8 pt-10 pb-20">
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
        <ol className="flex flex-col rounded-[20px] bg-white/[0.025] px-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]">
          {rules.map((r, i) => (
            <RuleRow key={r.id} rule={r} n={i + 1} onChange={(part) => change(r.id, part)} onRemove={() => remove(r)} />
          ))}
        </ol>
      )}
    </section>
  );
}

// Short names for the scope chip.
const SHORT: Record<RuleScope, string> = { all: "Every film", motion: "Motion", video: "Video" };

function RuleRow({ rule: r, n, onChange, onRemove }: { rule: Rule; n: number; onChange: (part: Partial<Rule>) => void; onRemove: () => void }) {
  const scope = SCOPES.findIndex((s) => s.value === r.scope);
  const next = SCOPES[(scope + 1) % SCOPES.length];
  const on = r.on;
  return (
    <li
      className={cn(
        "group/rule relative flex gap-5 px-4 py-5",
        "not-first:before:absolute not-first:before:top-0 not-first:before:right-4 not-first:before:left-4 not-first:before:h-px not-first:before:bg-white/[0.07]",
      )}
    >
      {/* Its number, large and light, like a rulebook's. */}
      <span aria-hidden="true" className={cn("w-8 shrink-0 pt-0.5 text-right font-light text-[28px] leading-none tabular-nums transition-colors", on ? "text-white/35" : "text-white/15")}>
        {n}
      </span>
      <div className={cn("flex min-w-0 flex-1 flex-col gap-1 transition-opacity", !on && "opacity-45")}>
        <input
          data-rule-title={r.id}
          value={r.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Calm motion"
          aria-label={`Rule ${n} name`}
          className="-mx-1.5 h-8 min-w-0 rounded-[8px] bg-transparent px-1.5 font-semibold text-[16px] text-white tracking-[-0.01em] outline-none placeholder:text-white/30 hover:bg-white/[0.04] focus:bg-white/[0.06]"
        />
        <textarea
          value={r.body}
          onChange={(e) => onChange({ body: e.target.value })}
          placeholder="Keep every move slow and eased"
          aria-label={`Rule ${n}`}
          rows={2}
          className="-mx-1.5 resize-none rounded-[8px] bg-transparent px-1.5 py-1 text-[13px] text-white/60 leading-relaxed outline-none [field-sizing:content] placeholder:text-white/30 hover:bg-white/[0.03] focus:bg-white/[0.05]"
        />
      </div>
      <div className="flex shrink-0 items-start gap-1.5 pt-0.5">
        <button
          type="button"
          className={cn(ICON_BUTTON, "size-7 opacity-0 hover:bg-[#e5484d]/12 hover:text-[#ff9592] focus-visible:opacity-100 group-hover/rule:opacity-100 [&_svg]:size-3.5")}
          onClick={onRemove}
          aria-label={`Delete rule ${n}`}
        >
          <DeleteDustbin01Icon aria-hidden="true" />
        </button>
        {/* Which films it's for: press to change. */}
        <button
          type="button"
          onClick={() => onChange({ scope: next.value })}
          aria-label={`Rule ${n} applies to ${SCOPES[scope]?.label ?? "every film"}. Change to ${next.label}`}
          className="h-7 min-w-[78px] cursor-pointer rounded-full bg-white/[0.06] px-2.5 text-[11.5px] text-white/60 outline-none transition-colors hover:bg-white/[0.1] hover:text-white/85 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {SHORT[r.scope] ?? "Every film"}
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={`Rule ${n}, ${r.title || "untitled"}`}
          onClick={() => onChange({ on: !on })}
          className={cn(
            "relative mt-px h-[24px] w-[40px] shrink-0 cursor-pointer rounded-full outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring",
            on ? "bg-white/85" : "bg-white/[0.12]",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "absolute top-[3px] left-[3px] size-[18px] rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.35)] transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
              on ? "translate-x-[16px] bg-[#141414]" : "translate-x-0 bg-white/70",
            )}
          />
        </button>
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
