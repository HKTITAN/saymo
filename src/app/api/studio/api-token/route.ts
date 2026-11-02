import { realpathSync } from "node:fs";
import path from "node:path";
import { connection } from "next/server";
import { ensureToken, type OutsideApps, replaceToken } from "@/lib/studio/api-token";
import { fromPage, refused } from "@/lib/studio/films";

// The local API token and what other apps need to use the studio, for the
// "Use the studio from other apps" section. Only the studio page itself can
// ask: an app holding the token can't read or replace it here.
//
// GET  /api/studio/api-token → OutsideApps (makes the token the first time)
// POST /api/studio/api-token → OutsideApps with a new token; the old one
//                              stops working at once

function describe(request: Request, token: string): OutsideApps {
  const root = process.cwd();
  let node = process.execPath;
  try {
    node = realpathSync(node);
  } catch {
    // The path as reported is still usable.
  }
  const port = (request.headers.get("host") ?? "").match(/:(\d+)$/)?.[1] ?? "3200";
  return {
    token,
    node,
    mcp: path.join(root, "scripts/studio/mcp.mjs"),
    cli: path.join(root, "scripts/studio/cli.mjs"),
    root,
    port,
  };
}

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request) {
  await connection();
  if (!fromPage(request)) return refused();
  return Response.json(describe(request, ensureToken()), { headers: NO_STORE });
}

export async function POST(request: Request) {
  if (!fromPage(request)) return refused();
  return Response.json(describe(request, replaceToken()), { headers: NO_STORE });
}
