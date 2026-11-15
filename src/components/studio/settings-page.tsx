"use client";

import { Popover } from "@base-ui/react/popover";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { BotIcon, CheckTickCircleIcon, ChevronDownIcon, CloudIcon, ExternalLinkSquareIcon, FolderIcon, MoonIcon, UserIcon } from "@/components/icons";
import { LABEL, ROW, ROW_BUTTON, SURFACE } from "@/components/tool/dial";
import type { ConnectionsStatus, DestinationsStatus } from "@/lib/studio/connect-types";
import { cn } from "@/lib/utils";
import { ME_CHANGED } from "./account-panel";
import { StudioError } from "./api";
import { connectApi } from "./connect-api";
import { DEFAULT_REPO, GithubSection } from "./connections";
import { ITEM, MENU_POPUP } from "./home-parts";
import { CloudMark } from "./cloud-marks";
import { ModelChoice } from "./model-choice";
import { Slide } from "./rules-panel";
import { setTheme, type Theme, useTheme } from "./theme";

// Settings, on the home page, in three cards:
//  - Profile: the name the studio shows for you.
//  - AI: which AI every prompt goes to, whether it's ready, and Claude's
//    model and effort.
//  - Saving: where finished films are copied (a folder a cloud app on this
//    Mac keeps in sync, so there's no sign-in here; destinations.ts), and
//    the GitHub library.
// Google Drive without its app (GoogleSection in connections.tsx) is off
// the page for now; see docs/later.md.

const CARD = "flex flex-col gap-1.5 rounded-[16px] bg-white/[0.025] p-2 shadow-[inset_0_0_0_1px_rgb(var(--hi)_/_0.05)]";

const failure = (e: unknown, fallback: string) => ({ text: e instanceof StudioError ? e.message : fallback, bad: true });

