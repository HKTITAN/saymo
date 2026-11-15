"use client";

import { Popover } from "@base-ui/react/popover";
import { useCallback, useState } from "react";
import { ClockIcon } from "@/components/icons";
import { Spinner } from "@/components/ui/spinner";
import { SURFACE } from "@/components/ui/dial";
import type { Version } from "@/lib/studio/films/contract";
import { cn } from "@/lib/utils";
import { api, StudioError } from "../api/studio";
import { formatTime } from "./clock";
import { Hint, PILL_BUTTON } from "../ui/panel";

// The film's history, from the Claude panel: the film after each prompt,
// newest first, with now at the top. Going back keeps the film as it was as
// a new version first, so you can always come forward again.

const POPUP =
  "origin-(--transform-origin) outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0";

const SMALL_BUTTON =
  "inline-flex h-7 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] px-2.5 font-medium text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50";

// "Just now", "4 min ago", "2 hr ago", "Yesterday", "3 days ago".
function ago(iso: string, now: number) {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 45) return "Just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  const days = Math.round(s / 86400);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

export function VersionsButton({
  filmId,
  busy,
  time,
  onRestore,
}: {
  filmId: string;
  busy: boolean; // Claude is working, or undoing: going back waits
  time: () => number;
  onRestore: (n: number, t: number) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const [going, setGoing] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    try {
      setVersions(await api.versions(filmId));
      setNow(Date.now());
      setError(null);
    } catch (e) {
      setError(e instanceof StudioError ? e.message : "Unable to load the versions. Try again.");
    }
  }, [filmId]);

  const goBack = async (n: number) => {
    setGoing(n);
    setError(null);
    const failed = await onRestore(n, time());
    setGoing(null);
    setAsking(null);
    if (failed) setError(failed);
    await load();
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Fresh each time it opens.
        if (next) void load();
        else setAsking(null);
      }}
    >
      <Hint label="Earlier versions">
        <Popover.Trigger
          className={cn(
            PILL_BUTTON,
            "h-7 px-2.5 text-white/60 hover:bg-white/[0.08] hover:text-white data-popup-open:bg-white/[0.08] data-popup-open:text-white",
          )}
        >
          <ClockIcon aria-hidden="true" />
          History
        </Popover.Trigger>
      </Hint>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8} collisionPadding={12} className="z-50">
          <Popover.Popup
            aria-label="Versions of this film"
            className={cn(
              SURFACE,
              POPUP,
              "flex max-h-[min(520px,calc(100dvh-120px))] w-max min-w-[260px] max-w-[360px] flex-col overflow-y-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            )}
          >
            {versions === null && !error ? (
              <p className="flex items-center gap-2 px-2.5 py-2 text-white/50">
                <Spinner className="size-3" />
                Loading versions
              </p>
            ) : null}
            {versions?.length === 1 ? (
              <p className="px-2.5 pt-1 pb-2 text-[12px] text-white/45 leading-relaxed">
                Each prompt keeps a version here.
              </p>
            ) : null}
            {versions?.map((v) => (
              <Row
                key={v.n ?? "now"}
                version={v}
                now={now}
                asking={asking === v.n && v.n !== null}
                going={going !== null && going === v.n}
                disabled={busy || going !== null}
                onAsk={() => setAsking(v.n)}
                onCancel={() => setAsking(null)}
                onGo={() => v.n !== null && void goBack(v.n)}
              />
            ))}
            {error ? <p className="px-2.5 py-2 text-[12px] text-danger leading-relaxed">{error}</p> : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Row({
  version: v,
  now,
  asking,
  going,
  disabled,
  onAsk,
  onCancel,
  onGo,
}: {
  version: Version;
  now: number;
  asking: boolean;
  going: boolean;
  disabled: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onGo: () => void;
}) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-[9px] px-2.5 py-2", asking ? "bg-white/[0.06]" : "hover:bg-white/[0.04]")}>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="line-clamp-2 text-[12.5px] text-white/85 leading-snug" title={v.prompt ?? undefined}>
            {v.detail ?? v.label}
          </p>
          <p className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-white/40">
            {v.current ? <span className="font-medium text-studio-soft">Now</span> : <span>{now ? ago(v.at, now) : ""}</span>}
            {v.t !== null ? (
              <span className="rounded-[5px] bg-white/[0.06] px-1.5 py-px text-[10.5px] text-white/45 tabular-nums">
                At {formatTime(v.t)}
              </span>
            ) : null}
          </p>
        </div>
        {v.current || asking ? null : (
          <button
            type="button"
            onClick={onAsk}
            disabled={disabled}
            className={cn(SMALL_BUTTON, "bg-white/[0.07] text-white/75 hover:bg-white/[0.12] hover:text-white")}
          >
            Go back
          </button>
        )}
      </div>
      {asking ? (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] text-white/60 leading-relaxed">Go back to this version? You can come forward again.</p>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={onGo}
              disabled={disabled}
              autoFocus
              className={cn(SMALL_BUTTON, "flex-1 bg-studio text-[#1f0612] hover:bg-studio-hover")}
            >
              {going ? <Spinner className="size-3" /> : null}
              Go back
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={going}
              className={cn(SMALL_BUTTON, "flex-1 bg-white/[0.08] text-white/80 hover:bg-white/[0.12]")}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
