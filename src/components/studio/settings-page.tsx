"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ChevronDownIcon, CloudIcon, ExternalLinkSquareIcon, FilterHorizontalIcon, FolderIcon } from "@/components/icons";
import { DialButton, DialNote, LABEL, ROW } from "@/components/tool/dial";
import type { ConnectionsStatus, Destination, DestinationsStatus } from "@/lib/studio/connect-types";
import { cn } from "@/lib/utils";
import { AiSection } from "./ai-connections";
import { StudioError } from "./api";
import { connectApi } from "./connect-api";
import { DEFAULT_REPO, GithubSection, GoogleSection } from "./connections";
import { ModelChoice } from "./model-choice";

// Settings, on the home page: where finished films go, the GitHub library,
// which AI makes the changes, and Google Drive for a Mac without Google's
// app. Saving to a cloud is one click: the cloud apps on this Mac each keep
// a folder in sync, so picking that folder is the whole set-up
// (destinations.ts).

const SMALL =
  "inline-flex h-6 shrink-0 cursor-pointer items-center rounded-[7px] bg-white/[0.08] px-2.5 text-[11.5px] text-white/85 outline-none transition-colors hover:bg-white/[0.13] hover:text-white focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50";
const CARD = "flex flex-col gap-1.5 rounded-[16px] bg-white/[0.025] p-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]";

const failure = (e: unknown, fallback: string) => ({ text: e instanceof StudioError ? e.message : fallback, bad: true });

export function SettingsPage() {
  const [dest, setDest] = useState<DestinationsStatus | null>(null);
  const [status, setStatus] = useState<ConnectionsStatus | null>(null);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [repo, setRepo] = useState(DEFAULT_REPO);
  const [busy, setBusy] = useState<string | null>(null); // the row that's working

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

  const act = async (key: string, job: () => Promise<DestinationsStatus>) => {
    setBusy(key);
    setNote(null);
    try {
      setDest(await job());
    } catch (e) {
      setNote(failure(e, "Unable to change that. Try again."));
    } finally {
      setBusy(null);
    }
  };

  const current = dest?.current ?? null;
  // A folder picked in Finder that isn't one of the cloud folders themselves.
  const picked = current && !dest?.found.some((f) => f.path === current.path) ? current : null;

  return (
    <section aria-labelledby="settings-heading" className="mx-auto flex w-full max-w-[660px] flex-col gap-6 px-8 pt-10 pb-20">
      <h1 id="settings-heading" className="px-1 font-medium text-[20px] text-white/95 tracking-[-0.01em]">
        Settings
      </h1>
      {note ? (
        <p className={cn("rounded-[10px] px-3 py-2 text-[12px] leading-relaxed", note.bad ? "bg-[#ff9592]/10 text-[#ff9592]" : "bg-white/[0.06] text-white/75")}>
          {note.text}
        </p>
      ) : null}

      <div className={CARD}>
        <Heading icon={<CloudIcon aria-hidden="true" />}>Where finished films go</Heading>
        {!dest ? (
          <Checking />
        ) : (
          <>
            {dest.found.map((d) => (
              <Place key={d.path} place={d} on={current?.path === d.path} busy={busy === d.path} onUse={() => act(d.path, () => connectApi.pickDestination(d.path))} />
            ))}
            {picked ? <Place place={picked} on busy={false} detail={picked.path} /> : null}
            {current?.gone ? <p className="px-1 text-[11.5px] text-[#ff9592] leading-relaxed">That folder isn’t on this Mac any more. Pick another.</p> : null}
            <div className="flex gap-1.5">
              <DialButton loading={busy === "choose"} onClick={() => void act("choose", connectApi.chooseFolder)} className="flex-1">
                <FolderIcon aria-hidden="true" />
                Choose a folder
              </DialButton>
              {current ? (
                <DialButton loading={busy === "stop"} onClick={() => void act("stop", connectApi.stopDestination)} className="flex-1 text-white/55">
                  Stop copying films
                </DialButton>
              ) : null}
            </div>
            <DialNote>
              {current
                ? `Each final render is copied to “${dest.folderName}” in that folder, and the app that syncs it uploads it.`
                : "Pick one, and each final render is copied there. A cloud app on this Mac then uploads it, with no sign-in here."}
            </DialNote>
            {dest.missing.length ? (
              <div className="flex flex-wrap items-center gap-1.5 px-1 pt-1">
                <span className="me-1 text-[11.5px] text-white/40">Not on this Mac yet:</span>
                {dest.missing.map((m) => (
                  <a
                    key={m.service}
                    href={m.get}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-6 items-center gap-1 rounded-full bg-white/[0.05] px-2.5 text-[11.5px] text-white/65 outline-none transition-colors hover:bg-white/[0.09] hover:text-white focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3"
                  >
                    {m.label}
                    <ExternalLinkSquareIcon aria-hidden="true" />
                  </a>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>

      {status ? (
        <>
          <div className={CARD}>
            <GithubSection status={status} onChange={refresh} onNote={setNote} name={repo} setName={setRepo} />
          </div>
          <div className={CARD}>
            <Heading icon={<FilterHorizontalIcon aria-hidden="true" />}>AI for every prompt</Heading>
            <ModelChoice />
          </div>
          <div className={CARD}>
            <AiSection />
          </div>
          {/* The older way into Drive, for a Mac without Google's app. */}
          <details className={cn(CARD, "group/more")}>
            <summary className="flex h-8 cursor-pointer list-none items-center gap-2 rounded-[10px] px-2 text-[12px] text-white/60 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden [&_svg]:size-3.5">
              <ChevronDownIcon aria-hidden="true" className="-rotate-90 transition-transform group-open/more:rotate-0" />
              Google Drive without its app
            </summary>
            <div className="flex flex-col gap-1.5 pt-1">
              <GoogleSection status={status} onChange={refresh} onNote={setNote} />
            </div>
          </details>
        </>
      ) : dest ? (
        <Checking />
      ) : null}
    </section>
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

// One place films can go: its name and account, and Use, one click.
function Place({ place, on, busy, detail, onUse }: { place: Destination; on: boolean; busy: boolean; detail?: string; onUse?: () => void }) {
  return (
    <div className={cn(ROW, "gap-3 ps-3 pe-1.5", on && "bg-white/[0.09]")}>
      <span className={cn(LABEL, on && "text-white")}>{place.label}</span>
      <span className="min-w-0 flex-1 truncate text-white/35" title={detail ?? place.account ?? undefined}>
        {detail ?? place.account ?? ""}
      </span>
      {on ? (
        <span className="shrink-0 pe-1.5 text-[11.5px] text-white/70">Films go here</span>
      ) : (
        <button type="button" className={SMALL} disabled={busy} onClick={onUse}>
          {busy ? "Using" : "Use"}
        </button>
      )}
    </div>
  );
}
