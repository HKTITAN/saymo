"use client";

import { Popover } from "@base-ui/react/popover";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { CloudIcon, CopyIcon, ExternalLinkSquareIcon, GithubIcon, LinkChainHorizontalIcon } from "@/components/icons";
import { DialButton, DialNote, DialText, DialToggle, LABEL, ROW, SURFACE } from "@/components/tool/dial";
import type { ConnectionsStatus, FilmConnections, SaveState } from "@/lib/studio/connect-types";
import { cn } from "@/lib/utils";
import { AiSection } from "./ai-connections";
import { StudioError } from "./api";
import { connectApi } from "./connect-api";
import { Hint, ICON_BUTTON } from "./panel";

// Where finished films go: the videos to Google Drive, the source to a
// GitHub library. Opened from the top right; Google's sign-in comes back
// here with ?connected=google or ?connect_error=… on the address.

const POPUP =
  "origin-(--transform-origin) outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0";
const LINK =
  "inline-flex items-center gap-1 rounded-[5px] text-white/75 underline-offset-2 outline-none hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3";
const DEFAULT_REPO = "aerchain-motion-library";

const message = (e: unknown, fallback: string) => (e instanceof StudioError ? e.message : fallback);

export function ConnectionsButton() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ConnectionsStatus | null>(null);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await connectApi.status());
    } catch (e) {
      setNote({ text: message(e, "Unable to load the connections. Try again."), bad: true });
    }
  }, []);

  // Back from Google's sign-in: say how it went, then tidy the address.
  useEffect(() => {
    const url = new URL(window.location.href);
    const ok = url.searchParams.get("connected");
    const bad = url.searchParams.get("connect_error");
    if (!ok && !bad) return;
    url.searchParams.delete("connected");
    url.searchParams.delete("connect_error");
    window.history.replaceState(window.history.state, "", url.toString());
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time message from the sign-in redirect
    setNote(bad ? { text: bad, bad: true } : { text: "Google Drive is connected. Final renders will be saved there.", bad: false });
    setOpen(true);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the connections when the panel opens
    if (open) void refresh();
  }, [open, refresh]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Hint label="Where films are saved">
        <Popover.Trigger className={cn(ICON_BUTTON, "size-8 data-popup-open:bg-white/[0.08]")} aria-label="Where films are saved">
          <LinkChainHorizontalIcon aria-hidden="true" />
        </Popover.Trigger>
      </Hint>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={10} collisionPadding={12} className="z-50">
          <Popover.Popup
            className={cn(SURFACE, POPUP, "flex max-h-[min(640px,calc(100vh-80px))] w-[340px] flex-col gap-3 overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden")}
          >
            <div className="px-1 pt-1">
              <p className="font-medium text-[12.5px] text-white/90">Where films are saved</p>
              <p className="pt-0.5 text-[11.5px] text-white/45 leading-relaxed">
                After each final render, the videos go to Google Drive and the film&rsquo;s source goes to GitHub.
              </p>
            </div>
            {note ? (
              <p className={cn("rounded-[10px] px-3 py-2 text-[11.5px] leading-relaxed", note.bad ? "bg-[#ff9592]/10 text-[#ff9592]" : "bg-white/[0.06] text-white/75")}>
                {note.text}
              </p>
            ) : null}
            {status ? (
              <>
                <GoogleSection status={status} onChange={refresh} onNote={setNote} />
                <GithubSection status={status} onChange={refresh} onNote={setNote} />
                <AiSection />
              </>
            ) : (
              <p className="px-1 pb-1 text-[11.5px]">
                <span className="studio-shimmer">Checking the connections</span>
              </p>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="flex items-center gap-2 px-1 font-medium text-[12px] text-white/85 [&_svg]:size-3.5 [&_svg]:text-white/55">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

// A row with a label on the left and words (or a link) on the right.
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={cn(ROW, "gap-3 px-3")}>
      <span className={LABEL}>{label}</span>
      <span className="ms-auto flex min-w-0 items-center gap-2 truncate text-white/85">{children}</span>
    </div>
  );
}

// Asks once more before signing an account out.
function Disconnect({ label, consequence, onConfirm }: { label: string; consequence: string; onConfirm: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking) {
    return (
      <DialButton onClick={() => setAsking(true)} className="text-white/55">
        {label}
      </DialButton>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] bg-white/[0.04] p-2">
      <p className="px-1 text-[11.5px] text-white/65 leading-relaxed">{consequence}</p>
      <div className="flex gap-1.5">
        <DialButton onClick={() => setAsking(false)}>Cancel</DialButton>
        <DialButton
          loading={busy}
          className="bg-[#ff9592]/12 text-[#ff9592] hover:bg-[#ff9592]/20"
          onClick={async () => {
            setBusy(true);
            await onConfirm().finally(() => setBusy(false));
            setAsking(false);
          }}
        >
          {label}
        </DialButton>
      </div>
    </div>
  );
}

type SectionProps = {
  status: ConnectionsStatus;
  onChange: () => Promise<void>;
  onNote: (note: { text: string; bad: boolean } | null) => void;
};

// ─── Google Drive ─────────────────────────────────────────────────────────

function GoogleSection({ status, onChange, onNote }: SectionProps) {
  const { google } = status;
  const active = google.accounts.find((a) => a.active) ?? null;
  const [copied, setCopied] = useState(false);
  const act = async (job: () => Promise<void>, fallback: string) => {
    onNote(null);
    try {
      await job();
      await onChange();
    } catch (e) {
      onNote({ text: message(e, fallback), bad: true });
    }
  };

  if (!google.configured) {
    return (
      <Section icon={<CloudIcon aria-hidden="true" />} title="Google Drive">
        <div className="flex flex-col gap-1.5 rounded-[10px] bg-white/[0.04] px-3 py-2.5 text-[11.5px] text-white/60 leading-relaxed">
          <p className="text-white/80">Google Drive needs a one-time set-up on this Mac.</p>
          <ol className="flex list-decimal flex-col gap-1 ps-4">
            <li>
              In{" "}
              <a className={LINK} href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer">
                Google Cloud
              </a>
              , turn on the Google Drive API for a project.
            </li>
            <li>Set up its OAuth consent screen as Internal, or as Testing with your team as test users.</li>
            <li>Create an OAuth client of type Web application, with this redirect address:</li>
          </ol>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(google.redirectUri).then(() => setCopied(true));
              setTimeout(() => setCopied(false), 1500);
            }}
            className="flex min-h-8 cursor-pointer items-center gap-2 rounded-[8px] bg-white/[0.06] px-2.5 py-1.5 text-left font-mono text-[11px] text-white/80 outline-none hover:bg-white/[0.09] focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5 [&_svg]:shrink-0"
          >
            <span className="min-w-0 flex-1 break-all">{google.redirectUri}</span>
            {copied ? <span className="font-sans text-white/50">Copied</span> : <CopyIcon aria-hidden="true" />}
          </button>
          <ol start={4} className="flex list-decimal flex-col gap-1 ps-4">
            <li>
              Put its client ID and secret in <span className="font-mono text-white/75">.env.local</span> as GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then restart the studio.
            </li>
          </ol>
        </div>
        <DialButton onClick={() => void onChange()}>Check again</DialButton>
      </Section>
    );
  }

  return (
    <Section icon={<CloudIcon aria-hidden="true" />} title="Google Drive">
      {active ? (
        <>
          {google.accounts.length > 1 ? (
            <div className="flex flex-col gap-0.5 rounded-[10px] bg-white/[0.05] p-0.5" role="radiogroup" aria-label="Drive in use">
              {google.accounts.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  role="radio"
                  aria-checked={a.active}
                  onClick={() => void act(() => connectApi.setGoogle({ active: a.email }), "Unable to switch Drives. Try again.")}
                  className={cn(
                    "flex h-8 cursor-pointer items-center rounded-[8px] px-2.5 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    a.active ? "bg-white/[0.13] text-white" : "text-white/55 hover:text-white/85",
                  )}
                >
                  <span className="truncate">{a.email}</span>
                </button>
              ))}
            </div>
          ) : (
            <Row label="Drive">
              <span className="truncate">{active.email}</span>
            </Row>
          )}
          <Row label="Folder">
            {active.folderLink ? (
              <a className={LINK} href={active.folderLink} target="_blank" rel="noreferrer">
                {active.folderName}
                <ExternalLinkSquareIcon aria-hidden="true" />
              </a>
            ) : (
              <span className="truncate">{active.folderName}</span>
            )}
          </Row>
          <DialToggle
            label="Save drafts too"
            checked={google.autoDrafts}
            onChange={(on) => void act(() => connectApi.setGoogle({ autoDrafts: on }), "Unable to change the drafts setting. Try again.")}
          />
          <DialButton onClick={() => window.location.assign(connectApi.googleStartUrl())}>Add another Drive</DialButton>
          <Disconnect
            label="Disconnect this Drive"
            consequence={`The studio stops saving to ${active.email}. Videos already saved stay in that Drive.`}
            onConfirm={() => act(() => connectApi.disconnectGoogle(active.email), "Unable to disconnect. Try again.")}
          />
        </>
      ) : (
        <>
          <DialButton className="bg-white text-[#141414] hover:bg-white/90" onClick={() => window.location.assign(connectApi.googleStartUrl())}>
            Connect Google Drive
          </DialButton>
          <DialNote>The studio only sees the folder it makes, Aerchain Studio. Nothing else in your Drive.</DialNote>
        </>
      )}
    </Section>
  );
}

