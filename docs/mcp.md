# Use the studio from other apps

Claude Desktop, Claude Code, Cursor and the terminal can list, make, change and render films in the studio. They all go through the studio while it runs on this Mac, so start it first:

```sh
npm run dev
```

Nothing here starts the studio for you. If it isn't running, every tool and command says so and tells you to run `npm run dev`.

The quickest set-up is in the studio itself: open **Where films are saved** (the link button at the top right) and scroll to **Use the studio from other apps**. Pick your app and click the block to copy it. The blocks there already hold the right paths for this Mac.

## Claude Code

Paste this in Terminal (with your own paths, or copy it from the studio):

```sh
claude mcp add --scope user motion-studio -- /path/to/node /path/to/motion-studio/scripts/studio/mcp.mjs
```

Then ask Claude Code things like "make a 9:16 Motion Studio film of orange lines rising" or "render film abcd1234 as a draft".

## Claude Desktop

In Claude Desktop, open **Settings**, **Developer**, **Edit Config**. Add this to `claude_desktop_config.json`, then restart Claude:

```json
{
  "mcpServers": {
    "motion-studio": {
      "command": "/path/to/node",
      "args": ["/path/to/motion-studio/scripts/studio/mcp.mjs"]
    }
  }
}
```

Use the full path to Node. Apps opened from the Dock don't see the Terminal's `PATH`, so a plain `node` may not be found. The studio shows the full path for this Mac.

## Cursor

Add the same block to `~/.cursor/mcp.json` (or **Cursor Settings**, **MCP**, **Add new server**), then reload Cursor.

## A studio on another port

The MCP server and the command line look for the studio at `http://127.0.0.1:3200`. For another port, set `MOTION_STUDIO_URL`:

```sh
claude mcp add --scope user motion-studio -e MOTION_STUDIO_URL=http://127.0.0.1:3333 -- /path/to/node /path/to/motion-studio/scripts/studio/mcp.mjs
```

In a JSON config, add `"env": { "MOTION_STUDIO_URL": "http://127.0.0.1:3333" }` beside `args`.

## The tools

| Tool | What it does |
| --- | --- |
| `list_films` | Every film, most recently edited first: id, title, kind, format, length, brand and its studio link. |
| `create_film` | Makes a film. `prompt` (what it should be), `format` (`16:9`, `1:1`, `4:5` or `9:16`), `kind` (`motion` or `video`), `brand` (a kit's name or id; Aerchain if left out). With a prompt, Claude makes the first version and its reply comes back when it's done. |
| `change_film` | Asks the film's Claude for a change, like the studio's chat. `id`, `prompt`, and `at` (seconds into the film, like the playhead). Returns Claude's reply when the change is done. |
| `render_film` | Makes the videos. `quality` is `draft` (quick, the film's own size) or `final` (4K and the film's own size). Returns the files' paths on this Mac when done. |
| `get_film` | One film: title, format, length, brand, its settings and its latest render. |
| `list_versions` | The film after each prompt, newest first. The first is the film as it is now. |
| `go_back` | Puts the film back to a `version` from `list_versions`. The film as it is now is kept as a version first, so nothing is lost. |
| `open_in_studio` | The link that opens the film in the studio: `http://localhost:3200/studio?film=<id>`. |

A Claude turn or a final render can take a few minutes. The tools send progress as they go (Claude's steps, the render's percentage), which also keeps apps from giving up early. If an app stops waiting anyway, the change or render carries on in the studio; check on it with `get_film` or in the studio.

Only one Claude turn runs on a film at a time. If the film is busy, `change_film` says so; wait for it, or stop it in the studio. Renders run one at a time across the studio and wait their turn.

## The command line

The same things from Terminal, in the studio's folder:

```sh
npm run studio -- films
npm run studio -- new "A 6 second loop: orange lines rise like a staircase" --format 9:16
npm run studio -- change abcd1234 "Make the lines thinner" --at 2.5
npm run studio -- render abcd1234 --draft
npm run studio -- versions abcd1234
npm run studio -- back abcd1234 3
npm run studio -- open abcd1234
npm run studio -- doctor
```

| Command | What it does |
| --- | --- |
| `films` | Lists the films, newest first. |
| `new "<prompt>"` | Makes a film and Claude's first version. `--format 16:9\|1:1\|4:5\|9:16`, `--video` for a video edit, `--brand <name or id>`. |
| `change <id> "<prompt>"` | Asks the film's Claude for a change. `--at <seconds>` for the moment it's about. |
| `render <id>` | Makes the final videos and prints where they are. `--draft` for a quick draft. |
| `versions <id>` | The film after each prompt. |
| `back <id> <version>` | Goes back to an earlier version. |
| `open <id>` | Opens the film in the studio in your browser. |
| `doctor` | Checks Node, the token, that the studio is running and takes the token, ffmpeg and the Claude command line. |

Add `--json` to any command for JSON on stdout. Results go to stdout; progress and problems go to stderr, so `--json` output can be piped straight into other tools. A command that fails exits with 1 (2 for a mistake in the command itself).

To type `motion-studio` instead of `npm run studio --` from any folder, run `npm link` once in the studio's folder.

## How it connects

The MCP server (`scripts/studio/mcp.mjs`, built on the official `@modelcontextprotocol/sdk`) and the command line (`scripts/studio/cli.mjs`) share one small client, `scripts/studio/client.mjs`. It calls the studio's own routes under `/api/studio` with the local API token from `.studio/api-token`. The token never appears in any of the set-ups above: both read it from the file, and make it if it isn't there yet. To use a token from somewhere else, set `MOTION_STUDIO_TOKEN`.

What the token allows and what it doesn't: [Security](security.md).

## The local API, for your own scripts

Send the token as a Bearer header from a program on this Mac (not a web page):

```sh
curl -H "Authorization: Bearer $(cat .studio/api-token)" http://127.0.0.1:3200/api/studio/films
```

The routes are listed in `src/lib/studio/contract.ts`. They're the studio's own and can change between versions; the MCP tools and the command line are the stable way in.
