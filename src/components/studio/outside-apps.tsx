"use client";

import { useCallback, useEffect, useState } from "react";
import { CodeIcon, CopyIcon, EyeOffIcon, EyeOnIcon } from "@/components/icons";
import { DialButton, DialNote, LABEL, ROW } from "@/components/tool/dial";
import type { OutsideApps } from "@/lib/studio/api-token";
import { STUDIO_HEADERS } from "@/lib/studio/contract";
import { cn } from "@/lib/utils";

// "Use the studio from other apps", in the Where films are saved popover:
// copy-ready set-ups for Claude Code, Claude Desktop, Cursor and the
// terminal, and the local API token for your own scripts. The MCP server
// and the command line read the token from .studio/api-token themselves,
// so the set-ups never contain it. See docs/mcp.md and docs/security.md.

type App = "code" | "desktop" | "cursor" | "terminal";
const APPS: [App, string][] = [
  ["code", "Claude Code"],
  ["desktop", "Claude Desktop"],
  ["cursor", "Cursor"],
  ["terminal", "Terminal"],
];

const WHERE: Record<App, string> = {
  code: "Paste this in Terminal. Claude Code can then use the studio in any folder.",
  desktop: "In Claude Desktop, open Settings, Developer, Edit Config. Add this to claude_desktop_config.json, then restart Claude.",
  cursor: "Add this to ~/.cursor/mcp.json (or Cursor Settings, MCP, Add new server), then reload Cursor.",
  terminal: "List, make, change and render films from Terminal. Run the doctor first to check everything is in place.",
};

// A word for the shell: quoted only when it needs to be.
const sh = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

function setup(app: App, info: OutsideApps) {
  // Another port than the usual one: the MCP server is told where to look.
  const url = info.port === "3200" ? null : `http://127.0.0.1:${info.port}`;
  if (app === "code") {
    return `claude mcp add --scope user motion-studio${url ? ` -e MOTION_STUDIO_URL=${url}` : ""} -- ${sh(info.node)} ${sh(info.mcp)}`;
  }
  if (app === "terminal") {
    const env = url ? `MOTION_STUDIO_URL=${url} ` : "";
    return `cd ${sh(info.root)}\n${env}npm run studio -- doctor\n${env}npm run studio -- films`;
  }
  const server = { command: info.node, args: [info.mcp], ...(url ? { env: { MOTION_STUDIO_URL: url } } : {}) };
  return JSON.stringify({ mcpServers: { "motion-studio": server } }, null, 2);
}

async function call(method: "GET" | "POST") {
  const res = await fetch("/api/studio/api-token", { method, headers: STUDIO_HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error();
  return (await res.json()) as OutsideApps;
}

// Copies a value and says so for a moment.
function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (key: string, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    });
  };
  return { copied, copy };
}