// ─── GitHub ───────────────────────────────────────────────────────────────

function GithubSection({ status, onChange, onNote }: SectionProps) {
  const { github } = status;
  const [busy, setBusy] = useState(false);
  const [owner, setOwner] = useState<string | null>(null);
  const [name, setName] = useState(DEFAULT_REPO);
  const [changing, setChanging] = useState(false);
  const [copied, setCopied] = useState(false);
  const pending = github.pending;

  // While a code is waiting on github.com, check back every few seconds.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(async () => {
      const r = await connectApi.pollGithub().catch(() => null);
      if (r?.result === "connected") void onChange();
      if (r?.result === "expired") {
        onNote({ text: "The GitHub code expired. Connect GitHub again.", bad: true });
        void onChange();
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [pending, onChange, onNote]);

  const act = async (job: () => Promise<unknown>, fallback: string) => {
    onNote(null);
    setBusy(true);
    try {
      await job();
      await onChange();
      return true;
    } catch (e) {
      onNote({ text: message(e, fallback), bad: true });
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (pending) {
    return (
      <Section icon={<GithubIcon aria-hidden="true" />} title="GitHub">
        <div className="flex flex-col items-center gap-2 rounded-[10px] bg-white/[0.04] px-3 py-3">
          <p className="text-[11.5px] text-white/60">Enter this code on github.com</p>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(pending.userCode).then(() => setCopied(true));
              setTimeout(() => setCopied(false), 1500);
            }}
            className="cursor-pointer rounded-[8px] px-2 font-mono text-[22px] text-white tracking-[0.12em] outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Copy the code"
          >
            {pending.userCode}
          </button>
          <p className="h-4 text-[11.5px]">
            {copied ? <span className="text-white/55">Copied</span> : <span className="studio-shimmer">Waiting for you to enter it</span>}
          </p>
        </div>
        <DialButton className="bg-white text-[#141414] hover:bg-white/90" onClick={() => window.open(pending.verificationUri, "_blank", "noreferrer")}>
          Open github.com
        </DialButton>
        <DialButton onClick={() => void act(() => connectApi.cancelGithub(), "Unable to cancel. Try again.")}>Cancel</DialButton>
      </Section>
    );
  }

  if (!github.connected) {
    const canConnect = github.deviceFlow || github.ghAvailable;
    return (
      <Section icon={<GithubIcon aria-hidden="true" />} title="GitHub">
        <DialButton
          loading={busy}
          disabled={!canConnect}
          className="bg-white text-[#141414] hover:bg-white/90"
          onClick={() => void act(() => connectApi.startGithub(), "Unable to connect GitHub. Try again.")}
        >
          Connect GitHub
        </DialButton>
        <DialNote>
          {github.deviceFlow
            ? "You'll get a code to enter on github.com."
            : github.ghAvailable
              ? "Uses this Mac's GitHub sign-in."
              : "Set GITHUB_CLIENT_ID in .env.local, or sign in to GitHub in Terminal with gh auth login."}
        </DialNote>
      </Section>
    );
  }

  const owners = github.owners.length ? github.owners : [github.connected.login];
  const pick = owner ?? owners[0];
  const choosing = !github.repo || changing;

  return (
    <Section icon={<GithubIcon aria-hidden="true" />} title="GitHub">
      <Row label="Account">
        <span className="truncate">{github.connected.login}</span>
      </Row>
      {choosing ? (
        <>
          {owners.length > 1 ? (
            <div className="flex flex-wrap gap-0.5 rounded-[10px] bg-white/[0.05] p-0.5" role="radiogroup" aria-label="Owner">
              {owners.map((o) => (
                <button
                  key={o}
                  type="button"
                  role="radio"
                  aria-checked={pick === o}
                  onClick={() => setOwner(o)}
                  className={cn(
                    "h-7 flex-1 cursor-pointer truncate rounded-[8px] px-2 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    pick === o ? "bg-white/[0.13] text-white" : "text-white/55 hover:text-white/85",
                  )}
                >
                  {o}
                </button>
              ))}
            </div>
          ) : null}
          <DialText label="Repository" value={name} placeholder={DEFAULT_REPO} onChange={setName} />
          <DialButton
            loading={busy}
            disabled={!name.trim()}
            className="bg-white text-[#141414] hover:bg-white/90"
            onClick={() =>
              void act(() => connectApi.chooseRepo(pick, name.trim()), "Unable to use that repository. Try again.").then((ok) => ok && setChanging(false))
            }
          >
            Use this repository
          </DialButton>
          <DialNote>If it doesn&rsquo;t exist yet, the studio makes it, private.</DialNote>
          {github.repo ? <DialButton onClick={() => setChanging(false)}>Cancel</DialButton> : null}
        </>
      ) : github.repo ? (
        <>
          <Row label="Library">
            <a className={LINK} href={github.repo.url} target="_blank" rel="noreferrer">
              <span className="truncate">{github.repo.fullName}</span>
              <ExternalLinkSquareIcon aria-hidden="true" />
            </a>
          </Row>
          <DialButton onClick={() => setChanging(true)}>Change repository</DialButton>
        </>
      ) : null}
      <Disconnect
        label="Disconnect GitHub"
        consequence="The studio stops saving film source to GitHub. What's already in the repository stays there."
        onConfirm={() => act(() => connectApi.disconnectGithub(), "Unable to disconnect. Try again.").then(() => undefined)}
      />
    </Section>
  );
}

