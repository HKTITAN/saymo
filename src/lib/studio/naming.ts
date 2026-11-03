import { spawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CLAUDE_BIN, killGroup } from "./ai-env";
import { readChat } from "./claude";
import { FILMS_DIR, readFilm, withFilm, writeFilm } from "./films";
import { claudeEnvFor, keyProblem } from "./providers";

// Films name themselves, so the home page stays organised: once Claude has
// made something, a film still called by a quick name ("Untitled film", or
// the first words of its first prompt) gets a short, clear title from a
// small, quick Claude call. A title the person typed (film.json `named`)
// is never touched.

const PLACEHOLDERS = new Set(["Untitled film", "Untitled video", "Untitled"]);
const MODEL = "claude-haiku-5-5"; // a few words don't need a big model
const LIMIT_MS = 45_000;

// The title the studio gives a film from its first prompt (studio.tsx).
export const titleFrom = (prompt: string) => {
  const first = prompt.split(/[.:;,\n]/)[0].trim().split(/\s+/).slice(0, 6).join(" ");
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "Untitled film";
};

const SYSTEM =
  "You name short films made in a motion design studio. Reply with the name only: 2 to 5 words, sentence case (capital first letter, then lower case except names and acronyms), no quotes, no full stop, no emoji, no dates unless the date is the point. Say what the film is about, the way a designer would label the file: \"Agentic AI billboard, Dubai\", \"SpendOS launch teaser\", \"Diwali greeting\".";

async function askForName(brief: string): Promise<string | null> {
  if (await keyProblem()) return null;
  const cwd = path.join(tmpdir(), "studio-naming");
  await mkdir(cwd, { recursive: true });
  const args = [
    "-p",
    "--output-format", "text",
    "--model", MODEL,
    "--tools", "",
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--setting-sources", "",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--system-prompt", SYSTEM,
  ];
  const env = await claudeEnvFor().catch(() => null);
  if (!env) return null;
  return new Promise((resolve) => {
    const proc = spawn(CLAUDE_BIN, args, { cwd, env, stdio: ["pipe", "pipe", "ignore"], detached: true });
    let out = "";
    const limit = setTimeout(() => proc.pid && killGroup(proc.pid), LIMIT_MS);
    proc.stdout.on("data", (c: Buffer) => {
      out += c;
    });
    proc.on("error", () => resolve(null));
    proc.on("exit", (code) => {
      clearTimeout(limit);
      const name = out
        .trim()
        .split("\n")[0]
        .replace(/^["'“‘]|["'”’.]$/g, "")
        .replace(/\s+—\s+|\s+–\s+/g, ", ")
        .trim();
      resolve(code === 0 && name.length >= 2 && name.length <= 60 ? name : null);
    });
    proc.stdin.end(brief);
  });
}

// Does this film still have a quick name the studio may replace?
async function quickName(id: string) {
  const film = await readFilm(id);
  if (!film || film.named || film.take) return null;
  const chat = await readChat(id).catch(() => []);
  const first = chat.find((m) => m.role === "you" && !m.auto)?.text ?? "";
  const quick = PLACEHOLDERS.has(film.title) || (first && film.title === titleFrom(first));
  if (!quick) return null;
  // Only once Claude has made something to name.
  const replies = chat.filter((m) => m.role === "claude" && m.text && !/^Stopped\.?$/.test(m.text));
  if (!replies.length) return null;
  return { film, chat, first };
}

const naming = new Set<string>();

// Names the film if it still has a quick name. Quiet: any failure leaves
// the title as it was.
export async function autoName(id: string) {
  if (naming.has(id)) return;
  naming.add(id);
  try {
    const found = await quickName(id);
    if (!found) return;
    const { film, chat, first } = found;
    const asks = chat.filter((m) => m.role === "you" && !m.auto).map((m) => m.text.replace(/\s+/g, " ").slice(0, 300));
    const said = chat.filter((m) => m.role === "claude").slice(-2).map((m) => m.text.replace(/\s+/g, " ").slice(0, 400));
    const brief = [
      `A ${film.kind === "video" ? "video edit" : "motion graphics film"}, ${film.width} x ${film.height}, ${film.duration} s.`,
      `First request: ${first.slice(0, 400)}`,
      asks.length > 1 ? `Later requests: ${asks.slice(1, 6).join(" | ")}` : "",
      `What the designer said they made: ${said.join(" | ")}`,
      "Name this film.",
    ]
      .filter(Boolean)
      .join("\n");
    const name = await askForName(brief);
    if (!name) return;
    await withFilm(id, async () => {
      const now = await readFilm(id);
      // Renamed by hand meanwhile, or already named: leave it.
      if (!now || now.named || now.title !== film.title) return;
      await writeFilm({ ...now, title: name });
    });
  } finally {
    naming.delete(id);
  }
}

// Once per server: films made before films named themselves, one at a time.
const g = globalThis as { __studioNamedOld?: boolean };
export function nameOldFilms() {
  if (g.__studioNamedOld) return;
  g.__studioNamedOld = true;
  void (async () => {
    const ids = (await readdir(FILMS_DIR).catch(() => [] as string[])).filter((d) => /^[a-z0-9]{8}$/.test(d));
    for (const id of ids) await autoName(id).catch(() => {});
  })();
}
