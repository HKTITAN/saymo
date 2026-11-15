"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ExportStage } from "@/components/export-stage";
import { DownloadDownIcon, PauseCircleIcon, PlayCircleIcon } from "@/components/icons";
import { MOTION_BY_ID, MOTIONS, type MotionId } from "@/components/post/lines";
import { Post, POST_H, POST_W } from "@/components/post/post";
import { post } from "@/content/post";
import { team } from "@/content/team";
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

const noSubscribe = () => () => {};

// The shared toggles are drawn for the dark tool; on the viewer's white page
// they take these light colours instead.
const LIGHT_GROUP = "bg-black/[0.05]";
const LIGHT_ITEM =
  "px-2.5 text-neutral-500 hover:text-neutral-800 not-data-pressed:hover:bg-black/[0.04] data-pressed:bg-white data-pressed:text-neutral-900 data-pressed:shadow-xs";

// The posts: the speaker post, and the team post beside it. `?post=team`
// opens the team post.
const POSTS = [
  { id: "speaker", label: "Speaker post", content: post },
  { id: "team", label: "Team post", content: team },
] as const;
type PostId = (typeof POSTS)[number]["id"];
const postFrom = (search: string): PostId => {
  const id = new URLSearchParams(search).get("post");
  return POSTS.find((p) => p.id === id)?.id ?? "speaker";
};

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
    const content = POSTS.find((p) => p.id === postFrom(search))!.content;
    return <ExportStage motion={isMotion(motion) ? motion : MOTIONS[0].id} content={content} />;
  }
  return <Showcase initial={postFrom(search)} />;
}

function Showcase({ initial }: { initial: PostId }) {
  const motion = MOTIONS[0].id;
  const [which, setWhich] = useState<PostId>(initial);
  // The viewer is light, so the posts are judged on white. The rest of the
  // app (the tool, the studio) stays dark.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark");
    return () => root.classList.add("dark");
  }, []);
  const shown = POSTS.find((p) => p.id === which)!;
  // Kept in the address, so a reload stays on the same post.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (which !== "speaker") url.searchParams.set("post", which);
    else url.searchParams.delete("post");
    window.history.replaceState(null, "", url);
  }, [which]);
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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const current = MOTION_BY_ID[motion];

  // Whether the 4K video for the post on screen is ready, checked every two
  // seconds so the button turns into a link the moment an export finishes.
  const downloadHref = `/download/${motion}${which === "speaker" ? "" : `?post=${which}`}`;
  const [video, setVideo] = useState<{ state: string; percent: number | null }>({
    state: "ready",
    percent: null,
  });
  useEffect(() => {
    let alive = true;
    const check = () =>
      fetch(`${downloadHref}${downloadHref.includes("?") ? "&" : "?"}status`)
        .then((r) => r.json())
        .then((s) => alive && setVideo(s))
        .catch(() => {});
    check();
    const id = window.setInterval(check, 2000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [downloadHref]);

  return (
    <TooltipProvider>
      <main className="flex h-dvh flex-col bg-white font-sans text-neutral-900">
        <header className="flex items-center justify-between gap-6 px-6 pt-5 pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <ToggleGroup
              size="sm"
              variant="outline"
              className={LIGHT_GROUP}
              value={[which]}
              onValueChange={(v) => {
                const id = POSTS.find((p) => p.id === v[0])?.id;
                if (id) setWhich(id);
              }}
            >
              {POSTS.map((p) => (
                <ToggleGroupItem key={p.id} value={p.id} className={LIGHT_ITEM}>
                  {p.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="truncate text-[12px] text-neutral-500">
              {which === "speaker" ? `${post.speaker.name} on SpendOS` : "Meet the team, New Delhi"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <p
              className="text-[11.5px] text-neutral-500 transition-opacity duration-700"
              style={{ opacity: hint ? 1 : 0 }}
            >
              Press Space to pause
            </p>
          </div>
        </header>

        <div ref={stage} className="relative min-h-0 flex-1 px-6">
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 shadow-2xl shadow-shade/40"
            style={{ width: POST_W * fit.scale, height: POST_H * fit.scale }}
          >
            <div style={{ transform: `scale(${fit.scale})`, transformOrigin: "0 0" }}>
              <Post
                motion={motion}
                playing={playing}
                pixelScale={fit.scale * fit.dpr}
                content={shown.content}
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
                  {playing ? <PauseCircleIcon aria-hidden="true" /> : <PlayCircleIcon aria-hidden="true" />}
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
            <span className="flex items-center px-2 text-[11.5px] text-neutral-500 tabular-nums">
              {current.duration}s loop
            </span>
            <ToolbarSeparator orientation="vertical" />
            {/* Downloads the motion on screen, made by `npm run export`. While
                the video is still being made, or not made yet, it says so
                instead of a link that would do nothing. */}
            {video.state === "ready" ? (
              <Tooltip>
                <ToolbarLink
                  href={downloadHref}
                  download
                  className={buttonVariants({ variant: "ghost" })}
                  render={<TooltipTrigger render={<a />} />}
                >
                  <DownloadDownIcon aria-hidden="true" className="size-3.5" />
                  Download 4K
                </ToolbarLink>
                <TooltipPopup>
                  {current.label} as a 3840 × 2160 video at 60 fps
                </TooltipPopup>
              </Tooltip>
            ) : (
              <span
                className="flex items-center gap-1.5 px-3 text-[12px] text-white/50 tabular-nums"
                aria-live="polite"
              >
                <DownloadDownIcon aria-hidden="true" className="size-3.5" />
                {video.state === "exporting"
                  ? `Making the 4K video${video.percent != null ? `, ${video.percent}%` : ""}`
                  : "4K video not made yet"}
              </span>
            )}
          </Toolbar>
        </footer>
      </main>
    </TooltipProvider>
  );
}
