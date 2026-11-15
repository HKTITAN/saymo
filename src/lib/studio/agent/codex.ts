import { type ChildProcess, spawn } from "node:child_process";
import { chmod, lstat, mkdir, readdir, readFile, readlink, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { aiChoice, childEnv, codexBin, killGroup } from "./ai-env";
import type { ChatEvent } from "../films/contract";
import { STUDIO_DIR } from "../connect/connect-store";
import { filmDir, ROOT } from "../films/films";
import { CODEX_MODEL } from "./providers";

// A film's turn on OpenAI's Codex CLI, signed in with the person's ChatGPT
// plan. The same job as a Claude turn (see claude.ts), with Codex's own
// safety rails instead of Claude Code's permission lists:
//
//  - Codex runs with its own home, .studio/codex/<film>/, so the person's
//    Codex settings, plugins, MCP servers and hooks never load. Its sign-in
//    is reached through a link to Codex's own auth.json (as Pond does); the
//    studio never reads, copies or prints it.
//  - Every command Codex runs is in macOS's sandbox under a permission
//    profile: it may write only this film's folder (footage, attachments and
//    history stay read-only) and the film's work folder; it may not read
//    .env files, the studio's connections, or other films; no network.
//  - It never asks for approval (there's no one to ask), so anything outside
//    those rules simply fails.
//
// Each film keeps one Codex conversation (its thread id in .history/), so a
// second prompt carries on from the first.

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type CodexTurn = { proc: ChildProcess | null; stopped: boolean };

export type CodexOutcome = {
  code: number | null;
  thread: string | undefined;
  lost: boolean; // the old thread couldn't be found: start a new one next time
  reply: string;
  steps: string[];
  changedAny: boolean;
  problem: string | null;
  raw: string; // Codex's own error words, for spotting a usage limit
};

const homeOf = (id: string) => path.join(STUDIO_DIR, "codex", id);
const threadFile = (id: string) => path.join(filmDir(id), ".history", "codex.json");
export const codexWorkDir = (id: string) => path.join(ROOT, "films/.work", id);

export async function readThread(id: string): Promise<string | undefined> {
  try {
    const saved = JSON.parse(await readFile(threadFile(id), "utf8")) as { thread?: unknown };
    return typeof saved.thread === "string" ? saved.thread : undefined;
  } catch {
    return undefined;
  }
}

export async function writeThread(id: string, thread: string | undefined) {
  if (!thread) {
    await rm(threadFile(id), { force: true });
    return;
  }
  await mkdir(path.dirname(threadFile(id)), { recursive: true });
  await writeFile(`${threadFile(id)}.tmp`, `${JSON.stringify({ thread }, null, 2)}\n`);
  await rename(`${threadFile(id)}.tmp`, threadFile(id));
}

// Codex features a film turn has no use for, all off. (Unknown names would
// stop Codex under --strict-config; these were checked against Codex 0.166.
// Web search is off through `web_search` below.)
const FEATURES_OFF = ["apps", "plugins", "hooks", "multi_agent", "image_generation", "standalone_web_search", "computer_use", "browser_use", "goals"];

const toml = (value: string) => JSON.stringify(value); // a JSON string is a valid TOML basic string

// The film's Codex settings, written fresh before each turn.
export function codexConfig(id: string, instructions: string) {
  const dir = filmDir(id);
  const home = homedir();
  const denied = [
    path.join(ROOT, ".studio"),
    path.join(ROOT, ".env*"),
    path.join(ROOT, "films"), // other films; this one is allowed below
    path.join(home, ".codex"),
    path.join(home, ".claude"),
    path.join(home, ".claude.json"),
    path.join(home, ".ssh"),
    path.join(home, ".aws"),
    path.join(home, ".config/gh"),
    path.join(home, ".netrc"),
    path.join(home, ".npmrc"),
  ];
  return [
    "# Written by Saymo before each Codex turn. Not the person's own Codex settings.",
    'approval_policy = "never"',
    'default_permissions = "studio"',
    'cli_auth_credentials_store = "file"',
    'forced_login_method = "chatgpt"',
    'web_search = "disabled"',
    // Codex's own scale tops out at high.
    `model_reasoning_effort = ${toml(["low", "medium", "high"].includes(aiChoice().effort) ? aiChoice().effort : "high")}`,
    `developer_instructions = ${toml(instructions)}`,
    "",
    "[features]",
    ...FEATURES_OFF.map((f) => `${f} = false`),
    "",
    "[permissions.studio]",
    'extends = ":read-only"',
    "",
    "[permissions.studio.filesystem]",
    ...denied.map((p) => `${toml(p)} = "deny"`),
    `${toml(dir)} = "read"`,
    `${toml(codexWorkDir(id))} = "write"`,
    "",
    '[permissions.studio.filesystem.":workspace_roots"]',
    '"." = "write"',
    // What they brought in and the studio's own records: read, never changed.
    '"media" = "read"',
    '"refs" = "read"',
    '".history" = "read"',
    '"out" = "read"',
    '"build.rs" = "read"',
    "",
  ].join("\n");
}

// Codex's own folder for this film, with a link to its sign-in and the
// settings above.
async function prepareHome(id: string, instructions: string) {
  const home = homeOf(id);
  await mkdir(home, { recursive: true, mode: 0o700 });
  await chmod(path.join(STUDIO_DIR, "codex"), 0o700).catch(() => {});
  await chmod(home, 0o700).catch(() => {});
  const source = path.join(process.env.CODEX_HOME ?? path.join(homedir(), ".codex"), "auth.json");
  const link = path.join(home, "auth.json");
  const linked = await lstat(link).then(
    async (s) => s.isSymbolicLink() && (await readlink(link)) === source,
    () => false,
  );
  if (!linked) {
    await rm(link, { force: true });
    await symlink(source, link);
  }
  await writeFile(path.join(home, "config.toml"), codexConfig(id, instructions), { mode: 0o600 });
  return home;
}

// ─── Running a turn ──────────────────────────────────────────────────────────

export async function runCodex(o: {
  id: string;
  message: string;
  instructions: string;
  thread: string | undefined;
  turn: CodexTurn;
  emit: (event: ChatEvent) => void;
  log: (line: string) => void;
  stepFor: (kind: "command" | "edit", detail: string) => string | null;
}): Promise<CodexOutcome> {
  const dir = filmDir(o.id);
  const bin = codexBin();
  const empty = { thread: o.thread, lost: false, reply: "", steps: [], changedAny: false, raw: "" };
  if (!bin) return { ...empty, code: -1, problem: "Codex isn't installed on this Mac. Open Connections, then AI, for the set-up steps." };

  const home = await prepareHome(o.id, o.instructions);
  const tmp = path.join(codexWorkDir(o.id), "tmp");
  await mkdir(tmp, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...childEnv(),
    CODEX_HOME: home,
    TMPDIR: tmp,
    PATH: [path.dirname(bin), childEnv().PATH].filter(Boolean).join(path.delimiter),
  };
  const common = ["--json", "--skip-git-repo-check", "--strict-config", "--ignore-rules", ...(CODEX_MODEL ? ["-m", CODEX_MODEL] : [])];
  const args = o.thread ? ["exec", "resume", ...common, o.thread, "-"] : ["exec", ...common, "--color", "never", "-"];
  o.log(JSON.stringify({ type: "studio_command", bin, args }));

  const proc = spawn(bin, args, { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"], detached: true });
  o.turn.proc = proc;
  if (o.turn.stopped && proc.pid) killGroup(proc.pid);
  proc.stdin.on("error", () => {});
  proc.stdin.end(o.message);

  const reader = new CodexReader(dir, o.emit, o.stepFor);
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
      o.log(line);
      try {
        reader.handle(JSON.parse(line));
      } catch {}
    }
  });
  const code = await new Promise<number | null>((resolve) => {
    proc.on("close", (c) => resolve(c));
    proc.on("error", (error) => {
      stderr += String(error);
      resolve(-1);
    });
  });
  await reader.settle();

  const lost = Boolean(o.thread) && code !== 0 && !reader.thread && /(no|unknown|missing)[^\n]{0,40}(rollout|session|thread|conversation)|(rollout|session|thread|conversation)[^\n]{0,40}not found/i.test(stderr);
  const problem = o.turn.stopped
    ? null
    : lost
      ? "Codex couldn't pick up the earlier conversation about this film, so the next message starts a new one. Send it again."
      : (reader.failure ?? (code !== 0 ? explainCodex(stderr || reader.lastError || "") : null));
  return {
    code,
    thread: lost ? undefined : (reader.thread ?? o.thread),
    lost,
    reply: reader.reply,
    steps: reader.steps,
    changedAny: reader.changedAny,
    problem,
    raw: [reader.failureRaw, reader.failure, reader.lastError, stderr].filter(Boolean).join("\n"),
  };
}

