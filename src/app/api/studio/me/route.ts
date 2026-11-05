import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { EDITION } from "@/lib/studio/edition";
import { allowed, refused, ROOT } from "@/lib/studio/films";

// Who's using the studio, for the account panel at the foot of the sidebar:
// the name this Mac knows them by, the edition and the studio's version.
// Nothing is looked up anywhere else.

const run = promisify(execFile);
let known: { name: string; version: string } | null = null;

export async function GET(request: Request) {
  if (!allowed(request)) return refused();
  if (!known) {
    let name = "";
    try {
      name = (await run("id", ["-F"])).stdout.trim();
    } catch {
      // Not every system has a full name to give.
    }
    const version = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8").catch(() => "{}")).version ?? "";
    known = { name: name || userInfo().username, version };
  }
  return Response.json({ ...known, edition: EDITION });
}
