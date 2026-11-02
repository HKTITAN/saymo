import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { attachmentNote } from "./attachments";
import type { BrandKit } from "./brand";
import { checkKit, kitDir, readBrand, restoreBrand, snapshotBrand, withBrand, writeBrand } from "./brands";
import { CLAUDE_BIN, childEnv, EFFORT, explain, killGroup, MODEL, StreamReader } from "./claude";
import type { Attachment, ChatEvent, ChatMessage, Film } from "./contract";
import { figmaReady, pullFigma } from "./figma";
import { ROOT } from "./films";
import { fetchable, findLinks, LINK_LABEL, type SharedLink } from "./links";

// Claude building or tidying a brand kit: from what the person shared (the
// words they wrote; guide/: PDFs, screenshots, notes; fonts/ and logos/)
// and the links in it. It may only write inside the kit's own folder, reads
// the Aerchain kit as an example of a full one, and may fetch pages only
// from the domains of the websites, Framer sites and Notion pages shared.
// Figma files are brought in by the server first (with FIGMA_TOKEN) as a
// styles sheet and frame pictures in guide/. No shell.

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

// The links a turn works with: those in the words, plus any sent apart.
export function linksFor(prompt: string, extra: string[]): SharedLink[] {
  return findLinks([prompt, ...extra].join("\n")).slice(0, 12);
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

export async function runBrandTurn(
  id: string,
  prompt: string,
  links: SharedLink[],
  emit: (event: ChatEvent) => void,
  attachments: Attachment[] = [],
) {
  if (running.has(id)) {
    emit({ kind: "error", message: "Claude is still working on this kit. Wait for it, or stop it first." });
    return;
  }
  const turn: Running = { pid: null, stopped: false };
  running.set(id, turn);
  try {
    await brandTurn(id, prompt, links, turn, emit, attachments);
  } catch (error) {
    emit({ kind: "error", message: `Claude stopped with an error. Try again. Details: ${String((error as Error)?.message ?? error)}` });
  } finally {
    running.delete(id);
  }
}

async function brandTurn(
  id: string,
  prompt: string,
  links: SharedLink[],
  turn: Running,
  emit: (event: ChatEvent) => void,
  attachments: Attachment[],
) {
  const kit = await readBrand(id);
  if (!kit) {
    emit({ kind: "error", message: "That kit no longer exists." });
    return;
  }
  const n = await withBrand(id, () => snapshotBrand(id));
  emit({ kind: "start", turn: n });
  const typed = links.filter((l) => !prompt.includes(l.url)).map((l) => l.url);
  await addChat(id, {
    role: "you",
    text: typed.length ? `${prompt}\n\n${typed.join("\n")}` : prompt,
    at: new Date().toISOString(),
    ...(attachments.length ? { context: { t: 0, pick: null, attachments } } : {}),
  });

  const dir = kitDir(id);
  // Figma files come in first, as a styles sheet and frame pictures.
  const notes: string[] = [];
  for (const link of links) {
    if (link.kind === "figma") {
      if (!figmaReady()) {
        notes.push(`${link.url}: a Figma file. The studio has no Figma token, so it couldn't be opened; say so, and ask for the frames as PDF or PNG.`);
        continue;
      }
      emit({ kind: "step", label: "Opening the Figma file" });
      try {
        notes.push(`${link.url}: ${await pullFigma(id, link.url)}`);
      } catch (error) {
        notes.push(`${link.url}: a Figma file that couldn't be opened (${(error as Error).message})`);
      }
    } else if (link.kind === "drive") notes.push(`${link.url}: a Google Drive or Docs link, which can't be opened from here; ask for the file to be downloaded and dropped in.`);
    else if (link.kind === "video") notes.push(`${link.url}: a video link, which can't be watched from here.`);
    else notes.push(`${link.url}: a ${LINK_LABEL[link.kind]} page you may fetch.`);
  }
  const sites = [...new Set(links.filter((l) => fetchable(l.kind)).map((l) => new URL(l.url).hostname))];
  const files = await inventory(dir);

  const session = (await readFile(sessionFile(id), "utf8").catch(() => "")).trim() || undefined;
  const args = brandArgs(id, session, sites);
  const proc = spawn(CLAUDE_BIN, args, { cwd: dir, env: childEnv(), stdio: ["pipe", "pipe", "pipe"], detached: true });
  turn.pid = proc.pid ?? null;
  if (turn.stopped && proc.pid) killGroup(proc.pid);
  proc.stdin.end(
    [
      `<kit>${path.join(dir, "brand.json")}, named "${kit.name}".</kit>`,
      files.length ? `<shared-files>\n${files.join("\n")}\n</shared-files>` : "",
      notes.length ? `<links>\n${notes.join("\n")}\n</links>` : "",
      attachmentNote(dir, attachments),
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

// What's in the kit's folders, so Claude knows what it was given.
async function inventory(dir: string) {
  const out: string[] = [];
  for (const folder of ["guide", "fonts", "logos"]) {
    for (const name of (await readdir(path.join(dir, folder)).catch(() => [])).sort()) {
      if (!name.startsWith(".")) out.push(`${folder}/${name}`);
    }
  }
  return out.slice(0, 80);
}

function brandArgs(id: string, session: string | undefined, sites: string[]) {
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
    ...sites.map((host) => `WebFetch(domain:${host})`),
  ];
  const deny = [`Edit(/${dir}/.history/**)`, `Read(${root}/**/.env*)`];
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model", MODEL,
    "--effort", EFFORT,
    "--permission-mode", "dontAsk",
    "--setting-sources", "project,local",
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--tools", `Read,Edit,Write,Glob,Grep,Skill,TodoWrite${sites.length ? ",WebFetch" : ""}`,
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

What you have: the person's own words (often a loose brain dump: take every hint in it seriously), guide/ with what they dropped in (guideline PDFs, screenshots, notes, and a sheet plus frame pictures from any Figma file), and fonts/ and logos/ with their font and logo files. Read PDFs and images directly. Websites, Framer sites and Notion pages they shared: you may fetch pages from those domains only; nothing else on the web. A logo or font that sits in guide/ by mistake can be named in brand.json only once it is in logos/ or fonts/; say if one needs moving.

Build brand.json from them: colour roles (background, surface, ink, muted, accent, onAccent, line) and the brand's full ramps with exact hex values; fonts (each file in fonts/ with family, role, weights); logos (each file in logos/ with kind and the ground it is drawn for); rules in four short lists (visual, motion, sound, words), one plain sentence each, in the brand's own words where it has them; texture (stroke and gap in px at 1080p) only if the brand has a line or grid system; and notes, a thorough Markdown guideline for whoever designs films with the kit. Only write what the sources show or clearly imply; where you infer (motion, sound), say so in notes. Never invent hex values: if a colour isn't given, sample it from a logo or screenshot and say you did. Keep "id" as "${id}". No shell commands are available.

Work in this order, saving brand.json as you go so the person sees the kit fill in: name and colours first, then fonts, then logos, then rules, then notes.

How to reply: work silently (write no text while you work), then end with exactly two short paragraphs of one or two plain sentences each (under 60 words in all, no lists or formatting). The first starts "Found:" and says, in plain words, what the kit now holds and where it came from. The second starts "Guessed:" and names what you inferred or couldn't find (and any link you couldn't open). Never use em dashes.`;
}
