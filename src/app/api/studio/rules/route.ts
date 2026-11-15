import { allowed, refused } from "@/lib/studio/films/films";
import { clean, readRules, type Rule, writeRules } from "@/lib/studio/agent/rules";

// The studio's standing rules, read on the home page and in every film turn.
export async function GET(request: Request) {
  if (!allowed(request)) return refused();
  return Response.json({ rules: await readRules() });
}

export async function PUT(request: Request) {
  if (!allowed(request)) return refused();
  const body = (await request.json().catch(() => null)) as { rules?: unknown; known?: unknown } | null;
  if (!Array.isArray(body?.rules)) return Response.json({ error: "Send the rules as a list." }, { status: 400 });
  const sent = body.rules.map(clean).filter((r): r is Rule => r !== null);
  // A page only changes the rules it has seen: rules added since it loaded
  // (by a teammate, or by Claude) are kept, after its own.
  const known = new Set(Array.isArray(body.known) ? body.known.filter((k): k is string => typeof k === "string") : sent.map((r) => r.id));
  const added = (await readRules()).filter((r) => !known.has(r.id) && !sent.some((s) => s.id === r.id));
  const rules = [...sent, ...added];
  await writeRules(rules);
  return Response.json({ rules });
}
