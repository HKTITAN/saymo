import { execFile } from "node:child_process";
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ConnectError, readSecret, removeSecret, withConnection, writeSecret } from "./connect-store";
import type { CloudService, Destination, DestinationsStatus } from "./connect-types";
import { outDir, readFilm, ROOT } from "../films/films";
import { IS_WINDOWS } from "../server/platform";

// Where finished films go, the easy way: the folder a cloud app on this
// computer already keeps in sync (Google Drive, Dropbox, OneDrive, iCloud Drive), or any folder picked in Finder. Picking one is the whole set-up:
// no keys and no sign-in here, because the app on the Mac does the
// uploading. After each final render the videos are copied to
// <folder>/Saymo/<film title>/. The Google Drive connection in
// google.ts stays, for a Mac without Google's app.

const run = promisify(execFile);
const HOME = os.homedir();
const CLOUD = path.join(HOME, "Library", "CloudStorage");
const ICLOUD = path.join(HOME, "Library", "Mobile Documents", "com~apple~CloudDocs");
const FOLDER = "Saymo";
const SECRET = "destination";
const MEDIA = new Set([".mp4", ".mov", ".webm", ".gif", ".png", ".jpg"]);

const SERVICES: { service: Exclude<CloudService, "folder">; label: string; get: string }[] = [
  { service: "google-drive", label: "Google Drive", get: "https://www.google.com/drive/download/" },
  { service: "dropbox", label: "Dropbox", get: "https://www.dropbox.com/install" },
  { service: "onedrive", label: "OneDrive", get: "https://www.microsoft.com/microsoft-365/onedrive/download" },
  { service: "icloud", label: "iCloud Drive", get: "https://support.apple.com/icloud" },
];

async function isDir(p: string) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

// The cloud folders on Windows: OneDrive says where its folders are, Google
// Drive is a drive of its own with My Drive at its top, and Dropbox and
// iCloud keep theirs in the home folder (looked for below, as on the Mac).
async function windowsDestinations(): Promise<Destination[]> {
  const found: Destination[] = [];
  const onedrive = [process.env.OneDriveConsumer, process.env.OneDriveCommercial, process.env.OneDrive].filter((p): p is string => !!p);
  for (const dir of [...new Set(onedrive)]) {
    if (!(await isDir(dir)) || found.some((f) => f.path === dir)) continue;
    const account = path.basename(dir).replace(/^OneDrive\s*-?\s*/, "") || null;
    found.push({ service: "onedrive", label: "OneDrive", account, path: dir });
  }
  for (const letter of "DEFGHIJKLMNOPQRSTUVWXYZ") {
    const myDrive = `${letter}:\\My Drive`;
    if (await isDir(myDrive)) found.push({ service: "google-drive", label: "Google Drive", account: null, path: myDrive });
  }
  const icloud = path.join(HOME, "iCloudDrive");
  if (await isDir(icloud)) found.push({ service: "icloud", label: "iCloud Drive", account: null, path: icloud });
  return found;
}

// The cloud folders on this computer. On the Mac, apps that use Apple's file
// provider keep theirs in ~/Library/CloudStorage, named after the service
// and account.
export async function findDestinations(): Promise<Destination[]> {
  const found: Destination[] = IS_WINDOWS ? await windowsDestinations() : [];
  const names = await readdir(CLOUD).catch(() => [] as string[]);
  for (const name of names.sort()) {
    const full = path.join(CLOUD, name);
    if (!(await isDir(full))) continue;
    if (name.startsWith("GoogleDrive-")) {
      const myDrive = path.join(full, "My Drive");
      found.push({ service: "google-drive", label: "Google Drive", account: name.slice(12) || null, path: (await isDir(myDrive)) ? myDrive : full });
    } else if (name === "Dropbox" || name.startsWith("Dropbox-")) {
      found.push({ service: "dropbox", label: "Dropbox", account: name.slice(8).replace(/^\(|\)$/g, "") || null, path: full });
    } else if (name.startsWith("OneDrive-")) {
      found.push({ service: "onedrive", label: "OneDrive", account: name.slice(9) || null, path: full });
    }
  }
  // Older Dropbox and Google Drive apps kept their folder in the home folder.
  for (const [service, label, dir] of [
    ["dropbox", "Dropbox", "Dropbox"],
    ["google-drive", "Google Drive", "Google Drive"],
  ] as const) {
    const full = path.join(HOME, dir);
    if (!found.some((f) => f.service === service) && (await isDir(full))) found.push({ service, label, account: null, path: full });
  }
  if (!IS_WINDOWS && (await isDir(ICLOUD))) found.push({ service: "icloud", label: "iCloud Drive", account: null, path: ICLOUD });
  return found;
}

export async function destinationsStatus(): Promise<DestinationsStatus> {
  const found = await findDestinations();
  const current = await readSecret<Destination>(SECRET);
  return {
    found,
    missing: SERVICES.filter((s) => !found.some((f) => f.service === s.service)),
    current: current ? { ...current, gone: !(await isDir(current.path)) } : null,
    folderName: FOLDER,
  };
}

// One click: one of the cloud folders found on this computer.
export function pickDestination(target: string) {
  return withConnection(SECRET, async () => {
    const match = (await findDestinations()).find((f) => f.path === target);
    if (!match) throw new ConnectError("That folder isn't on this computer any more. Check the app that syncs it, then try again.");
    await writeSecret(SECRET, match);
  });
}

// Any folder: Finder's own folder picker (or Windows'), opened on this
// computer. A folder inside a cloud folder counts as that cloud. Cancel
// changes nothing.
export async function chooseFolder() {
  const prompt = "Where should finished films go?";
  let picked = "";
  try {
    const { stdout } = IS_WINDOWS
      ? await run("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "scripts/native/choose-folder.ps1"), "-Prompt", prompt], {
          timeout: 10 * 60_000,
          windowsHide: true,
        })
      : // eslint-disable-next-line no-restricted-syntax -- Mac's Finder picker; Windows: choose-folder.ps1 above
        await run("osascript", ["-e", "activate", "-e", `POSIX path of (choose folder with prompt "${prompt}")`], { timeout: 10 * 60_000 });
    picked = stdout.trim().replace(/[\\/]$/, "");
  } catch {
    return; // closed with Cancel
  }
  if (!picked || !(await isDir(picked))) return;
  const cloud = (await findDestinations()).find((f) => picked === f.path || picked.startsWith(`${f.path}${path.sep}`));
  const chosen: Destination = cloud
    ? { ...cloud, path: picked }
    : { service: "folder", label: path.basename(picked) || picked, account: null, path: picked };
  await withConnection(SECRET, () => writeSecret(SECRET, chosen));
}

export function stopDestination() {
  return withConnection(SECRET, () => removeSecret(SECRET));
}

const safeName = (s: string) =>
  s
    .replace(/[/:\\]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Untitled film";

// After a render: its files copied into the chosen folder, where the cloud
// app on this Mac picks them up. A film's folder is named after its title.
export async function copyToDestination(id: string, files: string[]) {
  const dest = await readSecret<Destination>(SECRET);
  if (!dest || !files.length || !(await isDir(dest.path))) return;
  const film = await readFilm(id);
  const dir = path.join(dest.path, FOLDER, safeName(film?.title ?? id));
  await mkdir(dir, { recursive: true });
  for (const name of files.filter((f) => MEDIA.has(path.extname(f).toLowerCase()))) {
    await copyFile(path.join(outDir(id), name), path.join(dir, name));
  }
}
