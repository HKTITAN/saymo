import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { ChatContext, ChatEvent, ChatMessage, ChatRequest, Film } from "./contract";
import { attachmentNote } from "./attachments";
import { listenCommand, referenceSoundNote, refAudioDenies } from "./listen";
import { atPlayhead } from "./captions";
import type { Clip, Edit, Graphic } from "./edit";
import { brandDir, DEFAULT_BRAND, isBrandId } from "./brand-tokens";
import { filmDir, pruneVersions, readFilm, recordVersion, ROOT, snapshotFilm, wentBackTo, withFilm, writeFilm } from "./films";
import { startSound } from "./sound-render";

// The studio's chat: each prompt is one Claude Code turn, run headless on
// the owner's own Claude login (no API key), in the film's folder. The
// session id is kept in film.json, so each film has one continuing
// conversation with Claude.
//
// What Claude may do is the important part. It runs in "don't ask" mode,
// which refuses anything not on the list below, so it can:
//  - read the project (to learn the house style, skills and starters), but
//    not secrets such as .env files;
//  - write only inside its own film's folder;
//  - run exactly three commands: the film checker, a draft render of this
//    film and, for video films, the media tool on this film's footage (it
//    reports transcripts, pauses, cuts and faces, and makes small stills).
//    No other shell, no web, no MCP servers, no subagents;
//  - look at footage only through that tool: the original video and sound
//    files can't be read or changed.
// Only project settings load (not the owner's own plugins and hooks).

const ENGINE_WORDS: Record<Film["engine"], string> = {
  html: "html (HyperFrames: index.html with a paused GSAP timeline)",
  react: "react (Remotion: src/Film.jsx)",
  rust: "rust (fframes: a Cargo crate)",
};

const TURN_LIMIT_MS = 15 * 60 * 1000;
// Everyone's studio uses the same Claude by default: Opus 5.5 at high effort,
// named exactly so an older alias can't pick an older model on someone's Mac.
// STUDIO_MODEL and STUDIO_EFFORT in .env.local change it for one machine.
export const MODEL = process.env.STUDIO_MODEL ?? "claude-opus-5-5";
export const EFFORT = process.env.STUDIO_EFFORT ?? "high";

export const CLAUDE_BIN = (() => {
  const own = path.join(homedir(), ".local/bin/claude");
  return process.env.STUDIO_CLAUDE_BIN ?? (existsSync(own) ? own : "claude");
})();

// ─── Files ───────────────────────────────────────────────────────────────────

// The chat lives in .history/ so that undo, which puts the film's files
// back, never rewinds the conversation itself.
const historyDir = (id: string) => path.join(filmDir(id), ".history");
const chatFile = (id: string) => path.join(historyDir(id), "chat.json");
const undoneFlag = (id: string) => path.join(historyDir(id), "undone");
const wentBackFlag = (id: string) => path.join(historyDir(id), "went-back");
const logFile = (id: string) => path.join(historyDir(id), "last-turn.jsonl");

export async function readChat(id: string): Promise<ChatMessage[]> {
  try {
    return JSON.parse(await readFile(chatFile(id), "utf8")) as ChatMessage[];
  } catch {
    return [];
  }
}

async function addChat(id: string, message: ChatMessage) {
  await mkdir(historyDir(id), { recursive: true });
  const chat = [...(await readChat(id)), message];
  await writeFile(`${chatFile(id)}.tmp`, `${JSON.stringify(chat, null, 2)}\n`);
  await rename(`${chatFile(id)}.tmp`, chatFile(id));
}

// Undo tells the next turn that the files went back, since Claude's own
// memory of the conversation still has the change in it. Undoing a step
// back to an earlier version just returns the files to how Claude left them.
export async function noteUndo(id: string) {
  await mkdir(historyDir(id), { recursive: true });
  if (existsSync(wentBackFlag(id))) await rm(wentBackFlag(id), { force: true });
  else await writeFile(undoneFlag(id), new Date().toISOString());
  await addChat(id, { role: "you", text: "Undo the last change.", at: new Date().toISOString() });
}

// Going back to an earlier version tells the next turn the same way, and
// says which version, in the chat too.
export async function noteWentBack(id: string, about: string) {
  await mkdir(historyDir(id), { recursive: true });
  await writeFile(wentBackFlag(id), about);
  await rm(undoneFlag(id), { force: true });
  await addChat(id, { role: "you", text: wentBackTo(about), at: new Date().toISOString() });
}

