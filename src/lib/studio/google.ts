import { createHash, randomBytes } from "node:crypto";
import { ConnectError, readSecret, removeSecret, withConnection, writeSecret } from "./connect-store";
import type { GoogleAccount } from "./connect-types";

// Google Drive, through Google's own sign-in (OAuth 2.0 with PKCE). The
// studio asks only for `drive.file`: it can see and change the files and
// folders it makes itself, nothing else in anyone's Drive. Several people
// can link their Drives on this Mac; one is in use at a time.
//
// The one-time set-up is a Google Cloud OAuth client whose id and secret go
// in .env.local as GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const FOLDER_NAME = "Aerchain Studio";
const FOLDER_TYPE = "application/vnd.google-apps.folder";

// The addresses are fixed Google endpoints; the API base can point at a
// stand-in server for testing (never set in normal use).
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = process.env.STUDIO_GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token";
const REVOKE_URL = process.env.STUDIO_GOOGLE_REVOKE_URL ?? "https://oauth2.googleapis.com/revoke";
export const API = process.env.STUDIO_GOOGLE_API ?? "https://www.googleapis.com";

const client = () => {
  const id = process.env.GOOGLE_CLIENT_ID?.trim();
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : null;
};
export const googleConfigured = () => client() !== null;

export const redirectUriFor = (origin: string) => `${origin}/api/studio/connect/google/callback`;

// ─── Saved accounts ───────────────────────────────────────────────────────

type Saved = {
  active: string | null; // email
  autoDrafts: boolean;
  accounts: {
    email: string;
    name: string | null;
    refreshToken: string;
    accessToken: string | null;
    expiresAt: number; // ms
    folderId: string | null;
    folderName: string;
    folderLink: string | null;
  }[];
};
const SECRET = "google";
const empty = (): Saved => ({ active: null, autoDrafts: false, accounts: [] });
const load = async () => (await readSecret<Saved>(SECRET)) ?? empty();

export async function googleAccounts(): Promise<{ accounts: GoogleAccount[]; autoDrafts: boolean }> {
  const saved = await load();
  return {
    autoDrafts: saved.autoDrafts,
    accounts: saved.accounts.map((a) => ({
      email: a.email,
      name: a.name,
      folderName: a.folderName,
      folderLink: a.folderLink,
      active: a.email === saved.active,
    })),
  };
}

// ─── Signing in ───────────────────────────────────────────────────────────

type Pending = { verifier: string; redirectUri: string; returnTo: string; at: number };
const g = globalThis as { __googlePending?: Map<string, Pending> };
const pending = (g.__googlePending ??= new Map());
const TEN_MINUTES = 10 * 60 * 1000;

const b64url = (buf: Buffer) => buf.toString("base64url");

