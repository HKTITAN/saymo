import { open, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ConnectError } from "./connect-store";
import type { SaveState } from "./connect-types";
import { outDir, readFilm } from "../films/films";
import { accessToken, API, driveJson, ensureFolder, rootFolder } from "./google";

// Saves a film's renders to the active Google Drive, in
// "Saymo/<title> (<id>)/", one file at a time in the background.
// Uploads are resumable (Google's protocol), so a 4K video survives a
// dropped connection: the upload picks up where it stopped.
//
// Each file keeps its place in Drive: a new render of the same film
// replaces the file's contents, so links shared earlier keep working and
// Drive keeps the earlier versions in the file's own history.
// What was saved where is in films/<id>/out/drive.json.

type Record_ = SaveState & {
  account?: string;
  folderId?: string;
  folderLink?: string | null;
  saved?: Record<string, { id: string; link: string; size: number; at: string }>;
};

const recordFile = (id: string) => path.join(outDir(id), "drive.json");
export async function driveRecord(id: string): Promise<Record_> {
  try {
    return JSON.parse(await readFile(recordFile(id), "utf8")) as Record_;
  } catch {
    return { state: "none" };
  }
}
async function writeRecord(id: string, record: Record_) {
  const file = recordFile(id);
  await writeFile(`${file}.tmp`, JSON.stringify(record, null, 2));
  await rename(`${file}.tmp`, file);
}

const TYPES: Record<string, string> = { ".mp4": "video/mp4", ".png": "image/png", ".jpg": "image/jpeg" };
const CHUNK = 16 * 1024 * 1024; // a multiple of 256 KiB, as Google asks

// ─── The queue ────────────────────────────────────────────────────────────

type Job = { id: string; files: string[] };
const g = globalThis as { __driveQueue?: { queue: Job[]; running: string | null } };
const jobs = (g.__driveQueue ??= { queue: [], running: null });

export function saveToDrive(id: string, files: string[]) {
  const wanted = files.filter((f) => TYPES[path.extname(f)]);
  if (!wanted.length) return;
  const waiting = jobs.queue.find((j) => j.id === id);
  if (waiting) waiting.files = [...new Set([...waiting.files, ...wanted])];
  else jobs.queue.push({ id, files: wanted });
  void next();
}

async function next() {
  if (jobs.running || !jobs.queue.length) return;
  const job = jobs.queue.shift()!;
  jobs.running = job.id;
  try {
    await run(job);
  } catch (error) {
    const before = await driveRecord(job.id);
    const message = error instanceof ConnectError ? error.message : "Saving to Google Drive stopped. Try again.";
    await writeRecord(job.id, { ...before, state: "failed", message, at: new Date().toISOString() }).catch(() => {});
  } finally {
    jobs.running = null;
    void next();
  }
}

async function run({ id, files }: Job) {
  const film = await readFilm(id);
  if (!film) return;
  const before = await driveRecord(id);
  const step = (text: string) => writeRecord(id, { ...before, state: "saving", step: text });
  await step("Opening your Drive folder");
  const { token, email, folder } = await rootFolder();
  // The film's own folder, renamed if the film was.
  const folderName = `${film.title.replace(/[\\/]/g, " ").trim() || "Untitled film"} (${film.id})`;
  let filmFolder =
    before.account === email && before.folderId
      ? await driveJson<{ id: string; name: string; webViewLink?: string; trashed?: boolean }>(
          token,
          `/drive/v3/files/${before.folderId}?fields=id,name,webViewLink,trashed`,
        ).catch(() => null)
      : null;
  if (filmFolder?.trashed) filmFolder = null;
  if (!filmFolder) filmFolder = await ensureFolder(token, folderName, folder.id);
  else if (filmFolder.name !== folderName) {
    await driveJson(token, `/drive/v3/files/${filmFolder.id}?fields=id`, { method: "PATCH", body: JSON.stringify({ name: folderName }) });
  }
  const saved = before.account === email ? { ...(before.saved ?? {}) } : {};
  for (const [i, name] of files.entries()) {
    const file = path.join(outDir(id), name);
    const size = (await stat(file).catch(() => null))?.size;
    if (!size) continue;
    const label = files.length > 1 ? ` (${i + 1} of ${files.length})` : "";
    const progress = (share: number) => step(`Saving ${name} to Drive${label}, ${Math.round(share * 100)}%`);
    const uploaded = await upload(token, file, size, filmFolder.id, saved[name]?.id ?? null, progress);
    saved[name] = { id: uploaded.id, link: uploaded.webViewLink ?? `https://drive.google.com/file/d/${uploaded.id}/view`, size, at: new Date().toISOString() };
  }
  const link = filmFolder.webViewLink ?? `https://drive.google.com/drive/folders/${filmFolder.id}`;
  await writeRecord(id, {
    state: "saved",
    at: new Date().toISOString(),
    link,
    files: Object.entries(saved).map(([n, s]) => ({ name: n, link: s.link })),
    account: email,
    folderId: filmFolder.id,
    folderLink: link,
    saved,
  });
}

