import { failed } from "@/lib/studio/connect/connect-http";
import { allowed, refused } from "@/lib/studio/films/films";
import { aiStatus, removeApiKey, saveApiKey } from "@/lib/studio/agent/providers";

// The Anthropic API key, for teammates without a Claude plan. It's saved on
// this Mac only (.studio/connections/anthropic.json, mode 600) and never
// sent back: the answer is the AI status, which shows at most its last 4
// characters.

export async function POST(request: Request) {
  if (!allowed(request)) return refused();
  try {
    const body = (await request.json().catch(() => null)) as { key?: unknown } | null;
    await saveApiKey(body?.key);
    return Response.json(await aiStatus(true), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return failed(error);
  }
}

export async function DELETE(request: Request) {
  if (!allowed(request)) return refused();
  try {
    await removeApiKey();
    return Response.json(await aiStatus(true), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return failed(error);
  }
}
