// What differs between the Mac and Windows for the scripts: how to start a
// program an engine's package ships, and how to stop a process tree.
// (src/lib/studio/server/platform.ts does the same for the studio itself.)

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const IS_MAC = process.platform === "darwin";
export const IS_WINDOWS = process.platform === "win32";

// A package's command (`hyperframes`, say) as [program, arguments before
// the caller's own], or null when the package isn't installed. It runs the
// package's own script with this Node, since node_modules/.bin holds a .cmd
// on Windows that only a shell could start.
export function packageBin(root, pkg, name = pkg) {
  const file = path.join(root, "node_modules", pkg, "package.json");
  if (!existsSync(file)) return null;
  const { bin } = JSON.parse(readFileSync(file, "utf8"));
  const script = typeof bin === "string" ? bin : bin?.[name];
  return script ? [process.execPath, [path.join(root, "node_modules", pkg, script)]] : null;
}

// Stops a process and everything it started: its process group on the Mac
// (started with `detached: true`), its process tree on Windows.
export function killTree(pid) {
  if (IS_WINDOWS) {
    spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true }).on("error", () => {});
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {}
}

// This Windows account as icacls names it (DOMAIN\user), from Windows
// itself rather than the environment, which can name it differently.
let account;
export const windowsAccount = () =>
  (account ??= spawnSync("whoami", [], { encoding: "utf8", windowsHide: true }).stdout?.trim() || process.env.USERNAME || "");

// .studio/ private to this user on Windows, where file modes do nothing
// (src/lib/studio/server/platform.ts says more).
export function ownerOnly(dir) {
  if (!IS_WINDOWS) return;
  spawnSync("icacls", [dir, "/inheritance:r", "/grant:r", `${windowsAccount()}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F"], { stdio: "ignore", windowsHide: true });
}

// Who can open a file on Windows, as icacls lists them (for messages).
export const accessList = (file) => (IS_WINDOWS ? spawnSync("icacls", [file], { encoding: "utf8", windowsHide: true }).stdout?.trim() ?? "" : "");

// Whether anyone but this user (and the system) can open the file. On
// Windows that's its access list; elsewhere its mode.
export function othersCanRead(file, mode) {
  if (!IS_WINDOWS) return (mode & 0o077) !== 0;
  const r = spawnSync("icacls", [file], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) return true;
  const me = windowsAccount().toLowerCase();
  return r.stdout
    .split(/\r?\n/)
    .map((l) => l.replace(file, "").trim())
    .filter((l) => l.includes(":("))
    .some((l) => {
      const who = l.slice(0, l.indexOf(":(")).toLowerCase();
      return who !== me && who !== "nt authority\\system";
    });
}

// Adds a folder to the end of this process's PATH (Windows separates them
// with ';').
export function addToPath(dir) {
  process.env.PATH = [process.env.PATH, dir].filter(Boolean).join(path.delimiter);
}

// Opens a link in the default browser.
export function openLink(link) {
  const [cmd, args] = IS_WINDOWS ? ["explorer.exe", [link]] : IS_MAC ? ["open", [link]] : ["xdg-open", [link]];
  spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true }).on("error", () => {}).unref();
}
