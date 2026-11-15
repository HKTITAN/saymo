import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { EDITION } from "@/lib/studio/server/edition";
import { allowed, refused, ROOT } from "@/lib/studio/films/films";

// Who's using the studio, for the account panel at the foot of the sidebar:
// their name, the edition and the studio's version. The name is the one
// they set in Settings (.studio/profile.json), or else the one this Mac
// knows them by. Nothing is looked up anywhere else.
// GET says who; PUT {name} changes the name (empty goes back to the Mac's).

const run = promisify(execFile);
const profileFile = () => path.join(ROOT, ".studio", "profile.json");
let known: { macName: string; version: string } | null = null;

async function saved(): Promise<string> {
  try {
    const p = JSON.parse(await readFile(profileFile(), "utf8")) as { name?: unknown };
    return typeof p.name === "string" ? p.name.trim() : "";
  } catch {
    return "";
  }
}

async function me() {
  if (!known) {
    let macName = "";
    try {
      macName = (await run("id", ["-F"])).stdout.trim();
    } catch {
      // Not every system has a full name to give.
    }
    const version = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8").catch(() => "{}")).version ?? "";
    known = { macName: macName || userInfo().username, version };
  }
  return { name: (await saved()) || known.macName, macName: known.macName, version: known.version, edition: EDITION };
}

export async function GET(request: Request) {
  if (!allowed(request)) return refused();
  return Response.json(await me());
}

export async function PUT(request: Request) {
  if (!allowed(request)) return refused();
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  if (typeof body?.name !== "string" || body.name.trim().length > 60) {
    return Response.json({ error: "Use a name of 60 characters or fewer." }, { status: 400 });
  }
  await mkdir(path.dirname(profileFile()), { recursive: true });
  await writeFile(profileFile(), `${JSON.stringify({ name: body.name.trim() }, null, 2)}\n`);
  return Response.json(await me());
}
