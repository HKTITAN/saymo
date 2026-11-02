import { connection } from "next/server";
import { failed } from "@/lib/studio/connect-http";
import { allowed, refused } from "@/lib/studio/films";
import { aiStatus } from "@/lib/studio/providers";

// Which AIs can make a film's changes on this Mac, and how to set each one
// up. Never a key or token: only states, plan names and set-up steps.
export async function GET(request: Request) {
  await connection();
  if (!allowed(request)) return refused();
  try {
    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    return Response.json(await aiStatus(fresh), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return failed(error);
  }
}