// ─── Reading Codex's events ──────────────────────────────────────────────────

// Codex can change files with its patch tool or with a shell command, so
// rather than trust either, the film's folder is compared before and after
// each step: what's new or different is what changed.
const SKIP = new Set([".history", "out", "node_modules", "target", ".hyperframes", ".thumbnails"]);

async function fingerprint(dir: string): Promise<Map<string, string>> {
  const seen = new Map<string, string>();
  const walk = async (at: string, depth: number) => {
    if (depth > 6) return;
    const entries = await readdir(at, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const full = path.join(at, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (e.isFile()) {
        const s = await stat(full).catch(() => null);
        if (s) seen.set(path.relative(dir, full), `${s.size}:${s.mtimeMs}`);
      }
    }
  };
  await walk(dir, 0);
  return seen;
}

export class CodexReader {
  thread: string | undefined;
  reply = "";
  steps: string[] = [];
  failure: string | null = null;
  failureRaw: string | null = null; // Codex's own words when it failed
  lastError: string | null = null;
  changedAny = false;
  private before: Promise<Map<string, string>>;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private dir: string,
    private emit: (event: ChatEvent) => void,
    private stepFor: (kind: "command" | "edit", detail: string) => string | null,
  ) {
    this.before = fingerprint(dir);
  }

  handle(msg: Json) {
    switch (msg.type) {
      case "thread.started":
        if (typeof msg.thread_id === "string") this.thread = msg.thread_id;
        return;
      case "item.started":
        return this.started(msg.item ?? {});
      case "item.completed":
        return this.completed(msg.item ?? {});
      case "turn.failed":
        this.failureRaw = String(msg.error?.message ?? "the turn failed");
        this.failure = explainCodex(this.failureRaw);
        return;
      case "error":
        this.lastError = String(msg.message ?? "");
        return;
    }
  }

  // Waits for the last comparison of the film's folder.
  async settle() {
    this.compare();
    await this.chain;
  }

  private step(label: string | null) {
    if (label && this.steps.at(-1) !== label) {
      this.steps.push(label);
      this.emit({ kind: "step", label });
    }
  }

  private started(item: Json) {
    if (item.type === "command_execution") this.step(this.stepFor("command", String(item.command ?? "")));
    else if (item.type === "file_change") {
      const first = Array.isArray(item.changes) ? String(item.changes[0]?.path ?? "") : "";
      this.step(this.stepFor("edit", first));
    }
  }

  private completed(item: Json) {
    if (item.type === "agent_message" && typeof item.text === "string" && item.text.trim()) {
      const text = (this.reply ? "\n\n" : "") + item.text.trim();
      this.reply += text;
      this.emit({ kind: "text", text });
      return;
    }
    if (item.type === "file_change" && item.status !== "failed") {
      const first = Array.isArray(item.changes) ? String(item.changes[0]?.path ?? "") : "";
      this.step(this.stepFor("edit", first));
    }
    if (item.type === "command_execution" || item.type === "file_change") this.compare();
  }

  private compare() {
    this.chain = this.chain.then(async () => {
      const [was, now] = [await this.before, await fingerprint(this.dir)];
      const files = [...now.keys()].filter((f) => was.get(f) !== now.get(f));
      const gone = [...was.keys()].filter((f) => !now.has(f));
      this.before = Promise.resolve(now);
      const changed = [...files, ...gone];
      if (!changed.length) return;
      this.changedAny = true;
      this.emit({ kind: "changed", files: changed });
    });
  }
}

