import { aiChoice, saveAiChoice } from "@/lib/studio/ai-env";
import { isEffort, isModelId } from "@/lib/studio/ai-types";
import { allowed, refused } from "@/lib/studio/films";
import { forgetStatus } from "@/lib/studio/providers";

// Which Claude model and effort every turn uses (ai-types.ts MODELS and
// EFFORTS). GET says what's in use; PUT {model, effort} chooses, from the
// next prompt on.

export async function GET(request: Request) {
  if (!allowed(request)) return refused();
  return Response.json(aiChoice());
}

export async function PUT(request: Request) {
  if (!allowed(request)) return refused();
  const body = (await request.json().catch(() => null)) as { model?: unknown; effort?: unknown } | null;
  if (!isModelId(body?.model) || !isEffort(body?.effort)) {
    return Response.json({ error: "Pick one of the models and effort levels in Settings." }, { status: 400 });
  }
  saveAiChoice({ model: body.model, effort: body.effort });
  forgetStatus();
  return Response.json(aiChoice());
}
