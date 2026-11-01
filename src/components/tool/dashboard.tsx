"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CopyIcon, DeleteDustbin01Icon, PlusIcon, ThreeDotsMenuHorizontalIcon } from "@/components/icons";
import type { PostContent } from "@/components/post/content";
import type { MotionId } from "@/components/post/lines";
import { Post, POST_H, POST_W } from "@/components/post/post";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { motionOf, type PostDoc, type PostSummary, toContent } from "@/lib/tool/doc";
import { api } from "./api";
import { openPost } from "./nav";

// What an unnamed post is called, here and in the editor's header.
const UNNAMED = "New speaker";

// Every post made in the tool, newest first. A post opens in the editor;
// "Add post" starts the next speaker for the same event.
export function Dashboard() {
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<PostDoc | null>(null);

  // A quiet load is the count kept while a video is made: one that fails
  // waits for the next, rather than raising a note every two seconds.
  const load = useCallback(function load(quiet = false) {
    api.list().then(setPosts, (error: Error) => {
      if (quiet) return;
      const id = toastManager.add({
        type: "error",
        title: "Unable to load the posts",
        description: error.message,
        actionProps: {
          children: "Try again",
          onClick: () => {
            toastManager.close(id);
            load();
          },
        },
      });
    });
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // While a video is being made, its card keeps count.
  const exporting = posts?.some((p) => p.export.state === "running" || p.export.state === "queued");
  useEffect(() => {
    if (!exporting) return;
    const timer = window.setInterval(() => load(true), 2000);
    return () => window.clearInterval(timer);
  }, [exporting, load]);

  const create = async (from: string | null, mode: "copy" | "next") => {
    setCreating(true);
    try {
      openPost((await api.create(from, mode)).id);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: mode === "copy" ? "Unable to duplicate the post" : "Unable to add a post",
        description: (error as Error).message,
      });
      setCreating(false);
    }
  };

  const remove = async (doc: PostDoc) => {
    try {
      await api.remove(doc.id);
      setPosts((list) => list?.filter((p) => p.doc.id !== doc.id) ?? null);
    } catch (error) {
      const id = toastManager.add({
        type: "error",
        title: "Unable to delete the post",
        description: (error as Error).message,
        actionProps: {
          children: "Try again",
          onClick: () => {
            toastManager.close(id);
            remove(doc);
          },
        },
      });
    }
  };

  const addPost = (
    <Button size="sm" loading={creating} onClick={() => create(null, "next")}>
      <PlusIcon aria-hidden="true" className="size-3.5" />
      Add post
    </Button>
  );

  return (
    <main className="min-h-dvh bg-background font-sans text-white">
      <header className="flex items-center justify-between gap-6 px-6 pt-5 pb-4">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="shrink-0 font-medium text-[13px] text-white/90">Speaker posts</h1>
          <p className="truncate text-[12px] text-white/40">
            Change the words and pictures, then download the video
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Link href="/" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Original post
          </Link>
          {addPost}
        </div>
      </header>

      {posts === null ? (
        <div className="flex justify-center py-24">
          <Spinner className="text-white/50" />
        </div>
      ) : posts.length === 0 ? (
        <div className="mx-auto flex max-w-72 flex-col items-center gap-1.5 py-24 text-center">
          <p className="font-medium text-[13px] text-white/90">No posts yet</p>
          <p className="text-[12px] text-white/45 leading-relaxed">
            Each post announces one speaker and comes with its own 4K video.
          </p>
          <div className="mt-3">{addPost}</div>
        </div>
      ) : (
        <ul className="grid gap-3 px-6 pb-10 sm:grid-cols-2 xl:grid-cols-3">
          {posts.map((p) => (
            <PostCard
              key={p.doc.id}
              summary={p}
              onDuplicate={() => create(p.doc.id, "copy")}
              onDelete={() => setDeleting(p.doc)}
            />
          ))}
        </ul>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleting?.speaker.name.trim()
                ? `Delete the post for ${deleting.speaker.name.trim()}?`
                : "Delete this post?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Its photo, picture and videos are deleted with it. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <AlertDialogClose
              render={<Button variant="destructive" />}
              onClick={() => {
                if (deleting) remove(deleting);
              }}
            >
              Delete post
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </main>
  );
}

// The chip at the top right of a card, for a video being made or made.
function ExportChip({ summary }: { summary: PostSummary }) {
  const { doc, export: status } = summary;
  switch (status.state) {
    case "running":
      return (
        <Badge variant="info">
          Making video <span className="font-mono tabular-nums">{status.percent}%</span>
        </Badge>
      );
    case "queued":
      return <Badge variant="secondary">Waiting to start</Badge>;
    case "done":
      return doc.updatedAt > status.docUpdatedAt ? (
        <Badge variant="warning">Edited since video</Badge>
      ) : (
        <Badge variant="success">4K video ready</Badge>
      );
    case "failed":
      return <Badge variant="error">Video failed</Badge>;
    default:
      return null;
  }
}

function PostCard({
  summary,
  onDuplicate,
  onDelete,
}: {
  summary: PostSummary;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { doc } = summary;
  const [hover, setHover] = useState(false);
  const name = doc.speaker.name.trim() || UNNAMED;

  return (
    <li
      className="group relative rounded-[14px] bg-white/[0.04] p-1.5 transition-colors hover:bg-white/[0.06] has-[[data-popup-open]]:bg-white/[0.06]"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <Thumbnail content={toContent(doc)} motion={motionOf(doc)} playing={hover} />
      <div className="flex flex-col gap-1 px-2 pt-2.5 pb-1.5">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate font-medium text-[13px] text-white/90">{name}</p>
          <ExportChip summary={summary} />
        </div>
        <p className="truncate text-[12px] text-white/55">{doc.title.join(" ")}</p>
        <p className="truncate text-[11.5px] text-white/35">
          {doc.date.lines.join(" ")} · {doc.location.lines[0]}
        </p>
      </div>
      {/* The whole card opens the post. */}
      <button
        type="button"
        className="absolute inset-0 cursor-pointer rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Edit the post for ${name}`}
        onClick={() => openPost(doc.id)}
      />
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`More actions for ${name}`}
              // Shown with the pointer over the card, so it never sits on
              // the logo in the thumbnail otherwise.
              className="absolute top-3.5 right-3.5 bg-black/55 text-white/85 opacity-0 backdrop-blur-md transition-opacity hover:bg-black/70 hover:text-white focus-visible:opacity-100 group-hover:opacity-100 data-popup-open:bg-black/70 data-popup-open:opacity-100"
            />
          }
        >
          <ThreeDotsMenuHorizontalIcon aria-hidden="true" />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={onDuplicate}>
            <CopyIcon aria-hidden="true" />
            Duplicate
          </MenuItem>
          <MenuItem variant="destructive" onClick={onDelete}>
            <DeleteDustbin01Icon aria-hidden="true" />
            Delete
          </MenuItem>
        </MenuPopup>
      </Menu>
    </li>
  );
}

// The post itself, drawn small. It plays while the pointer is over it.
function Thumbnail({ content, motion, playing }: { content: PostContent; motion: MotionId; playing: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 0, dpr: 1 });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setFit({ scale: el.clientWidth / POST_W, dpr: window.devicePixelRatio || 1 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={box}
      className="relative aspect-video w-full overflow-hidden rounded-[10px] bg-white/[0.04]"
      aria-hidden="true"
    >
      {fit.scale > 0 && (
        <div
          className="absolute top-0 left-0"
          style={{ width: POST_W, height: POST_H, transform: `scale(${fit.scale})`, transformOrigin: "0 0" }}
        >
          <Post motion={motion} playing={playing} pixelScale={fit.scale * fit.dpr} content={content} />
        </div>
      )}
    </div>
  );
}
