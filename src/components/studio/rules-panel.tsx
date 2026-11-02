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

  useEffect(() => {
    api
      .rules()
      .then(setRules)
      .catch(() => setProblem("Unable to load the rules. Reload the page to try again."));
  }, []);

  const save = (next: Rule[]) => {
    setRules(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api
        .saveRules(next)
        .then(() => setProblem(null))
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
    <div className="absolute inset-0 flex items-start justify-center overflow-y-auto px-4 pt-16 pb-12 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <section aria-labelledby="rules-title" className={cn(CARD, "relative flex w-full max-w-[620px] flex-col gap-4 p-5 pb-4")}>
        <header className="flex items-start gap-3">
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

        {rules === null ? (
          <p className="text-[12.5px] text-white/45">
            <span className="studio-shimmer">Loading the rules</span>
          </p>
        ) : (
          <ol className="flex flex-col gap-2.5">
            {rules.map((r, i) => (
              <li key={r.id} className={cn("group/rule flex flex-col gap-2 rounded-[14px] bg-white/[0.04] p-3 pe-2 transition-opacity", !r.on && "opacity-55")}>
                <div className="flex items-center gap-2">
                  <span className="w-5 shrink-0 font-mono text-[12px] text-white/35 tabular-nums">{i + 1}.</span>
                  <input
                    data-rule-title={r.id}
                    value={r.title}
                    onChange={(e) => change(r.id, { title: e.target.value })}
                    placeholder="Name the rule"
                    aria-label={`Rule ${i + 1} name`}
                    className="h-7 min-w-0 flex-1 rounded-[7px] bg-transparent px-1.5 font-medium text-[13px] text-white/90 outline-none placeholder:text-white/30 hover:bg-white/[0.04] focus:bg-white/[0.06]"
                  />
                  <div role="radiogroup" aria-label={`Rule ${i + 1} on or off`} className="flex h-7 shrink-0 items-center rounded-[8px] bg-white/[0.04] p-0.5 text-[11.5px]">
                    {[false, true].map((v) => (
                      <button
                        key={String(v)}
                        type="button"
                        role="radio"
                        aria-checked={r.on === v}
                        onClick={() => change(r.id, { on: v })}
                        className={cn("h-6 cursor-pointer rounded-[6px] px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring", r.on === v ? "bg-white/[0.12] text-white" : "text-white/45 hover:text-white/75")}
                      >
                        {v ? "On" : "Off"}
                      </button>
                    ))}
                  </div>
                  <button type="button" className={cn(ICON_BUTTON, "size-7 opacity-0 group-hover/rule:opacity-100 focus-visible:opacity-100 [&_svg]:size-3.5")} onClick={() => remove(r)} aria-label={`Delete rule ${i + 1}`}>
                    <DeleteDustbin01Icon aria-hidden="true" />
                  </button>
                </div>
                <textarea
                  value={r.body}
                  onChange={(e) => change(r.id, { body: e.target.value })}
                  placeholder="What Claude should always do"
                  aria-label={`Rule ${i + 1}`}
                  rows={2}
                  className="ms-7 me-1 resize-none rounded-[8px] bg-transparent px-1.5 py-1 text-[12.5px] text-white/70 leading-relaxed outline-none [field-sizing:content] placeholder:text-white/30 hover:bg-white/[0.03] focus:bg-white/[0.05]"
                />
                <div role="radiogroup" aria-label={`Rule ${i + 1} applies to`} className="ms-7 flex flex-wrap gap-1">
                  {SCOPES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      role="radio"
                      aria-checked={r.scope === s.value}
                      onClick={() => change(r.id, { scope: s.value })}
                      className={cn("h-6 cursor-pointer rounded-[7px] px-2 text-[11.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring", r.scope === s.value ? "bg-white/[0.1] text-white/85" : "text-white/40 hover:bg-white/[0.04] hover:text-white/70")}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}

        <div className="flex items-center gap-3">
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
        </div>
      </section>
    </div>
  );
}
