"use client";

import { CopyIcon, EllipsisIcon, PlusIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
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

// Every post made in the tool, newest first. A post opens in the editor;
// "New post" starts the next speaker for the same event.
export function Dashboard() {
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<PostDoc | null>(null);

  const load = useCallback(
    () =>
      api.list().then(setPosts, (error: Error) =>
        toastManager.add({ type: "error", title: "The posts could not be loaded", description: error.message }),
      ),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  // While a video is being made, its card keeps count.
  const exporting = posts?.some((p) => p.export.state === "running" || p.export.state === "queued");
  useEffect(() => {
    if (!exporting) return;
    const timer = window.setInterval(load, 2000);
    return () => window.clearInterval(timer);
  }, [exporting, load]);

  const create = async (from: string | null, mode: "copy" | "next") => {
    setCreating(true);
    try {
      openPost((await api.create(from, mode)).id);
    } catch (error) {
      toastManager.add({ type: "error", title: "The post could not be made", description: (error as Error).message });
      setCreating(false);
    }
  };

  const remove = async (doc: PostDoc) => {
    try {
      await api.remove(doc.id);
      setPosts((list) => list?.filter((p) => p.doc.id !== doc.id) ?? null);
    } catch (error) {
      toastManager.add({ type: "error", title: "The post could not be deleted", description: (error as Error).message });
    }
  };

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="flex items-center justify-between gap-6 px-6 pt-5 pb-4">
        <div className="flex items-baseline gap-3">
          <h1 className="font-medium text-sm">Speaker posts</h1>
          <p className="text-muted-foreground text-sm">Change the words and pictures, then download the video</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Original video
          </Link>
          <Button size="sm" loading={creating} onClick={() => create(null, "next")}>
            <PlusIcon aria-hidden="true" />
            New post
          </Button>
        </div>
      </header>

      {posts === null ? (
        <div className="flex justify-center py-24">
          <Spinner />
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <p className="font-medium text-sm">No posts yet</p>
          <p className="text-muted-foreground text-sm">Start one with New post.</p>
        </div>
      ) : (
        <ul className="grid gap-6 px-6 pb-10 sm:grid-cols-2 xl:grid-cols-3">
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
            <AlertDialogTitle>Delete this post?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.speaker.name || "This post"}, its photo, image and videos are deleted for good.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
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

function PostCard({
  summary,
  onDuplicate,
  onDelete,
}: {
  summary: PostSummary;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { doc, export: status } = summary;
  const [hover, setHover] = useState(false);
  const outdated = status.state === "done" && doc.updatedAt > status.docUpdatedAt;

  return (
    <li
      className="group relative overflow-hidden rounded-xl border bg-card transition-colors has-[>button:hover]:border-ring/40"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <Thumbnail content={toContent(doc)} motion={motionOf(doc)} playing={hover} />
      <div className="flex flex-col gap-1 px-4 pt-3 pb-4">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate font-medium text-sm">{doc.speaker.name || "No speaker yet"}</p>
          {status.state === "running" && <Badge variant="info">Making video {status.percent}%</Badge>}
          {status.state === "queued" && <Badge variant="secondary">Waiting to export</Badge>}
          {status.state === "done" &&
            (outdated ? (
              <Badge variant="warning">Edited since video</Badge>
            ) : (
              <Badge variant="success">4K video ready</Badge>
            ))}
          {status.state === "failed" && <Badge variant="error">Export failed</Badge>}
        </div>
        <p className="truncate text-muted-foreground text-sm">{doc.title.join(" ")}</p>
        <p className="truncate text-muted-foreground text-xs">
          {doc.date.lines.join(" ")} · {doc.location.lines[0]}
        </p>
      </div>
      {/* The whole card opens the post. */}
      <button
        type="button"
        className="absolute inset-0 cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        aria-label={`Edit ${doc.speaker.name || "this post"}`}
        onClick={() => openPost(doc.id)}
      />
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={`More for ${doc.speaker.name || "this post"}`}
              // Shown with the pointer over the card, so it never sits on
              // the logo in the thumbnail otherwise.
              className="absolute top-2.5 right-2.5 bg-background/80 opacity-0 backdrop-blur transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-popup-open:opacity-100"
            />
          }
        >
          <EllipsisIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={onDuplicate}>
            <CopyIcon aria-hidden="true" />
            Duplicate
          </MenuItem>
          <MenuItem variant="destructive" onClick={onDelete}>
            <Trash2Icon aria-hidden="true" />
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
    <div ref={box} className="relative aspect-video w-full overflow-hidden bg-muted" aria-hidden="true">
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
