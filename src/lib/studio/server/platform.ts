import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

// What differs between the Mac and Windows for the programs the studio
// starts: where they are, and how to stop one with everything it started.

export const IS_MAC = process.platform === "darwin";
export const IS_WINDOWS = process.platform === "win32";

// Programs on Windows end in .exe, or .cmd for the ones npm installs.
// A file with no extension there is never the program (it's a shell shim).
const EXTENSIONS = IS_WINDOWS ? [".exe", ".cmd", ".com"] : [""];

// The folders on the PATH (Windows separates them with ';').
export const pathDirs = () => (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);

const SEARCH = () => [...new Set([...(IS_MAC ? ["/opt/homebrew/bin", "/usr/local/bin"] : []), ...(IS_WINDOWS ? [] : ["/usr/bin", "/bin"]), ...pathDirs()])];

// The full path of `cmd` on the PATH (or one of `extra`), or null.
export function which(cmd: string, extra: string[] = []): string | null {
  for (const dir of SEARCH()) {
    for (const ext of EXTENSIONS) {
      const full = path.join(dir, cmd + ext);
      if (existsSync(full)) return full;
    }
  }
  return extra.find((p) => existsSync(p)) ?? null;
}

// A program npm installed is a .cmd file on Windows, which only a shell can
// start, and a shell would read the arguments again. The .cmd only runs a
// script with Node, so that script is run with Node directly instead.
// Returns the program and the arguments that go before the caller's own.
export function launcher(bin: string): [string, string[]] {
  if (!IS_WINDOWS || !/\.cmd$/i.test(bin)) return [bin, []];
  try {
    const shim = readFileSync(bin, "utf8");
    const target = /"%dp0%\\([^"]+)"/i.exec(shim.replace(/"%dp0%\\node\.exe"/gi, ""))?.[1];
    if (target) {
      const file = path.join(path.dirname(bin), target);
      // npm's shims run a script with Node, or a program directly.
      if (/\.exe$/i.test(target)) return [file, []];
      return [process.execPath, [file]];
    }
  } catch {}
  return [bin, []];
}

// Stops a process and everything it started. On the Mac and Linux that's
// its process group (started with `detached: true`); Windows has no process
// groups, so taskkill walks the tree instead.
export function killTree(pid: number) {
  if (IS_WINDOWS) {
    spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true }).on("error", () => {});
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {}
  setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
  }, 3000).unref();
}

// An absolute path in a Claude Code permission rule, where "//" starts an
// absolute path. Claude Code matches Windows paths in their POSIX form
// (C:\Users\me is /c/Users/me), so a rule there reads //c/Users/me/**.
export function rulePath(abs: string) {
  if (!IS_WINDOWS) return `/${abs}`;
  const posix = abs.replaceAll("\\", "/");
  return /^[A-Za-z]:\//.test(posix) ? `//${posix[0].toLowerCase()}${posix.slice(2)}` : `/${posix}`;
}

// A path in a command Claude runs. Its shell on Windows is Git Bash, which
// reads a backslash as an escape; forward slashes work there and in Node.
// Quoted when it has a space (C:/Users/Jane Doe), on both.
export const shellPath = (abs: string) => {
  const p = IS_WINDOWS ? abs.replaceAll("\\", "/") : abs;
  return /[\s'"$`]/.test(p) ? `"${p.replace(/(["$`\\])/g, "\\$1")}"` : p;
};

// The few variables a program needs to run, and `keep` besides, for
// starting one with a clean environment. Windows programs also need these
// to find the user's folders and the system.
const WINDOWS_ENV = ["PATHEXT", "SystemRoot", "SystemDrive", "windir", "ComSpec", "USERPROFILE", "USERNAME", "USERDOMAIN", "HOMEDRIVE", "HOMEPATH",
  "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "CommonProgramFiles", "TEMP", "TMP",
  "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS"];
export function minimalEnv(keep: string[] = []): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv;
  for (const key of ["PATH", "HOME", ...(IS_WINDOWS ? WINDOWS_ENV : []), ...keep]) if (process.env[key]) env[key] = process.env[key];
  return env;
}

// The full command line of a running process ("" when it's gone): ps on
// the Mac, the process list on Windows.
export function commandOf(pid: number): Promise<string> {
  const [cmd, args] = IS_WINDOWS
    ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId=${Math.trunc(pid)}').CommandLine`]]
    : ["ps", ["-p", String(Math.trunc(pid)), "-o", "command="]];
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", () => resolve(""));
    p.on("close", () => resolve(out.trim()));
  });
}

// The studio keeps its tokens in .studio/, private to this user: mode 700
// on the Mac. Windows ignores those modes, and folders outside the user's
// own often let every signed-in user change them, so there the folder's
// access list is cut to this user and the system (what's inside follows it).
// Every private folder is made with privateDir, never mkdir and chmod.
const locked = new Set<string>();
// This Windows account as icacls names it (DOMAIN\user), from Windows
// itself rather than the environment, which can name it differently.
let account: string | undefined;
export const windowsAccount = () =>
  (account ??= spawnSync("whoami", [], { encoding: "utf8", windowsHide: true }).stdout?.trim() || process.env.USERNAME || "");
const icacls = (file: string, ...args: string[]) => spawnSync("icacls", [file, ...args], { encoding: "utf8", windowsHide: true });

// Who is on a file's access list (DOMAIN\name each), or null if icacls
// can't read it. The first line starts with the path, so it's cut at the
// column the next lines line up to.
function accessEntries(file: string): string[] | null {
  const r = icacls(file);
  if (r.status !== 0) return null;
  const lines = r.stdout.split(/\r?\n/).filter((l) => l.includes(":("));
  const column = lines.length > 1 ? lines[1].length - lines[1].trimStart().length : file.length + 1;
  return lines.map((l, i) => (i === 0 ? l.slice(column) : l).trim()).map((l) => l.slice(0, l.indexOf(":(")));
}
const meOrSystem = (who: string) => who.toLowerCase() === windowsAccount().toLowerCase() || who.toLowerCase().endsWith("\\system");

// Whether anyone but this user (and the system) is on a file's list.
export const othersCanOpen = (file: string) => accessEntries(file)?.some((who) => !meOrSystem(who)) ?? true;

// Who can open a file, as icacls lists them (for messages).
export const accessList = (file: string) => {
  const r = icacls(file);
  return `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() || `icacls exited ${r.status}; account ${windowsAccount()}`;
};

export function privateDir(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!IS_WINDOWS) {
    try {
      chmodSync(dir, 0o700);
    } catch {}
    return;
  }
  if (locked.has(dir)) return;
  // Never carry on with tokens in a folder others can open.
  const fail = (why: string) => {
    throw new Error(`Couldn't make ${dir} private to this user: ${why.trim()}`);
  };
  // What's already inside follows the folder's new list (it inherits it).
  const r = icacls(dir, "/inheritance:r", "/grant:r", `${windowsAccount()}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F");
  if (r.status !== 0) fail(r.stderr || r.stdout || "");
  // A folder made from an administrator's terminal gets a list of its own
  // (Administrators on it) rather than an inherited one; those go too.
  for (const who of accessEntries(dir) ?? []) {
    if (meOrSystem(who)) continue;
    const removed = icacls(dir, "/remove:g", who);
    if (removed.status !== 0) fail(removed.stderr || removed.stdout || "");
  }
  if (othersCanOpen(dir)) fail(accessList(dir));
  locked.add(dir);
}

// `detached` gives a child its own process group on the Mac; on Windows it
// would open a console window of its own instead, so it stays attached there.
export const OWN_GROUP = { detached: !IS_WINDOWS, windowsHide: true } as const;
