"use client";

import { useEffect, useRef, useState } from "react";
import { DeleteDustbin01Icon, MultipleCrossCancelIcon, PlusIcon } from "@/components/icons";
import type { Rule, RuleScope } from "@/lib/studio/rules";
import { cn } from "@/lib/utils";
import { api, StudioError } from "./api";
import { CARD, ICON_BUTTON, PILL_BUTTON } from "./panel";

// The studio's standing rules: Claude follows them in every film unless a
// prompt says otherwise, and the whole team shares them. Each rule is a
// card you type straight into; changes save on their own.

const SCOPES: { value: RuleScope; label: string }[] = [
  { value: "all", label: "Every film" },
  { value: "motion", label: "Motion graphics" },
  { value: "video", label: "Video edits" },
];

export function RulesPanel({ onClose }: { onClose: () => void }) {
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
    // The card fits the window: its title and "Add a rule" stay put, and
    // only the rules scroll between them.
    <div data-backdrop="" className="absolute inset-0 flex items-center justify-center p-4 sm:p-8">
      <section aria-labelledby="rules-title" className={cn(CARD, "flex max-h-full w-full max-w-[600px] flex-col overflow-hidden")}>
        <header className="flex shrink-0 items-start gap-3 px-5 pt-5 pb-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id="rules-title" className="font-medium text-[15px] text-white/90">
              Studio rules
            </h2>
            <p className="text-[12.5px] text-white/50 leading-relaxed">
              Claude follows these in every film unless your prompt says otherwise. Everyone on the team shares them.
            </p>
          </div>
          <button type="button" className={cn(ICON_BUTTON, "-me-1.5 -mt-1")} onClick={onClose} aria-label="Close the rules">
            <MultipleCrossCancelIcon aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 [mask-image:linear-gradient(to_bottom,transparent,black_12px,black_calc(100%-12px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {rules === null ? (
            <p className="px-2 py-3 text-[12.5px] text-white/45">
              <span className="studio-shimmer">Loading the rules</span>
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rules.map((r, i) => (
                <li
                  key={r.id}
                  className={cn(
                    "group/rule flex flex-col rounded-[14px] bg-white/[0.035] py-3 ps-4 pe-2 transition-[opacity,background-color] hover:bg-white/[0.05]",
                    !r.on && "opacity-50",
                  )}
                >
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <input
                        data-rule-title={r.id}
                        value={r.title}
                        onChange={(e) => change(r.id, { title: e.target.value })}
                        placeholder="Name the rule"
                        aria-label={`Rule ${i + 1} name`}
                        className="-ms-1.5 h-7 min-w-0 flex-1 rounded-[7px] bg-transparent px-1.5 font-medium text-[13px] text-white/90 outline-none placeholder:text-white/30 hover:bg-white/[0.04] focus:bg-white/[0.06]"
                      />
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
                    </div>
                    <textarea
                      value={r.body}
                      onChange={(e) => change(r.id, { body: e.target.value })}
                      placeholder="What Claude should always do"
                      aria-label={`Rule ${i + 1}`}
                      rows={2}
                      className="-ms-1.5 me-1 resize-none rounded-[8px] bg-transparent px-1.5 py-1 text-[12.5px] text-white/65 leading-relaxed outline-none [field-sizing:content] placeholder:text-white/30 hover:bg-white/[0.03] focus:bg-white/[0.05]"
                    />
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <span className="text-[11.5px] text-white/35">Applies to</span>
                      <Slide
                        label={`Rule ${i + 1} applies to`}
                        value={r.scope}
                        options={SCOPES}
                        onChange={(scope) => change(r.id, { scope })}
                        segment={104}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="flex shrink-0 items-center gap-3 border-white/[0.06] border-t px-4 py-3">
          <button type="button" disabled={rules === null} onClick={add} className={cn(PILL_BUTTON, "text-white/75 hover:bg-white/[0.07] hover:text-white")}>
            <PlusIcon aria-hidden="true" />
            Add a rule
          </button>
          {removed ? (
            <p className="text-[12px] text-white/50" role="status">
              Rule deleted.{" "}
              <button type="button" onClick={undoRemove} className="cursor-pointer text-white/85 underline-offset-2 hover:underline">
                Undo
              </button>
            </p>
          ) : null}
          {problem ? <p className="text-[12px] text-[#ff9592]">{problem}</p> : null}
        </footer>
      </section>
    </div>
  );
}

// Options in a row with one highlight that slides to the chosen one.
// Segments share one width, so the highlight moves by whole segments.
function Slide<T extends string | boolean>({
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
            "relative cursor-pointer rounded-[7px] outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]",
            o.value === value ? "text-white" : "text-white/45 hover:text-white/75",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
