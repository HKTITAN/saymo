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
for `drive.file`, so it sees just the "Aerchain Studio" folder it makes
(one folder per film inside), nothing else in that Drive. Several Drives
can be linked; one is in use at a time. A new render replaces the film's
files in place, so shared links keep working and Drive keeps the old
versions.

**GitHub** works at once with this Mac's GitHub CLI sign-in (`gh auth
login`). For anyone to sign in with their own account instead, make a
GitHub OAuth App with the device flow turned on and put its client ID in
`.env.local` as `GITHUB_CLIENT_ID` (add `GITHUB_CLIENT_SECRET` too if
Disconnect should also revoke the sign-in at GitHub). Then pick or name a
repository (default `aerchain-motion-library`); a new one is made private.
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
