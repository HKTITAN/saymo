import { CLAUDE_BIN, childEnv, codexBin, EFFORT, MODEL, runQuick } from "./ai-env";
import { type AiStatus, DEFAULT_PROVIDER, type ProviderId, type ProviderStatus } from "./ai-types";
import { ConnectError, readSecret, removeSecret, writeSecret } from "./connect-store";

// The AIs a film's turn can run on, and whether each is ready on this Mac.
// After Pond's provider subscriptions (github.com/raphaelsalaja/pond, MIT):
// the studio runs the official CLIs, never reads or copies their sign-ins,
// and strips other billing routes from their environment.
//
// The API key is the one secret kept here: in .studio/connections/
// anthropic.json (mode 600), given only to that provider's Claude Code as
// ANTHROPIC_API_KEY, and never sent back to the page beyond its last 4
// characters.

export const CODEX_MODEL = process.env.STUDIO_CODEX_MODEL ?? null;

const KEY_FILE = "anthropic";
type SavedKey = { key: string; savedAt: string };

export async function readApiKey(): Promise<string | null> {
  const saved = await readSecret<SavedKey>(KEY_FILE);
  return typeof saved?.key === "string" && saved.key ? saved.key : null;
}

export async function saveApiKey(raw: unknown) {
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!/^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(key)) {
    throw new ConnectError("That doesn't look like an Anthropic API key. Keys start with sk-ant- and come from console.anthropic.com.");
  }
  await writeSecret(KEY_FILE, { key, savedAt: new Date().toISOString() } satisfies SavedKey);
  cached = null;
}

export async function removeApiKey() {
  await removeSecret(KEY_FILE);
  cached = null;
}

// The environment for one provider's Claude Code turn. The plan path gets
// no key at all; the API-key path gets only the studio's own.
export async function claudeEnvFor(provider: ProviderId): Promise<NodeJS.ProcessEnv> {
  const env = childEnv();
  if (provider !== "api-key") return env;
  const key = await readApiKey();
  if (!key) throw new ConnectError("No API key is saved. Add one under Connections, then AI.");
  return { ...env, ANTHROPIC_API_KEY: key };
}

// ─── Status ──────────────────────────────────────────────────────────────────

const modelWords = () => {
  const name = MODEL === "claude-opus-5-5" ? "Opus 5.5" : MODEL;
  return `${name}, ${EFFORT} effort`;
};

const INSTALL_CLAUDE = { text: "Install Claude Code", command: "curl -fsSL https://claude.ai/install.sh | bash" };
const LOGIN_CLAUDE = { text: "Sign in with your Claude plan", command: "claude auth login" };

type ClaudeAuth = { loggedIn?: boolean; authMethod?: string; subscriptionType?: string };

async function claudeStatus(): Promise<{ status: ProviderStatus; installed: boolean }> {
  const base = { id: "claude" as const, plan: null, model: modelWords(), detail: null };
  const r = await runQuick(CLAUDE_BIN, ["auth", "status", "--json"], childEnv());
  if (r.missing) {
    return {
      installed: false,
      status: { ...base, state: "not-installed", detail: "Claude Code isn't installed on this Mac.", setup: [INSTALL_CLAUDE, LOGIN_CLAUDE] },
    };
  }
  let auth: ClaudeAuth | null = null;
  try {
    auth = JSON.parse(r.stdout) as ClaudeAuth;
  } catch {}
  if (!auth?.loggedIn) {
    return { installed: true, status: { ...base, state: "sign-in", detail: "Claude Code isn't signed in.", setup: [LOGIN_CLAUDE] } };
  }
  // A plan sign-in only: a key-based sign-in here would bill an API account.
  if (!["claude.ai", "oauth_token"].includes(auth.authMethod ?? "")) {
    return {
      installed: true,
      status: {
        ...base,
        state: "sign-in",
        detail: "Claude Code on this Mac is signed in with an API key, not a plan. Sign in with your plan, or use the API key option.",
        setup: [LOGIN_CLAUDE],
      },
    };
  }
  const plan = auth.subscriptionType ? `${auth.subscriptionType[0].toUpperCase()}${auth.subscriptionType.slice(1)} plan` : null;
  return { installed: true, status: { ...base, state: "ready", plan, setup: [LOGIN_CLAUDE] } };
}

