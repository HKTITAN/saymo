"use client";

import { DownloadIcon, PauseIcon, PlayIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MOTION_BY_ID, MOTIONS, type MotionId } from "@/components/post/lines";
import { Post, POST_H, POST_W, type PostHandle } from "@/components/post/post";
import { isVersion, VERSIONS, type VersionId } from "@/components/post/versions";
import { post } from "@/content/post";
import { Button, buttonVariants } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarLink,
  ToolbarSeparator,
} from "@/components/ui/toolbar";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

declare global {
  interface Window {
    __post?: {
      ready: boolean;
      motions: { id: MotionId; duration: number; still: number }[];
      versions: { id: VersionId; suffix: string }[];
      renderAt: (seconds: number) => void;
    };
  }
}

const isMotion = (v: string | null): v is MotionId => !!v && Object.hasOwn(MOTION_BY_ID, v);
const noSubscribe = () => () => {};

export function Viewer() {
  // Read on the client only; the server renders nothing and the page
  // appears once the browser knows which mode it is in.
  const search = useSyncExternalStore(
    noSubscribe,
    () => window.location.search,
    () => null,
  );
  if (search === null) return null;

  // `?export=1&motion=scenes&version=skyline` renders the bare post for
  // scripts/export.mjs.
  const params = new URLSearchParams(search);
  if (params.has("export")) {
    const motion = params.get("motion");
    const version = params.get("version");
    return (
      <ExportStage
        motion={isMotion(motion) ? motion : MOTIONS[0].id}
        version={isVersion(version) ? version : VERSIONS[0].id}
      />
    );
  }
  return <Showcase />;
}

function ExportStage({ motion, version }: { motion: MotionId; version: VersionId }) {
  const handle = useRef<PostHandle>(null);
  // The exporter opens this page at 2x for 4K, so the lines draw at 2x too.
  const pixelScale = window.devicePixelRatio || 1;

  useEffect(() => {
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (cancelled || !handle.current) return;
      const h = handle.current;
      window.__post = {
        ready: true,
        motions: MOTIONS.map(({ id, duration, still }) => ({ id, duration, still })),
        versions: VERSIONS.map(({ id, suffix }) => ({ id, suffix })),
        renderAt: (s) => h.renderAt(s),
      };
    });
    return () => {
      cancelled = true;
    };
  }, [motion]);

  return (
    <div style={{ position: "fixed", inset: 0, width: POST_W, height: POST_H }}>
      <Post
        ref={handle}
        motion={motion}
        version={version}
        playing={false}
        pixelScale={pixelScale}
        live={false}
      />
    </div>
  );
}