export function OutsideAppsSection() {
  const [info, setInfo] = useState<OutsideApps | null>(null);
  const [failed, setFailed] = useState(false);
  const [app, setApp] = useState<App>("code");
  const [shown, setShown] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);
  const { copied, copy } = useCopy();

  const load = useCallback(async (method: "GET" | "POST") => {
    setFailed(false);
    try {
      setInfo(await call(method));
      return true;
    } catch {
      setFailed(true);
      return false;
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the set-ups when the popover opens
    void load("GET");
  }, [load]);

  const text = info ? setup(app, info) : "";
  const masked = info ? `${info.token.slice(0, 7)}${"•".repeat(10)}${info.token.slice(-4)}` : "";

  return (
    <section className="flex flex-col gap-1.5" aria-labelledby="outside-apps">
      <h3 id="outside-apps" className="flex items-center gap-2 px-1 font-medium text-[12px] text-white/85 [&_svg]:size-3.5 [&_svg]:text-white/55">
        <CodeIcon aria-hidden="true" />
        Use the studio from other apps
      </h3>
      <DialNote>While the studio is open, Claude and other apps on this Mac can list, make, change and render films.</DialNote>

      {failed ? (
        <>
          <p className="rounded-[10px] bg-[#ff9592]/10 px-3 py-2 text-[11.5px] text-[#ff9592] leading-relaxed">
            Unable to load the set-up. Check that the studio is still running, then try again.
          </p>
          <DialButton onClick={() => void load("GET")}>Try again</DialButton>
        </>
      ) : !info ? (
        <p className="px-1 pb-1 text-[11.5px]">
          <span className="studio-shimmer">Loading the set-up</span>
        </p>
      ) : (
        <>
          <div className="flex gap-0.5 rounded-[10px] bg-white/[0.05] p-0.5" role="tablist" aria-label="App">
            {APPS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={app === key}
                onClick={() => setApp(key)}
                className={cn(
                  "h-7 flex-auto cursor-pointer whitespace-nowrap rounded-[8px] px-2 text-[11.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  app === key ? "bg-white/[0.13] text-white" : "text-white/55 hover:text-white/85",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="px-1 text-[11.5px] text-white/60 leading-relaxed">{WHERE[app]}</p>
          <button
            type="button"
            onClick={() => copy(app, text)}
            aria-label={`Copy the ${APPS.find(([k]) => k === app)?.[1]} set-up`}
            className="group relative flex cursor-pointer rounded-[8px] bg-white/[0.06] px-2.5 py-2 pe-14 text-left outline-none hover:bg-white/[0.09] focus-visible:ring-2 focus-visible:ring-ring"
          >
            <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all tabular-nums text-[10.5px] text-white/80 leading-[1.55]">{text}</pre>
            <span className="absolute top-2 right-2.5 flex items-center gap-1 text-[11px] text-white/50 group-hover:text-white/75 [&_svg]:size-3.5">
              {copied === app ? "Copied" : <CopyIcon aria-hidden="true" />}
            </span>
          </button>

          <div className={cn(ROW, "mt-1 gap-2 ps-3 pe-1")}>
            <span className={LABEL}>Token</span>
            <span className="ms-auto min-w-0 truncate tabular-nums text-[11px] text-white/80">{shown ? info.token : masked}</span>
            <button
              type="button"
              onClick={() => setShown((s) => !s)}
              aria-label={shown ? "Hide the token" : "Show the token"}
              className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[8px] text-white/55 outline-none hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
            >
              {shown ? <EyeOffIcon aria-hidden="true" /> : <EyeOnIcon aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={() => copy("token", info.token)}
              aria-label="Copy the token"
              className="flex h-7 min-w-7 shrink-0 cursor-pointer items-center justify-center rounded-[8px] px-1.5 text-[11px] text-white/55 outline-none hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
            >
              {copied === "token" ? "Copied" : <CopyIcon aria-hidden="true" />}
            </button>
          </div>
          <DialNote>
            {fresh
              ? "New token made. The old one no longer works."
              : "For your own scripts, sent as Authorization: Bearer. Claude and the command line find it on their own. Keep it private."}
          </DialNote>
          {asking ? (
            <div className="flex flex-col gap-1.5 rounded-[10px] bg-white/[0.04] p-2">
              <p className="px-1 text-[11.5px] text-white/65 leading-relaxed">
                Scripts that use the current token stop working until you give them the new one. Claude and the command line pick it up on their own.
              </p>
              <div className="flex gap-1.5">
                <DialButton onClick={() => setAsking(false)}>Cancel</DialButton>
                <DialButton
                  loading={busy}
                  className="bg-[#ff9592]/12 text-[#ff9592] hover:bg-[#ff9592]/20"
                  onClick={async () => {
                    setBusy(true);
                    const ok = await load("POST").finally(() => setBusy(false));
                    setAsking(false);
                    setFresh(ok);
                  }}
                >
                  Make a new token
                </DialButton>
              </div>
            </div>
          ) : (
            <DialButton onClick={() => setAsking(true)} className="text-white/55">
              Make a new token
            </DialButton>
          )}
        </>
      )}
    </section>
  );
}