// ─── In the Render menu: where this film was saved ────────────────────────

export function SavedTo({ id, renderedAt }: { id: string; renderedAt: string | null }) {
  const [state, setState] = useState<FilmConnections | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      const next = await connectApi.film(id).catch(() => null);
      if (!live || !next) return;
      setState(next);
      if (next.drive.state === "saving" || next.github.state === "saving") timer = setTimeout(ask, 1500);
    };
    void ask();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id, renderedAt]);

  if (!state || (state.drive.state === "none" && state.github.state === "none" && !error)) return null;
  const save = async (to: "drive" | "github") => {
    setError(null);
    try {
      setState(await connectApi.saveFilm(id, to));
    } catch (e) {
      setError(message(e, "Unable to start saving. Try again."));
    }
  };

  return (
    <div className="mt-1 flex flex-col gap-1 border-white/[0.07] border-t px-1 pt-2 pb-0.5">
      <SaveLine label="Google Drive" saved="Saved to Drive" state={state.drive} onRetry={() => void save("drive")} />
      <SaveLine label="GitHub" saved="Source saved to GitHub" state={state.github} onRetry={() => void save("github")} />
      {error ? <p className="px-1.5 text-[11.5px] text-[#ff9592] leading-relaxed">{error}</p> : null}
    </div>
  );
}

function SaveLine({ label, saved, state, onRetry }: { label: string; saved: string; state: SaveState; onRetry: () => void }) {
  if (state.state === "none") return null;
  return (
    <div className="flex min-h-7 items-center gap-2 px-1.5 text-[11.5px]">
      {state.state === "saving" ? (
        <span className="studio-shimmer truncate">{state.step}</span>
      ) : state.state === "saved" ? (
        <>
          <span className="text-white/60">{saved}</span>
          {state.link ? (
            <a className={cn(LINK, "ms-auto")} href={state.link} target="_blank" rel="noreferrer">
              Open
              <ExternalLinkSquareIcon aria-hidden="true" />
            </a>
          ) : null}
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 text-[#ff9592] leading-snug" title={state.message}>
            {label}: {state.message}
          </span>
          <button type="button" onClick={onRetry} className={cn(LINK, "shrink-0")}>
            Try again
          </button>
        </>
      )}
    </div>
  );
}
