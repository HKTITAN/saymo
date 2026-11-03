import { IS_PRODUCT } from "./edition";

// Which AI makes a film's changes, shared by the server and the page. No
// key, token or account detail is ever part of these: the page only learns
// whether each one is ready, its plan's name and how to set it up.
//
//  - claude: Claude Code on the owner's own Claude plan (the in-house
//    default, and the studio's house model: Opus 5.5 at high effort).
//  - codex: OpenAI's Codex CLI on a ChatGPT plan.
//  - api-key: Claude Code paid by an Anthropic API key pasted into the
//    studio, for teammates without a Claude plan.
//
// The product edition (edition.ts) offers the customer's own Claude, signed
// in through Claude Code itself: their Claude plan or their API key.
// Anthropic allows a product to run unmodified Claude Code that way and
// says it mustn't restrict Claude Code's sign-in methods; we never offer a
// Claude sign-in of our own or touch its tokens. Codex on a ChatGPT plan
// stays out until OpenAI's terms are checked (docs/launch/ai-providers.md).
// Later options, such as Claude through Bedrock or Vertex, or other models,
// join PROVIDER_IDS and the product's list here.

export const PROVIDER_IDS = ["claude", "codex", "api-key"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

// The AIs this build offers, in the order the picker lists them.
export const OFFERED_PROVIDERS: readonly ProviderId[] = IS_PRODUCT ? ["claude", "api-key"] : PROVIDER_IDS;
export const DEFAULT_PROVIDER: ProviderId = "claude";
export const DEFAULT_CHOICE: AiChoice = { model: "claude-opus-5-5", effort: "high", provider: DEFAULT_PROVIDER };

// True only for an AI this build offers, so a pick saved by another build
// (or sent by hand) falls back to the default or is refused.
export const isProviderId = (value: unknown): value is ProviderId =>
  typeof value === "string" && (OFFERED_PROVIDERS as readonly string[]).includes(value);

// Claude Code and the API key share one conversation per film; Codex keeps
// its own.
export const familyOf = (id: ProviderId) => (id === "codex" ? "codex" : "claude");

// Which Claude model and how hard it thinks, chosen in Settings and used by
// every Claude turn (the plan and the API key alike). Kept in
// .studio/ai-model.json; without it, STUDIO_MODEL and STUDIO_EFFORT, else
// Opus 5.5 at high effort.
export const MODELS = [
  { id: "claude-opus-5-5", name: "Opus 5.5", note: "The most capable. Best for most films." },
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5", note: "Quicker, and uses less of your plan." },
  { id: "claude-haiku-5-5", name: "Haiku 5.5", note: "The quickest, for small changes." },
] as const;
export type ModelId = (typeof MODELS)[number]["id"];
export const EFFORTS = [
  { id: "low", name: "Low" },
  { id: "medium", name: "Medium" },
  { id: "high", name: "High" },
  { id: "xhigh", name: "Extra high" },
  { id: "max", name: "Max" },
] as const;
export type Effort = (typeof EFFORTS)[number]["id"];
// `provider`: which AI every prompt goes to (also chosen in Settings).
export type AiChoice = { model: string; effort: string; provider: ProviderId };
export const isModelId = (v: unknown): v is ModelId => MODELS.some((m) => m.id === v);
export const isEffort = (v: unknown): v is Effort => EFFORTS.some((e) => e.id === v);
const modelName = (id: string) => MODELS.find((m) => m.id === id)?.name ?? id;
const effortName = (id: string) => EFFORTS.find((e) => e.id === id)?.name ?? id;
// "Opus 5.5 · High", for the picker in prompt boxes.
export const choiceShort = (c: AiChoice) => `${modelName(c.model)} · ${effortName(c.effort)}`;
// "Opus 5.5, high effort", for status lines.
export const choiceWords = (c: AiChoice) => `${modelName(c.model)}, ${effortName(c.effort).toLowerCase()} effort`;

// `model` is what runs, in plain words, shown before the status check answers.
export const PROVIDERS: Record<ProviderId, { name: string; short: string; via: string; model: string }> = {
  claude: { name: "Claude", short: "Opus 5.5 · High", via: "Your Claude plan", model: "Opus 5.5, high effort" },
  codex: { name: "Codex", short: "Codex", via: "Your ChatGPT plan", model: "Codex's own model, high effort" },
  "api-key": { name: "Claude with an API key", short: "Opus 5.5 · Key", via: "An Anthropic API key", model: "Opus 5.5, high effort" },
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