// Plain-English versions of the ways a Codex turn can fail.
export function explainCodex(raw: string) {
  const text = raw.toLowerCase();
  if (/not logged in|log ?in|unauthori[sz]ed|401|authenticat|token (has )?expired|refresh token/.test(text)) {
    return "Codex isn't signed in on this Mac. In Terminal, run codex login and sign in with ChatGPT.";
  }
  if (/usage limit|rate limit|limit reached|too many requests|429|quota/.test(text)) {
    return "Your ChatGPT plan's Codex limit is reached for now. Try again later, or switch this film to Claude.";
  }
  if (/model[^\n]{0,60}(not (found|supported|available)|does not exist)/.test(text)) {
    return "Codex can't use that model on this plan. Remove STUDIO_CODEX_MODEL from .env.local to use Codex's own.";
  }
  if (/overloaded|503|502|server error|stream disconnected/.test(text)) return "Codex is busy right now. Try again in a minute.";
  if (/enoent|command not found|spawn/.test(text)) return "Codex isn't installed where the studio can find it. Open Connections, then AI, for the set-up steps.";
  const firstLine = raw.trim().split("\n").find(Boolean);
  return firstLine ? `Codex stopped with an error: ${firstLine.slice(0, 200)}` : "Codex stopped without saying why. Try again.";
}
