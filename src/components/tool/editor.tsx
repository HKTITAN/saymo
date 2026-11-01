"use client";

import { ArrowLeftIcon, PauseIcon, PlayIcon, TriangleAlertIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toastManager } from "@/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { dateLines } from "@/lib/tool/dates";
import { MOTIONS } from "@/components/post/lines";
import {
  type Crop,
  type DatePick,
  type DocEdit,
  motionOf,
  orangeOf,
  type PostDoc,
  toContent,
  toEdit,
} from "@/lib/tool/doc";
import { api, type Problem, ProblemError } from "./api";
import { ExportControl } from "./export-control";
import { fitHeadline, layoutProblems } from "./fit";
import { ImageField } from "./image-field";
import { MotionPicker } from "./motion-picker";
import { openPost } from "./nav";
import { OrangeWords } from "./orange-words";
import { PhotoField } from "./photo-field";
import { Preview } from "./preview";

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
          All posts
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
  // The headline box keeps the rows as typed; the post gets the filled ones.
  const [titleText, setTitleText] = useState(initial.title.join("\n"));
  const [playing, setPlaying] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [busy, setBusy] = useState<{ photo: string | null; image: string | null }>({ photo: null, image: null });
  const [problems, setProblems] = useState<string[]>([]);
  const postRef = useRef<HTMLDivElement>(null);
  const saver = useSaver(doc.id, (updatedAt) => setDoc((d) => ({ ...d, updatedAt: later(d.updatedAt, updatedAt) })));
  const { schedule, flush } = saver;

  // Every edit shows at once and is saved a moment later.
  const dirty = useRef(false);
  const edit = useCallback((change: (d: PostDoc) => PostDoc) => {
    dirty.current = true;
    setDoc(change);
  }, []);
  useEffect(() => {
    if (!dirty.current) return;
    dirty.current = false;
    schedule(toEdit(doc));
  }, [doc, schedule]);

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

  // Space pauses and 1 to 4 pick the animation, unless it is typing or
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

  const onTitle = (text: string) => {
    setTitleText(text);
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const titleSize = fitHeadline(lines);
    edit((d) => ({ ...d, title: lines, titleSize }));
  };

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
    withBusy("photo", "Framing the face", async () => {
      try {
        const r = await api.uploadPhoto(doc.id, file);
        setDoc((d) => ({ ...d, photo: r.photo, updatedAt: later(d.updatedAt, r.updatedAt) }));
        if (r.note) toastManager.add({ type: "info", title: r.note });
      } catch (error) {
        failed("That photo could not be used", error);
      }
    });
  const changePhoto = (change: { crop?: Crop; plain?: boolean }) =>
    withBusy("photo", "Updating the photo", async () => {
      try {
        const r = await api.changePhoto(doc.id, change);
        setDoc((d) => ({ ...d, photo: r.photo, updatedAt: later(d.updatedAt, r.updatedAt) }));
        if (r.note) toastManager.add({ type: "info", title: r.note });
      } catch (error) {
        failed("The photo could not be updated", error);
      }
    });
  const uploadImage = (file: File) =>
    withBusy("image", "Cutting out the landmark", async () => {
      try {
        const r = await api.uploadImage(doc.id, file);
        setDoc((d) => ({ ...d, image: r.image, updatedAt: later(d.updatedAt, r.updatedAt) }));
      } catch (error) {
        failed("That image could not be used", error);
      }
    });
  const removeImage = () =>
    withBusy("image", "Removing", async () => {
      try {
        const r = await api.removeImage(doc.id);
        setDoc((d) => ({ ...d, image: null, updatedAt: later(d.updatedAt, r.updatedAt) }));
      } catch (error) {
        failed("The image could not be removed", error);
      }
    });
  // What went wrong is shown beside the box it was typed in, with the page
  // that fixes it, rather than in a passing toast.
  const generateImage = async (place: string) => {
    let problem: Problem | null = null;
    await withBusy("image", `Making ${place}, about 20 seconds`, async () => {
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
    withBusy("image", "Switching", async () => {
      try {
        const r = await api.useTake(doc.id, file);
        setDoc((d) => ({ ...d, image: r.image, updatedAt: later(d.updatedAt, r.updatedAt) }));
      } catch (error) {
        failed("That earlier try could not be used", error);
      }
    });

  return (
    <main className="flex h-dvh flex-col bg-background text-foreground">
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
            {saver.state === "saving" ? "Saving" : saver.state === "failed" ? "Not saved, edit again to retry" : "Saved"}
          </span>
        </div>
        <ExportControl doc={doc} flush={flush} />
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-100 shrink-0 border-r">
          <ScrollArea scrollFade>
            <Section title="Animation">
              <MotionPicker
                value={motionOf(doc)}
                onChange={(motion) => edit((d) => ({ ...d, motion }))}
              />
            </Section>

            <Section title="Headline">
              <Field>
                <FieldLabel>One line per row</FieldLabel>
                <Textarea value={titleText} onChange={(e) => onTitle(e.target.value)} rows={4} />
                <FieldDescription>
                  The first line is set at full strength, the rest at 60%.
                  {doc.titleSize < 86 && ` Made smaller to fit: ${Math.round(doc.titleSize)} px instead of 86.`}
                </FieldDescription>
              </Field>
            </Section>

            <Section title="Speaker">
              <PhotoField photo={doc.photo} busy={busy.photo} onUpload={uploadPhoto} onChange={changePhoto} />
              <TextField
                label="Name"
                value={doc.speaker.name}
                onChange={(name) => edit((d) => ({ ...d, speaker: { ...d.speaker, name } }))}
              />
              <TextField
                label="Role"
                value={doc.speaker.role}
                onChange={(role) => edit((d) => ({ ...d, speaker: { ...d.speaker, role } }))}
              />
              <TextField
                label="Company"
                value={doc.speaker.company}
                onChange={(company) => edit((d) => ({ ...d, speaker: { ...d.speaker, company } }))}
              />
            </Section>

            <Section title="Date and time">
              <div className="grid grid-cols-2 gap-3">
                <PickField label="Starts" type="date" value={pick.start} onChange={(start) => onPick({ start })} />
                <PickField label="Ends, if longer" type="date" value={pick.end} onChange={(end) => onPick({ end })} />
                <PickField label="From" type="time" value={pick.time} onChange={(time) => onPick({ time })} />
                <PickField label="Until" type="time" value={pick.endTime} onChange={(endTime) => onPick({ endTime })} />
              </div>
              <p className="text-muted-foreground text-xs">
                Picking a date writes the two lines below, weekday included. You can still type over them.
              </p>
              <TextField
                label="First line"
                value={doc.date.lines[0]}
                onChange={(v) => edit((d) => ({ ...d, date: { ...d.date, lines: [v, d.date.lines[1]] } }))}
              />
              <TextField
                label="Second line"
                value={doc.date.lines[1]}
                onChange={(v) => edit((d) => ({ ...d, date: { ...d.date, lines: [d.date.lines[0], v] } }))}
              />
            </Section>

            <Section title="Location">
              <TextField
                label="First line"
                value={doc.location.lines[0]}
                onChange={(v) =>
                  edit((d) => ({ ...d, location: { ...d.location, lines: [v, d.location.lines[1]] } }))
                }
              />
              <TextField
                label="Second line"
                value={doc.location.lines[1]}
                onChange={(v) =>
                  edit((d) => ({ ...d, location: { ...d.location, lines: [d.location.lines[0], v] } }))
                }
              />
              <OrangeWords
                lines={doc.location.lines}
                value={orangeOf(doc)}
                onChange={(orange) => edit((d) => ({ ...d, location: { ...d.location, orange } }))}
              />
            </Section>

            <Section title="Landmark">
              <ImageField
                image={doc.image}
                takes={doc.takes ?? []}
                busy={busy.image}
                onUpload={uploadImage}
                onGenerate={generateImage}
                onUseTake={pickTake}
                onRemove={removeImage}
                onName={(name) => edit((d) => (d.image ? { ...d, image: { ...d.image, name } } : d))}
                onPlace={(place) => edit((d) => (d.image ? { ...d, image: { ...d.image, place } } : d))}
              />
            </Section>
          </ScrollArea>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col gap-4 p-6">
          <div className="min-h-0 flex-1">
            <Preview
              content={toContent(doc)}
              motion={motionOf(doc)}
              playing={playing}
              postRef={postRef}
              onPlace={(place) => edit((d) => (d.image ? { ...d, image: { ...d.image, place } } : d))}
            />
          </div>
          <footer className="flex min-h-9 items-center gap-4">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={playing ? "Pause" : "Play"}
                    onClick={() => setPlaying((p) => !p)}
                  />
                }
              >
                {playing ? <PauseIcon /> : <PlayIcon />}
              </TooltipTrigger>
              <TooltipPopup>
                <span className="flex items-center gap-2">
                  {playing ? "Pause" : "Play"}
                  <Kbd>Space</Kbd>
                </span>
              </TooltipPopup>
            </Tooltip>
            {problems.length > 0 && (
              <ul className="flex flex-col gap-1 text-warning-foreground text-xs" aria-live="polite">
                {problems.map((p) => (
                  <li key={p} className="flex items-center gap-2">
                    <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden="true" />
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </footer>
        </section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-b px-5 py-5 last:border-b-0">
      <h2 className="font-medium text-sm">{title}</h2>
      {children}
    </section>
  );
}

function TextField({
  label,
  value,
  description,
  onChange,
}: {
  label: string;
  value: string;
  description?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}

function PickField({
  label,
  type,
  value,
  onChange,
}: {
  label: string;
  type: "date" | "time";
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} style={{ colorScheme: "dark" }} />
    </Field>
  );
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
