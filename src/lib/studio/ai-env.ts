import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { type AiChoice, DEFAULT_CHOICE, isEffort, isModelId, isProviderId } from "./ai-types";
import { homedir } from "node:os";
import path from "node:path";

// What every AI the studio runs shares: which programs, which model, and the
// clean environment each one starts in. Kept apart from claude.ts so the
// providers and Codex can use it without importing the whole turn runner.

// Everyone's studio uses the same Claude by default: Opus 5.5 at high effort,
// named exactly so an older alias can't pick an older model on someone's Mac.
// STUDIO_MODEL and STUDIO_EFFORT in .env.local change it for one machine.
// The choice made in Settings (.studio/ai-model.json) wins over both, and is
// read again for every turn, so a change applies to the next prompt.
export const MODEL = process.env.STUDIO_MODEL ?? DEFAULT_CHOICE.model;
export const EFFORT = process.env.STUDIO_EFFORT ?? DEFAULT_CHOICE.effort;

const choiceFile = () => path.join(process.cwd(), ".studio", "ai-model.json");

export function aiChoice(): AiChoice & { chosen: boolean } {
  try {
    const saved = JSON.parse(readFileSync(choiceFile(), "utf8")) as Partial<AiChoice>;
    const provider = isProviderId(saved.provider) ? saved.provider : DEFAULT_CHOICE.provider;
    if (isModelId(saved.model) && isEffort(saved.effort)) return { model: saved.model, effort: saved.effort, provider, chosen: true };
    return { model: MODEL, effort: EFFORT, provider, chosen: true };
  } catch {
    // Nothing chosen yet: the environment's, else the default.
  }
  return { model: MODEL, effort: EFFORT, provider: DEFAULT_CHOICE.provider, chosen: false };
}

export function saveAiChoice(choice: AiChoice) {
  const dir = path.dirname(choiceFile());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${choiceFile()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ model: choice.model, effort: choice.effort, provider: choice.provider }, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, choiceFile());
  chmodSync(choiceFile(), 0o600);
}

// Claude Code's own install, not the `claude` shell function some people
// have in zsh: spawn() never sees shell functions, so the real file is used.
export const CLAUDE_BIN = (() => {
  const own = path.join(homedir(), ".local/bin/claude");
  return process.env.STUDIO_CLAUDE_BIN ?? (existsSync(own) ? own : "claude");
})();

// Codex on this Mac, or null. Looked for on the studio's PATH and in the
// places npm, Homebrew, bun, fnm and nvm put programs, since a studio
// started from an app may not have the shell's PATH.
export function codexBin(): string | null {
  if (process.env.STUDIO_CODEX_BIN) return process.env.STUDIO_CODEX_BIN;
  const home = homedir();
  const versions = (dir: string, inner: string) => {
    try {
      return readdirSync(dir)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        .map((v) => path.join(dir, v, inner));
    } catch {
      return [];
    }
  };
  const dirs = [
    ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean),
    path.join(home, ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".bun/bin"),
    path.join(home, ".volta/bin"),
    ...versions(path.join(home, "Library/Application Support/fnm/node-versions"), "installation/bin"),
    ...versions(path.join(home, ".local/share/fnm/node-versions"), "installation/bin"),
    ...versions(path.join(home, ".nvm/versions/node"), "bin"),
  ];
  for (const dir of dirs) {
    const file = path.join(dir, "codex");
    if (existsSync(file)) return file;
  }
  return null;
}

// Variables that would route an AI CLI to someone's API billing or another
// provider. None of them reach a turn: the plan path must use the plan, and
// the API-key path gets only the studio's own key. (After Pond's list.)
const PROVIDER_VARIABLES = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_ORGANIZATION_ID",
  "ANTHROPIC_WORKSPACE_ID",
  "ANTHROPIC_PROFILE",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_VERTEX_BASE_URL",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "ANTHROPIC_FOUNDRY_API_KEY",
  "ANTHROPIC_FOUNDRY_BASE_URL",
  "AWS_BEARER_TOKEN_BEDROCK",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
  "CLAUDECODE",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "CODEX_API_KEY",
  "CODEX_ACCESS_TOKEN",
];

export function scrubbed(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const key of Object.keys(out)) {
    if (PROVIDER_VARIABLES.includes(key) || (key.startsWith("CODEX_") && key !== "CODEX_HOME")) delete out[key];
  }
  return out;
}

// A clean environment: the dev server's own variables (keys in .env.local,
// the owner's Claude Code session settings) don't pass to the turn.
export function childEnv(): NodeJS.ProcessEnv {
  const keep = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "TERM", "CARGO_HOME", "RUSTUP_HOME"];
  const env = {} as NodeJS.ProcessEnv;
  for (const key of keep) if (process.env[key]) env[key] = process.env[key] as string;
  for (const [key, value] of Object.entries(process.env)) if (key.startsWith("LC_") && value) env[key] = value;
  env.HYPERFRAMES_NO_TELEMETRY = "1";
  // The same effort as the flag, so a person's own Claude settings don't lower it.
  env.CLAUDE_CODE_EFFORT_LEVEL = EFFORT;
  // Where the voiceover tool reaches the studio itself.
  env.STUDIO_ORIGIN = `http://localhost:${process.env.PORT ?? "3200"}`;
  return scrubbed(env);
}

// Stops a whole process group, so nothing a turn started keeps going.
export function killGroup(pid: number) {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {}
  setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
  }, 3000).unref();
}

export type Quick = { code: number | null; stdout: string; stderr: string; missing: boolean };

// Runs a short command (a status check) with a time limit. `missing` is true
// when the program isn't there at all.
export function runQuick(bin: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs = 15_000): Promise<Quick> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let missing = false;
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(bin, args, { cwd: homedir(), env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    } catch {
      resolve({ code: -1, stdout, stderr, missing: true });
      return;
    }
    const timer = setTimeout(() => proc.pid && killGroup(proc.pid), timeoutMs);
    proc.stdout?.on("data", (d) => (stdout = (stdout + d).slice(-20_000)));
    proc.stderr?.on("data", (d) => (stderr = (stderr + d).slice(-20_000)));
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, missing });
    };
    proc.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "EACCES") missing = true;
      finish(-1);
    });
    proc.on("close", finish);
  });
}