const dropSnapshot = (id: string, n: number) =>
  withFilm(id, async () => {
    await rm(path.join(historyDir(id), String(n)), { recursive: true, force: true });
    await pruneVersions(id);
  });

// ─── Running turns ───────────────────────────────────────────────────────────

type Running = { proc: ChildProcess | null; stopped: boolean; timedOut: boolean };
const g = globalThis as { __studioTurns?: Map<string, Running> };
const running = (g.__studioTurns ??= new Map());

export const isRunning = (id: string) => running.has(id);

// Stops the film's turn, if one is running: the whole process group, so
// nothing it started keeps going.
export function stopTurn(id: string) {
  const turn = running.get(id);
  if (!turn) return false;
  turn.stopped = true;
  if (turn.proc?.pid) killGroup(turn.proc.pid);
  return true;
}

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

// Runs one turn and calls `emit` with each ChatEvent. Resolves when the
// turn is over, whatever happened.
export async function runTurn(id: string, request: ChatRequest, emit: (event: ChatEvent) => void) {
  if (running.has(id)) {
    emit({ kind: "error", message: "Claude is still working on this film. Wait for it, or stop it first." });
    return;
  }
  const turn: Running = { proc: null, stopped: false, timedOut: false };
  running.set(id, turn);
  try {
    await turnFor(id, request, turn, emit);
  } catch (error) {
    emit({ kind: "error", message: `Claude stopped with an error. Try again. Details: ${String((error as Error)?.message ?? error)}` });
  } finally {
    running.delete(id);
  }
}

