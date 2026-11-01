import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// Makes a landmark in the post's own style with Vercel's AI Gateway. The
// towers from the original post go along as the style example, cut out on
// a magenta screen, and the new landmark comes back on the same screen for
// the tool to key out: nothing in a black-and-white landmark is magenta,
// not even its trees.

const ENDPOINT = "https://ai-gateway.vercel.sh/v1/chat/completions";
// Google's Nano Banana 2.1: good at copying a style example, about 4 cents
// a picture.
const MODEL = "google/gemini-nano-banana-2.1";
// The shape asked for, 4:5; the model answers in the shape of the example.
const FRAME = { width: 928, height: 1152 };
const EXAMPLE = "assets/places/kuala-lumpur-skyline.png";

export type Action = { label: string; url: string };

export class GenerateError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly action?: Action,
  ) {
    super(message);
  }
}

// The key lives in .env.local. One added while the server runs is read from
// the file directly, so nothing needs restarting.
async function gatewayKey() {
  if (process.env.AI_GATEWAY_API_KEY) return process.env.AI_GATEWAY_API_KEY;
  const file = await readFile(path.join(process.cwd(), ".env.local"), "utf8").catch(() => "");
  return /^AI_GATEWAY_API_KEY=(.+)$/m.exec(file)?.[1].trim() || null;
}

// The towers, on the screen colour, in the frame asked for.
const g = globalThis as { __styleExample?: Promise<Buffer> };
function styleExample() {
  g.__styleExample ??= (async () => {
    const height = Math.round(FRAME.height * 0.86);
    const towers = await sharp(path.join(process.cwd(), EXAMPLE)).resize({ height }).png().toBuffer();
    const { width = 0 } = await sharp(towers).metadata();
    return sharp({ create: { ...FRAME, channels: 3, background: "#FF00FF" } })
      .composite([{ input: towers, left: Math.round((FRAME.width - width) / 2), top: FRAME.height - height }])
      .png()
      .toBuffer();
  })();
  return g.__styleExample;
}

const instructions = (place: string) => `The attached picture shows the house style: the Petronas Towers in Kuala Lumpur as a crisp black-and-white photograph, high contrast and finely detailed, the landmark tall in the centre, a few lower buildings beside it and a band of trees along the bottom, everything standing on the bottom edge of the frame, cut out on a flat, solid magenta (#FF00FF) background.

Make a new picture in exactly that style, framing and background for: ${place}. If that is a city, region or country, show its most famous landmark, for example the Burj Khalifa for Dubai. Show the whole landmark from its base to its tip, tall and centred, with lower buildings and trees at its base as in the example. Keep everything strictly black and white, with no colour at all. Keep the background flat, solid magenta (#FF00FF): no gradient, sky, clouds, shadow, ground, text, logo, watermark or border.

First reply with the landmark's name and nothing else, then the picture.`;

// "**Burj Khalifa**" reads "Burj Khalifa"; anything chattier falls back to
// what was typed.
function landmarkName(text: unknown, typed: string) {
  const line = typeof text === "string" ? (text.split("\n").find((l) => l.trim()) ?? "") : "";
  const name = line.replace(/[*_#"“”]/g, "").replace(/[.:]+$/, "").trim();
  if (name && name.length <= 60) return name;
  return typed.charAt(0).toUpperCase() + typed.slice(1);
}

// The gateway's refusals, in plain words, with the page that fixes them.
function explain(status: number, body: { error?: { message?: string; type?: string } } | null) {
  const message = body?.error?.message ?? "";
  const link = /https:\/\/vercel\.com\/\S+/.exec(message)?.[0].replace(/[.)]+$/, "");
  if (body?.error?.type === "customer_verification_required" || /credit card/i.test(message)) {
    return new GenerateError(
      "Vercel needs a card on your account before it makes pictures. Adding one unlocks the free monthly credit.",
      403,
      { label: "Add a card on Vercel", url: link ?? "https://vercel.com/dashboard" },
    );
  }
  if (status === 401) return new GenerateError("The AI Gateway key in .env.local no longer works.", 401);
  if (status === 402) {
    return new GenerateError("This month's picture budget has run out. It starts again next month.", 402);
  }
  if (status === 429) return new GenerateError("Too many pictures at once. Try again in a minute.", 429);
  return new GenerateError(
    message ? `The picture service said: ${message}` : `The picture service failed (${status}).`,
    502,
  );
}

export async function generateLandmark(place: string) {
  const key = await gatewayKey();
  if (!key) {
    throw new GenerateError(
      "There is no AI Gateway key yet. Run `vercel ai-gateway api-keys create` and put it in .env.local as AI_GATEWAY_API_KEY.",
      409,
    );
  }
  const example = await styleExample();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: instructions(place) },
            { type: "image_url", image_url: { url: `data:image/png;base64,${example.toString("base64")}` } },
          ],
        },
      ],
      modalities: ["text", "image"],
      stream: false,
    }),
    signal: AbortSignal.timeout(150_000),
  }).catch((error: Error) => {
    throw new GenerateError(
      error.name === "TimeoutError" ? "The picture took too long. Try again." : "Could not reach Vercel. Check the internet connection.",
      504,
    );
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw explain(res.status, body);

  const message = body?.choices?.[0]?.message;
  const url: string | undefined = message?.images?.find(
    (i: { image_url?: { url?: string } }) => i?.image_url?.url,
  )?.image_url.url;
  if (!url) {
    throw new GenerateError("No picture came back. Try other words, like the landmark's own name.", 502);
  }
  return {
    image: Buffer.from(url.slice(url.indexOf(",") + 1), "base64"),
    name: landmarkName(message.content, place),
  };
}
