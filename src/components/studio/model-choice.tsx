"use client";

import { useState } from "react";
import { DialNote, LABEL, ROW } from "@/components/tool/dial";
import { type AiChoice, EFFORTS, MODELS } from "@/lib/studio/ai-types";
import { aiApi, useAiChoice } from "./ai-api";
import { StudioError } from "./api";
import { Slide } from "./rules-panel";

// Settings: which Claude model makes the changes, and how hard it thinks.
// Used by every Claude turn from the next prompt on, with your plan or an
// API key alike; Codex keeps its own model.

export function ModelChoice() {
  const choice = useAiChoice();
  const [error, setError] = useState<string | null>(null);
  const save = (next: AiChoice) => {
    setError(null);
    aiApi.saveChoice(next).catch((e) => setError(e instanceof StudioError ? e.message : "Unable to save that. Try again."));
  };
  const model = MODELS.find((m) => m.id === choice.model);
  return (
    <div className="flex flex-col gap-1.5">
      <div className={`${ROW} gap-3 ps-3 pe-1`}>
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
      <div className={`${ROW} gap-3 ps-3 pe-1`}>
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
      <DialNote>
        {error ? (
          <span className="text-[#ff9592]">{error}</span>
        ) : (
          <>
            {model ? `${model.name}: ${model.note.charAt(0).toLowerCase()}${model.note.slice(1)} ` : ""}Higher effort thinks longer and uses more of your plan. Changes apply from your next prompt, in every film.
          </>
        )}
      </DialNote>
    </div>
  );
}
