import { spawn } from "node:child_process";
import { ConnectError, readSecret, removeSecret, withConnection, writeSecret } from "./connect-store";
import type { GithubRepo } from "./connect-types";

// GitHub, for keeping each film's source in a library repository.
//
// Two ways in. With a GitHub OAuth App's client id in .env.local
// (GITHUB_CLIENT_ID), anyone signs in with a code on github.com (the device
// flow, which needs no secret). Without one, the studio uses this Mac's own
// GitHub CLI sign-in (`gh`), asking it for a token each time and never
// keeping a copy.

const API = "https://api.github.com";
const SECRET = "github";

type Saved = {
  via: "device" | "gh";
  login: string;
  userId: number;
  token: string | null; // device flow only; `gh` is asked each time
  repo: GithubRepo | null;
};

const load = () => readSecret<Saved>(SECRET);
export const deviceFlowAvailable = () => Boolean(process.env.GITHUB_CLIENT_ID?.trim());

const run = (cmd: string, args: string[]) =>
  new Promise<{ code: number; out: string }>((resolve) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    proc.stdout.on("data", (d) => {
      out += String(d);
    });
    proc.on("error", () => resolve({ code: 1, out: "" }));
    proc.on("close", (code) => resolve({ code: code ?? 1, out: out.trim() }));
  });

const ghToken = async () => {
  const { code, out } = await run("gh", ["auth", "token", "--hostname", "github.com"]);
  return code === 0 && out ? out : null;
};
export const ghAvailable = async () => (await ghToken()) !== null;

// The token to use now, from wherever this connection gets it.
export async function githubToken(): Promise<{ token: string; saved: Saved }> {
  const saved = await load();
  if (!saved) throw new ConnectError("GitHub isn't connected. Connect it under Where films are saved.");
  const token = saved.via === "gh" ? await ghToken() : saved.token;
  if (!token) {
    throw new ConnectError(
      saved.via === "gh" ? "This Mac's GitHub sign-in has ended. Run `gh auth login` in Terminal, or connect GitHub again." : "GitHub signed the studio out. Connect GitHub again.",
    );
  }
  return { token, saved };
}

export async function gh<T>(token: string, pathAndQuery: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API}${pathAndQuery}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  }).catch(() => null);
  if (!res) throw new ConnectError("Unable to reach GitHub. Check the internet connection.");
  if (res.status === 401) throw new ConnectError("GitHub signed the studio out. Connect GitHub again.");
  const body = (await res.json().catch(() => null)) as T;
  return { status: res.status, body };
}

async function whoAmI(token: string) {
  const me = await gh<{ login?: string; id?: number }>(token, "/user");
  if (me.status !== 200 || !me.body.login || !me.body.id) throw new ConnectError("GitHub didn't say which account this is. Try again.");
  return { login: me.body.login, userId: me.body.id };
}

// ─── Signing in ───────────────────────────────────────────────────────────

type Pending = { deviceCode: string; userCode: string; verificationUri: string; interval: number; expiresAt: number; nextPoll: number };
const g = globalThis as { __githubPending?: Pending | null };

export const githubPending = () => {
  const p = g.__githubPending;
  if (!p || p.expiresAt < Date.now()) return null;
  return { userCode: p.userCode, verificationUri: p.verificationUri, expiresAt: new Date(p.expiresAt).toISOString() };
};

// Starts a sign-in: with the device flow, a code to enter on github.com;
// otherwise this Mac's GitHub CLI, at once.
export async function startGithub(): Promise<"connected" | "code"> {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  if (!clientId) {
    const token = await ghToken();
    if (!token) {
      throw new ConnectError("To connect GitHub, either set GITHUB_CLIENT_ID in .env.local, or sign in to GitHub in Terminal with `gh auth login`.");
    }
    const me = await whoAmI(token);
    await withConnection(SECRET, async () => {
      const old = await load();
      await writeSecret(SECRET, { via: "gh", ...me, token: null, repo: old?.login === me.login ? old.repo : null } satisfies Saved);
    });
    return "connected";
  }
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scope: "repo" }),
  }).catch(() => null);
  const reply = (await res?.json().catch(() => null)) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    interval?: number;
    expires_in?: number;
  } | null;
  if (!reply?.device_code || !reply.user_code) {
    throw new ConnectError("GitHub didn't start the sign-in. Check GITHUB_CLIENT_ID in .env.local, and that the OAuth App allows the device flow.");
  }
  g.__githubPending = {
    deviceCode: reply.device_code,
    userCode: reply.user_code,
    verificationUri: reply.verification_uri ?? "https://github.com/login/device",
    interval: (reply.interval ?? 5) * 1000,
    expiresAt: Date.now() + (reply.expires_in ?? 900) * 1000,
    nextPoll: Date.now(),
  };
  return "code";
}

