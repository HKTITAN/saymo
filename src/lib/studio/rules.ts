import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Film } from "./contract";
import { ROOT } from "./films";

// The studio's standing rules: what Claude follows in every film unless a
// request says otherwise. Kept in studio/rules.json, tracked in git, so the
// whole team shares one set. Edited on the studio home page.

export type RuleScope = "all" | "motion" | "video";
export type Rule = { id: string; title: string; body: string; scope: RuleScope; on: boolean };

const FILE = path.join(ROOT, "studio/rules.json");
const SCOPES: RuleScope[] = ["all", "motion", "video"];

export async function readRules(): Promise<Rule[]> {
  try {
    const raw = JSON.parse(await readFile(FILE, "utf8")) as unknown;
    return Array.isArray(raw) ? raw.map(clean).filter((r): r is Rule => r !== null) : [];
  } catch {
    return [];
  }
}

export function clean(raw: unknown): Rule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && /^[a-z0-9-]{1,40}$/.test(r.id) ? r.id : null;
  if (!id) return null;
  return {
    id,
    title: typeof r.title === "string" ? r.title.slice(0, 120) : "",
    body: typeof r.body === "string" ? r.body.slice(0, 2000) : "",
    scope: SCOPES.includes(r.scope as RuleScope) ? (r.scope as RuleScope) : "all",
    on: r.on !== false,
  };
}

export async function writeRules(rules: Rule[]) {
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, `${JSON.stringify(rules.slice(0, 40), null, 2)}\n`);
  await rename(tmp, FILE);
}

// The rules that apply to this film, for Claude's turn message.
export function rulesNote(rules: Rule[], kind: Film["kind"]): string {
  const apply = rules.filter((r) => r.on && (r.title.trim() || r.body.trim()) && (r.scope === "all" || r.scope === kind));
  if (!apply.length) return "";
  const list = apply.map((r, i) => `${i + 1}. ${r.title.trim()}${r.title.trim() && r.body.trim() ? ": " : ""}${r.body.trim()}`);
  return `<studio-rules>\nThe studio's standing rules for every film. Follow them unless this request says otherwise, and check the film against them before you finish:\n${list.join("\n")}\n</studio-rules>`;
}