async function turnFor(id: string, request: ChatRequest, turn: Running, emit: (event: ChatEvent) => void) {
  const film = await readFilm(id);
  if (!film) {
    emit({ kind: "error", message: "That film no longer exists." });
    return;
  }
  const prompt = request.prompt.trim();
  if (!prompt) {
    emit({ kind: "error", message: "Type what you'd like changed." });
    return;
  }

  // The film as it is now, for undo and the version history.
  const n = await withFilm(id, async () => {
    const taken = await snapshotFilm(id);
    await recordVersion(id, taken, prompt, request.context.t);
    return taken;
  });
  emit({ kind: "start", turn: n });
  await addChat(id, { role: "you", text: prompt, at: new Date().toISOString(), context: request.context });

  const undone = existsSync(undoneFlag(id));
  await rm(undoneFlag(id), { force: true });
  const wentBack = await readFile(wentBackFlag(id), "utf8").catch(() => null);
  await rm(wentBackFlag(id), { force: true });

  const dir = filmDir(id);
  await rm(logFile(id), { force: true });
  const args = claudeArgs(id, film.session, film.kind, film.brand);
  const proc = spawn(CLAUDE_BIN, args, {
    cwd: dir,
    env: childEnv(),
    stdio: ["pipe", "pipe", "pipe"],
    detached: true, // its own process group, so stopping ends everything
  });
  turn.proc = proc;
  if (turn.stopped && proc.pid) killGroup(proc.pid);
  // The exact command goes first in the turn's log, for debugging.
  await appendFile(logFile(id), `${JSON.stringify({ type: "studio_command", bin: CLAUDE_BIN, args })}\n`).catch(() => {});
  const edit = film.kind === "video" ? await editSummary(id, request.context.t) : null;
  proc.stdin.end(userMessage(film, prompt, request.context, undone, wentBack, edit));

  const limit = setTimeout(() => {
    turn.stopped = true;
    turn.timedOut = true;
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
      void appendFile(logFile(id), `${line}\n`).catch(() => {});
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
  clearTimeout(limit);

  // Keep the conversation going next time, whatever happened; if the old
  // conversation couldn't be found, the next turn starts a new one.
  const lost = code !== 0 && /no conversation found/i.test(stderr);
  const session = lost ? undefined : (reader.session ?? film.session);
  const after = await withFilm(id, async () => {
    const now = (await readFilm(id)) ?? film;
    const next: Film = { ...now, session, updatedAt: new Date().toISOString() };
    await writeFilm(next);
    return next;
  });

  // A turn that changed nothing needn't be a step for undo.
  if (!reader.changedAny) await dropSnapshot(id, n);
  // A new score, length or cut means new sound, unless Claude already
  // rendered it while listening to its work.
  else void startSound(id);

  const problem = turn.stopped
    ? null
    : lost
      ? "Claude couldn't pick up the earlier conversation about this film, so the next message starts a new one. Send it again."
      : (reader.failure ?? (code !== 0 ? explain(stderr || reader.lastError || "") : null));
  const text = reader.reply.trim();
  await addChat(id, {
    role: "claude",
    text: turn.stopped ? (text ? `${text}\n\n(Stopped.)` : "Stopped.") : text || problem || "Done.",
    at: new Date().toISOString(),
    steps: reader.steps,
  });
  if (turn.timedOut) emit({ kind: "error", message: "Claude took longer than 15 minutes, so the studio stopped it. What it changed is kept; Undo puts it back." });
  else if (turn.stopped) emit({ kind: "error", message: "Stopped. Anything Claude had already changed is kept; Undo puts it back." });
  else if (problem) emit({ kind: "error", message: problem });
  emit({ kind: "done", film: after });
}

// ─── The command ─────────────────────────────────────────────────────────────

function claudeArgs(id: string, session: string | undefined, kind: Film["kind"], brand?: string) {
  const dir = filmDir(id);
  const root = `/${ROOT}`; // permission rules: "//" starts an absolute path
  const check = `node ${path.join(ROOT, "scripts/studio/check-film.mjs")}`;
  const draft = `node ${path.join(ROOT, "scripts/studio/render.mjs")} --film ${id} --draft`;
  const sound = soundCommand(id);
  // Its arguments vary (media ids, times), so it's allowed as a prefix. The
  // tool checks every argument and runs nothing through a shell, and Claude
  // Code still refuses chained or substituted commands.
  const media = mediaTool(id);
  const frames = path.join(ROOT, "films/.work", id, "frames");
  const allow = [
    `Edit(/${dir}/**)`, // covers Write and Edit: this film's folder only
    `Read(/${dir}/**)`,
    `Read(${root}/src/**)`,
    `Read(${root}/studio/**)`,
    `Read(${root}/scripts/studio/**)`,
    `Read(${root}/.claude/skills/**)`,
    `Read(${root}/assets/**)`,
    `Read(${root}/public/**)`,
    `Read(${root}/CLAUDE.md)`,
    `Read(${root}/AGENTS.md)`,
    `Read(/${frames}/**)`, // stills the media tool makes, so Claude can see the footage
    `Read(/${brandDir(ROOT, brand && isBrandId(brand) ? brand : DEFAULT_BRAND)}/**)`, // the film's brand kit
    `Bash(${check})`,
    `Bash(${draft})`,
    `Bash(${sound})`,
    `Bash(${media} *)`,
    `Bash(${voiceTool(id)} *)`,
    `Bash(${listenCommand(id)} *)`, // hears this film's refs/ and stems only
    "Skill",
    "TodoWrite",
  ];
  const deny = [
    `Read(${root}/**/.env*)`,
    // Connections' tokens and the library's working copy.
    `Read(${root}/.studio/**)`,
    `Edit(${root}/.studio/**)`,
    `Read(${root}/**/node_modules/**)`,
    `Edit(/${dir}/.history/**)`,
    `Edit(/${dir}/out/**)`,
    // Footage is never changed, and the big files are never read (the
    // media tool reports on them); stills, thumbnails and JSON stay readable.
    `Edit(/${dir}/media/**)`,
    // What they attach is theirs: read it, never change it.
    `Edit(/${dir}/refs/**)`,
    ...refAudioDenies(dir), // sounds are heard with the listening tool
    // A rust film's build script is the studio's own (it runs code when the
    // film is built); Claude may not change it.
    `Edit(/${dir}/build.rs)`,
    // The sound is written as a score; what it renders to is the renderer's.
    `Edit(/${dir}/sound/sound.wav)`,
    `Edit(/${dir}/sound/peaks.json)`,
    `Edit(/${dir}/sound/status.json)`,
    `Read(/${dir}/sound/*.wav)`,
    // The stems and the person's own volume edits are the studio's.
    `Edit(/${dir}/sound/*.wav)`,
    `Edit(/${dir}/sound/*-peaks.json)`,
    `Edit(/${dir}/sound/master.json)`,
    `Edit(/${dir}/sound/mix.json)`,
    ...FOOTAGE_FILES.map((f) => `Read(/${dir}/media/**/${f})`),
  ];
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
    "--tools", "Read,Edit,Write,Glob,Grep,Bash,Skill,TodoWrite",
    "--allowedTools", ...allow,
    "--disallowedTools", ...deny,
    "--append-system-prompt", systemPrompt(id, kind),
  ];
  if (session) args.push("--resume", session);
  return args;
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
  return env;
}

// Recorded with the conversation on its first turn (Claude Code keeps the
// system prompt fixed for a session), so it holds only what never changes
// for this film; the rest goes with each message.
function systemPrompt(id: string, kind: Film["kind"]) {
  const video = kind === "video" ? videoPrompt(id) : "";
  return `You are the ${kind === "video" ? "video editor and motion designer" : "motion designer"} inside Aerchain's motion studio, an internal tool. The person you work with is a visual designer: they see the film playing and talk to you about it. You change the film by editing its files.

Your film is films/${id}/ and the shell is already in it. Write only inside it. Load the aerchain-film skill before your first change: it explains how a studio film is made, how film.json works and which other skills to use.

To check your work, run exactly:
  node ${path.join(ROOT, "scripts/studio/check-film.mjs")}
and fix what it reports. For a quick test video of a film that can't be checked any other way, run exactly:
  node ${path.join(ROOT, "scripts/studio/render.mjs")} --film ${id} --draft
The film's sound design is sound/score.js (music in Strudel, effects in Tone.js, as src/lib/studio/sound.ts describes). Load the aerchain-sound-design skill before writing or changing sound. To render the sound and hear what you made (loudness, and where each hit lands against the film's moments), run exactly:
  ${soundCommand(id)}
No other shell commands are available, and there is no web access.${video}

How to reply: work silently (write no text while you work), then end with at most two short sentences, under 35 words in all, saying what changed on screen in visual words. Plain text only: no lists, no headings, no bold, no code, no file names. Never use em dashes. Don't name the engines or libraries (HyperFrames, Remotion, fframes, GSAP) unless asked. If a request is unclear, make your best guess, say what you assumed, and offer one alternative.`;
}

// ─── Video films ─────────────────────────────────────────────────────────────

const FOOTAGE_FILES = ["original.*", "*.mp4", "*.mov", "*.m4v", "*.webm", "*.mkv", "*.wav", "*.mp3", "*.m4a", "*.aac", "*.aif", "*.aiff", "*.flac"];

const soundCommand = (id: string) => `node ${path.join(ROOT, "scripts/studio/sound.mjs")} ${id}`;

// A part of the sound picked on the timeline's Music or Effects lane.
function soundSpanNote(s: NonNullable<ChatContext["sound"]>) {
  const what = s.stem === "both" ? "music and the effects" : s.stem;
  const span = `${s.from.toFixed(2)} s to ${s.to.toFixed(2)} s`;
  return `<sound>They picked part of the sound design: the ${what} from ${span}. "This" or "this bit" means that. In sound/score.js, change only what plays on that ${s.stem === "both" ? "music and effects" : `stem (${s.stem === "music" ? "the Strudel music" : "the Tone.js effects"})`} from ${span}. Keep every other sound byte-identical in timing and level: the same notes, hits, times and gains outside that span${s.stem === "both" ? "" : `, and everything on the ${s.stem === "music" ? "effects" : "music"}`}. Load the aerchain-sound-design skill (its "Changing one part" section), then render the sound again with the sound command. Their own volume edits in sound/mix.json are applied on top of whatever you render; never edit mix.json.</sound>`;
}

const mediaTool = (id: string) => `node ${path.join(ROOT, "scripts/studio/media-tool.mjs")} ${id}`;

// What a video film adds to the system prompt.
function videoPrompt(id: string) {
  const tool = mediaTool(id);
  return `

This film is a VIDEO EDIT of footage the person brought in. Load the aerchain-video-edit skill before your first change. The edit is edit.json, shaped as src/lib/studio/edit.ts: tracks of clips cut from the footage, graphics and music, plus captions. Change the edit by editing edit.json. The studio's graphics are in ${path.join(ROOT, "studio/graphics")}/ (look there, not across the whole project; the checker also lists them). For a graphic the studio doesn't have, write the film's own as graphics/<name>.jsx. "start" and caption times are on the film's timeline; a clip's "from" and "to" are seconds in its source. Keep film.json's duration equal to where the edit ends.

You can't open the footage files. To hear, see and measure them, run one of these per call, nothing chained:
  ${tool} list
  ${tool} words <media> [from] [to]
  ${tool} silences <media> [min-seconds] [threshold-dB]
  ${tool} scenes <media> [sensitivity]
  ${tool} frames <media> <t> [t ...]   (then Read the stills it names)
  ${tool} faces <media> [every-seconds]

For a voiceover, write the words to voice/<name>.txt in the film, then run exactly:
  ${voiceTool(id)} <voice> <words-per-minute> voice/<name>.txt
Voices: Rishi (Indian English, male, the default), Tara (Indian English, female), Aman (Indian English, male), Lekha (Hindi, female); pace 175 is normal. It lands in the film's media; place it on an audio track and transcribe it for captions.`;
}

const voiceTool = (id: string) => `node ${path.join(ROOT, "scripts/studio/voice.mjs")} ${id}`;

// A short picture of a video film's edit, sent with each message, so "the
// second clip" or "the lower third" makes sense.
async function editSummary(id: string, t: number): Promise<string> {
  let edit: Edit;
  try {
    edit = JSON.parse(await readFile(path.join(filmDir(id), "edit.json"), "utf8")) as Edit;
  } catch {
    return "edit.json is missing or unreadable";
  }
  const length = (item: Clip | Graphic) => (item.type === "clip" ? (item.to - item.from) / (item.speed ?? 1) : item.duration);
  const span = (item: Clip | Graphic) => `${item.start.toFixed(2)}-${(item.start + length(item)).toFixed(2)} s`;
  let end = 0;
  const lines: string[] = [];
  for (const track of edit.tracks ?? []) {
    const items = [...(track.items ?? [])].sort((a, b) => a.start - b.start);
    for (const item of items) end = Math.max(end, item.start + length(item));
    const shown = items.slice(0, 25).map((item) =>
      item.type === "clip"
        ? `${item.id}: ${item.media} source ${item.from.toFixed(2)}-${item.to.toFixed(2)} at ${span(item)}`
        : `${item.id}: ${item.graphic} at ${span(item)}`,
    );
    const more = items.length > 25 ? `; and ${items.length - 25} more` : "";
    const flags = [track.muted ? "muted" : null, track.hidden ? "hidden" : null].filter(Boolean).join(", ");
    lines.push(`${track.kind} track "${track.name}" (${track.id}${flags ? `, ${flags}` : ""}): ${shown.join("; ") || "empty"}${more}`);
  }
  // What the playhead is on, down to the moment in the source file, so
  // "cut here" lands on the exact frame.
  const under = atPlayhead(edit, t).map((a) =>
    a.type === "clip"
      ? `clip ${a.id} on ${a.track} (${a.media}): source ${a.source.toFixed(2)} s, ${a.intoClip.toFixed(2)} s into the clip, ${a.left.toFixed(2)} s left`
      : `graphic ${a.id} (${a.graphic}) on ${a.track}: ${a.intoGraphic.toFixed(2)} s in, ${a.left.toFixed(2)} s left`,
  );
  lines.push(`at the playhead (${t.toFixed(2)} s): ${under.join("; ") || "nothing, a gap"}`);
  const c = edit.captions;
  lines.push(`captions ${c?.on ? `on (${c.style}, ${c.position})` : "off"}, ${c?.words?.length ?? 0} words. The edit ends at ${end.toFixed(2)} s.`);
  return lines.join("\n");
}

function userMessage(
  film: Film,
  prompt: string,
  context: ChatContext,
  undone: boolean,
  wentBack: string | null,
  edit: string | null,
) {
  const lines = [
    `<film>engine ${ENGINE_WORDS[film.engine]}, ${film.width}x${film.height}, ${film.fps} fps, ${film.duration} s, title "${film.title}"</film>`,
    `<playhead>They stopped the playhead at ${context.t.toFixed(2)} s (frame ${Math.round(context.t * film.fps)}). "Here", "now", "this moment" and "at this point" mean exactly that time; make timed changes relative to it.</playhead>`,
  ];
  const pick = context.pick;
  if (pick) {
    const what = [
      pick.id ? `#${pick.id}` : null,
      pick.tag ? `<${pick.tag}>` : null,
      pick.text ? `showing "${pick.text}"` : null,
      pick.rect
        ? `box x ${Math.round(pick.rect.x)}, y ${Math.round(pick.rect.y)}, ${Math.round(pick.rect.width)} x ${Math.round(pick.rect.height)}`
        : null,
    ].filter(Boolean);
    lines.push(
      `<pointed>They pointed at film pixel (${Math.round(pick.x)}, ${Math.round(pick.y)}) at ${context.t.toFixed(2)} s${what.length ? `: ${what.join(", ")}` : ""}. "This" or "here" means that.</pointed>`,
    );
  }
  const kit = film.brand && isBrandId(film.brand) ? film.brand : DEFAULT_BRAND;
  lines.push(
    `<brand>The film's brand kit is "${kit}": ${path.join(brandDir(ROOT, kit), "brand.json")} (colours, fonts, logos, rules and notes, with its files beside it). Follow its rules, and draw with its tokens (see the aerchain-film skill) rather than fixed colours or fonts.</brand>`,
  );
  if (edit) lines.push(`<edit>\n${edit}\n</edit>`);
  if (context.selection?.length) {
    lines.push(`<selected>On the timeline they have selected ${context.selection.join(", ")}. "This", "these" or "the selected" means them.</selected>`);
  }
  if (context.sound) lines.push(soundSpanNote(context.sound));
  if (undone) lines.push("<note>They undid your previous change: the files are back to how they were before it.</note>");
  if (wentBack) {
    lines.push(
      `<note>They went back to an earlier version of the film, ${wentBack}: the files are back to how they were then, so changes you made since are gone. Read the files again before changing them.</note>`,
    );
  }
  const attached = attachmentNote(filmDir(film.id), context.attachments ?? []);
  if (attached) lines.push(attached);
  const heard = referenceSoundNote(film.id, film.kind, context.attachments ?? [], context.sound);
  if (heard) lines.push(heard);
  lines.push(`<request>\n${prompt}\n</request>`);
  // Repeated every turn, since a conversation keeps its first system prompt.
  lines.push("<reply>Work silently. Then answer in at most two short plain sentences (under 35 words), no lists or formatting. Ask one short question only if you truly can't guess.</reply>");
  return lines.join("\n");
}

// ─── Reading Claude's stream ─────────────────────────────────────────────────

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export class StreamReader {
  session: string | undefined;
  reply = "";
  steps: string[] = [];
  failure: string | null = null;
  changedAny = false;
  lastError: string | null = null;
  private tools = new Map<string, { name: string; file: string | null }>();
  private textBlocks = 0;
  private openText = false;

  constructor(
    private dir: string,
    private emit: (event: ChatEvent) => void,
  ) {}

  handle(msg: Json) {
    if (msg.session_id && !this.session) this.session = msg.session_id;
    if (msg.type === "stream_event") return this.partial(msg.event);
    if (msg.type === "assistant") {
      for (const block of msg.message?.content ?? []) {
        if (block.type === "tool_use") this.toolUse(block);
      }
      if (msg.error) this.lastError = String(msg.error);
      return;
    }
    if (msg.type === "user") {
      for (const block of msg.message?.content ?? []) {
        if (block.type === "tool_result") this.toolResult(block);
      }
      return;
    }
    if (msg.type === "result") {
      if (msg.session_id) this.session = msg.session_id;
      if (msg.is_error) this.failure = explain(String(msg.result ?? msg.subtype ?? ""));
    }
  }

  private partial(event: Json) {
    if (event?.type === "content_block_start" && event.content_block?.type === "text") {
      // A new paragraph of words, after some work in between.
      if (this.textBlocks++ > 0 && this.reply) this.say("\n\n");
      this.openText = true;
    } else if (event?.type === "content_block_delta" && event.delta?.type === "text_delta" && this.openText) {
      this.say(event.delta.text ?? "");
    } else if (event?.type === "content_block_stop") {
      this.openText = false;
    }
  }

  private say(text: string) {
    if (!text) return;
    this.reply += text;
    this.emit({ kind: "text", text });
  }

  private toolUse(block: Json) {
    const input = block.input ?? {};
    const file = typeof input.file_path === "string" ? input.file_path : typeof input.path === "string" ? input.path : null;
    this.tools.set(block.id, { name: block.name, file });
    const label = stepFor(block.name, input, this.dir);
    if (label && this.steps.at(-1) !== label) {
      this.steps.push(label);
      this.emit({ kind: "step", label });
    }
  }

  private toolResult(block: Json) {
    const tool = this.tools.get(block.tool_use_id);
    if (!tool || block.is_error) return;
    if ((tool.name === "Edit" || tool.name === "Write" || tool.name === "MultiEdit") && tool.file) {
      const abs = path.resolve(this.dir, tool.file);
      if (abs.startsWith(`${this.dir}${path.sep}`)) {
        this.changedAny = true;
        this.emit({ kind: "changed", files: [path.relative(this.dir, abs)] });
      }
    }
  }
}

const MEDIA_STEPS: Record<string, string> = {
  list: "Looking at the footage",
  words: "Reading what's said",
  silences: "Finding the pauses",
  scenes: "Finding the cuts",
  frames: "Watching the footage",
  faces: "Finding the speaker",
};

function stepFor(name: string, input: Json, dir: string): string | null {
  const file = typeof input.file_path === "string" ? path.resolve(dir, input.file_path) : null;
  const inFilm = file?.startsWith(`${dir}${path.sep}`) ?? false;
  if (dir.includes(`${path.sep}brands${path.sep}`)) return kitStepFor(name, file, dir);
  switch (name) {
    case "Read":
      if (inFilm) return "Reading the film";
      if (file?.includes(`${path.sep}.claude${path.sep}skills${path.sep}`)) return "Looking up how to do it";
      return "Looking at the house style";
    case "Glob":
    case "Grep":
      return "Looking around";
    case "Skill":
      return "Looking up how to do it";
    case "Edit":
    case "Write":
    case "MultiEdit":
      if (file?.endsWith("film.json")) return "Updating the film's settings";
      if (file?.endsWith("edit.json")) return "Editing the cut";
      if (file?.includes(`${path.sep}sound${path.sep}`)) return "Writing the sound";
      return file?.includes(`${path.sep}graphics${path.sep}`) ? "Making a graphic" : "Editing the film";
    case "Bash": {
      const command = String(input.command ?? "");
      if (command.includes("check-film")) return "Checking it";
      if (command.includes("render.mjs")) return "Making a draft";
      if (command.includes("sound.mjs")) return "Listening to the sound";
      if (command.includes("listen.mjs")) return command.includes("--stem") ? "Listening to the sound" : "Listening to your reference";
      if (command.includes("media-tool")) return MEDIA_STEPS[command.split(/\s+/)[3] ?? ""] ?? "Looking at the footage";
      return "Running a command";
    }
    default:
      return null;
  }
}

// A brand kit's turn, in the words of making a kit.
function kitStepFor(name: string, file: string | null, dir: string): string | null {
  const inKit = file?.startsWith(`${dir}${path.sep}`) ?? false;
  switch (name) {
    case "Read":
      if (inKit && /[/\\](guide|fonts|logos)[/\\]/.test(file ?? "")) return "Reading what you shared";
      if (file?.includes(`${path.sep}.claude${path.sep}skills${path.sep}`)) return "Looking up how to do it";
      return inKit ? "Looking at the kit" : "Looking at a full kit for reference";
    case "Glob":
    case "Grep":
      return "Looking through what you shared";
    case "WebFetch":
      return "Looking at the links";
    case "Edit":
    case "Write":
    case "MultiEdit":
      return "Writing the kit";
    case "Skill":
      return "Looking up how to do it";
    default:
      return null;
  }
}

// Plain-English versions of the ways a turn can fail.
export function explain(raw: string) {
  const text = raw.toLowerCase();
  if (/not logged in|please run \/login|invalid api key|authentication|oauth/.test(text)) {
    return "Claude isn't signed in on this Mac. Open Terminal, run `claude`, then type /login.";
  }
  if (/usage limit|rate limit|limit reached|too many requests|429/.test(text)) {
    return "Claude's usage limit is reached for now. Try again later; the message says when it resets.";
  }
  if (/credit balance|billing/.test(text)) return "Claude's account needs attention (billing). Check it in Claude's settings.";
  if (/overloaded|529|503/.test(text)) return "Claude is busy right now. Try again in a minute.";
  if (/max.?turns|error_max_turns/.test(text)) return "Claude ran out of steps before finishing. Ask it to carry on.";
  if (/enoent|command not found|spawn/.test(text)) return "Claude Code isn't installed where the studio can find it.";
  const firstLine = raw.trim().split("\n").find(Boolean);
  return firstLine ? `Claude stopped with an error: ${firstLine.slice(0, 200)}` : "Claude stopped without saying why. Try again.";
}