const INSTALL_CODEX = [
  { text: "Install Codex with npm", command: "npm install --global @openai/codex" },
  { text: "Or with Homebrew", command: "brew install codex" },
];
const LOGIN_CODEX = { text: "Sign in with ChatGPT", command: "codex login" };

async function codexStatus(): Promise<ProviderStatus> {
  const base = {
    id: "codex" as const,
    plan: null,
    model: CODEX_MODEL ? `${CODEX_MODEL}, high effort` : "Codex's own model, high effort",
    detail: null,
  };
  const bin = codexBin();
  if (!bin) {
    return { ...base, state: "not-installed", detail: "Codex isn't installed on this Mac.", setup: [...INSTALL_CODEX, LOGIN_CODEX] };
  }
  // Asks Codex itself, which reads its own sign-in; the studio never does.
  const ask = (store: "file" | "keyring") =>
    runQuick(bin, ["-c", `cli_auth_credentials_store="${store}"`, "login", "status"], childEnv());
  const file = await ask("file");
  if (file.missing) {
    return { ...base, state: "not-installed", detail: "Codex isn't installed on this Mac.", setup: [...INSTALL_CODEX, LOGIN_CODEX] };
  }
  const said = `${file.stdout}\n${file.stderr}`;
  if (file.code === 0 && /logged in using chatgpt/i.test(said)) {
    return { ...base, state: "ready", plan: "ChatGPT plan", setup: [LOGIN_CODEX] };
  }
  if (file.code === 0 && /api key/i.test(said)) {
    return {
      ...base,
      state: "sign-in",
      detail: "Codex is signed in with an OpenAI API key. The studio uses your ChatGPT plan, so sign in with ChatGPT instead.",
      setup: [LOGIN_CODEX],
    };
  }
  const keyring = await ask("keyring");
  if (keyring.code === 0 && /logged in using chatgpt/i.test(`${keyring.stdout}\n${keyring.stderr}`)) {
    return {
      ...base,
      state: "sign-in",
      detail: "Codex keeps its sign-in in the Keychain, which the studio can't share safely. Sign in once more so it's kept in Codex's own file.",
      setup: [{ text: "Sign in with ChatGPT, kept in a file", command: `codex -c 'cli_auth_credentials_store="file"' login` }],
    };
  }
  return { ...base, state: "sign-in", detail: "Codex isn't signed in.", setup: [LOGIN_CODEX] };
}

async function apiKeyStatus(claudeInstalled: boolean): Promise<ProviderStatus> {
  const key = await readApiKey();
  const base = { id: "api-key" as const, plan: null, model: `${modelWords()}, billed to the key` };
  const make = { text: "Make a key in the Claude Console (console.anthropic.com, API keys), then paste it here." };
  if (!claudeInstalled) {
    return { ...base, state: "not-installed", detail: "This uses Claude Code too, and it isn't installed on this Mac.", setup: [INSTALL_CLAUDE, make] };
  }
  if (!key) return { ...base, state: "no-key", detail: null, setup: [make] };
  return { ...base, state: "ready", detail: null, setup: [make], keyEnding: key.slice(-4) };
}

let cached: { at: number; status: AiStatus } | null = null;

export async function aiStatus(fresh = false): Promise<AiStatus> {
  if (!fresh && cached && Date.now() - cached.at < 20_000) return cached.status;
  const [claude, codex] = await Promise.all([claudeStatus(), codexStatus()]);
  const status: AiStatus = {
    default: DEFAULT_PROVIDER,
    providers: [claude.status, codex, await apiKeyStatus(claude.installed)],
  };
  cached = { at: Date.now(), status };
  return status;
}
