#!/usr/bin/env node
// Motion Studio as an MCP server, over stdio. Claude Desktop, Claude Code,
// Cursor and other MCP apps start this script; it talks to the studio that
// is already running on this Mac (`npm run dev`) through its local API, with
// the token in .studio/api-token. It starts nothing itself. Set-up and the
// tools: docs/mcp.md.
//
// stdout belongs to the protocol: nothing else may be printed there.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  changeFilm,
  createFilm,
  FORMATS,
  filmLink,
  getFilm,
  goBack,
  listFilms,
  listVersions,
  renderFilm,
  StudioError,
} from "./client.mjs";

const server = new McpServer(
  { name: "motion-studio", title: "Motion Studio", version: "1.0.0" },
  {
    instructions:
      "Makes and changes Aerchain films in the Motion Studio running on this Mac. Each film has an 8-character id; list_films finds them. " +
      "change_film and create_film with a prompt run one Claude turn in the studio, which can take a few minutes. " +
      "render_film makes the video files. open_in_studio gives the link to watch a film in the studio.",
  },
);

const ID = z.string().regex(/^[a-z0-9]{8}$/).describe("The film's id: 8 lower-case letters and digits, from list_films");

const json = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const failure = (error) => ({
  isError: true,
  content: [{ type: "text", text: error instanceof StudioError ? error.message : `Something went wrong: ${error?.message ?? error}` }],
});

// Runs a tool, turning studio errors into readable tool errors.
const tool = (run) => async (args, extra) => {
  try {
    return await run(args, extra);
  } catch (error) {
    return failure(error);
  }
};

// Progress for apps that ask for it (they send a progressToken). Each
// notification also tells the app the call is still alive.
function progressFor(extra) {
  const token = extra?._meta?.progressToken;
  let count = 0;
  return (message, progress, total) => {
    if (token === undefined) return;
    count += 1;
    void extra
      .sendNotification({
        method: "notifications/progress",
        params: { progressToken: token, progress: progress ?? count, ...(total ? { total } : {}), message },
      })
      .catch(() => {});
  };
}

// What a Claude turn says as it goes, as progress.
const turnProgress = (extra) => {
  const report = progressFor(extra);
  return (event) => {
    if (event.kind === "start") report("Claude started on the film");
    else if (event.kind === "step") report(event.label);
    else if (event.kind === "changed") report("The film's files changed");
  };
};

server.registerTool(
  "list_films",
  {
    title: "List films",
    description: "Every film in the studio, most recently edited first: id, title, kind, format, length in seconds, brand and its studio link.",
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  tool(async () => json(await listFilms())),
);

server.registerTool(
  "create_film",
  {
    title: "Create a film",
    description:
      "Makes a new film. With a prompt, Claude makes its first version straight away and the reply comes back when it's done (this can take a few minutes). " +
      "A motion film is described in words; a video film is an edit of footage, which is added in the studio.",
    inputSchema: {
      prompt: z.string().max(8000).optional().describe("What the film should be, in plain words. Leave out for a blank film."),
      format: z.enum(Object.keys(FORMATS)).default("16:9").describe("16:9 wide, 1:1 square, 4:5 portrait or 9:16 story"),
      kind: z.enum(["motion", "video"]).default("motion").describe("motion (made from a description) or video (an edit of footage)"),
      brand: z.string().optional().describe("A brand kit's name or id. Leave out for Aerchain."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async ({ prompt, format, kind, brand }, extra) => {
    const made = await createFilm({ prompt, format, kind, brand, onEvent: turnProgress(extra), signal: extra.signal });
    return json(made);
  }),
);

server.registerTool(
  "change_film",
  {
    title: "Change a film",
    description:
      "Asks the film's Claude for a change, like typing in the studio's chat, and returns Claude's reply when the change is done. " +
      "This can take a few minutes. Every change is kept as a version, so go_back can undo it.",
    inputSchema: {
      id: ID,
      prompt: z.string().min(1).max(8000).describe("The change, in plain words"),
      at: z.number().min(0).optional().describe("Seconds into the film the change is about, like the studio's playhead"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async ({ id, prompt, at }, extra) => json(await changeFilm(id, prompt, { at, onEvent: turnProgress(extra), signal: extra.signal }))),
);

server.registerTool(
  "render_film",
  {
    title: "Render a film",
    description:
      "Makes the film's video files and returns where they are on this Mac once done. A draft is quick, at the film's own size. " +
      "A final render makes 4K and the film's own size, and takes longer. One render runs at a time; others wait their turn.",
    inputSchema: {
      id: ID,
      quality: z.enum(["draft", "final"]).default("final").describe("draft (quick) or final (4K and the film's own size)"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  tool(async ({ id, quality }, extra) => {
    const report = progressFor(extra);
    const done = await renderFilm(id, quality, {
      signal: extra.signal,
      onProgress: (s) =>
        s.state === "running" ? report(`Rendering, ${Math.round(s.progress * 100)}%`, Math.round(s.progress * 100), 100) : report("Waiting for another render to finish"),
    });
    return json(done);
  }),
);

server.registerTool(
  "get_film",
  {
    title: "Get a film",
    description: "One film: its title, format, length, brand, the settings it exposes and its latest render.",
    inputSchema: { id: ID },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  tool(async ({ id }) => json(await getFilm(id))),
);

server.registerTool(
  "list_versions",
  {
    title: "List a film's versions",
    description: "The film after each prompt, newest first. The first entry is the film as it is now; go_back takes any other version number.",
    inputSchema: { id: ID },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  tool(async ({ id }) => json(await listVersions(id))),
);

server.registerTool(
  "go_back",
  {
    title: "Go back to a version",
    description: "Puts the film back as it was in an earlier version. The film as it is now is kept as a new version first, so nothing is lost.",
    inputSchema: { id: ID, version: z.number().int().min(1).describe("A version number from list_versions") },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async ({ id, version }) => json(await goBack(id, version))),
);

server.registerTool(
  "open_in_studio",
  {
    title: "Open in the studio",
    description: "The link that opens the film in the studio, to watch it or keep working on it.",
    inputSchema: { id: ID },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  tool(async ({ id }) => {
    await getFilm(id); // says so if the film doesn't exist or the studio isn't running
    return { content: [{ type: "text", text: filmLink(id) }] };
  }),
);

await server.connect(new StdioServerTransport());
