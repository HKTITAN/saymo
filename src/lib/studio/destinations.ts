import { execFile } from "node:child_process";
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ConnectError, readSecret, removeSecret, withConnection, writeSecret } from "./connect-store";
import type { CloudService, Destination, DestinationsStatus } from "./connect-types";
import { outDir, readFilm } from "./films";

// Where finished films go, the easy way: the folder a cloud app on this Mac
// already keeps in sync (Google Drive, Dropbox, OneDrive, Box, iCloud
// Drive), or any folder picked in Finder. Picking one is the whole set-up:
// no keys and no sign-in here, because the app on the Mac does the
// uploading. After each final render the videos are copied to
// <folder>/Motion Studio/<film title>/. The Google Drive connection in
// google.ts stays, for a Mac without Google's app.

const run = promisify(execFile);
const HOME = os.homedir();
const CLOUD = path.join(HOME, "Library", "CloudStorage");
const ICLOUD = path.join(HOME, "Library", "Mobile Documents", "com~apple~CloudDocs");
const FOLDER = "Motion Studio";
const SECRET = "destination";
const MEDIA = new Set([".mp4", ".mov", ".webm", ".gif", ".png", ".jpg"]);

const SERVICES: { service: Exclude<CloudService, "folder">; label: string; get: string }[] = [
  { service: "google-drive", label: "Google Drive", get: "https://www.google.com/drive/download/" },
  { service: "dropbox", label: "Dropbox", get: "https://www.dropbox.com/install" },
  { service: "onedrive", label: "OneDrive", get: "https://www.microsoft.com/microsoft-365/onedrive/download" },
  { service: "box", label: "Box", get: "https://www.box.com/resources/downloads" },
  { service: "icloud", label: "iCloud Drive", get: "https://support.apple.com/icloud" },
];

async function isDir(p: string) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

// The cloud folders on this Mac. Apps that use Apple's file provider keep
// theirs in ~/Library/CloudStorage, named after the service and account.
export async function findDestinations(): Promise<Destination[]> {
  const found: Destination[] = [];
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
    } else if (name.startsWith("Box-")) {
      found.push({ service: "box", label: "Box", account: null, path: full });
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
  if (await isDir(ICLOUD)) found.push({ service: "icloud", label: "iCloud Drive", account: null, path: ICLOUD });
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

// One click: one of the cloud folders found on this Mac.
export function pickDestination(target: string) {
  return withConnection(SECRET, async () => {
    const match = (await findDestinations()).find((f) => f.path === target);
    if (!match) throw new ConnectError("That folder isn't on this Mac any more. Check the app that syncs it, then try again.");
    await writeSecret(SECRET, match);
  });
}

// Any folder: Finder's own folder picker, opened on this Mac. A folder inside
// a cloud folder counts as that cloud. Cancel changes nothing.
export async function chooseFolder() {
  let picked = "";
  try {
    const { stdout } = await run("osascript", ["-e", "activate", "-e", 'POSIX path of (choose folder with prompt "Where should finished films go?")'], {
      timeout: 10 * 60_000,
    });
    picked = stdout.trim().replace(/\/$/, "");
  } catch {
    return; // closed with Cancel
  }
  if (!picked || !(await isDir(picked))) return;
  const cloud = (await findDestinations()).find((f) => picked === f.path || picked.startsWith(`${f.path}/`));
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
