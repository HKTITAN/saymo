"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveEdit, type Transcripts } from "@/lib/studio/films/anchors";
import { type Edit, editEnd, type GraphicInfo, type Media, type Word } from "@/lib/studio/films/edit";
import { StudioError } from "../api/studio";
import { appendMedia } from "./edit-ops";
import type { History } from "../film/history";
import { isMediaFile, upload, videoApi } from "../api/video";

// One video film's edit as you work on it: the edit itself, what's
// selected, the footage in the bin and the graphics library. Every change
// goes to the stage at once, joins the studio's undo history (history.ts)
// and is saved a moment after the last one. Claude's turns change
// edit.json on the server; `reload` takes those in.

export type Upload = { key: string; name: string; progress: number; error: string | null };
export type SaveState = "saved" | "saving" | "failed";

export function useEdit(
  id: string,
  {
    onLive,
    onDuration,
    record,
    enabled,
  }: {
    onLive: (edit: Edit) => void;
    onDuration: (seconds: number) => void;
    record: History["record"];
    enabled: boolean; // only video films have an edit and footage
  },
) {
  const [edit, setEdit] = useState<Edit | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [media, setMedia] = useState<Media[]>([]);
  // False until the bin's footage has been read once: it draws shapes until then.
  const [binLoaded, setBinLoaded] = useState(false);
  const [graphics, setGraphics] = useState<GraphicInfo[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [save, setSave] = useState<SaveState>("saved");

  const current = useRef<Edit | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const retry = useRef<(() => Promise<void>) | null>(null);
  const callbacks = useRef({ onLive, onDuration, record });
  useEffect(() => {
    callbacks.current = { onLive, onDuration, record };
  });

  // What's said in each file the edit uses, for turning words into seconds
  // (anchors.ts) as the edit changes: cut a clip and the graphics on its
  // words move with them.
  const said = useRef<Transcripts>({});
  const [saidCount, setSaidCount] = useState(0);

  // Shows an edit everywhere: here, on the stage and in the clock. An edit
  // that's the same as the one showing isn't sent again, so the stage never
  // redraws for nothing.
  const show = useCallback((raw: Edit) => {
    const next = resolveEdit(raw, said.current).edit;
    if (current.current && JSON.stringify(current.current) === JSON.stringify(next)) return;
    current.current = next;
    setEdit(next);
    callbacks.current.onLive(next);
    callbacks.current.onDuration(Math.max(0.1, editEnd(next)));
  }, []);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current || !current.current) return;
    dirty.current = false;
    setSave("saving");
    try {
      await videoApi.saveEdit(id, current.current);
      setSave(dirty.current ? "saving" : "saved");
    } catch {
      dirty.current = true;
      setSave("failed");
      // Try again shortly.
      timer.current = setTimeout(() => void retry.current?.(), 3000);
    }
  }, [id]);
  useEffect(() => {
    retry.current = flush;
  });

  const schedule = useCallback(() => {
    dirty.current = true;
    setSave("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 500);
  }, [flush]);

  // Saves whatever is waiting when the page goes away.
  useEffect(() => {
    const away = () => {
      if (dirty.current && current.current) {
        void fetch(`/api/studio/films/${id}/edit`, {
          method: "PUT",
          keepalive: true,
          headers: { "Content-Type": "application/json", "x-studio": "1" },
          body: JSON.stringify(current.current),
        });
      }
    };
    window.addEventListener("pagehide", away);
    return () => {
      window.removeEventListener("pagehide", away);
      away();
    };
  }, [id]);

  // Adds a step to the studio's undo history that puts back `before`, and
  // redoes by putting back whatever was there when it was undone.
  const remember = useCallback(
    (before: Edit, label: string, group?: string) => {
      callbacks.current.record({
        label,
        group,
        undo: () => {
          const now = current.current;
          show(before);
          schedule();
          if (!now) return;
          return () => {
            show(now);
            schedule();
          };
        },
      });
    },
    [show, schedule],
  );

  // Changes the edit. `label` names it in the undo note ("Split", "Speed
  // 1.50 ×"); changes in the same `group` moments apart are one step. A drag
  // calls `begin` once, then changes with `record: false`.
  const change = useCallback(
    (
      fn: (edit: Edit) => Edit,
      { label = "Edit", group, record = true }: { label?: string; group?: string; record?: boolean } = {},
    ) => {
      const before = current.current;
      if (!before) return;
      const next = fn(before);
      if (next === before) return;
      if (record) remember(before, label, group);
      show(next);
      schedule();
    },
    [show, schedule, remember],
  );

  const begin = useCallback(
    (label: string) => {
      if (current.current) remember(current.current, label);
    },
    [remember],
  );

  // Takes in the edit as the server has it (after one of Claude's turns).
  const reload = useCallback(async () => {
    await flush();
    try {
      const next = await videoApi.edit(id);
      show(next);
      setSelected((s) => new Set([...s].filter((i) => next.tracks.some((t) => t.items.some((x) => x.id === i)))));
    } catch (e) {
      setLoadError(e instanceof StudioError ? e.message : "Unable to load the edit. Reload the page to try again.");
    }
  }, [id, flush, show]);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    videoApi
      .edit(id)
      .then((e) => live && show(e))
      .catch((e) => live && setLoadError(e instanceof StudioError ? e.message : "Unable to load the edit. Reload the page to try again."));
    videoApi
      .graphics()
      .then((g) => live && setGraphics(g))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id, show, enabled]);

  // ─── The bin ────────────────────────────────────────────────────────────

  const refreshMedia = useCallback(async () => {
    const list = await videoApi.media(id).catch(() => null);
    if (list) setMedia(list);
    setBinLoaded(true);
    return list;
  }, [id]);

  // Checks back while anything is still being prepared or transcribed.
  const busy = media.some((m) => m.status === "importing" || m.transcribing);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load of the bin
    if (enabled && !busy) void refreshMedia();
  }, [busy, refreshMedia, enabled]);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void refreshMedia(), 1000);
    return () => clearInterval(timer);
  }, [busy, refreshMedia]);

  // Footage waiting to be laid end to end once it's ready, in drop order.
  const pending = useRef<string[]>([]);
  useEffect(() => {
    if (!pending.current.length) return;
    const waiting = pending.current.map((m) => media.find((x) => x.id === m));
    if (waiting.some((m) => !m || m.status === "importing")) return;
    pending.current = [];
    const ready = waiting.filter((m): m is Media => !!m && m.status === "ready");
    if (ready.length) {
      change((e) => appendMedia(e, ready), {
        label: ready.length === 1 ? `Added ${ready[0].name}` : `Added ${ready.length} files`,
      });
    }
  }, [media, change]);

  // Sends each file to the bin, showing how far each upload has got.
  // `append` lays them end to end on the timeline once they're ready.
  const importFiles = useCallback(
    async (files: File[], { append = false }: { append?: boolean } = {}) => {
      const usable = files.filter(isMediaFile);
      const made: string[] = [];
      await Promise.all(
        usable.map(async (file, n) => {
          const key = `${Date.now()}-${n}-${file.name}`;
          setUploads((u) => [...u, { key, name: file.name, progress: 0, error: null }]);
          try {
            const m = await upload(id, file, (p) =>
              setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: p } : x))),
            );
            made[n] = m.id;
            setMedia((list) => [...list.filter((x) => x.id !== m.id), m]);
            setUploads((u) => u.filter((x) => x.key !== key));
          } catch (e) {
            const error = e instanceof StudioError ? e.message : `Unable to add ${file.name}. Try again.`;
            setUploads((u) => u.map((x) => (x.key === key ? { ...x, error } : x)));
          }
        }),
      );
      if (append) pending.current = [...pending.current, ...made.filter(Boolean)];
      await refreshMedia();
      return usable.length;
    },
    [id, refreshMedia],
  );

  const dismissUpload = (key: string) => setUploads((u) => u.filter((x) => x.key !== key));

  // Each piece of footage's loudness, fetched once, for the waveforms.
  const [peaks, setPeaks] = useState<Record<string, number[]>>({});
  const asked = useRef(new Set<string>());
  useEffect(() => {
    for (const m of media) {
      if (!m.peaks || asked.current.has(m.id)) continue;
      asked.current.add(m.id);
      videoApi
        .peaks(id, m)
        .then((p) => setPeaks((all) => ({ ...all, [m.id]: p })))
        .catch(() => asked.current.delete(m.id));
    }
  }, [id, media]);

  // Each transcript the edit can hang words on, fetched once; the edit is
  // placed again as each arrives.
  const askedSaid = useRef(new Set<string>());
  useEffect(() => {
    for (const m of media) {
      if (!m.transcript || askedSaid.current.has(m.id)) continue;
      askedSaid.current.add(m.id);
      videoApi
        .transcript(id, m)
        .then((words) => {
          said.current = { ...said.current, [m.id]: words };
          setSaidCount((n) => n + 1);
        })
        .catch(() => askedSaid.current.delete(m.id));
    }
  }, [id, media]);
  useEffect(() => {
    if (saidCount && current.current) show(current.current);
  }, [saidCount, show]);

  // What's said in each of these, by media id. Pass the newest bin list
  // when transcripts have only just been written.
  const transcripts = useCallback(
    async (ids: string[], list: Media[] = media) => {
      const out = new Map<string, Word[]>();
      for (const mid of ids) {
        const m = list.find((x) => x.id === mid);
        if (m?.transcript) out.set(mid, await videoApi.transcript(id, m).catch(() => []));
      }
      return out;
    },
    [id, media],
  );

  const byId = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);

  return {
    edit,
    loadError,
    selected,
    setSelected,
    media,
    binLoaded,
    mediaById: byId,
    graphics,
    uploads,
    dismissUpload,
    peaks,
    save,
    change,
    begin,
    reload,
    flush,
    importFiles,
    refreshMedia,
    transcripts,
  };
}

export type EditState = ReturnType<typeof useEdit>;
