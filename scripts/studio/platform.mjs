// What differs between the Mac and Windows for the scripts: how to start a
// program an engine's package ships, and how to stop a process tree.
// (src/lib/studio/server/platform.ts does the same for the studio itself.)

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { accessList as studioAccessList, othersCanOpen, privateDir } from "../../src/lib/studio/server/platform.ts";

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

// .studio/ private to this user: the studio's own privateDir (mode 700 on
// the Mac, an access list of this user and the system on Windows), so the
// scripts and the studio can't drift apart.
export const ownerOnly = (dir) => privateDir(dir);

// `detached` gives a child its own process group on the Mac; on Windows it
// would open a console window of its own instead.
export const OWN_GROUP = { detached: !IS_WINDOWS, windowsHide: true };

// Who can open a file on Windows, as icacls lists them (for messages).
export const accessList = (file) => (IS_WINDOWS ? studioAccessList(file) : "");

// Whether anyone but this user (and the system) can open the file. On
// Windows that's its access list; elsewhere its mode.
export const othersCanRead = (file, mode) => (IS_WINDOWS ? othersCanOpen(file) : (mode & 0o077) !== 0);

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
