"use client";

import { useState } from "react";
import { DialNote, LABEL, ROW } from "@/components/tool/dial";
import { type AiChoice, EFFORTS, MODELS, OFFERED_PROVIDERS, type ProviderId } from "@/lib/studio/ai-types";
import { cn } from "@/lib/utils";
import { aiApi, useAiChoice } from "./ai-api";
import { SelectedAi } from "./ai-connections";
import { StudioError } from "./api";
import { Slide } from "./rules-panel";

// Settings' AI card: which AI every prompt goes to and whether it's ready,
// then, for Claude, which model and how hard it thinks. Used from the next
// prompt on, in every film (there's no picker in the prompt boxes).

const AI_NAMES: Record<ProviderId, string> = { claude: "Claude plan", codex: "Codex", "api-key": "API key" };

export function ModelChoice() {
  const choice = useAiChoice();
  const [error, setError] = useState<string | null>(null);
  const save = (next: AiChoice) => {
    setError(null);
    aiApi.saveChoice(next).catch((e) => setError(e instanceof StudioError ? e.message : "Unable to save that. Try again."));
  };
  const model = MODELS.find((m) => m.id === choice.model);
  const codex = choice.provider === "codex";
  return (
    <div className="flex flex-col gap-1.5">
      {OFFERED_PROVIDERS.length > 1 ? (
        <div className={cn(ROW, "gap-3 ps-3 pe-1")}>
          <span className={LABEL}>Prompts go to</span>
          <span className="ms-auto">
            <Slide
              label="Prompts go to"
              value={choice.provider as string}
              options={OFFERED_PROVIDERS.map((id) => ({ value: id as string, label: AI_NAMES[id] }))}
              onChange={(id) => save({ ...choice, provider: id as ProviderId })}
              segment={96}
            />
          </span>
        </div>
      ) : null}
      <SelectedAi provider={choice.provider} />
      {codex ? null : (
        <>
          <div className={cn(ROW, "mt-1 gap-3 ps-3 pe-1")}>
            <span className={LABEL}>Model</span>
            <span className="ms-auto">
              <Slide
                label="Model"
                value={choice.model}
                options={MODELS.map((m) => ({ value: m.id as string, label: m.name }))}
                onChange={(id) => save({ ...choice, model: id })}
                segment={84}
              />
            </span>
          </div>
          <div className={cn(ROW, "gap-3 ps-3 pe-1")}>
            <span className={LABEL}>Effort</span>
            <span className="ms-auto">
              <Slide
                label="Effort"
                value={choice.effort}
                options={EFFORTS.map((e) => ({ value: e.id as string, label: e.name }))}
                onChange={(id) => save({ ...choice, effort: id })}
                segment={72}
              />
            </span>
          </div>
        </>
      )}
      <DialNote>{error ? <span className="text-[#ff9592]">{error}</span> : codex ? "Codex picks its own model." : (model?.note ?? null)}</DialNote>
    </div>
  );
}