export function SettingsPage() {
  const [dest, setDest] = useState<DestinationsStatus | null>(null);
  const [status, setStatus] = useState<ConnectionsStatus | null>(null);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [repo, setRepo] = useState(DEFAULT_REPO);

  const refresh = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([connectApi.destinations(), connectApi.status()]);
      setDest(d);
      setStatus(s);
    } catch (e) {
      setNote(failure(e, "Unable to load the settings. Check that the studio is still running."));
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the settings once, when the page opens
    void refresh();
  }, [refresh]);

  return (
    <section aria-labelledby="settings-heading" className="mx-auto flex w-full max-w-[660px] flex-col gap-6 px-8 pt-10 pb-20">
      <div className="flex flex-col gap-1.5 px-1">
        <h1 id="settings-heading" className="font-medium text-[20px] text-white/95 tracking-[-0.01em]">
          Settings
        </h1>
        <p className="text-[12.5px] text-white/50">Your profile, how the studio looks, your AI and where finished films go.</p>
      </div>
      {note ? (
        <p className={cn("rounded-[10px] px-3 py-2 text-[12px] leading-relaxed", note.bad ? "bg-danger/10 text-danger" : "bg-white/[0.06] text-white/75")}>
          {note.text}
        </p>
      ) : null}

      <div className={CARD}>
        <Heading icon={<UserIcon aria-hidden="true" />}>Profile</Heading>
        <NameRow onNote={setNote} />
      </div>

      <div className={CARD}>
        <Heading icon={<MoonIcon aria-hidden="true" />}>Appearance</Heading>
        <ThemeRow />
      </div>

      <div className={CARD}>
        <Heading icon={<BotIcon aria-hidden="true" />}>AI</Heading>
        <ModelChoice />
      </div>

      <div className={CARD}>
        <Heading icon={<CloudIcon aria-hidden="true" />}>Saving</Heading>
        {dest ? <FilmsGoTo dest={dest} onDest={setDest} onNote={setNote} /> : <Checking />}
        {status ? (
          <div className="pt-2">
            <GithubSection status={status} onChange={refresh} onNote={setNote} name={repo} setName={setRepo} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

// "Finished films go to": one row showing where, and a menu to change it.
function FilmsGoTo({
  dest,
  onDest,
  onNote,
}: {
  dest: DestinationsStatus;
  onDest: (d: DestinationsStatus) => void;
  onNote: (n: { text: string; bad: boolean } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = dest.current;
  const act = async (job: () => Promise<DestinationsStatus>) => {
    setOpen(false);
    setBusy(true);
    onNote(null);
    try {
      onDest(await job());
    } catch (e) {
      onNote(failure(e, "Unable to change that. Try again."));
    } finally {
      setBusy(false);
    }
  };
  const label = current ? (dest.found.find((f) => f.path === current.path)?.label ?? current.label) : "Nowhere yet";
  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger className={ROW_BUTTON} disabled={busy}>
          <span className={LABEL}>Finished films go to</span>
          <span className={cn("ms-auto truncate", current ? "text-white/90" : "text-white/40")}>{busy ? "Changing" : label}</span>
          <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0 text-white/40" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={12} className="z-50">
            <Popover.Popup className={cn(SURFACE, MENU_POPUP, "min-w-[220px]")}>
              {dest.found.map((d) => (
                <button key={d.path} type="button" className={ITEM} onClick={() => void act(() => connectApi.pickDestination(d.path))}>
                  {d.service === "folder" ? <FolderIcon aria-hidden="true" /> : <CloudMark service={d.service} />}
                  {d.label}
                  {current?.path === d.path ? <CheckTickCircleIcon aria-label="Chosen" className="ms-auto text-white/70" /> : null}
                </button>
              ))}
              <button type="button" className={ITEM} onClick={() => void act(connectApi.chooseFolder)}>
                <FolderIcon aria-hidden="true" />
                Choose a folder
              </button>
              {current ? (
                <button type="button" className={cn(ITEM, "text-white/55")} onClick={() => void act(connectApi.stopDestination)}>
                  <span aria-hidden="true" className="size-4 shrink-0" />
                  Stop copying films
                </button>
              ) : null}
              {dest.missing.map((m) => (
                <a key={m.service} href={m.get} target="_blank" rel="noreferrer" className={cn(ITEM, "text-white/45")} onClick={() => setOpen(false)}>
                  <CloudMark service={m.service} />
                  Get {m.label}
                  <ExternalLinkSquareIcon aria-hidden="true" className="ms-auto" />
                </a>
              ))}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {current?.gone ? <p className="px-1 text-[11.5px] text-danger leading-relaxed">That folder isn&rsquo;t on this Mac any more. Pick another.</p> : null}
    </>
  );
}

// Your name, as the sidebar shows it. Saved when you leave the field or
// press Return; left empty, it's the name this Mac knows you by.
function NameRow({ onNote }: { onNote: (n: { text: string; bad: boolean } | null) => void }) {
  const [name, setName] = useState<string | null>(null);
  const [macName, setMacName] = useState("");
  const [saved, setSaved] = useState("");
  useEffect(() => {
    let live = true;
    fetch("/api/studio/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((m: { name: string; macName: string } | null) => {
        if (!live || !m) return;
        const own = m.name === m.macName ? "" : m.name;
        setMacName(m.macName);
        setSaved(own);
        setName(own);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const save = async () => {
    if (name === null || name.trim() === saved) return;
    try {
      const r = await fetch("/api/studio/me", { method: "PUT", headers: { "Content-Type": "application/json", "x-studio": "1" }, body: JSON.stringify({ name }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new StudioError(body.error ?? "Unable to save your name. Try again.");
      setSaved(name.trim());
      onNote(null);
      window.dispatchEvent(new Event(ME_CHANGED));
    } catch (e) {
      onNote(failure(e, "Unable to save your name. Try again."));
    }
  };
  return (
    <label className={cn(ROW, "gap-3 px-3 focus-within:bg-white/[0.08]")}>
      <span className={LABEL}>Name</span>
      <input
        value={name ?? ""}
        disabled={name === null}
        maxLength={60}
        placeholder={macName || "Your name"}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="h-full min-w-0 flex-1 bg-transparent text-right text-white/90 outline-none placeholder:text-white/35"
      />
    </label>
  );
}

const THEMES: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

// Dark, light, or the Mac's own setting. Kept in this browser.
function ThemeRow() {
  const theme = useTheme();
  return (
    <div className={cn(ROW, "gap-3 ps-3 pe-1")}>
      <span className={LABEL}>Theme</span>
      <span className="ms-auto">
        <Slide label="Theme" value={theme} options={THEMES} onChange={setTheme} segment={64} />
      </span>
    </div>
  );
}

function Heading({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 px-1 pt-0.5 pb-1 font-medium text-[12px] text-white/85 [&_svg]:size-3.5 [&_svg]:text-white/55">
      {icon}
      {children}
    </h2>
  );
}

function Checking() {
  return (
    <p className="px-1 pb-1 text-[11.5px]">
      <span className="studio-shimmer">Checking</span>
    </p>
  );
}