function Showcase() {
  const [motion, setMotion] = useState<MotionId>(MOTIONS[0].id);
  const [version, setVersion] = useState<VersionId>(VERSIONS[0].id);
  // Starts paused for people who ask their system for less motion. This
  // component only ever renders in the browser, so `window` is safe here.
  const [playing, setPlaying] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [fit, setFit] = useState({ scale: 0.5, dpr: 1 });
  const [hint, setHint] = useState(true);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setHint(false), 5000);
    return () => window.clearTimeout(id);
  }, []);

  // Fit the 1920 x 1080 post into the space between the header and toolbar.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      setFit({
        scale: Math.min(width / POST_W, height / POST_H),
        dpr: window.devicePixelRatio || 1,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
      const n = Number(e.key);
      if (n >= 1 && n <= MOTIONS.length) setMotion(MOTIONS[n - 1].id);
      if (e.key === "v" || e.key === "V") {
        setVersion((v) => VERSIONS[(VERSIONS.findIndex((x) => x.id === v) + 1) % VERSIONS.length].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const current = MOTION_BY_ID[motion];
  const shown = VERSIONS.find((v) => v.id === version) ?? VERSIONS[0];

  return (
    <TooltipProvider>
      <main className="flex h-dvh flex-col bg-background text-foreground">
        <header className="flex items-baseline justify-between gap-6 px-6 pt-5 pb-4">
          <div className="flex items-baseline gap-3">
            <h1 className="font-medium text-sm">Speaker post</h1>
            <p className="text-muted-foreground text-sm">
              {post.speaker.name} on SpendOS
            </p>
          </div>
          <p
            className="text-muted-foreground text-xs transition-opacity duration-700"
            style={{ opacity: hint ? 1 : 0 }}
          >
            Space to pause, 1 to {MOTIONS.length} to switch the motion, V to switch the version
          </p>
        </header>

        <div ref={stage} className="relative min-h-0 flex-1 px-6">
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 shadow-2xl shadow-black/40"
            style={{ width: POST_W * fit.scale, height: POST_H * fit.scale }}
          >
            <div style={{ transform: `scale(${fit.scale})`, transformOrigin: "0 0" }}>
              <Post
                motion={motion}
                version={version}
                playing={playing}
                pixelScale={fit.scale * fit.dpr}
              />
            </div>
          </div>
        </div>

        <footer className="flex justify-center px-6 pt-4 pb-5">
          <Toolbar>
            <ToggleGroup
              className="border-none p-0"
              value={[version]}
              onValueChange={(v) => {
                if (v[0]) setVersion(v[0] as VersionId);
              }}
            >
              {VERSIONS.map((v) => (
                <Tooltip key={v.id}>
                  <ToolbarButton
                    render={
                      <TooltipTrigger render={<ToggleGroupItem value={v.id} aria-label={v.label} />} />
                    }
                  >
                    {v.label}
                  </ToolbarButton>
                  <TooltipPopup className="max-w-64">
                    <span className="flex items-center gap-2">
                      {v.hint}
                      <Kbd>V</Kbd>
                    </span>
                  </TooltipPopup>
                </Tooltip>
              ))}
            </ToggleGroup>
            <ToolbarSeparator orientation="vertical" />
            <ToggleGroup
              className="border-none p-0"
              value={[motion]}
              onValueChange={(v) => {
                if (v[0]) setMotion(v[0] as MotionId);
              }}
            >
              {MOTIONS.map((m, i) => (
                <Tooltip key={m.id}>
                  <ToolbarButton
                    render={
                      <TooltipTrigger render={<ToggleGroupItem value={m.id} aria-label={m.label} />} />
                    }
                  >
                    {m.label}
                  </ToolbarButton>
                  <TooltipPopup className="max-w-64">
                    <span className="flex items-center gap-2">
                      {m.hint}
                      <Kbd>{i + 1}</Kbd>
                    </span>
                  </TooltipPopup>
                </Tooltip>
              ))}
            </ToggleGroup>
            <ToolbarSeparator orientation="vertical" />
            <ToolbarGroup>
              <Tooltip>
                <ToolbarButton
                  render={
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={playing ? "Pause" : "Play"}
                          onClick={() => setPlaying((p) => !p)}
                        />
                      }
                    />
                  }
                >
                  {playing ? <PauseIcon /> : <PlayIcon />}
                </ToolbarButton>
                <TooltipPopup>
                  <span className="flex items-center gap-2">
                    {playing ? "Pause" : "Play"}
                    <Kbd>Space</Kbd>
                  </span>
                </TooltipPopup>
              </Tooltip>
            </ToolbarGroup>
            <ToolbarSeparator orientation="vertical" />
            <span className="flex items-center px-2 text-muted-foreground text-xs tabular-nums">
              {current.duration}s loop
            </span>
            <ToolbarSeparator orientation="vertical" />
            <Tooltip>
              {/* Downloads the version and motion on screen, made by `npm run export`. */}
              <ToolbarLink
                href={`/download/${version}/${motion}`}
                download
                className={buttonVariants({ variant: "ghost" })}
                render={<TooltipTrigger render={<a />} />}
              >
                <DownloadIcon aria-hidden="true" />
                Download 4K
              </ToolbarLink>
              <TooltipPopup>
                {shown.label}, {current.label}, as a 3840 × 2160 video, 60 fps
              </TooltipPopup>
            </Tooltip>
          </Toolbar>
        </footer>
      </main>
    </TooltipProvider>
  );
}
