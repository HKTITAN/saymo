# Contributing to Saymo

Thanks for helping. Saymo is a motion editor that runs on your own Mac or Windows PC; [the README](../README.md) covers setup.

## Before you send a change

Run these from the repo root. Every pull request runs them too.

```bash
npm run typecheck
npm run lint
npm run build
node scripts/studio/platform-check.mjs # after touching what differs between the Mac and Windows
node scripts/studio/edit-check.mjs     # after touching how video edits are timed or cut
node scripts/studio/sketch-check.mjs   # after touching sketch on the frame
node scripts/studio/parts-check.mjs    # after touching studio/effects or the starters
```

## Mac and Windows

Every change has to work on both, and CI checks each pull request on both. What differs between them lives in two files: `src/lib/studio/server/platform.ts` (the studio) and `scripts/studio/platform.mjs` (the scripts), with the Windows twins of Mac tools in `scripts/native/`. Lint stops code that branches on `process.platform`, starts a process group, splits the PATH, or calls a Mac-only program outside them. A Mac-only call is allowed only with a comment naming its Windows twin.

## Where things go

- **Studio interface:** `src/components/studio/<area>/`, one folder per area (home, film, video, chat, sound, brand, library, settings, flows). Shared controls go in `src/components/ui/`.
- **Studio server side:** `src/lib/studio/<area>/` (agent, films, stage, brands, sound, input, library, connect, server).
- New files go in the area they belong to, not loose at the top of those folders.

## House rules

The interface, copy and icon rules are in [CLAUDE.md](../CLAUDE.md), and Claude follows them too. In short:
- **Type:** the system font everywhere.
- **Controls:** DialKit-style rows.
- **Icons:** PikaIcons only.
- **Copy:** plain English, with no em dashes.

Nothing owned by a company or a real person (logos, photos, brand kits, names) goes into tracked files; keep sample content generic.

## Commits

Use conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`), each with a plain sentence or two about what changed and why.
