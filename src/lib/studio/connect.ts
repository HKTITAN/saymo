import { ConnectError } from "./connect-store";
import type { ConnectionsStatus, FilmConnections } from "./connect-types";
import type { RenderQuality, RenderStatus } from "./contract";
import { copyToDestination } from "./destinations";
import { filmDriveState, saveToDrive } from "./drive-sync";
import { readFilm } from "./films";
import { cancelGithubSignIn, deviceFlowAvailable, ghAvailable, githubPending, githubState } from "./github";
import { autoSaveDrafts, driveConnected, googleAccounts, googleConfigured, redirectUriFor } from "./google";
import { githubRecord, renderMessage, saveToGithub } from "./library";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { outDir } from "./films";

// Where finished work goes. After every final render (and drafts too, if
// asked) the videos go to the active Google Drive and the film's source to
// the GitHub library, both in the background, one at a time.

export async function afterRender(id: string, quality: RenderQuality, files: string[]) {
  const film = await readFilm(id);
  if (!film) return;
  // Every size counts as finished work, as a final does.
  const finished = quality !== "draft" || (await autoSaveDrafts());
  if (finished && (await driveConnected())) saveToDrive(id, files);
  // And into the folder picked in Settings, for the cloud app on this Mac to upload.
  if (finished) void copyToDestination(id, files).catch((e) => console.error("Copying the render to its folder stopped:", e instanceof Error ? e.message : e));
  if (quality === "final") {
    const gh = await githubState().catch(() => null);
    if (gh?.connected && gh.repo) saveToGithub(id, renderMessage(film, quality, files));
  }
}

export async function connectionsStatus(origin: string): Promise<ConnectionsStatus> {
  const google = await googleAccounts();
  const github = await githubState();
  return {
    google: { configured: googleConfigured(), redirectUri: redirectUriFor(origin), ...google },
    github: {
      deviceFlow: deviceFlowAvailable(),
      ghAvailable: github.connected ? true : await ghAvailable(),
      ...github,
      pending: githubPending(),
    },
  };
}

export async function filmConnections(id: string): Promise<FilmConnections> {
  return { drive: await filmDriveState(id), github: await githubRecord(id) };
}

// "Try again" and "Save code now".
export async function saveFilmNow(id: string, to: "drive" | "github") {
  const film = await readFilm(id);
  if (!film) throw new ConnectError("That film no longer exists.");
  const render = await readFile(path.join(outDir(id), "render.json"), "utf8")
    .then((t) => JSON.parse(t) as RenderStatus)
    .catch(() => null);
  if (to === "drive") {
    if (!(await driveConnected())) throw new ConnectError("Connect Google Drive first.");
    if (render?.state !== "done") throw new ConnectError("Render the film first, then it can be saved to Drive.");
    saveToDrive(id, render.files);
    return;
  }
  const gh = await githubState();
  if (!gh.connected) throw new ConnectError("Connect GitHub first.");
  if (!gh.repo) throw new ConnectError("Pick a repository for the film library first.");
  saveToGithub(id, `Save ${film.title} (${film.id})`);
}

export { cancelGithubSignIn };