// Where to send the browser to sign in. `state` ties the answer to this
// request; the PKCE verifier stays here and proves the code is ours.
export function googleSignInUrl(origin: string, returnTo: string): string {
  const c = client();
  if (!c) throw new ConnectError("Google Drive isn't set up on this studio yet.");
  for (const [k, p] of pending) if (Date.now() - p.at > TEN_MINUTES) pending.delete(k);
  const state = b64url(randomBytes(32));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const redirectUri = redirectUriFor(origin);
  pending.set(state, { verifier, redirectUri, returnTo, at: Date.now() });
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: c.id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline",
    // Always ask, so Google sends a refresh token even on a second link.
    prompt: "consent select_account",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

// Google's answer: checks `state`, swaps the code for tokens, finds who it
// is and sets up the folder. Returns where to send the browser back to.
export async function finishGoogleSignIn(state: string | null, code: string | null, error: string | null) {
  const flow = state ? pending.get(state) : undefined;
  if (state) pending.delete(state);
  if (!flow || Date.now() - flow.at > TEN_MINUTES) {
    throw new ConnectError("That sign-in link has expired or didn't start here. Try connecting again.");
  }
  if (error || !code) {
    throw Object.assign(new ConnectError(error === "access_denied" ? "Google Drive wasn't connected: access was declined." : "Google didn't finish the sign-in. Try again."), { returnTo: flow.returnTo });
  }
  const c = client();
  if (!c) throw new ConnectError("Google Drive isn't set up on this studio yet.");
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: flow.redirectUri,
    code_verifier: flow.verifier,
    client_id: c.id,
    client_secret: c.secret,
  });
  if (!tokens.refresh_token) {
    throw Object.assign(new ConnectError("Google didn't allow offline access. Remove the studio's access in your Google account and connect again."), { returnTo: flow.returnTo });
  }
  const access = tokens.access_token;
  const me = await driveJson<{ user?: { emailAddress?: string; displayName?: string } }>(access, "/drive/v3/about?fields=user(emailAddress,displayName)");
  const email = me.user?.emailAddress;
  if (!email) throw new ConnectError("Google didn't say which account this is. Try again.");
  await withConnection(SECRET, async () => {
    const saved = await load();
    const old = saved.accounts.find((a) => a.email === email);
    const account = {
      email,
      name: me.user?.displayName ?? null,
      refreshToken: tokens.refresh_token as string,
      accessToken: access,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      folderId: old?.folderId ?? null,
      folderName: old?.folderName ?? FOLDER_NAME,
      folderLink: old?.folderLink ?? null,
    };
    saved.accounts = [...saved.accounts.filter((a) => a.email !== email), account];
    saved.active = email;
    await writeSecret(SECRET, saved);
  });
  await rootFolder(); // made now, so the first render doesn't wait for it
  return flow.returnTo;
}

type TokenReply = { access_token: string; refresh_token?: string; expires_in?: number; error?: string };
async function tokenRequest(body: Record<string, string>): Promise<TokenReply> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  }).catch(() => null);
  if (!res) throw new ConnectError("Unable to reach Google. Check the internet connection.");
  const reply = (await res.json().catch(() => ({}))) as TokenReply;
  if (!res.ok || !reply.access_token) {
    if (reply.error === "invalid_grant") throw new ConnectError("Google no longer accepts this sign-in. Connect Google Drive again.");
    if (reply.error === "invalid_client") throw new ConnectError("Google didn't recognise the studio's OAuth client. Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local.");
    throw new ConnectError("Google refused the sign-in. Try connecting again.");
  }
  return reply;
}

// ─── Using the active account ─────────────────────────────────────────────

// A fresh access token for the account in use, refreshed when it's close
// to running out.
export async function accessToken(): Promise<{ token: string; email: string }> {
  return withConnection(SECRET, async () => {
    const saved = await load();
    const a = saved.accounts.find((x) => x.email === saved.active);
    if (!a) throw new ConnectError("No Google Drive is connected.");
    if (a.accessToken && a.expiresAt - Date.now() > 60_000) return { token: a.accessToken, email: a.email };
    const c = client();
    if (!c) throw new ConnectError("Google Drive isn't set up on this studio any more. Check .env.local.");
    const reply = await tokenRequest({ grant_type: "refresh_token", refresh_token: a.refreshToken, client_id: c.id, client_secret: c.secret });
    a.accessToken = reply.access_token;
    a.expiresAt = Date.now() + (reply.expires_in ?? 3600) * 1000;
    await writeSecret(SECRET, saved);
    return { token: a.accessToken, email: a.email };
  });
}

export async function driveJson<T>(token: string, pathAndQuery: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${pathAndQuery}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
  }).catch(() => null);
  if (!res) throw new ConnectError("Unable to reach Google Drive. Check the internet connection.");
  if (res.status === 401) throw new ConnectError("Google Drive signed the studio out. Connect it again.");
  if (res.status === 403) throw new ConnectError("Google Drive refused: the Drive may be full, or the Drive API isn't turned on for the studio's Google Cloud project.");
  if (!res.ok) throw new ConnectError(`Google Drive answered with error ${res.status}. Try again in a moment.`);
  return (await res.json()) as T;
}

