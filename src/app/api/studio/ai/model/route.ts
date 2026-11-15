import { aiChoice, saveAiChoice } from "@/lib/studio/agent/ai-env";
import { isEffort, isModelId, isProviderId } from "@/lib/studio/agent/ai-types";
import { allowed, refused } from "@/lib/studio/films/films";
import { forgetStatus } from "@/lib/studio/agent/providers";

// Which AI every prompt goes to, and the Claude model and effort it uses
// (ai-types.ts). GET says what's in use; PUT {model, effort, provider}
// chooses, from the next prompt on.

export async function GET(request: Request) {
  if (!allowed(request)) return refused();
  return Response.json(aiChoice());
}

export async function PUT(request: Request) {
  if (!allowed(request)) return refused();
  const body = (await request.json().catch(() => null)) as { model?: unknown; effort?: unknown; provider?: unknown } | null;
  if (!isModelId(body?.model) || !isEffort(body?.effort) || (body?.provider !== undefined && !isProviderId(body.provider))) {
    return Response.json({ error: "Pick one of the AIs, models and effort levels in Settings." }, { status: 400 });
  }
  saveAiChoice({ model: body.model, effort: body.effort, provider: isProviderId(body.provider) ? body.provider : aiChoice().provider });
  forgetStatus();
  return Response.json(aiChoice());
}
