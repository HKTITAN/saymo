@AGENTS.md

# Aerchain speaker post: house rules

Read by every Claude working here, including the studio's chat. The owner is
a visual designer; explain in plain words.

## The artwork

- The post at `/` and its export (`npm run export`) must not change unless
  asked. Check by rendering frames before and after (`window.__post.renderAt`)
  and comparing pixels; Chrome's text edges vary by 1/255 between runs, which
  is not a change.
- The post's type is Bricolage Grotesque (`--font-post`); its colours are in
  `src/components/post/palette.ts`. Lines are continuous flat strokes, one
  colour each; colour only arrives from the right.
- The post's own icons (date and location) are part of the artwork; leave
  them be.

## The interface (the tool, the studio)

- Type: the system font (`font-sans`), with `font-mono` for numbers. Never a
  display face such as Bricolage or Clash Display in the interface.
- Controls follow Josh Puckett's DialKit (`src/components/tool/dial.tsx`):
  each control is one quiet rounded row, label on the left and value on the
  right; a slider is the row filled to its value; on and off is an
  "Off | On" pair; actions are row buttons; groups fold away.
- No browser-default or stock-looking components: no native date, time,
  select or colour pickers, no visible scrollbars, no default-looking
  dialogs, menus, toasts or tooltips. Build them in the DialKit style.
- Copy: plain English, written with the `better-writing` skill. Number
  things 1, 2, 3, never Roman numerals. Never use em dashes anywhere.

## Icons

Use PikaIcons for every interface icon. Don't hand-draw SVGs or add another
icon library, and never use a sparkle icon.
- Find: `npx pikaicons search home "user avatar"` (each argument is one
  query; quote phrases)
- React: `npx pikaicons add <name…>` writes components into
  `src/components/icons` and prints the import line to use
- Variants: stroke by default; `name:solid`, `name:duo-stroke`, … per icon
Free icons work without signing in; search marks the rest "locked". For a
locked icon, use a free one the error suggests, or ask the owner to run
`npx pikaicons login`. Never ask for the key.

## Working here

- Dev server: `npm run dev` on port 3200. Posts made in the tool live in
  `posts/` (git ignores it); secrets in `.env.local` (also ignored).
- Re-export after a change to an export, and say what was verified.