// ─── Resumable upload ─────────────────────────────────────────────────────

async function upload(
  token: string,
  file: string,
  size: number,
  folderId: string,
  existing: string | null,
  progress: (share: number) => Promise<void>,
): Promise<{ id: string; webViewLink?: string }> {
  const type = TYPES[path.extname(file)] ?? "application/octet-stream";
  // A replaced file keeps its id (and its links); a new one goes in the folder.
  const start = async (replace: string | null) =>
    fetch(
      replace
        ? `${API}/upload/drive/v3/files/${replace}?uploadType=resumable&fields=id,webViewLink`
        : `${API}/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink`,
      {
        method: replace ? "PATCH" : "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-type": type,
          "x-upload-content-length": String(size),
        },
        body: JSON.stringify(replace ? {} : { name: path.basename(file), parents: [folderId] }),
      },
    ).catch(() => null);

  let res = await start(existing);
  // The earlier file was deleted from Drive: make a new one.
  if (existing && res && res.status === 404) res = await start(null);
  if (!res?.ok) throw new ConnectError(res?.status === 403 ? "Google Drive refused the upload: the Drive may be full." : "Google Drive didn't accept the upload. Try again.");
  const session = res.headers.get("location");
  if (!session) throw new ConnectError("Google Drive didn't accept the upload. Try again.");

  const handle = await open(file, "r");
  try {
    let sent = 0;
    let tries = 0;
    while (sent < size) {
      const length = Math.min(CHUNK, size - sent);
      const chunk = Buffer.alloc(length);
      await handle.read(chunk, 0, length, sent);
      // 308 here means "keep going", not a redirect, so it must never be followed.
      const put = await fetch(session, {
        method: "PUT",
        redirect: "manual",
        // A fresh token each chunk: a 4K upload can outlast an hour's token.
        headers: { authorization: `Bearer ${(await accessToken()).token}`, "content-length": String(length), "content-range": `bytes ${sent}-${sent + length - 1}/${size}` },
        body: chunk,
      }).catch(() => null);
      if (put && (put.status === 200 || put.status === 201)) {
        await progress(1);
        return (await put.json()) as { id: string; webViewLink?: string };
      }
      if (put?.status === 308) {
        sent = rangeEnd(put.headers.get("range"));
        tries = 0;
        await progress(sent / size);
        continue;
      }
      if (put && put.status >= 400 && put.status < 500 && put.status !== 408 && put.status !== 429) {
        throw new ConnectError(put.status === 404 ? "The upload expired. Try again." : "Google Drive stopped the upload. Try again.");
      }
      // Dropped connection or a busy server: wait, ask how far it got, carry on.
      if (++tries > 6) throw new ConnectError("The upload kept failing. Check the internet connection, then try again.");
      await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** tries)));
      const asked = await fetch(session, {
        method: "PUT",
        redirect: "manual",
        headers: { authorization: `Bearer ${(await accessToken()).token}`, "content-length": "0", "content-range": `bytes */${size}` },
      }).catch(() => null);
      if (asked && (asked.status === 200 || asked.status === 201)) return (await asked.json()) as { id: string; webViewLink?: string };
      if (asked?.status === 308) sent = rangeEnd(asked.headers.get("range"));
    }
    throw new ConnectError("Google Drive didn't confirm the upload. Try again.");
  } finally {
    await handle.close();
  }
}

// "bytes=0-1048575" → 1048576 (the next byte to send); no header → 0.
const rangeEnd = (range: string | null) => {
  const m = range?.match(/bytes=0-(\d+)/);
  return m ? Number(m[1]) + 1 : 0;
};

export async function filmDriveState(id: string): Promise<SaveState> {
  const record = await driveRecord(id);
  const busy = jobs.running === id || jobs.queue.some((j) => j.id === id);
  if (record.state === "saving" && !busy) {
    return { state: "failed", message: "Saving to Google Drive stopped when the studio restarted. Try again.", at: new Date().toISOString() };
  }
  if (busy && record.state !== "saving") return { state: "saving", step: "Waiting to save to Google Drive" };
  return driveState(record);
}

function driveState(record: Record_): SaveState {
  if (record.state === "saving") return { state: "saving", step: record.step };
  if (record.state === "saved") return { state: "saved", at: record.at, link: record.link, files: record.files };
  if (record.state === "failed") return { state: "failed", message: record.message, at: record.at };
  return { state: "none" };
}
