import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrandKit } from "./brand";
import { checkKit, kitDir, readBrand, restoreBrand, snapshotBrand, withBrand, writeBrand } from "./brands";
import { CLAUDE_BIN, childEnv, explain, killGroup, MODEL, StreamReader } from "./claude";
import type { ChatEvent, ChatMessage, Film } from "./contract";
import { ROOT } from "./films";

// Claude building or tidying a brand kit: from the guideline files dropped
// into the kit (guide/: PDFs, screenshots; fonts/ and logos/) and, if
// given, one website. It may only write inside the kit's own folder, reads
// the Aerchain kit as an example of a full one, and may fetch pages only
// from that one website's domain. No shell.

const TURN_LIMIT_MS = 15 * 60 * 1000;
const history = (id: string) => path.join(kitDir(id), ".history");
const chatFile = (id: string) => path.join(history(id), "chat.json");
const sessionFile = (id: string) => path.join(history(id), "session");

type Running = { pid: number | null; stopped: boolean };
const g = globalThis as { __brandTurns?: Map<string, Running> };
const running = (g.__brandTurns ??= new Map());
export const isBrandRunning = (id: string) => running.has(id);

export async function readBrandChat(id: string): Promise<ChatMessage[]> {
  return JSON.parse(await readFile(chatFile(id), "utf8").catch(() => "[]")) as ChatMessage[];
}

async function addChat(id: string, message: ChatMessage) {
  await mkdir(history(id), { recursive: true });
  const chat = [...(await readBrandChat(id)), message];
  await writeFile(`${chatFile(id)}.tmp`, `${JSON.stringify(chat, null, 2)}\n`);
  await rename(`${chatFile(id)}.tmp`, chatFile(id));
}

export function stopBrandTurn(id: string) {
  const turn = running.get(id);
  if (!turn) return false;
  turn.stopped = true;
  if (turn.pid) killGroup(turn.pid);
  return true;
}

// Only http(s) websites; the domain it may fetch from.
export function siteOf(url: string | undefined): URL | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".") ? u : null;
  } catch {
    return null;
  }
}

export async function runBrandTurn(id: string, prompt: string, url: URL | null, emit: (event: ChatEvent) => void) {
  if (running.has(id)) {
    emit({ kind: "error", message: "Claude is still working on this kit. Wait for it, or stop it first." });
    return;
  }
  const turn: Running = { pid: null, stopped: false };
  running.set(id, turn);
  try {
    await brandTurn(id, prompt, url, turn, emit);
  } catch (error) {
    emit({ kind: "error", message: `Something went wrong: ${String((error as Error)?.message ?? error)}` });
  } finally {
    running.delete(id);
  }
}

async function brandTurn(id: string, prompt: string, url: URL | null, turn: Running, emit: (event: ChatEvent) => void) {
  const kit = await readBrand(id);
  if (!kit) {
    emit({ kind: "error", message: "That kit no longer exists." });
    return;
  }
  const n = await withBrand(id, () => snapshotBrand(id));
  emit({ kind: "start", turn: n });
  await addChat(id, { role: "you", text: url ? `${prompt}\n\n${url.href}` : prompt, at: new Date().toISOString() });

  const dir = kitDir(id);
  const session = (await readFile(sessionFile(id), "utf8").catch(() => "")).trim() || undefined;
  const args = brandArgs(id, session, url);
  const proc = spawn(CLAUDE_BIN, args, { cwd: dir, env: childEnv(), stdio: ["pipe", "pipe", "pipe"], detached: true });
  turn.pid = proc.pid ?? null;
  if (turn.stopped && proc.pid) killGroup(proc.pid);
  proc.stdin.end(
    [
      `<kit>${path.join(dir, "brand.json")}, named "${kit.name}".</kit>`,
      url ? `<website>${url.href} (you may fetch pages from ${url.hostname} only)</website>` : "",
      `<request>\n${prompt}\n</request>`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  let timedOut = false;
  const limit = setTimeout(() => {
    turn.stopped = true;
    timedOut = true;
    if (proc.pid) killGroup(proc.pid);
  }, TURN_LIMIT_MS);

  const reader = new StreamReader(dir, emit);
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
  let buffer = "";
  proc.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        reader.handle(JSON.parse(line));
      } catch {}
    }
  });
  const code = await new Promise<number | null>((resolve) => {
    proc.on("close", resolve);
    proc.on("error", (e) => {
      stderr += String(e);
      resolve(-1);
    });
  });
  clearTimeout(limit);
  if (reader.session) await writeFile(sessionFile(id), reader.session);

  // Whatever Claude wrote is checked like any save; anything that doesn't
  // fit the kit's shape is reported, and Undo puts the kit back.
  let problem: string | null = null;
  const after = await withBrand(id, async () => {
    const raw = await readFile(path.join(dir, "brand.json"), "utf8").catch(() => null);
    const parsed = raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : null;
    const checked = parsed ? checkKit(id, parsed, kit) : "brand.json is missing or isn't valid JSON.";
    if (typeof checked === "string") {
      problem = `The kit Claude wrote doesn't check out (${checked}) Undo puts it back.`;
      return null;
    }
    await writeBrand(checked);
    return checked;
  });
  if (!reader.changedAny) await rm(path.join(history(id), String(n)), { recursive: true, force: true });

  const failure = turn.stopped ? null : (reader.failure ?? (code !== 0 ? explain(stderr || reader.lastError || "") : null));
  const text = reader.reply.trim();
  await addChat(id, {
    role: "claude",
    text: turn.stopped ? (text ? `${text}\n\n(Stopped.)` : "Stopped.") : text || failure || problem || "Done.",
    at: new Date().toISOString(),
    steps: reader.steps,
  });
  if (timedOut) emit({ kind: "error", message: "Claude took longer than 15 minutes, so the studio stopped it. Undo puts the kit back." });
  else if (turn.stopped) emit({ kind: "error", message: "Stopped. Anything Claude had already changed is kept; Undo puts it back." });
  else if (failure || problem) emit({ kind: "error", message: (failure ?? problem) as string });
  // For a kit, `done` carries the kit as it is now (in the `film` field).
  emit({ kind: "done", film: (after ?? kit) as unknown as Film });
}

