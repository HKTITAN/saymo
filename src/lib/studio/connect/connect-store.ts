import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT } from "../films/films";
import { privateDir } from "../server/platform";

// Where connections keep what they need between restarts: tokens and which
// account, folder and repository are in use. Only the server reads it;
// .studio/ is ignored by git, its folders are private to this Mac's user
// (700) and its files too (600). Nothing from here is ever sent to the
// page, logged, or passed to a Claude turn.

export const STUDIO_DIR = path.join(ROOT, ".studio");
const DIR = path.join(STUDIO_DIR, "connections");
const fileOf = (name: string) => path.join(DIR, `${name}.json`);

async function ensureDir() {
  privateDir(STUDIO_DIR);
  privateDir(DIR);
}

export async function readSecret<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(fileOf(name), "utf8")) as T;
  } catch {
    return null;
  }
}

export async function writeSecret(name: string, value: unknown) {
  await ensureDir();
  const file = fileOf(name);
  // Written aside with no access for anyone else, then moved into place.
  await writeFile(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  await chmod(`${file}.tmp`, 0o600);
  await rename(`${file}.tmp`, file);
}

export async function removeSecret(name: string) {
  await rm(fileOf(name), { force: true });
}

// One change at a time per connection.
const g = globalThis as { __connectLocks?: Map<string, Promise<unknown>> };
const locks = (g.__connectLocks ??= new Map());
export function withConnection<T>(name: string, job: () => Promise<T>): Promise<T> {
  const run = (locks.get(name) ?? Promise.resolve()).catch(() => {}).then(job);
  locks.set(name, run);
  return run;
}

// Errors safe to show: plain words, never a token or a server's raw reply.
export class ConnectError extends Error {}