type DriveFile = { id: string; name: string; webViewLink?: string };

async function findFolder(token: string, name: string, parent: string | null): Promise<DriveFile | null> {
  const q = [`name = '${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`, `mimeType = '${FOLDER_TYPE}'`, "trashed = false", parent ? `'${parent}' in parents` : null]
    .filter(Boolean)
    .join(" and ");
  const found = await driveJson<{ files: DriveFile[] }>(token, `/drive/v3/files?${new URLSearchParams({ q, fields: "files(id,name,webViewLink)", pageSize: "1" })}`);
  return found.files[0] ?? null;
}

export async function ensureFolder(token: string, name: string, parent: string | null): Promise<DriveFile> {
  const found = await findFolder(token, name, parent);
  if (found) return found;
  return driveJson<DriveFile>(token, "/drive/v3/files?fields=id,name,webViewLink", {
    method: "POST",
    body: JSON.stringify({ name, mimeType: FOLDER_TYPE, ...(parent ? { parents: [parent] } : {}) }),
  });
}

// The studio's folder in the active Drive, made if it isn't there.
export async function rootFolder(): Promise<{ token: string; email: string; folder: DriveFile }> {
  const { token, email } = await accessToken();
  const saved = await load();
  const a = saved.accounts.find((x) => x.email === email);
  if (!a) throw new ConnectError("No Google Drive is connected.");
  if (a.folderId) {
    const still = await driveJson<DriveFile & { trashed?: boolean }>(token, `/drive/v3/files/${a.folderId}?fields=id,name,webViewLink,trashed`).catch(() => null);
    if (still && !still.trashed) return { token, email, folder: still };
  }
  const folder = await ensureFolder(token, a.folderName, null);
  await withConnection(SECRET, async () => {
    const now = await load();
    const b = now.accounts.find((x) => x.email === email);
    if (b) {
      b.folderId = folder.id;
      b.folderLink = folder.webViewLink ?? null;
      await writeSecret(SECRET, now);
    }
  });
  return { token, email, folder };
}

// ─── Settings ─────────────────────────────────────────────────────────────

export async function setGoogle(change: { active?: string; autoDrafts?: boolean; folderName?: string }) {
  await withConnection(SECRET, async () => {
    const saved = await load();
    if (change.active !== undefined) {
      if (!saved.accounts.some((a) => a.email === change.active)) throw new ConnectError("That Google account isn't connected here.");
      saved.active = change.active;
    }
    if (change.autoDrafts !== undefined) saved.autoDrafts = change.autoDrafts;
    if (change.folderName !== undefined) {
      const name = change.folderName.trim().slice(0, 100);
      if (!name) throw new ConnectError("Give the folder a name.");
      const a = saved.accounts.find((x) => x.email === saved.active);
      if (a && a.folderName !== name) {
        a.folderName = name;
        a.folderId = null; // found or made by that name on the next save
        a.folderLink = null;
      }
    }
    await writeSecret(SECRET, saved);
  });
}

export const autoSaveDrafts = async () => (await load()).autoDrafts;
export const driveConnected = async () => (await load()).active !== null;

// Signs an account out: Google forgets the studio's access, then so does
// this Mac.
export async function disconnectGoogle(email: string) {
  await withConnection(SECRET, async () => {
    const saved = await load();
    const a = saved.accounts.find((x) => x.email === email);
    if (!a) return;
    await fetch(`${REVOKE_URL}?${new URLSearchParams({ token: a.refreshToken })}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    }).catch(() => {});
    saved.accounts = saved.accounts.filter((x) => x.email !== email);
    if (saved.active === email) saved.active = saved.accounts[0]?.email ?? null;
    if (saved.accounts.length) await writeSecret(SECRET, saved);
    else if (saved.autoDrafts) await writeSecret(SECRET, { ...empty(), autoDrafts: true });
    else await removeSecret(SECRET);
  });
}
