import { allowed, refused } from "@/lib/studio/films";
import { clean, readRules, type Rule, writeRules } from "@/lib/studio/rules";

// The studio's standing rules, read on the home page and in every film turn.
export async function GET(request: Request) {
  if (!allowed(request)) return refused();
  return Response.json({ rules: await readRules() });
}

export async function PUT(request: Request) {
  if (!allowed(request)) return refused();
  const body = (await request.json().catch(() => null)) as { rules?: unknown } | null;
  if (!Array.isArray(body?.rules)) return Response.json({ error: "Send the rules as a list." }, { status: 400 });
  const rules = body.rules.map(clean).filter((r): r is Rule => r !== null);
  await writeRules(rules);
  return Response.json({ rules });
}
