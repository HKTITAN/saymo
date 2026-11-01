"use client";

import { ChevronDownIcon, DownloadIcon, FilmIcon, RotateCwIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Menu, MenuGroup, MenuGroupLabel, MenuLinkItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { Progress } from "@/components/ui/progress";
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
      toastManager.add({ type: "error", title: "Could not start the video", description: (error as Error).message });
    } finally {
      setStarting(false);
    }
  };

  if (!status) return null;

  if (status.state === "running" || status.state === "queued") {
    const percent = status.state === "running" ? status.percent : 0;
    const elapsed = status.state === "running" && status.startedAt ? now - Date.parse(status.startedAt) : 0;
    const left =
      status.state === "queued"
        ? "Waiting for another video to finish"
        : percent >= 99
          ? "Finishing"
          : percent >= 5
            ? minutes((elapsed / percent) * (100 - percent))
            : "Starting";
    return (
      <div className="flex w-60 flex-col gap-1.5" aria-live="polite">
        <div className="flex justify-between text-xs">
          <span className="font-medium">Making the 4K video</span>
          <span className="text-muted-foreground tabular-nums">{percent}%</span>
        </div>
        <Progress value={percent} aria-label="Making the 4K video" />
        <span className="text-muted-foreground text-xs">{left}</span>
      </div>
    );
  }

  const ready = Boolean(doc.photo && doc.speaker.name.trim());
  const make = (label: string, again = false) =>
    ready ? (
      <Tooltip>
        <TooltipTrigger
          render={<Button variant={again ? "outline" : "default"} loading={starting} onClick={start} />}
        >
          {again ? <RotateCwIcon aria-hidden="true" /> : <FilmIcon aria-hidden="true" />}
          {label}
        </TooltipTrigger>
        <TooltipPopup>3840 × 2160 and 1920 × 1080 at 60 fps, plus stills. Takes about 4 minutes.</TooltipPopup>
      </Tooltip>
    ) : (
      <>
        <span className="text-muted-foreground text-xs">Add the speaker&apos;s name and photo first</span>
        <Button disabled>
          <FilmIcon aria-hidden="true" />
          {label}
        </Button>
      </>
    );

  if (status.state === "done") {
    const outdated = doc.updatedAt > status.docUpdatedAt;
    const { files } = status;
    const item = (name: string, label: string, size: string) => (
      <MenuLinkItem href={downloadUrl(doc.id, name)} download={name}>
        <span className="flex-1">{label}</span>
        <span className="text-muted-foreground text-xs tabular-nums">{size}</span>
      </MenuLinkItem>
    );
    return (
      <div className="flex items-center gap-2">
        {outdated && (
          <>
            <span className="text-muted-foreground text-xs">Edited since this video</span>
            {make("Make again", true)}
          </>
        )}
        <Menu>
          <MenuTrigger render={<Button variant={outdated ? "outline" : "default"} />}>
            <DownloadIcon aria-hidden="true" />
            Download
            <ChevronDownIcon aria-hidden="true" />
          </MenuTrigger>
          <MenuPopup align="end" className="min-w-64">
            <MenuGroup>
              <MenuGroupLabel>Video, 60 fps</MenuGroupLabel>
              {item(files.video4k, "4K", "3840 × 2160")}
              {item(files.video, "Full HD", "1920 × 1080")}
            </MenuGroup>
            <MenuGroup>
              <MenuGroupLabel>Still</MenuGroupLabel>
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
        <span className="max-w-64 truncate text-destructive-foreground text-xs" title={status.error}>
          The last export failed: {status.error}
        </span>
      )}
      {make(status.state === "failed" ? "Try again" : "Make 4K video")}
    </div>
  );
}
