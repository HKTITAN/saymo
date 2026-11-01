"use client";

import { DownloadIcon, PauseIcon, PlayIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ExportStage } from "@/components/export-stage";
import { MOTION_BY_ID, MOTIONS, type MotionId } from "@/components/post/lines";
import { Post, POST_H, POST_W } from "@/components/post/post";
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

const isMotion = (v: string | null): v is MotionId => !!v && Object.hasOwn(MOTION_BY_ID, v);

// The Before/After switch for Scenes.
const COMPARE = [
  { id: "before", label: "Before", hint: "Scenes as measured from the reference" },
  { id: "after", label: "After", hint: "Softer landings: bands ease into the edge, the circle springs" },
] as const;
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

  // `?export=1&motion=scenes` renders the bare post for scripts/export.mjs.
  const params = new URLSearchParams(search);
  if (params.has("export")) {
    const motion = params.get("motion");
    return <ExportStage motion={isMotion(motion) ? motion : MOTIONS[0].id} />;
  }
  return <Showcase />;
}

function Showcase() {
  const motion = MOTIONS[0].id;
  // Before shows Scenes as measured from the reference; After is the post's
  // own softer landings.
  const [compare, setCompare] = useState<"before" | "after">("after");
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
      // B flips Before and After.
      if (e.key === "b" || e.key === "B") setCompare((c) => (c === "after" ? "before" : "after"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const current = MOTION_BY_ID[motion];

  return (
    <TooltipProvider>
      <main className="flex h-dvh flex-col bg-background text-foreground">
        <header className="flex items-center justify-between gap-6 px-6 pt-5 pb-4">
          <div className="flex items-baseline gap-3">
            <h1 className="font-medium text-sm">Speaker post</h1>
            <p className="text-muted-foreground text-sm">
              {post.speaker.name} on SpendOS
            </p>
          </div>
          <div className="flex items-center gap-4">
            <p
              className="text-muted-foreground text-xs transition-opacity duration-700"
              style={{ opacity: hint ? 1 : 0 }}
            >
              Space to pause, B to compare before and after
            </p>
            <ToggleGroup
              size="sm"
              variant="outline"
              value={[compare]}
              onValueChange={(v) => {
                if (v[0] === "before" || v[0] === "after") setCompare(v[0]);
              }}
            >
              {COMPARE.map((c) => (
                <Tooltip key={c.id}>
                  <TooltipTrigger render={<ToggleGroupItem value={c.id} />}>{c.label}</TooltipTrigger>
                  <TooltipPopup className="max-w-64" side="bottom">
                    <span className="flex items-center gap-2">
                      {c.hint}
                      <Kbd>B</Kbd>
                    </span>
                  </TooltipPopup>
                </Tooltip>
              ))}
            </ToggleGroup>
          </div>
        </header>

        <div ref={stage} className="relative min-h-0 flex-1 px-6">
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 shadow-2xl shadow-black/40"
            style={{ width: POST_W * fit.scale, height: POST_H * fit.scale }}
          >
            <div style={{ transform: `scale(${fit.scale})`, transformOrigin: "0 0" }}>
              <Post
                motion={motion}
                playing={playing}
                pixelScale={fit.scale * fit.dpr}
                look={compare === "before" ? "reference" : undefined}
              />
            </div>
          </div>
        </div>

        <footer className="flex justify-center px-6 pt-4 pb-5">
          <Toolbar>
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
              {/* Downloads the motion on screen, made by `npm run export`. */}
              <ToolbarLink
                href={`/download/${motion}`}
                download
                className={buttonVariants({ variant: "ghost" })}
                render={<TooltipTrigger render={<a />} />}
              >
                <DownloadIcon aria-hidden="true" />
                Download 4K
              </ToolbarLink>
              <TooltipPopup>
                {current.label} as a 3840 × 2160 video, 60 fps
              </TooltipPopup>
            </Tooltip>
          </Toolbar>
        </footer>
      </main>
    </TooltipProvider>
  );
}
