import { connection } from "next/server";
import { figmaReady } from "@/lib/studio/brands/figma";
import { allowed, refused } from "@/lib/studio/films/films";

// Whether the studio can open Figma links (a FIGMA_TOKEN is set). Only the
// yes or no leaves the server, never the token.
export async function GET(request: Request) {
  await connection();
  if (!allowed(request)) return refused();
  return Response.json({ ready: figmaReady() });
}
