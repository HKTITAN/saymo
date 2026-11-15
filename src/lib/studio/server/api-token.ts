import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

// The local API token: what lets apps outside the browser (the studio's MCP
// server and command line, Raycast, your own scripts) use the studio. One
// random token in .studio/api-token, readable only by this Mac's user
// (mode 600). Git ignores .studio/. The token is never logged or sent
// anywhere but back to the studio page that asks for it. See docs/security.md.
//
// scripts/studio/client.mjs makes the same file the same way when it is
// missing, so the command line works before the studio page has been opened.

// What the studio page is told (GET /api/studio/api-token), so it can show
// the token and copy-ready set-ups for other apps.
export type OutsideApps = {
  token: string;
  node: string; // this Mac's Node, by its real path (not a shell's shim)
  mcp: string; // scripts/studio/mcp.mjs
  cli: string; // scripts/studio/cli.mjs
  root: string; // the studio's folder
  port: string;
};

export const TOKEN_FILE =path.join(process.cwd(), ".studio", "api-token");

const g = globalThis as { __studioToken?: { mtime: number; token: string } };

const makeToken = () => `ms_${randomBytes(32).toString("base64url")}`;
const valid = (t: string) => /^ms_[A-Za-z0-9_-]{43}$/.test(t);

// The token as saved, or null if there isn't one yet. Read again only when
// the file changes.
export function readToken(): string | null {
  let mtime: number;
  try {
    mtime = statSync(TOKEN_FILE).mtimeMs;
  } catch {
    g.__studioToken = undefined;
    return null;
  }
  if (g.__studioToken?.mtime === mtime) return g.__studioToken.token;
  try {
    const token = readFileSync(TOKEN_FILE, "utf8").trim();
    if (!valid(token)) return null;
    g.__studioToken = { mtime, token };
    return token;
  } catch {
    return null;
  }
}

function save(token: string) {
  mkdirSync(path.dirname(TOKEN_FILE), { recursive: true, mode: 0o700 });
  // Written aside and renamed, so a half-written token never counts.
  const tmp = `${TOKEN_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, `${token}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, TOKEN_FILE);
  g.__studioToken = undefined;
}

// The token, made the first time it's asked for. A file anyone else on the
// Mac could read is tightened to mode 600.
export function ensureToken(): string {
  const token = readToken();
  if (!token) {
    const fresh = makeToken();
    save(fresh);
    return fresh;
  }
  try {
    if ((statSync(TOKEN_FILE).mode & 0o077) !== 0) chmodSync(TOKEN_FILE, 0o600);
  } catch {
    // Read just now; if it's gone, the next request makes a new one.
  }
  return token;
}

// A new token. The old one stops working at once.
export function replaceToken(): string {
  const fresh = makeToken();
  save(fresh);
  return fresh;
}

const digest = (s: string) => createHash("sha256").update(s).digest();

// Whether an Authorization header carries the token. Both sides are hashed
// first so the comparison takes the same time whatever was sent.
export function tokenMatches(header: string): boolean {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  const token = readToken();
  if (!m || !token) return false;
  return timingSafeEqual(digest(m[1]), digest(token));
}
