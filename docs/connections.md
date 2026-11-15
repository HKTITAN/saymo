# Saving to Google Drive and GitHub

The link button at the top right of the studio sets where finished films
go. After every final render (and every draft, if "Save drafts too" is on)
the videos and the still go to Google Drive, and the film's source goes to
a private GitHub library. Both run in the background, one at a time, and
the Download menu shows where each film was saved, with Try again if a
save fails.

**Google Drive** needs a one-time set-up on the Mac running the studio:

1. In Google Cloud, turn on the Google Drive API for a project.
2. Set up its OAuth consent screen as Internal (Workspace) or as Testing,
   with the people who'll connect added as test users.
3. Create an OAuth client of type Web application with these redirect
   addresses: `http://localhost:3200/api/studio/connect/google/callback`
   and `http://127.0.0.1:3200/api/studio/connect/google/callback`.
4. Put its client ID and secret in `.env.local` as `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`, then restart the studio.

Then anyone at the studio clicks Connect Google Drive. The studio asks only
for `drive.file`, so it sees just the "Saymo" folder it makes
(one folder per film inside), nothing else in that Drive. Several Drives
can be linked; one is in use at a time. A new render replaces the film's
files in place, so shared links keep working and Drive keeps the old
versions.

**GitHub** works at once with this Mac's GitHub CLI sign-in (`gh auth
login`). For anyone to sign in with their own account instead, make a
GitHub OAuth App with the device flow turned on and put its client ID in
`.env.local` as `GITHUB_CLIENT_ID` (add `GITHUB_CLIENT_SECRET` too if
Disconnect should also revoke the sign-in at GitHub). Then pick or name a
repository (default `saymo-film-library`); a new one is made private.
Its layout, written into its own README:

```
README.md                        index of every film
studio.json                      studio and schema versions
brands/<brand-id>/               brand.json, logos, fonts whose licence allows
films/<yyyy>/<mm>/<slug>--<id>/  one folder per film; the id never changes
  README.md, film.json, edit.json, media.json, the film's code, sound/score.js
```

Footage, renders, history, chat and anything secret never go to GitHub;
`media.json` lists the footage a video edit uses (name, size, sha256).

Tokens are kept server-side in `.studio/connections/` (ignored by git,
private to this Mac's user), never sent to the page or to Claude's turns.

## AI: who makes the changes

The same pop-up has an AI section. It lists the AIs that can make a film's
changes on this Mac, whether each is ready ("Signed in", "Not installed",
"Sign in needed"), its plan when known, and "How to set up" with the exact
commands to copy. Run them in Terminal, or in Claude Code by typing `! `
before the command, then press Check again.

- **Claude (your Claude plan)** is the studio's default: Claude Code, Opus
  5.5 at high effort, on the plan you signed in with (`claude auth login`).
  Any API key or other provider setting in the studio's environment is
  removed before the turn starts, so it always uses the plan.
- **Codex (your ChatGPT plan)** runs OpenAI's Codex CLI. Install it with
  `npm install --global @openai/codex` (or `brew install codex`), then
  `codex login` and sign in with ChatGPT. The studio never installs it.
- **Claude with an API key** is for teammates without a Claude plan. Paste
  an Anthropic key from console.anthropic.com. It's saved only in
  `.studio/connections/anthropic.json` (readable only by your Mac user),
  given only to that AI's Claude Code, and never shown again: the panel says
  "Saved, ends in" and its last 4 characters. Remove key forgets it.

Each prompt box (the chat and the bubble on the film) has a small picker
next to Point to choose the AI for that prompt. It starts on Claude and
remembers the last pick for each film in this browser. Undo, versions and
the stage reload work the same whichever AI ran. Switching AI mid-film is
fine: the new one gets a short recap of the chat and reads the files fresh.

How Codex is kept safe (after Pond's provider subscriptions,
github.com/raphaelsalaja/pond, MIT):

- It runs with its own settings folder per film, `.studio/codex/<film>/`,
  so your own Codex settings, plugins, MCP servers and hooks never load.
  Its sign-in is reached through a link to Codex's own `auth.json`; the
  studio never reads, copies or prints it. A Keychain sign-in can't be
  linked, so the panel asks you to sign in again into Codex's file.
- Every command it runs is in macOS's sandbox: it can write only the open
  film's folder (footage, attachments and history stay read-only) and the
  film's work folder, can't read `.env` files, `.studio/` or other films,
  and has no network. It never stops to ask for approval.
- Each film keeps one Codex conversation, so a second prompt carries on
  from the first.
- Limits: with no network, the voiceover tool (which calls the studio) and
  anything else that needs the web won't work under Codex; use Claude for
  those. `STUDIO_CODEX_MODEL` in `.env.local` picks a Codex model;
  otherwise Codex uses its own default, at high reasoning effort.

The brand kit maker and the script writer always use Claude on your plan.
