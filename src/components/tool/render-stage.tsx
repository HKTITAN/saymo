"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ExportStage } from "@/components/export-stage";
import { MOTION_BY_ID, MOTIONS, type MotionId } from "@/components/post/lines";
import { type PostDoc, toContent } from "@/lib/tool/doc";

const noSubscribe = () => () => {};
const isMotion = (v: string | null): v is MotionId => !!v && Object.hasOwn(MOTION_BY_ID, v);

// `/tool/render?id=<id>&motion=scenes`: one tool post, bare, for the
// exporter. It appears once the post has loaded, so the exporter's wait for
// window.__post also waits for the post's words and pictures.
export function RenderStage() {
  const search = useSyncExternalStore(noSubscribe, () => window.location.search, () => null);
  const params = new URLSearchParams(search ?? "");
  const id = params.get("id");
  const motion = params.get("motion");
  const [doc, setDoc] = useState<PostDoc | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/posts/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setDoc);
  }, [id]);

  if (!doc) return null;
  return <ExportStage motion={isMotion(motion) ? motion : MOTIONS[0].id} content={toContent(doc)} />;
}
