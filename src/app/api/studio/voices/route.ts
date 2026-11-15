import { allowed, refused } from "@/lib/studio/films/films";
import { DEFAULT_VOICE, installedVoices, RATE, VOICES } from "@/lib/studio/sound/voice";

// The voices a voiceover can use, Indian first, and which are on this Mac.
export async function GET(request: Request) {
  if (!allowed(request)) return refused();
  const have = await installedVoices();
  return Response.json({
    voices: VOICES.map((v) => ({ ...v, installed: have.has(v.id) })),
    defaultVoice: DEFAULT_VOICE,
    rate: RATE,
  });
}
