"use client";

import { useEffect, useState } from "react";
import { ChevronDownIcon, DownloadDownIcon, RefreshIcon, VideoCallIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuLinkItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { Progress, ProgressIndicator, ProgressLabel, ProgressTrack, ProgressValue } from "@/components/ui/progress";
import { toastManager } from "@/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import type { ExportStatus, PostDoc } from "@/lib/tool/doc";
import { api, downloadUrl } from "./api";

const minutes = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m <= 1 ? "About a minute left" : `About ${m} minutes left`;
};

// Makes the post's 4K video, shows how far along it is, then offers the
// files. A video made before the post's last edit is offered again with a
// way to make it afresh.
export function ExportControl({ doc, flush }: { doc: PostDoc; flush: () => Promise<void> }) {
  const [status, setStatus] = useState<ExportStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    api.exportStatus(doc.id).then(setStatus, () => setStatus({ state: "none" }));
  }, [doc.id]);

  const active = status?.state === "running" || status?.state === "queued";
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      api.exportStatus(doc.id).then(setStatus, () => {});
    }, 1000);
    return () => window.clearInterval(timer);
  }, [active, doc.id]);

  const start = async () => {
    setStarting(true);
    try {
      // The video is made from the saved post, so save first.
      await flush();
      setStatus(await api.startExport(doc.id));
    } catch (error) {
      toastManager.add({ type: "error", title: "Unable to start the video", description: (error as Error).message });
    } finally {
      setStarting(false);
    }
  };

  if (!status) return null;

  if (status.state === "running" || status.state === "queued") {
    const running = status.state === "running";
    const percent = running ? status.percent : 0;
    const elapsed = running && status.startedAt ? now - Date.parse(status.startedAt) : 0;
    const left = !running
      ? "Waiting for another video to finish"
      : percent >= 99
        ? "Finishing"
        : percent >= 5
          ? minutes((elapsed / percent) * (100 - percent))
          : "Starting";
    return (
      <div className="flex items-center gap-3">
        <span className="text-[11.5px] text-white/40" aria-live="polite">
          {left}
        </span>
        {/* A DialKit row filling up to the percent. */}
        <Progress value={percent} className="h-7 w-56 rounded-[8px]">
          <ProgressTrack>
            <ProgressIndicator />
          </ProgressTrack>
          <ProgressLabel>{running ? "Making 4K video" : "Waiting to start"}</ProgressLabel>
          {running && <ProgressValue />}
        </Progress>
      </div>
    );
  }

  const name = doc.speaker.name.trim();
  const missing =
    !name && !doc.photo
      ? "Add the speaker's name and photo first"
      : !doc.photo
        ? "Add the speaker's photo first"
        : !name
          ? "Add the speaker's name first"
          : null;

  // The first video, or another go: a remade video is the quieter button
  // when a download sits beside it.
  const make = (label: string, { again = false, quiet = false } = {}) => {
    const icon = again ? (
      <RefreshIcon aria-hidden="true" className="size-3.5" />
    ) : (
      <VideoCallIcon aria-hidden="true" className="size-3.5" />
    );
    return missing ? (
      <>
        <span className="text-[11.5px] text-white/40">{missing}</span>
        <Button size="sm" disabled>
          {icon}
          {label}
        </Button>
      </>
    ) : (
      <Tooltip>
        <TooltipTrigger
          render={<Button size="sm" variant={quiet ? "outline" : "default"} loading={starting} onClick={start} />}
        >
          {icon}
          {label}
        </TooltipTrigger>
        <TooltipPopup side="bottom" className="max-w-80">
          Makes the video in 4K and Full HD at 60 fps, with a still of each. Takes about 4 minutes.
        </TooltipPopup>
      </Tooltip>
    );
  };

  if (status.state === "done") {
    const outdated = doc.updatedAt > status.docUpdatedAt;
    const { files } = status;
    const item = (file: string, label: string, size: string) => (
      <MenuLinkItem href={downloadUrl(doc.id, file)} download={file}>
        <span className="flex-1">{label}</span>
        <span className="font-mono text-[11px] text-white/40 tabular-nums">{size}</span>
      </MenuLinkItem>
    );
    return (
      <div className="flex items-center gap-1.5">
        {outdated && (
          <>
            <span className="me-1.5 text-[11.5px] text-white/40">Edited since this video</span>
            {make("Make again", { again: true, quiet: true })}
          </>
        )}
        <Menu>
          <MenuTrigger render={<Button size="sm" variant={outdated ? "outline" : "default"} />}>
            <DownloadDownIcon aria-hidden="true" className="size-3.5" />
            Download
            <ChevronDownIcon aria-hidden="true" className="-me-0.5 size-3.5 opacity-60" />
          </MenuTrigger>
          <MenuPopup align="end" className="min-w-60">
            <MenuGroup>
              <MenuGroupLabel>Video at 60 fps</MenuGroupLabel>
              {item(files.video4k, "4K", "3840 × 2160")}
              {item(files.video, "Full HD", "1920 × 1080")}
            </MenuGroup>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Still image</MenuGroupLabel>
              {item(files.image4k, "4K", "3840 × 2160")}
              {item(files.image, "Full HD", "1920 × 1080")}
            </MenuGroup>
          </MenuPopup>
        </Menu>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {status.state === "failed" && (
        // Long errors are cut short here and shown whole on hover.
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                // Focusable, so the whole error can be read from the keyboard too.
                tabIndex={0}
                className="max-w-72 cursor-default truncate rounded-[4px] text-[11.5px] text-[#ff9592] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            }
          >
            Unable to make the video: {status.error}
          </TooltipTrigger>
          <TooltipPopup side="bottom" className="max-w-96">
            {status.error}
          </TooltipPopup>
        </Tooltip>
      )}
      {status.state === "failed" ? make("Try again", { again: true }) : make("Make 4K video")}
    </div>
  );
}
