"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangleIcon, ArrowLeftIcon } from "@/components/icons";
import { MOTIONS } from "@/components/post/lines";
import { HEADLINE, type PostHandle, type PostPart } from "@/components/post/post";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { dateLines } from "@/lib/tool/dates";
import { type Crop, type DatePick, type DocEdit, motionOf, type PostDoc, toContent, toEdit } from "@/lib/tool/doc";
import { api, type Problem, ProblemError } from "./api";
import { createPickerHandle, DateIconTrigger, DatePicker, TimePicker } from "./date-picker";
import { DialGroup, DialNote } from "./dial";
import { ExportControl } from "./export-control";
import { layoutProblems } from "./fit";
import { ImageField } from "./image-field";
import { EditingContext, InlineField, tidy, titleLines, useInlineEditing } from "./inline-edit";
import { MotionPicker } from "./motion-picker";
import { openPost } from "./nav";
import { PhotoField } from "./photo-field";
import { Preview } from "./preview";
import { Timeline } from "./timeline";

export function Editor({ id }: { id: string }) {
  const [doc, setDoc] = useState<PostDoc | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    api.get(id).then(setDoc, () => setMissing(true));
  }, [id]);

  if (missing) {
    return (
      <main className="flex h-dvh flex-col items-center justify-center gap-3 bg-background text-foreground">
        <p className="text-sm">This post no longer exists.</p>
        <Button variant="outline" onClick={() => openPost(null)}>
          Back to all posts
        </Button>
      </main>
    );
  }
  if (!doc) {
    return (
      <main className="flex h-dvh items-center justify-center bg-background">
        <Spinner />
      </main>
    );
  }
  return <Workspace initial={doc} />;
}

const NO_PICK: DatePick = { start: "", end: "", time: "", endTime: "" };
const later = (a: string, b: string) => (a > b ? a : b);
const failed = (title: string, error: unknown) =>
  toastManager.add({ type: "error", title, description: (error as Error).message });

