import { DictationError, discardKept, removeExtra, retryKept, startExtra, startSetup, status, stopExtra, takePiece } from "@/lib/studio/input/dictation";
import { type DictationErrorCode, isAccuracy, isExtra, isLanguage, isScript, MAX_PIECE_BYTES, RECORDING_ID } from "@/lib/studio/input/dictation-shared";
import { allowed, refused } from "@/lib/studio/films/films";

// Talking into a prompt box (dictation.ts).
//  GET  what's set up, and recordings kept because they weren't written down
//  POST one piece of a recording (16 kHz mono WAV; WebM or MP4 when the
//       browser recorded plainly) → { text, language }.
//       Headers: x-dictation (the recording's id), x-piece (0, 1, 2…),
//       x-language, x-script, x-accuracy, x-context (URL-encoded words
//       just before). With x-keep: 1 it's only kept, to write down later
//       (its prompt box closed while recording).
//  PUT  { action }: "setup"; "get", "stop" or "remove" { model: "best" |
//       "hinglish" }; "retry" { id } or "discard" { id }.

const failure = (error: unknown, fallback: string, kept: boolean) => {
  if (!(error instanceof DictationError)) console.error("[studio dictation]", error);
  const code: DictationErrorCode = error instanceof DictationError ? error.code : "failed";
  const message = error instanceof DictationError ? error.message : fallback;
  return Response.json({ error: message, code, kept }, { status: code === "gone" ? 404 : code === "audio" ? 400 : 503 });
};

export async function GET(request: Request) {
  if (!allowed(request)) return refused();
  return Response.json(await status());
}

export async function POST(request: Request) {
  if (!allowed(request)) return refused();
  const id = request.headers.get("x-dictation") ?? "";
  const n = Number(request.headers.get("x-piece"));
  const language = request.headers.get("x-language");
  const script = request.headers.get("x-script");
  const accuracy = request.headers.get("x-accuracy") ?? "fast";
  if (!RECORDING_ID.test(id) || !Number.isInteger(n) || n < 0 || n > 999 || !isLanguage(language) || !isScript(script) || !isAccuracy(accuracy)) {
    return Response.json({ error: "Send a piece of a recording with its id, number, language and script.", code: "audio", kept: false }, { status: 400 });
  }
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim();
  const kind = type === "audio/wav" ? "wav" : type === "audio/webm" ? "webm" : type === "audio/mp4" ? "mp4" : null;
  if (!kind) return Response.json({ error: "The recording didn't arrive as sound.", code: "audio", kept: false }, { status: 415 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_PIECE_BYTES) return Response.json({ error: "That piece of the recording is too large.", code: "audio", kept: false }, { status: 413 });
  if (!request.body) return Response.json({ error: "The recording was empty.", code: "audio", kept: false }, { status: 400 });
  let context = "";
  try {
    context = decodeURIComponent(request.headers.get("x-context") ?? "").slice(-400);
  } catch {}
  try {
    const keepOnly = request.headers.get("x-keep") === "1";
    return Response.json(await takePiece(id, n, kind, request.body, { language, script, accuracy, context }, keepOnly));
  } catch (error) {
    // Kept on disk unless it never arrived.
    return failure(error, "Writing this down failed. Your recording is kept, so you can try again.", !(error instanceof DictationError && error.code === "audio"));
  }
}

export async function PUT(request: Request) {
  if (!allowed(request)) return refused();
  let body: { action?: unknown; id?: unknown; model?: unknown; language?: unknown; script?: unknown; accuracy?: unknown; context?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send what to do." }, { status: 400 });
  }
  const id = typeof body.id === "string" && RECORDING_ID.test(body.id) ? body.id : null;
  const model = isExtra(body.model) ? body.model : null;
  switch (body.action) {
    case "setup":
      startSetup();
      return Response.json(await status());
    case "get":
      if (!model) break;
      startExtra(model);
      return Response.json(await status());
    case "stop":
      if (!model) break;
      stopExtra(model);
      return Response.json(await status());
    case "remove":
      if (!model) break;
      await removeExtra(model);
      return Response.json(await status());
    case "retry":
      if (!id) break;
      try {
        return Response.json(
          await retryKept(id, {
            language: isLanguage(body.language) ? body.language : undefined,
            script: isScript(body.script) ? body.script : undefined,
            accuracy: isAccuracy(body.accuracy) ? body.accuracy : undefined,
            context: typeof body.context === "string" ? body.context.slice(-400) : undefined,
          }),
        );
      } catch (error) {
        return failure(error, "Writing this down failed. Your recording is kept, so you can try again.", true);
      }
    case "discard":
      if (!id) break;
      await discardKept(id);
      return new Response(null, { status: 204 });
  }
  return Response.json({ error: "The studio doesn't know that action." }, { status: 400 });
}
