// Which AI makes a film's changes, shared by the server and the page. No
// key, token or account detail is ever part of these: the page only learns
// whether each one is ready, its plan's name and how to set it up.
//
//  - claude: Claude Code on the owner's own Claude plan (the default, and
//    the studio's house model: Opus 5.5 at high effort).
//  - codex: OpenAI's Codex CLI on a ChatGPT plan.
//  - api-key: Claude Code paid by an Anthropic API key pasted into the
//    studio, for teammates without a Claude plan.

export const PROVIDER_IDS = ["claude", "codex", "api-key"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export const DEFAULT_PROVIDER: ProviderId = "claude";

export const isProviderId = (value: unknown): value is ProviderId =>
  typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);

// Claude Code and the API key share one conversation per film; Codex keeps
// its own.
export const familyOf = (id: ProviderId) => (id === "codex" ? "codex" : "claude");

export const PROVIDERS: Record<ProviderId, { name: string; short: string; via: string }> = {
  claude: { name: "Claude", short: "Claude", via: "Your Claude plan" },
  codex: { name: "Codex", short: "Codex", via: "Your ChatGPT plan" },
  "api-key": { name: "Claude with an API key", short: "API key", via: "An Anthropic API key" },
};

// ready: signed in and usable. The rest say what's missing.
export type ProviderState = "ready" | "not-installed" | "sign-in" | "no-key" | "unknown";

export type SetupStep = { text: string; command?: string };

export type ProviderStatus = {
  id: ProviderId;
  state: ProviderState;
  plan: string | null; // "Team plan", "ChatGPT plan", or null when unknown
  model: string; // in plain words: "Opus 5.5, high effort"
  detail: string | null; // what's wrong, in plain words
  setup: SetupStep[]; // how to set it up, in order
  keyEnding?: string; // api-key only: at most the key's last 4 characters
};

export type AiStatus = { default: ProviderId; providers: ProviderStatus[] };

// GET    /api/studio/ai            → AiStatus (?fresh=1 checks again now)
// POST   /api/studio/ai/key {key}  → AiStatus (saves the key; never echoed)
// DELETE /api/studio/ai/key        → AiStatus (removes it)
