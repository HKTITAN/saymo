import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CLAUDE_BIN, EFFORT, explain, killGroup, MODEL } from "./claude";
import { claudeEnvFor, keyProblem } from "./providers";
import { type Beat, cleanScript, type ScriptEvent, type ScriptRequest, tidy } from "./script";

// Writes a script and its storyboard in one quick Claude call: no tools,
// no project, no conversation kept, and the answer comes back as JSON in
// the shape of `Script` (the CLI's structured output). It runs on the
// owner's own Claude login, like the studio's chat (claude.ts), with the
// same model and effort; in the product edition, on the API key.
//
// While it writes, the beats are read out of the half-written JSON and
// sent on, so the storyboard fills in as Claude goes.

const LIMIT_MS = 4 * 60 * 1000;

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "A short working title, 2 to 6 words, sentence case." },
    beats: {
      type: "array",
      items: {
        type: "object",
        properties: {
          line: { type: "string", description: "What is said aloud in this beat: one or two short sentences." },
          visual: { type: "string", description: "What the motion graphic shows while it's said: 5 to 14 words." },
        },
        required: ["line", "visual"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "beats"],
  additionalProperties: false,
};

const SYSTEM = `You write short scripts for vertical social videos (Instagram Reels, LinkedIn, X) for the marketing team of Aerchain, a company that makes AI software for procurement (its platform is SpendOS). A person reads the script to camera from a teleprompter, and a motion graphic plays beside them for each beat.

Write how people talk: short sentences, plain words, one idea per beat, contractions, no jargon unless the brief uses it. Open with a hook in the first beat (a sharp claim, question or number from the brief). End with a clear close or call to action if the brief suggests one. Never invent statistics, customers or claims: use only facts in the brief, and otherwise write so no number is needed. Never use em dashes. No emoji, no hashtags, no stage directions in the spoken lines.

Each beat: "line" is exactly what is said aloud (one or two sentences, about 4 to 20 words); "visual" is a concrete idea for the motion graphic shown while it's said (an object, a number counting up, a diagram, a word on screen), 5 to 14 words, no camera directions for the speaker.

Answer only through the structured output.`;

const userMessage = ({ idea, seconds, keep }: ScriptRequest) => {
  const words = Math.round(seconds * 2.5);
  return keep
    ? `Here is my script. Keep my words exactly as written, in order: don't add, drop or change any spoken word. Only split it into beats at natural breaks (about one or two sentences each), give each beat a visual idea, and give the whole a title.\n\n<script>\n${idea}\n</script>`
    : `Write a script of about ${seconds} seconds read aloud (about ${words} words in all) from this brief, split into beats.\n\n<brief>\n${idea}\n</brief>`;
};

// Runs the call; `emit` gets each event and the promise ends with it.
// `signal` stops it (the page went away).
export async function writeScript(request: ScriptRequest, emit: (event: ScriptEvent) => void, signal: AbortSignal) {
  // An empty folder of its own, so no project files or notes come along.
  const cwd = path.join(tmpdir(), "studio-script");
  await mkdir(cwd, { recursive: true });
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model", MODEL,
    "--effort", EFFORT,
    "--tools", "",
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--setting-sources", "",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--system-prompt", SYSTEM,
    "--json-schema", JSON.stringify(SCHEMA),
  ];
  const noKey = await keyProblem();
  if (noKey) {
    emit({ kind: "error", message: noKey });
    return;
  }
  const proc = spawn(CLAUDE_BIN, args, { cwd, env: await claudeEnvFor(), stdio: ["pipe", "pipe", "pipe"], detached: true });
  const stop = () => proc.pid && killGroup(proc.pid);
  signal.addEventListener("abort", stop, { once: true });
  const limit = setTimeout(stop, LIMIT_MS);
  proc.stdin.end(userMessage(request));

  emit({ kind: "step", label: request.keep ? "Reading your script" : "Thinking it through" });
  let json = ""; // the structured answer, as it streams in
  let answer: unknown = null;
  let failure: string | null = null;
  let stderr = "";
  let shown = -1;
  let title = "";

  const handle = (msg: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (msg.type === "stream_event") {
      const e = msg.event;
      if (e?.type === "content_block_start" && e.content_block?.type === "tool_use") {
        emit({ kind: "step", label: request.keep ? "Splitting it into beats" : "Writing the script" });
      } else if (e?.type === "content_block_delta" && e.delta?.type === "input_json_delta") {
        json += e.delta.partial_json ?? "";
        const draft = partial(json);
        if (draft.title && draft.title !== title) title = draft.title;
        if (draft.beats.length !== shown) {
          shown = draft.beats.length;
          emit({ kind: "draft", title, beats: draft.beats });
          emit({ kind: "step", label: `Writing beat ${draft.beats.length + 1}` });
        }
      }
      return;
    }
    if (msg.type === "assistant") {
      for (const block of msg.message?.content ?? []) {
        if (block.type === "tool_use" && block.name === "StructuredOutput") answer = block.input;
      }
      return;
    }
    if (msg.type === "result") {
      if (msg.structured_output) answer = msg.structured_output;
      if (msg.is_error) failure = explain(String(msg.result ?? msg.subtype ?? ""));
    }
  };

  let buffer = "";
  proc.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        handle(JSON.parse(line));
      } catch {}
    }
  });
  proc.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
  const code = await new Promise<number | null>((resolve) => {
    proc.on("close", resolve);
    proc.on("error", (error) => {
      stderr += String(error);
      resolve(-1);
    });
  });
  clearTimeout(limit);
  signal.removeEventListener("abort", stop);
  if (signal.aborted) return;

  const script = cleanScript(answer);
  if (script) emit({ kind: "done", script });
  else if (failure || code !== 0) emit({ kind: "error", message: failure ?? explain(stderr) });
  else emit({ kind: "error", message: "Claude didn't send a script back. Try again." });
}

// The title and the beats that are complete so far, from JSON that's
// still arriving.
const STRING = String.raw`"((?:[^"\\]|\\.)*)"`;
const TITLE = new RegExp(String.raw`"title"\s*:\s*${STRING}`);
const BEAT = new RegExp(String.raw`\{\s*"line"\s*:\s*${STRING}\s*,\s*"visual"\s*:\s*${STRING}\s*\}`, "g");

function partial(json: string): { title: string; beats: Beat[] } {
  const unquote = (s: string) => {
    try {
      return tidy(JSON.parse(`"${s}"`) as string);
    } catch {
      return tidy(s);
    }
  };
  const t = TITLE.exec(json);
  const beats = [...json.matchAll(BEAT)].map((m) => ({ line: unquote(m[1]), visual: unquote(m[2]) }));
  return { title: t ? unquote(t[1]) : "", beats };
}
