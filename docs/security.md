# Security

The studio runs on this Mac only. Claude, inside the studio, can edit a film's files and run a few of the studio's tools, so every route under `/api/studio` checks who is asking before it does anything (`allowed()` in `src/lib/studio/films.ts`). The table below is each way in, what it must do, and how it was checked.

## Boundaries

| Boundary | Required behavior | Verification evidence |
|---|---|---|
| Network | The dev server listens on `127.0.0.1` only (`next dev -H 127.0.0.1`). Other computers can't reach it. | `package.json` `dev` script |
| Host header | Every request must name this Mac (`localhost`, `127.0.0.1` or `[::1]`). This stops a web page that points its own domain at this Mac (DNS rebinding). Applies to the token too. | A request with the token and Host `evil.example` or `192.168.1.5` gets 403 |
| The studio page | A request that changes something must be same-origin (by `Origin` and `Sec-Fetch-Site`) and carry `x-studio: 1`. A web page elsewhere can't add that header without the studio's permission, which it never gives. Unchanged by the local API. | A POST without `x-studio`, or from another site, gets 403; the studio page works as before |
| Local API token | Programs on this Mac may send `Authorization: Bearer <token>`. The token is compared in constant time (both sides hashed with SHA-256, then `timingSafeEqual`). A wrong or missing token is refused, even with `x-studio`. | Wrong token: 403 on reads and writes; right token: 200 |
| Browsers and the token | A request with a token is refused if it has an `Origin`, or a `Sec-Fetch-Site` other than `none`: browsers add those, programs don't. The studio sends no CORS headers, so a browser won't even send an `Authorization` header to it from another site. | Token plus `Origin`: 403; token plus `Sec-Fetch-Site: cross-site`: 403; a preflight from another site gets no `Access-Control-*` headers |
| The token itself | Random, 256 bits, in `.studio/api-token` with mode 600 (only your user can read it). `.studio/` is ignored by git. The token is never logged, and no set-up block contains it. | `ls -l .studio/api-token` shows `-rw-------`; `npm run studio -- doctor` checks the mode |
| Showing and replacing the token | Only the studio page can (`/api/studio/api-token`: same-origin, `x-studio: 1`, no token). A program holding the token can't read or replace it there. Replacing it stops the old one at once. | GET or POST with the token: 403; with no headers: 403 |
| Links (`/studio?new=…`) | A link only fills in the new film card. Nothing starts until you send the prompt, so a link from anywhere can't make a film on its own. | Open the link; the card waits for Send |
| MCP server and command line | They start nothing and open no film files; they only call the running studio with the token, so they can do exactly what the API allows. | `scripts/studio/client.mjs` |

## What the token doesn't protect against

- **Programs already running as you.** Anything on this Mac running under your account can read `.studio/api-token`, just as it can read the films and `.env.local`. The token keeps out web pages and other people's accounts, not your own software.
- **Reads without the token.** As before, a program on this Mac can read the film list and films (GET requests) without the token, and the studio's own scripts that Claude runs (such as `scripts/studio/voice.mjs`) still use `x-studio: 1`. Web pages can't do either. Requiring the token for everything would need those scripts to carry it too.
- **Too many wrong tokens.** There's no limit on attempts. With 256 random bits, guessing isn't practical.

## If the token leaks

In the studio, open **Where films are saved**, **Use the studio from other apps**, and click **Make a new token**. The old one stops working at once. Claude and the command line pick up the new one by themselves; give it to any scripts of your own.
