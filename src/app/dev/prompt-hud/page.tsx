import { notFound } from "next/navigation";
import { PromptHudBench } from "@/components/studio/prompt-hud-bench";

// A bench for the prompt box cut like hardware. Development only.
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PromptHudBench />;
}