function Workspace({ initial }: { initial: PostDoc }) {
  const [doc, setDoc] = useState(initial);
  const [playing, setPlaying] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [busy, setBusy] = useState<{ photo: string | null; image: string | null }>({ photo: null, image: null });
  const [problems, setProblems] = useState<string[]>([]);
  const postRef = useRef<HTMLDivElement>(null);
  const postHandle = useRef<PostHandle>(null);
  const [calendar] = useState(createPickerHandle);
  const saver = useSaver(doc.id, (updatedAt) => setDoc((d) => ({ ...d, updatedAt: later(d.updatedAt, updatedAt) })));
  const { schedule, flush } = saver;

  // Every edit shows at once and is saved a moment later, tidied: no empty
  // headline lines, no spaces at the ends of lines.
  const dirty = useRef(false);
  const docRef = useRef(doc);
  useEffect(() => {
    docRef.current = doc;
  });
  const history = useHistory();
  const edit = useCallback(
    (change: (d: PostDoc) => PostDoc) => {
      history.record({ kind: "words", before: wordsOf(docRef.current) });
      dirty.current = true;
      setDoc(change);
    },
    [history],
  );
  useEffect(() => {
    if (!dirty.current) return;
    dirty.current = false;
    schedule(toEdit(tidy(doc)));
  }, [doc, schedule]);

  const editing = useInlineEditing(doc, edit);
  const motion = motionOf(doc);

  // What does not fit, checked once the post has drawn with its own type.
  useEffect(() => {
    const post = postRef.current?.querySelector<HTMLElement>("[data-post]");
    if (!post) return;
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) setProblems(layoutProblems(post));
    });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  // Space plays and pauses and 1 to 4 pick the animation, unless typing or
  // pressing a control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, button, a, [role], [tabindex]")) return;
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
      const picked = MOTIONS[Number(e.key) - 1];
      if (picked) edit((d) => ({ ...d, motion: picked.id }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [edit]);


  const pick = doc.date.pick ?? NO_PICK;
  const onPick = (change: Partial<DatePick>) => {
    const next = { ...pick, ...change };
    const lines = dateLines(next);
    edit((d) => ({ ...d, date: { pick: next, lines: lines ?? d.date.lines } }));
  };

  // Uploads wait for any unsaved words first, so a late save can never put
  // an old placement onto a new image.
  const withBusy = async (part: "photo" | "image", label: string, job: () => Promise<void>) => {
    setBusy((b) => ({ ...b, [part]: label }));
    try {
      await flush();
      await job();
    } finally {
      setBusy((b) => ({ ...b, [part]: null }));
    }
  };
  const uploadPhoto = (file: File) =>
    withBusy("photo", "Framing the face…", async () => {
      try {
        const r = await api.uploadPhoto(doc.id, file);
        setDoc((d) => ({ ...d, photo: r.photo, updatedAt: later(d.updatedAt, r.updatedAt) }));
        if (r.note) toastManager.add({ type: "info", title: r.note });
      } catch (error) {
        failed("Unable to use that photo", error);
      }
    });
  const changePhoto = (change: { crop?: Crop; plain?: boolean }, fromHistory = false) =>
    withBusy("photo", "Updating the photo…", async () => {
      const photo = docRef.current.photo;
      if (!fromHistory && photo) {
        history.record({ kind: "photo", before: { crop: photo.crop ?? undefined, plain: photo.plain } }, true);
      }
      try {
        const r = await api.changePhoto(doc.id, change);
        setDoc((d) => ({ ...d, photo: r.photo, updatedAt: later(d.updatedAt, r.updatedAt) }));
        if (r.note) toastManager.add({ type: "info", title: r.note });
      } catch (error) {
        failed("Unable to update the photo", error);
      }
    });
  const uploadImage = (file: File) =>
    withBusy("image", "Cutting out the landmark…", async () => {
      try {
        const r = await api.uploadImage(doc.id, file);
        setDoc((d) => ({ ...d, image: r.image, updatedAt: later(d.updatedAt, r.updatedAt) }));
      } catch (error) {
        failed("Unable to use that image", error);
      }
    });
  const removeImage = () =>
    withBusy("image", "Removing the landmark…", async () => {
      try {
        const r = await api.removeImage(doc.id);
        setDoc((d) => ({ ...d, image: null, updatedAt: later(d.updatedAt, r.updatedAt) }));
      } catch (error) {
        failed("Unable to remove the landmark", error);
      }
    });
  // What went wrong is shown beside the box it was typed in, with the page
  // that fixes it, rather than in a passing toast.
  const generateImage = async (place: string) => {
    let problem: Problem | null = null;
    await withBusy("image", `Making ${place}. This takes about 20 seconds.`, async () => {
      try {
        const r = await api.generateImage(doc.id, place);
        setDoc((d) => ({ ...d, image: r.image, takes: r.takes, updatedAt: later(d.updatedAt, r.updatedAt) }));
      } catch (error) {
        problem = error instanceof ProblemError ? error.problem : { message: (error as Error).message };
      }
    }).catch((error: Error) => {
      problem = { message: error.message };
    });
    return problem;
  };
  const pickTake = (file: string) =>
    withBusy("image", "Switching to that try…", async () => {
      try {
        const r = await api.useTake(doc.id, file);
        setDoc((d) => ({ ...d, image: r.image, updatedAt: later(d.updatedAt, r.updatedAt) }));
      } catch (error) {
        failed("Unable to switch to that try", error);
      }
    });

  // ⌘Z / Ctrl+Z undo and ⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y redo every change to
  // the post: words, dates, orange words, animation, sizes, the landmark's
  // placement and the photo's framing. Inside a text box the box's own
  // undo runs instead.
  const step = useCallback(
    (direction: "undo" | "redo") => {
      const current = docRef.current;
      const entry = history.take(direction, (e) =>
        e.kind === "words"
          ? { kind: "words", before: wordsOf(current) }
          : { kind: "photo", before: { crop: current.photo?.crop ?? e.before.crop, plain: current.photo?.plain ?? e.before.plain } },
      );
      if (!entry) return;
      if (entry.kind === "words") {
        dirty.current = true;
        setDoc((d) => withWords(d, entry.before));
      } else {
        void changePhoto(entry.before, true);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- changePhoto is remade each render
    [history],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const redo = (key === "z" && e.shiftKey) || (key === "y" && e.ctrlKey && !e.metaKey);
      if (key !== "z" && !redo) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable='true']")) return;
      e.preventDefault();
      step(redo ? "redo" : "undo");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  // Each piece of text on the post edits in place; the date's icon opens
  // the calendar.
  const wrap = (part: PostPart, node: ReactNode) =>
    part === "date.icon" ? (
      <DateIconTrigger handle={calendar}>{node}</DateIconTrigger>
    ) : (
      <InlineField part={part}>{node}</InlineField>
    );
  const onPlace = (place: NonNullable<PostDoc["image"]>["place"]) =>
    edit((d) => (d.image ? { ...d, image: { ...d.image, place } } : d));

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <header className="flex min-h-16 items-center justify-between gap-6 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              flush().catch(() => {});
              openPost(null);
            }}
          >
            <ArrowLeftIcon aria-hidden="true" />
            All posts
          </Button>
          <h1 className="truncate font-medium text-sm">{doc.speaker.name || "New speaker"}</h1>
          <span
            className={
              saver.state === "failed" ? "text-destructive-foreground text-xs" : "text-muted-foreground text-xs"
            }
          >
            {saver.state === "saving"
              ? "Saving changes…"
              : saver.state === "failed"
                ? "Changes not saved. Make any change to try again."
                : "Changes saved"}
          </span>
        </div>
        <ExportControl doc={doc} flush={flush} />
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col gap-4 p-6">
          <div className="min-h-0 flex-1">
            <EditingContext value={editing}>
              <Preview
                content={toContent({ ...doc, title: titleLines(doc) })}
                motion={motion}
                handle={postHandle}
                wrap={wrap}
                postRef={postRef}
                onPlace={onPlace}
              />
            </EditingContext>
          </div>
          <Timeline motion={motion} playing={playing} onPlaying={setPlaying} post={postHandle} />
          {problems.length > 0 && (
            <ul className="flex flex-col gap-1 text-warning-foreground text-xs" aria-live="polite">
              {problems.map((p) => (
                <li key={p} className="flex items-center gap-2">
                  <AlertTriangleIcon className="size-3.5 shrink-0" aria-hidden="true" />
                  {p}
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="w-100 shrink-0 border-l">
          <ScrollArea scrollFade>
            <div className="flex flex-col gap-5 px-4 py-4">
              <DialGroup title="Animation">
                <MotionPicker value={motion} onChange={(m) => edit((d) => ({ ...d, motion: m }))} />
              </DialGroup>

              <DialGroup title="Words">
                <ul className="flex flex-col gap-1.5 rounded-[10px] bg-white/[0.03] px-3 py-2.5 text-[11.5px] text-white/55 leading-relaxed">
                  <li>Click any words on the post to change them.</li>
                  <li>In the headline, Enter starts a new line.</li>
                  <li>To set words in orange, select them in the location.</li>
                </ul>
                {doc.titleSize < HEADLINE.size && (
                  <DialNote>
                    The headline is set at {Math.round(doc.titleSize)} px instead of {HEADLINE.size}, so it fits.
                  </DialNote>
                )}
              </DialGroup>

              <DialGroup title="Date and time">
                <DatePicker handle={calendar} pick={pick} onPick={onPick} />
                <TimePicker pick={pick} onPick={onPick} />
                <DialNote>
                  Picking writes the date lines on the post. You can still change their words there.
                </DialNote>
              </DialGroup>

              <DialGroup title="Speaker photo">
                <PhotoField photo={doc.photo} busy={busy.photo} onUpload={uploadPhoto} onChange={changePhoto} />
              </DialGroup>

              <DialGroup title="Landmark">
                <ImageField
                  image={doc.image}
                  takes={doc.takes ?? []}
                  busy={busy.image}
                  onUpload={uploadImage}
                  onGenerate={generateImage}
                  onUseTake={pickTake}
                  onRemove={removeImage}
                  onName={(name) => edit((d) => (d.image ? { ...d, image: { ...d.image, name } } : d))}
                  onPlace={onPlace}
                />
              </DialGroup>
            </div>
          </ScrollArea>
        </aside>
      </div>
    </main>
  );
}

// ─── Undo ─────────────────────────────────────────────────────────────────

// What undo puts back: everything typed or set in the editor, and the
// photo's framing (which the server redraws, so it is undone by asking
// again). Uploads and new landmarks are not undone.
type Words = Pick<PostDoc, "motion" | "title" | "titleSize" | "speaker" | "date" | "location"> & {
  place: NonNullable<PostDoc["image"]>["place"] | null;
};
type Change =
  | { kind: "words"; before: Words }
  | { kind: "photo"; before: { crop?: Crop; plain: boolean } };

const wordsOf = (d: PostDoc): Words => ({
  motion: d.motion,
  title: d.title,
  titleSize: d.titleSize,
  speaker: d.speaker,
  date: d.date,
  location: d.location,
  place: d.image?.place ?? null,
});
const withWords = (d: PostDoc, { place, ...words }: Words): PostDoc => ({
  ...d,
  ...words,
  image: d.image && place ? { ...d.image, place } : d.image,
});

// Changes made in quick succession (typing, dragging a slider) undo as one.
const GROUP_MS = 700;
const LIMIT = 100;

function useHistory() {
  const [history] = useState(() => {
    const undo: Change[] = [];
    const redo: Change[] = [];
    let last = 0;
    let lastKind: Change["kind"] | null = null;
    return {
      // Called before a change, with the state it changes from.
      record(change: Change, separate = false) {
        const now = Date.now();
        const joins = !separate && lastKind === change.kind && now - last < GROUP_MS;
        last = now;
        lastKind = change.kind;
        redo.length = 0;
        if (joins) return;
        undo.push(change);
        if (undo.length > LIMIT) undo.shift();
      },
      // Takes the next change to undo (or redo), keeping the state it
      // replaces on the other stack.
      take(direction: "undo" | "redo", current: (entry: Change) => Change): Change | null {
        const [from, to] = direction === "undo" ? [undo, redo] : [redo, undo];
        const entry = from.pop();
        if (!entry) return null;
        to.push(current(entry));
        lastKind = null;
        return entry;
      },
    };
  });
  return history;
}

// Saves the post's edits half a second after the last change, one save at
// a time and in order. `flush` saves anything waiting straight away.
function useSaver(id: string, onSaved: (updatedAt: string) => void) {
  const [state, setState] = useState<"saved" | "saving" | "failed">("saved");
  const pending = useRef<DocEdit | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const timer = useRef(0);
  const saved = useRef(onSaved);
  useEffect(() => {
    saved.current = onSaved;
  });

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    for (;;) {
      if (running.current) {
        await running.current;
        continue;
      }
      const edit = pending.current;
      if (!edit) return;
      pending.current = null;
      let ok = true;
      running.current = api
        .save(id, edit)
        .then(
          (r) => saved.current(r.updatedAt),
          () => {
            ok = false;
            pending.current ??= edit;
          },
        )
        .finally(() => {
          running.current = null;
        });
      await running.current;
      if (!ok) {
        setState("failed");
        throw new Error("The post could not be saved.");
      }
      if (!pending.current) setState("saved");
    }
  }, [id]);

  const schedule = useCallback(
    (edit: DocEdit) => {
      pending.current = edit;
      setState("saving");
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => flush().catch(() => {}), 500);
    },
    [flush],
  );

  // Anything unsaved goes on the way out: back to the list, or a closed tab.
  useEffect(() => {
    const onHide = () => {
      if (!pending.current) return;
      api.save(id, pending.current, true).catch(() => {});
      pending.current = null;
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      flush().catch(() => {});
    };
  }, [id, flush]);

  return { state, schedule, flush };
}