// Asks GitHub whether the code has been entered yet.
export async function pollGithub(): Promise<"connected" | "waiting" | "expired"> {
  const p = g.__githubPending;
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  if (!p || !clientId) return "expired";
  if (p.expiresAt < Date.now()) {
    g.__githubPending = null;
    return "expired";
  }
  if (Date.now() < p.nextPoll) return "waiting";
  p.nextPoll = Date.now() + p.interval;
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, device_code: p.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
  }).catch(() => null);
  const reply = (await res?.json().catch(() => null)) as { access_token?: string; error?: string; interval?: number } | null;
  if (reply?.access_token) {
    g.__githubPending = null;
    const me = await whoAmI(reply.access_token);
    await withConnection(SECRET, async () => {
      const old = await load();
      await writeSecret(SECRET, { via: "device", ...me, token: reply.access_token as string, repo: old?.login === me.login ? old.repo : null } satisfies Saved);
    });
    return "connected";
  }
  if (reply?.error === "slow_down") p.interval += 5000;
  if (reply?.error === "expired_token" || reply?.error === "access_denied") {
    g.__githubPending = null;
    return "expired";
  }
  return "waiting";
}

export const cancelGithubSignIn = () => {
  g.__githubPending = null;
};

// ─── State ────────────────────────────────────────────────────────────────

export async function githubState() {
  const saved = await load();
  let owners: string[] = [];
  if (saved) {
    try {
      const { token } = await githubToken();
      const orgs = await gh<{ login: string }[]>(token, "/user/orgs?per_page=100");
      owners = [saved.login, ...(orgs.status === 200 && Array.isArray(orgs.body) ? orgs.body.map((o) => o.login) : [])];
    } catch {
      owners = [saved.login];
    }
  }
  return {
    connected: saved ? { login: saved.login, via: saved.via } : null,
    repo: saved?.repo ?? null,
    owners,
  };
}

// Picks the library repository: uses it if it exists (it must be private),
// otherwise makes it, private.
export async function chooseRepo(owner: string, name: string): Promise<GithubRepo> {
  const clean = name.trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(clean) || clean.startsWith(".")) {
    throw new ConnectError("Repository names use letters, numbers, dots, dashes and underscores.");
  }
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner)) throw new ConnectError("Pick who owns the repository.");
  const { token, saved } = await githubToken();
  const found = await gh<{ full_name?: string; html_url?: string; private?: boolean; permissions?: { push?: boolean } }>(
    token,
    `/repos/${owner}/${clean}`,
  );
  let repo: GithubRepo;
  if (found.status === 200 && found.body.full_name) {
    if (!found.body.private) throw new ConnectError(`${found.body.full_name} is public. Pick a private repository, or a new name.`);
    if (found.body.permissions && !found.body.permissions.push) throw new ConnectError(`You can't save to ${found.body.full_name}. Pick another repository, or a new name.`);
    repo = { fullName: found.body.full_name, url: found.body.html_url ?? `https://github.com/${found.body.full_name}`, private: true };
  } else if (found.status === 404) {
    const made = await gh<{ full_name?: string; html_url?: string; message?: string }>(
      token,
      owner === saved.login ? "/user/repos" : `/orgs/${owner}/repos`,
      {
        method: "POST",
        body: JSON.stringify({
          name: clean,
          private: true,
          description: "Saymo, the open-source motion studio: the source of every film, kept by the studio.",
          has_issues: false,
          has_wiki: false,
          auto_init: false,
        }),
      },
    );
    if (made.status !== 201 || !made.body.full_name) {
      throw new ConnectError(made.body?.message ? `GitHub didn't make the repository: ${made.body.message}.` : "GitHub didn't make the repository. Try again.");
    }
    repo = { fullName: made.body.full_name, url: made.body.html_url ?? `https://github.com/${made.body.full_name}`, private: true };
  } else {
    throw new ConnectError("GitHub didn't say whether that repository exists. Try again.");
  }
  await withConnection(SECRET, async () => {
    const now = await load();
    if (now) await writeSecret(SECRET, { ...now, repo });
  });
  return repo;
}

export async function githubIdentity() {
  const saved = await load();
  if (!saved) throw new ConnectError("GitHub isn't connected. Connect it under Where films are saved.");
  return { name: saved.login, email: `${saved.userId}+${saved.login}@users.noreply.github.com` };
}

// Signs out. A device-flow token is revoked at GitHub when the OAuth App's
// secret is also in .env.local (GITHUB_CLIENT_SECRET; GitHub needs it to
// revoke), and deleted here either way. The GitHub CLI's own sign-in is
// this Mac's, so it is left alone.
export async function disconnectGithub() {
  await withConnection(SECRET, async () => {
    const saved = await load();
    const id = process.env.GITHUB_CLIENT_ID?.trim();
    const secret = process.env.GITHUB_CLIENT_SECRET?.trim();
    if (saved?.via === "device" && saved.token && id && secret) {
      await fetch(`${API}/applications/${id}/token`, {
        method: "DELETE",
        headers: {
          authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
          accept: "application/vnd.github+json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ access_token: saved.token }),
      }).catch(() => {});
    }
    await removeSecret(SECRET);
  });
  g.__githubPending = null;
}