export async function undoBrand(id: string): Promise<BrandKit | null> {
  const kit = await withBrand(id, () => restoreBrand(id));
  if (kit) await addChat(id, { role: "you", text: "Undo the last change.", at: new Date().toISOString() });
  return kit;
}

function brandArgs(id: string, session: string | undefined, url: URL | null) {
  const dir = kitDir(id);
  const root = `/${ROOT}`;
  const allow = [
    `Edit(/${dir}/**)`,
    `Read(/${dir}/**)`,
    `Read(${root}/studio/brands/**)`,
    `Read(${root}/src/lib/studio/brand.ts)`,
    `Read(${root}/.claude/skills/**)`,
    "Skill",
    "TodoWrite",
    ...(url ? [`WebFetch(domain:${url.hostname})`] : []),
  ];
  const deny = [`Edit(/${dir}/.history/**)`, `Read(${root}/**/.env*)`];
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model", MODEL,
    "--effort", "high",
    "--permission-mode", "dontAsk",
    "--setting-sources", "project,local",
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--tools", `Read,Edit,Write,Glob,Grep,Skill,TodoWrite${url ? ",WebFetch" : ""}`,
    "--allowedTools", ...allow,
    "--disallowedTools", ...deny,
    "--append-system-prompt", systemPrompt(id),
  ];
  if (session) args.push("--resume", session);
  return args;
}

function systemPrompt(id: string) {
  const dir = kitDir(id);
  return `You build brand kits inside Aerchain's motion studio, an internal tool. A brand kit is everything that makes a film look, move and sound like its brand. The person you work with is a visual designer.

The kit is ${dir}/ and the shell is already in it. Write only inside it. Its shape is BrandKit in ${path.join(ROOT, "src/lib/studio/brand.ts")}: read that first. A complete example is the Aerchain kit at ${path.join(ROOT, "studio/brands/aerchain/brand.json")}.

What you have: guide/ holds what the person dropped in (guideline PDFs, screenshots, notes); fonts/ and logos/ hold their font and logo files. Read PDFs and images directly. If a website is given you may fetch pages from that one domain; nothing else on the web.

Build brand.json from them: colour roles (background, surface, ink, muted, accent, onAccent, line) and the brand's full ramps with exact hex values; fonts (each file in fonts/ with family, role, weights); logos (each file in logos/ with kind and the ground it is drawn for); rules in four short lists (visual, motion, sound, words), one plain sentence each, in the brand's own words where it has them; texture (stroke and gap in px at 1080p) only if the brand has a line or grid system; and notes, a thorough Markdown guideline for whoever designs films with the kit. Only write what the sources show or clearly imply; where you infer (motion, sound), say so in notes. Never invent hex values: if a colour isn't given, sample it from a logo or screenshot and say you did. Keep "id" as "${id}". No shell commands are available.

How to reply: work quietly, then end with two or three plain sentences on what the kit now holds and anything you couldn't find. Never use em dashes.`;
}
