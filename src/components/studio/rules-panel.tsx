"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { DeleteDustbin01Icon, PlusIcon } from "@/components/icons";
import type { Rule, RuleScope } from "@/lib/studio/rules";
import { cn } from "@/lib/utils";
import { api, StudioError } from "./api";
import { ICON_BUTTON, PILL_BUTTON } from "./panel";

// The studio's standing rules: Claude follows them in every film unless a
// prompt says otherwise, and the whole team shares them. Each rule is a
// widget you type straight into; changes save on their own.

// Each scope's tab, in the Ideas page's colours: lavender for every film,
// mint for motion graphics, pink for video edits.
const TABS: Record<RuleScope, { tab: string; accent: string }> = {
  all: { tab: "#a79dff", accent: "#958aff" },
  motion: { tab: "#93e3b9", accent: "#5fd59c" },
  video: { tab: "#ffa6c8", accent: "#ff86b6" },
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
    // A page in the home's main panel. Each rule is a widget, like an idea
    // list on the Ideas page: a dark card tucked into a coloured tab that
    // says which films it applies to, in a grid of two.
    <section aria-labelledby="rules-heading" className="mx-auto flex w-full max-w-[920px] flex-col gap-8 px-8 pt-10 pb-20">
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
        <ul className="grid grid-cols-1 gap-x-5 gap-y-6 md:grid-cols-2">
          {rules.map((r, i) => {
            const look = TABS[r.scope] ?? TABS.all;
            return (
              <li key={r.id} className={cn("group/rule relative flex flex-col pt-7 transition-opacity", !r.on && "opacity-55")} style={{ "--accent": look.accent } as CSSProperties}>
                {/* The coloured tab behind the card's top, saying which films it's for. */}
                <div aria-hidden="true" className="absolute inset-x-0 top-0 h-16 rounded-t-[22px] px-4 pt-[6px] font-medium text-[12px] text-black/55" style={{ background: look.tab }}>
                  {SCOPES.find((s) => s.value === r.scope)?.label ?? "Every film"}
                </div>
                <div className="relative flex flex-1 flex-col overflow-hidden rounded-[22px] bg-[#1a1a1d] shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_18px_36px_-18px_rgba(0,0,0,0.8)]">
                  {/* A faint dot grid over the right of the card, fading in from the left. */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 right-0 w-3/5 [background-image:radial-gradient(rgba(255,255,255,0.075)_1px,transparent_1.3px)] [background-size:12px_12px] [mask-image:linear-gradient(to_right,transparent,#000_45%)]"
                  />
                  <div className="relative flex items-start gap-2 px-4 pt-4">
                    <input
                      data-rule-title={r.id}
                      value={r.title}
                      onChange={(e) => change(r.id, { title: e.target.value })}
                      placeholder="Calm motion"
                      aria-label={`Rule ${i + 1} name`}
                      className="-ms-1.5 h-9 min-w-0 flex-1 rounded-[8px] bg-transparent px-1.5 font-semibold text-[19px] text-white tracking-[-0.015em] outline-none placeholder:text-white/30 hover:bg-white/[0.04] focus:bg-white/[0.06]"
                    />
                    <span className="flex shrink-0 items-center gap-0.5 pt-1">
                      <button
                        type="button"
                        className={cn(
                          ICON_BUTTON,
                          "size-7 opacity-0 hover:bg-[#e5484d]/12 hover:text-[#ff9592] focus-visible:opacity-100 group-hover/rule:opacity-100 [&_svg]:size-3.5",
                        )}
                        onClick={() => remove(r)}
                        aria-label={`Delete rule ${i + 1}`}
                      >
                        <DeleteDustbin01Icon aria-hidden="true" />
                      </button>
                      <Slide
                        label={`Rule ${i + 1} on or off`}
                        value={r.on}
                        options={[
                          { value: false, label: "Off" },
                          { value: true, label: "On" },
                        ]}
                        onChange={(on) => change(r.id, { on })}
                        segment={34}
                      />
                    </span>
                  </div>
                  <textarea
                    value={r.body}
                    onChange={(e) => change(r.id, { body: e.target.value })}
                    placeholder="Keep every move slow and eased"
                    aria-label={`Rule ${i + 1}`}
                    rows={3}
                    className="relative mx-2.5 mt-1 mb-3 flex-1 resize-none rounded-[8px] bg-transparent px-1.5 py-1 text-[13px] text-white/65 leading-relaxed outline-none [field-sizing:content] placeholder:text-white/30 hover:bg-white/[0.03] focus:bg-white/[0.05]"
                  />
                  <div className="relative flex flex-wrap items-center gap-2 border-white/[0.06] border-t px-4 py-2.5">
                    <span className="text-[11.5px] text-white/35">Applies to</span>
                    <span className="ms-auto">
                      <Slide
                        label={`Rule ${i + 1} applies to`}
                        value={r.scope}
                        options={SCOPES}
                        onChange={(scope) => change(r.id, { scope })}
                        segment={96}
                      />
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
