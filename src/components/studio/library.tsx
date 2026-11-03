"use client";

import { Popover } from "@base-ui/react/popover";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  DeleteDustbin01Icon,
  ExternalLinkSquareIcon,
  FileIcon,
  FolderIcon,
  GridDashboard02Icon,
  LayerThreeIcon,
  LinkChainHorizontalIcon,
  MultipleCrossCancelIcon,
  PauseCircleIcon,
  PencilEditIcon,
  PlayCircleIcon,
  PlusIcon,
  TagIcon,
  ThreeDotsMenuHorizontalIcon,
  UploadUpIcon,
} from "@/components/icons";
import { Skeleton } from "@/components/skeleton";
import { SURFACE } from "@/components/tool/dial";
import { RenameField } from "@/components/tool/rename";
import {
  KIND_NAME,
  LIBRARY_ACCEPT,
  LIBRARY_DRAG,
  type LibraryList,
  type RefEntry,
  type RefFolder,
} from "@/lib/studio/references-shared";
import { cn } from "@/lib/utils";
import { StudioError } from "./api";
import { EdgeBeam } from "./edge-beam";
import { ago, DANGER_ITEM, Empty, FolderCard, FolderChip, FolderMenu, ITEM, MENU_POPUP } from "./home-parts";
import type { useHistory } from "./history";
import { libraryApi } from "./library-api";
import { clockText as formatTime } from "./use-attachments";
import { CARD, DiscardAsk, Hint, ICON_BUTTON, PILL_BUTTON } from "./panel";

// The reference library on the studio's home page: pictures, clips, GIFs,
// sounds, PDFs, notes and links saved once and used in any film. Filed in
// folders like films, tagged, searched from the header. Drop files anywhere
// on the page, paste a picture or a link, or use Add. Each card can be
// dragged onto a folder, onto a film (it waits in that film's chat), or
// onto "Make motion graphics"; every prompt box can also pick from it.
// The brand kits' logos, guideline files and rules show here too, read-only.

type History = ReturnType<typeof useHistory>;
type Sort = "edited" | "name";
// The open place: everything not in a folder, a folder, or the brand kits.
type Place = null | "brands" | string;

const plural = new Intl.PluralRules("en");
const itemCount = (n: number) => `${n} ${plural.select(n) === "one" ? "item" : "items"}`;
const sizeText = (bytes?: number) =>
  bytes === undefined ? "" : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
const isLink = (text: string) => /^https?:\/\/\S+$/i.test(text.trim());

// What the line under a card says: "Clip · 0:12", "Image · 1920 × 1080".
function detailOf(e: RefEntry): ReactNode {
  const mono = (s: string) => <span className="tabular-nums">{s}</span>;
  if (e.brand) return e.brand.name;
  if ((e.kind === "video" || e.kind === "audio") && e.duration) return mono(formatTime(e.duration));
  if ((e.kind === "image" || e.kind === "gif") && e.width && e.height) return mono(`${e.width} × ${e.height}`);
  if (e.kind === "pdf" && e.pages) return <>{mono(String(e.pages))} {plural.select(e.pages) === "one" ? "page" : "pages"}</>;
  if (e.kind === "link") return e.site ?? "";
  return "";
}

const matches = (e: RefEntry, q: string) =>
  !q ||
  [e.name, e.note, e.site ?? "", e.url ?? "", e.brand?.name ?? "", ...e.tags].some((s) => s.toLowerCase().includes(q));

// What the loading shapes are measured from.
const SAMPLE: RefEntry[] = ["Moodboard", "Launch clip", "Walk-on music", "Brief"].map((name, i) => ({
  id: `sample${i}`,
  kind: (["image", "video", "audio", "pdf"] as const)[i],
  name,
  folder: null,
  tags: [],
  note: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  file: null,
  thumb: null,
  thumbUrl: null,
  fileUrl: null,
  previewUrl: null,
  attach: [],
}));

// ─── One sound playing at a time ──────────────────────────────────────────────

const player = (() => {
  let audio: HTMLAudioElement | null = null;
  let state = { id: null as string | null, at: 0 };
  const subs = new Set<() => void>();
  const emit = () => {
    for (const s of subs) s();
  };
  return {
    subscribe(cb: () => void) {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    get: () => state,
    toggle(id: string, url: string) {
      if (state.id === id) {
        audio?.pause();
        state = { id: null, at: 0 };
        emit();
        return;
      }
      audio?.pause();
      audio = new Audio(url);
      const mine = audio;
      state = { id, at: 0 };
      mine.ontimeupdate = () => {
        if (audio !== mine || !mine.duration) return;
        state = { id, at: mine.currentTime / mine.duration };
        emit();
      };
      mine.onended = () => {
        if (audio !== mine) return;
        state = { id: null, at: 0 };
        emit();
      };
      void mine.play().catch(() => {
        state = { id: null, at: 0 };
        emit();
      });
      emit();
    },
  };
})();
const STOPPED = { id: null, at: 0 };
const usePlayer = () => useSyncExternalStore(player.subscribe, player.get, () => STOPPED);

// ─── The library ──────────────────────────────────────────────────────────────

export function LibraryView({
  active,
  tabs,
  query,
  sort,
  now,
  history,
  say,
  onClearQuery,
  onDragItem,
  onOpenKit,
  onCount,
}: {
  active: boolean;
  tabs: ReactNode; // Films | Library, shown at the top level
  query: string;
  sort: Sort;
  now: number;
  history: History;
  say: (text: string) => void;
  onClearQuery: () => void;
  onDragItem: (id: string | null) => void;
  onOpenKit: (id: string) => void;
  onCount: (n: number | null) => void;
}) {
  const [list, setList] = useState<LibraryList | null>(null);
  const [place, setPlace] = useState<Place>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [uploads, setUploads] = useState<{ key: number; name: string }[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [filesOver, setFilesOver] = useState(false);
  const [naming, setNaming] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const uploadKey = useRef(0);

  const load = useCallback(async () => {
    try {
      setList(await libraryApi.list());
    } catch {
      setList((l) => l ?? { items: [], folders: [], brands: [] });
    }
  }, []);
  // Loaded once for the tab's count, and again each time it's opened.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the library
    void load();
  }, [active, load]);
  useEffect(() => onCount(list ? list.items.length : null), [list, onCount]);

  const folders = list?.folders ?? [];
  const folder = place && place !== "brands" ? (folders.find((f) => f.id === place) ?? null) : null;
  const items = useMemo(() => list?.items ?? [], [list]);
  const brands = useMemo(() => list?.brands ?? [], [list]);
  const folderName = (id: string | null) => (id ? (folders.find((f) => f.id === id)?.name ?? "a folder") : "the library");

  // Changes made here show at once, then the server's answer replaces them.
  const patchLocal = (id: string, change: Partial<RefEntry>) =>
    setList((l) => (l ? { ...l, items: l.items.map((i) => (i.id === id ? { ...i, ...change } : i)) } : l));
  const update = (entry: RefEntry, change: { name?: string; note?: string; tags?: string[]; folder?: string | null }) => {
    patchLocal(entry.id, change);
    void libraryApi
      .update(entry.id, change)
      .then((fresh) => patchLocal(entry.id, fresh))
      .catch(() => load());
  };

  // ─── Adding ───────────────────────────────────────────────────────────────

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setProblem(null);
      const into = place && place !== "brands" ? place : null;
      const pending = files.map((f) => ({ key: ++uploadKey.current, name: f.name }));
      setUploads((u) => [...u, ...pending]);
      let added = 0;
      for (const [i, file] of files.entries()) {
        try {
          const made = await libraryApi.upload(file, into);
          added += 1;
          setList((l) => (l ? { ...l, items: [made, ...l.items.filter((x) => x.id !== made.id)] } : l));
        } catch (e) {
          setProblem(e instanceof StudioError ? e.message : `Unable to add ${file.name}. Try again.`);
        } finally {
          setUploads((u) => u.filter((x) => x.key !== pending[i].key));
        }
      }
      if (added) say(added === 1 ? "Added to the library" : `Added ${itemCount(added)} to the library`);
    },
    [place, say],
  );

  const addLink = useCallback(
    async (link: string) => {
      setProblem(null);
      const key = ++uploadKey.current;
      setUploads((u) => [...u, { key, name: link }]);
      try {
        const made = await libraryApi.link(link, place && place !== "brands" ? place : null);
        setList((l) => (l ? { ...l, items: [made, ...l.items] } : l));
        say("Saved the link");
        return true;
      } catch (e) {
        setProblem(e instanceof StudioError ? e.message : "Unable to save the link. Try again.");
        return false;
      } finally {
        setUploads((u) => u.filter((x) => x.key !== key));
      }
    },
    [place, say],
  );

  const addNote = useCallback(
    async (text: string) => {
      setProblem(null);
      try {
        const made = await libraryApi.note(text, place && place !== "brands" ? place : null);
        setList((l) => (l ? { ...l, items: [made, ...l.items] } : l));
        say("Saved the note");
        return true;
      } catch (e) {
        setProblem(e instanceof StudioError ? e.message : "Unable to save the note. Try again.");
        return false;
      }
    },
    [place, say],
  );

  // Files dropped anywhere on the page, and pictures or links pasted,
  // while the library is showing.
  useEffect(() => {
    if (!active) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes("Files"));
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setFilesOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setFilesOver(false);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const drop = (e: DragEvent) => {
      depth = 0;
      setFilesOver(false);
      if (e.defaultPrevented || !e.dataTransfer) return;
      const files = [...e.dataTransfer.files];
      if (files.length) {
        e.preventDefault();
        void addFiles(files);
        return;
      }
      const link = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain")).split("\n")[0]?.trim() ?? "";
      if (isLink(link)) {
        e.preventDefault();
        void addLink(link);
      }
    };
    const paste = (e: ClipboardEvent) => {
      if (typing(e.target) || !e.clipboardData || document.querySelector("[data-library-panel]")) return;
      const files = [...e.clipboardData.files];
      if (files.length) {
        e.preventDefault();
        void addFiles(files.map((f) => (f.name === "image.png" ? new File([f], `Pasted image ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }).replace(":", ".")}.png`, { type: f.type }) : f)));
        return;
      }
      const text = e.clipboardData.getData("text/plain").trim();
      if (!text) return;
      e.preventDefault();
      if (isLink(text)) void addLink(text);
      else void addNote(text);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
      window.removeEventListener("paste", paste);
    };
  }, [active, addFiles, addLink, addNote]);

  // A dragged card may be gone before its drag ends (moved into a folder),
  // so the end of any drag ends ours too.
  useEffect(() => {
    if (!dragging) return;
    const end = () => {
      setDragging(null);
      onDragItem(null);
    };
    window.addEventListener("dragend", end, true);
    window.addEventListener("drop", end);
    return () => {
      window.removeEventListener("dragend", end, true);
      window.removeEventListener("drop", end);
    };
  }, [dragging, onDragItem]);

  // ─── Changing (undone with ⌘Z) ────────────────────────────────────────────

  const move = (entry: RefEntry, to: string | null) => {
    const from = entry.folder;
    if (from === to || entry.brand) return;
    update(entry, { folder: to });
    const label = to ? `Moved “${entry.name}” to ${folderName(to)}` : `Took “${entry.name}” out of ${folderName(from)}`;
    say(label);
    history.record({
      label,
      undo: () => {
        update(entry, { folder: from });
        return () => update(entry, { folder: to });
      },
    });
  };
  const moveById = (id: string, to: string | null) => {
    const entry = items.find((i) => i.id === id);
    if (entry) move(entry, to);
  };

  const rename = (entry: RefEntry, name: string) => {
    update(entry, { name });
    history.record({
      label: `Renamed “${entry.name}”`,
      undo: () => {
        update(entry, { name: entry.name });
        return () => update(entry, { name });
      },
    });
  };

  const remove = (entry: RefEntry) => {
    setList((l) => (l ? { ...l, items: l.items.filter((i) => i.id !== entry.id) } : l));
    if (openId === entry.id) setOpenId(null);
    void libraryApi.remove(entry.id).catch(() => load());
    const label = `Deleted “${entry.name}”`;
    say(label);
    history.record({
      label,
      undo: () => {
        void libraryApi
          .restore(entry.id)
          .then((back) => setList((l) => (l ? { ...l, items: [back, ...l.items.filter((i) => i.id !== back.id)] } : l)))
          .catch(() => say("That item can’t be brought back any more"));
        return () => remove(entry);
      },
    });
  };

  const newFolder = async (name: string) => {
    setProblem(null);
    try {
      const made = await libraryApi.newFolder(name);
      setList((l) => (l ? { ...l, folders: [...l.folders, made] } : l));
      return made;
    } catch (e) {
      setProblem(e instanceof StudioError ? e.message : "Unable to make the folder. Try again.");
      return null;
    }
  };

  const renameFolder = (target: RefFolder, name: string) => {
    const apply = (next: string) => {
      setList((l) => (l ? { ...l, folders: l.folders.map((f) => (f.id === target.id ? { ...f, name: next } : f)) } : l));
      void libraryApi.renameFolder(target.id, next).catch(() => load());
    };
    apply(name);
    history.record({
      label: `Renamed the folder “${target.name}”`,
      undo: () => {
        apply(target.name);
        return () => apply(name);
      },
    });
  };

  const deleteFolder = async (target: RefFolder) => {
    await libraryApi.removeFolder(target.id).catch(() => undefined);
    setPlace(null);
    await load();
    say(`Deleted the folder “${target.name}”. What was in it is back in the library.`);
  };

  // ─── What the grid shows ──────────────────────────────────────────────────

  const q = query.trim().toLowerCase();
  const tags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const i of items) for (const t of i.tags) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [items]);
  const activeTag = tag && tags.some((t) => t.toLowerCase() === tag.toLowerCase()) ? tag : null;
  const order = sort === "name" ? (a: RefEntry, b: RefEntry) => a.name.localeCompare(b.name) : (a: RefEntry, b: RefEntry) => b.updatedAt.localeCompare(a.updatedAt);
  const filtering = Boolean(q || activeTag);
  const shown: RefEntry[] | null =
    list === null
      ? null
      : place === "brands"
        ? brands.filter((e) => matches(e, q))
        : [
            ...items.filter(
              (i) =>
                (folder ? i.folder === folder.id : filtering || !i.folder) &&
                matches(i, q) &&
                (!activeTag || i.tags.some((t) => t.toLowerCase() === activeTag.toLowerCase())),
            ),
            // Searching from the top also finds the kits' files.
            ...(q && !folder && !activeTag ? brands.filter((e) => matches(e, q)) : []),
          ].sort(order);
  const folderCards = !place && !filtering ? folders : [];
  const inFolder = (id: string) => items.filter((i) => i.folder === id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const counts = (id: string) => items.filter((i) => i.folder === id).length;
  const open = openId ? (items.find((i) => i.id === openId) ?? brands.find((b) => b.id === openId) ?? null) : null;
  const kits = useMemo(() => {
    const m = new Map<string, { id: string; name: string; list: RefEntry[] }>();
    for (const b of shown ?? []) {
      if (!b.brand) continue;
      const k = m.get(b.brand.id) ?? { id: b.brand.id, name: b.brand.name, list: [] };
      k.list.push(b);
      m.set(b.brand.id, k);
    }
    return [...m.values()];
  }, [shown]);

  const goPlace = (p: Place) => {
    setPlace(p);
    setRenamingFolder(false);
  };

  const cardFor = (e: RefEntry) => (
    <RefCard
      key={e.id}
      entry={e}
      now={now}
      folders={folders}
      folderLabel={!folder && e.folder && filtering ? folderName(e.folder) : null}
      dragged={dragging === e.id}
      onDrag={(on) => {
        setDragging(on ? e.id : null);
        onDragItem(on ? e.id : null);
      }}
      onOpen={() => setOpenId(e.id)}
      onRename={(name) => rename(e, name)}
      onMove={(to) => move(e, to)}
      onMoveNew={async (name) => {
        const made = await newFolder(name);
        if (made) move(e, made.id);
      }}
      onDelete={() => remove(e)}
      onTag={(t) => setTag(t)}
    />
  );

  return (
    <section aria-label={folder ? folder.name : "Library"} className="flex flex-col gap-3" hidden={!active}>
      <div className="sticky top-0 z-10 -mx-3 flex flex-col gap-2.5 bg-[#0e0e0e]/90 px-3 pt-1 pb-2.5 backdrop-blur-xl">
        <header className="flex h-8 items-center gap-1.5 px-1">
          {folder || place === "brands" ? (
            <>
              <Hint label="Library">
                <button type="button" aria-label="Back to the library" onClick={() => goPlace(null)} className={cn(ICON_BUTTON, "-ms-1.5")}>
                  <ArrowLeftIcon aria-hidden="true" />
                </button>
              </Hint>
              {folder && renamingFolder ? (
                <RenameField
                  value={folder.name}
                  className="h-7 w-[240px] text-[13px]"
                  onDone={(name) => {
                    setRenamingFolder(false);
                    if (name) renameFolder(folder, name);
                  }}
                />
              ) : (
                <h2 className="truncate font-medium text-[13px] text-white/90">{folder ? folder.name : "Brand kits"}</h2>
              )}
              <span className="ms-1 text-[11.5px] text-white/35 tabular-nums">{folder ? counts(folder.id) : brands.length}</span>
              {folder ? (
                <FolderMenu
                  folder={folder}
                  deleteBody={counts(folder.id) ? `Only the folder goes. Its ${itemCount(counts(folder.id))} stay in the library.` : "It’s empty, so only the folder goes."}
                  onRename={() => setRenamingFolder(true)}
                  onDelete={() => deleteFolder(folder)}
                />
              ) : null}
            </>
          ) : (
            tabs
          )}
          <span className="ms-auto flex items-center gap-2">
            {dragging ? <span className="text-[11.5px] text-white/45">Drop it on a folder, or hold it over Films to drop it on a film</span> : null}
            {place !== "brands" ? (
              naming ? (
                <RenameField
                  value=""
                  placeholder="Moodboards"
                  className="h-8 w-[180px] rounded-[10px] px-2.5 text-[12px]"
                  onDone={(name) => {
                    setNaming(false);
                    if (name) void newFolder(name);
                  }}
                />
              ) : (
                <button type="button" onClick={() => setNaming(true)} className={cn(PILL_BUTTON, "text-white/70 hover:bg-white/[0.07] hover:text-white")}>
                  <PlusIcon aria-hidden="true" />
                  New folder
                </button>
              )
            ) : null}
            {place !== "brands" ? <AddMenu onPick={() => picker.current?.click()} onLink={addLink} onNote={addNote} /> : null}
            <input
              ref={picker}
              type="file"
              multiple
              accept={LIBRARY_ACCEPT}
              className="hidden"
              tabIndex={-1}
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = "";
                void addFiles(files);
              }}
            />
          </span>
        </header>

        <ul aria-label="Library folders" className="flex flex-wrap items-center gap-1.5">
          <li>
            <FolderChip
              label="Library"
              count={list ? items.length : null}
              current={!place}
              dragType={LIBRARY_DRAG}
              onOpen={() => goPlace(null)}
              onDrop={(id) => moveById(id, null)}
            />
          </li>
          {folders.map((f) => (
            <li key={f.id}>
              <FolderChip
                label={f.name}
                count={list ? counts(f.id) : null}
                current={place === f.id}
                folder
                dragType={LIBRARY_DRAG}
                onOpen={() => goPlace(f.id)}
                onDrop={(id) => moveById(id, f.id)}
              />
            </li>
          ))}
          {brands.length ? (
            <li>
              <FolderChip
                label="Brand kits"
                count={brands.length}
                current={place === "brands"}
                icon={<LayerThreeIcon className="size-3.5 opacity-70" aria-hidden="true" />}
                dragType={null}
                onOpen={() => goPlace("brands")}
                onDrop={() => {}}
              />
            </li>
          ) : null}
        </ul>
        {tags.length && place !== "brands" ? (
          <ul aria-label="Tags" className="flex flex-wrap items-center gap-1">
            {tags.map((t) => {
              const on = activeTag?.toLowerCase() === t.toLowerCase();
              return (
                <li key={t}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTag(on ? null : t)}
                    className={cn(
                      "inline-flex h-6 cursor-pointer items-center gap-1 rounded-[7px] px-2 text-[11.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3",
                      on ? "bg-white/[0.14] text-white" : "text-white/50 hover:bg-white/[0.06] hover:text-white/80",
                    )}
                  >
                    <TagIcon aria-hidden="true" className="opacity-60" />
                    {t}
                    {on ? <MultipleCrossCancelIcon aria-hidden="true" className="opacity-60" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {problem ? <p className="px-1 text-[12px] text-[#ff9592]">{problem}</p> : null}
      </div>

      <Skeleton data={shown} sample={SAMPLE} id="studio-library" label="Loading the library">
        {(list) =>
          place === "brands" ? (
            kits.length ? (
              <div className="flex flex-col gap-6">
                {kits.map((k) => (
                  <div key={k.id} className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 px-1">
                      <h3 className="font-medium text-[12.5px] text-white/80">{k.name}</h3>
                      <span className="text-[11.5px] text-white/35">Edit these in the kit</span>
                      <button type="button" onClick={() => onOpenKit(k.id)} className={cn(PILL_BUTTON, "ms-auto h-7 text-white/65 hover:bg-white/[0.07] hover:text-white")}>
                        Open the kit
                      </button>
                    </div>
                    <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-3 gap-y-4">{k.list.map(cardFor)}</ul>
                  </div>
                ))}
              </div>
            ) : (
              <Empty doodle={<LibraryDoodle className="h-[84px] w-[120px]" />} title={`Nothing matches “${query.trim()}”`} note="Check the spelling, or search the whole library.">
                <button type="button" onClick={onClearQuery} className={cn(PILL_BUTTON, "mt-2 bg-white/[0.08] text-white/80 hover:bg-white/[0.12]")}>
                  Clear search
                </button>
              </Empty>
            )
          ) : list.length > 0 || folderCards.length > 0 || uploads.length > 0 ? (
            <div className="flex flex-col gap-6">
              {folderCards.length ? (
                <ul aria-label="Folders" className="grid grid-cols-[repeat(auto-fill,minmax(128px,148px))] gap-x-3 gap-y-4">
                  {folderCards.map((x) => {
                    const inside = inFolder(x.id);
                    return (
                      <FolderCard
                        key={x.id}
                        folder={x}
                        pages={inside.map((i) => ({ id: i.id, poster: i.thumbUrl }))}
                        detail={inside.length ? `${itemCount(inside.length)}${now ? ` · ${ago(inside[0].updatedAt, now)}` : ""}` : "Empty"}
                        deleteBody={inside.length ? `Only the folder goes. Its ${itemCount(inside.length)} stay in the library.` : "It’s empty, so only the folder goes."}
                        dragType={LIBRARY_DRAG}
                        dragging={dragging !== null}
                        onOpen={() => goPlace(x.id)}
                        onDrop={(id) => moveById(id, x.id)}
                        onRename={(name) => renameFolder(x, name)}
                        onDelete={() => deleteFolder(x)}
                      />
                    );
                  })}
                </ul>
              ) : null}
              {list.length || uploads.length ? (
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-3 gap-y-4">
                  {uploads.map((u) => (
                    <li key={`u${u.key}`} className="flex flex-col gap-2.5 p-1.5" aria-live="polite">
                      <span className="block aspect-[4/3] w-full rounded-[10px] bg-white/[0.04] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]" />
                      <span className="flex flex-col gap-0.5 px-1 pb-0.5">
                        <span className="truncate text-[12.5px] text-white/60">{u.name}</span>
                        <span className="studio-shimmer text-[11.5px]">Adding it to the library</span>
                      </span>
                    </li>
                  ))}
                  {list.map(cardFor)}
                </ul>
              ) : null}
            </div>
          ) : filtering ? (
            <Empty
              doodle={<LibraryDoodle className="h-[84px] w-[120px]" />}
              title={q ? `Nothing matches “${query.trim()}”` : `Nothing is tagged “${activeTag}”${folder ? ` in ${folder.name}` : ""}`}
              note={q ? "Check the spelling, or search the whole library." : "Pick another tag, or see everything."}
            >
              <button
                type="button"
                onClick={() => {
                  onClearQuery();
                  setTag(null);
                }}
                className={cn(PILL_BUTTON, "mt-2 bg-white/[0.08] text-white/80 hover:bg-white/[0.12]")}
              >
                {q ? "Clear search" : "Show everything"}
              </button>
            </Empty>
          ) : folder ? (
            <Empty
              doodle={<LibraryDoodle className="h-[84px] w-[120px]" />}
              title={`${folder.name} is empty`}
              note="Drop files here, or drag items from the library onto the folder above."
            >
              <button type="button" onClick={() => picker.current?.click()} className={cn(PILL_BUTTON, "mt-2 bg-white/[0.08] text-white/80 hover:bg-white/[0.12]")}>
                <UploadUpIcon aria-hidden="true" />
                Add files
              </button>
            </Empty>
          ) : (
            <Empty
              doodle={<LibraryDoodle className="h-[84px] w-[120px]" />}
              title="Your library is empty"
              note="Pictures, clips, sounds, PDFs and links for any prompt, drop or paste them here"
            >
              <button type="button" onClick={() => picker.current?.click()} className={cn(PILL_BUTTON, "mt-2 bg-studio text-[#1f0612] hover:bg-studio-hover")}>
                <UploadUpIcon aria-hidden="true" />
                Add files
              </button>
            </Empty>
          )
        }
      </Skeleton>

      {filesOver && active ? (
        <div className="pointer-events-none fixed inset-3 z-30 flex items-center justify-center rounded-[20px] bg-black/40 outline-2 outline-dashed outline-white/30 backdrop-blur-[2px] animate-in fade-in-0">
          <p className={cn(CARD, "flex h-10 items-center rounded-full px-4 text-[12.5px] text-white/85")}>
            {folder ? `Drop to add to ${folder.name}` : "Drop to add to the library"}
          </p>
          <EdgeBeam on tone="drop" />
        </div>
      ) : null}

      {open ? (
        <RefPanel
          key={open.id}
          entry={open}
          folders={folders}
          allTags={tags}
          onClose={() => setOpenId(null)}
          onRename={(name) => rename(open, name)}
          onChange={(change) => update(open, change)}
          onMove={(to) => move(open, to)}
          onDelete={() => remove(open)}
          onOpenKit={onOpenKit}
        />
      ) : null}
    </section>
  );
}

// ─── Adding a link or a note ──────────────────────────────────────────────────

function AddMenu({ onPick, onLink, onNote }: { onPick: () => void; onLink: (url: string) => Promise<boolean>; onNote: (text: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"menu" | "link" | "note">("menu");
  const [text, setText] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setOpen(false);
    setAsking(false);
    setText("");
  };
  const save = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    const ok = view === "link" ? await onLink(value) : await onNote(value);
    setBusy(false);
    if (ok) close();
  };
  const linkBad = view === "link" && text.trim() !== "" && !isLink(text);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next, details) => {
        if (next) {
          setView("menu");
          setOpen(true);
          return;
        }
        // Typed words aren't thrown away without asking: the popup stays.
        if (text.trim() && view !== "menu") {
          details.cancel();
          setAsking(true);
        } else close();
      }}
    >
      <Popover.Trigger className={cn(PILL_BUTTON, "bg-studio text-[#1f0612] hover:bg-studio-hover")}>
        <PlusIcon aria-hidden="true" />
        Add
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={12} className="z-50">
          <Popover.Popup className={cn(SURFACE, MENU_POPUP, view === "menu" ? "w-max min-w-[168px]" : "w-[320px] gap-1.5")}>
            {view === "menu" ? (
              <>
                <button
                  type="button"
                  className={ITEM}
                  onClick={() => {
                    close();
                    onPick();
                  }}
                >
                  <UploadUpIcon aria-hidden="true" />
                  Add files
                </button>
                <button type="button" className={ITEM} onClick={() => setView("link")}>
                  <LinkChainHorizontalIcon aria-hidden="true" />
                  Save a link
                </button>
                <button type="button" className={ITEM} onClick={() => setView("note")}>
                  <FileIcon aria-hidden="true" />
                  Write a note
                </button>
              </>
            ) : (
              <>
                {view === "link" ? (
                  <input
                    // biome-ignore lint/a11y/noAutofocus: opened on purpose
                    autoFocus
                    aria-label="Link"
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      setAsking(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void save();
                    }}
                    placeholder="https://vimeo.com/76979871"
                    className="h-9 rounded-[9px] bg-white/[0.06] px-2.5 text-[12.5px] text-white outline-none placeholder:text-white/30 focus:bg-white/[0.08]"
                  />
                ) : (
                  <textarea
                    // biome-ignore lint/a11y/noAutofocus: opened on purpose
                    autoFocus
                    aria-label="Note"
                    rows={5}
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      setAsking(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
                    }}
                    placeholder="Open slow on the product, then three quick cuts to the logo."
                    className="resize-none rounded-[9px] bg-white/[0.06] px-2.5 py-2 text-[12.5px] text-white leading-relaxed outline-none placeholder:text-white/30 focus:bg-white/[0.08]"
                  />
                )}
                {linkBad ? <p className="px-1 text-[11.5px] text-white/45">Paste a full link, starting with https://.</p> : null}
                {asking ? (
                  <DiscardAsk what={view === "link" ? "this link" : "this note"} onKeep={() => setAsking(false)} onDiscard={close} />
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="me-auto px-1 text-[11.5px] text-white/35">{view === "note" ? "⌘ Enter saves" : "Enter saves"}</span>
                    <button type="button" onClick={() => (text.trim() ? setAsking(true) : close())} className={cn(PILL_BUTTON, "h-7 px-2.5 text-white/65 hover:bg-white/[0.08] hover:text-white")}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!text.trim() || linkBad || busy}
                      onClick={() => void save()}
                      className={cn(PILL_BUTTON, "h-7 px-2.5 bg-studio text-[#1f0612] hover:bg-studio-hover")}
                    >
                      {busy ? <span className="studio-shimmer">Saving</span> : view === "link" ? "Save link" : "Save note"}
                    </button>
                  </div>
                )}
              </>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── A card ───────────────────────────────────────────────────────────────────

// What a reference looks like, small: the picture, a clip's still (playing
// on hover), a sound's shape with play, a PDF's first page, a note's words
// or a link's picture and site.
// A sound's play button. On a card it sits over the card (a button can't
// hold another), in the open item it sits in the preview.
function PlayButton({ entry: e }: { entry: RefEntry }) {
  const playing = usePlayer();
  const mine = playing.id === e.id;
  return (
    <button
      type="button"
      aria-label={mine ? `Pause ${e.name}` : `Play ${e.name}`}
      onClick={(ev) => {
        ev.stopPropagation();
        if (e.fileUrl) player.toggle(e.id, e.fileUrl);
      }}
      className="pointer-events-auto relative z-10 inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/[0.1] text-white/85 outline-none transition-colors hover:bg-white/[0.16] focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-5"
    >
      {mine ? <PauseCircleIcon aria-hidden="true" /> : <PlayCircleIcon aria-hidden="true" />}
    </button>
  );
}

export function RefPreview({ entry: e, hovered, large = false }: { entry: RefEntry; hovered: boolean; large?: boolean }) {
  const playing = usePlayer();
  if (e.kind === "audio") {
    const mine = playing.id === e.id;
    // 48 bars: every other peak, the louder of each pair.
    const bars = e.peaks?.length
      ? Array.from({ length: Math.ceil(e.peaks.length / 2) }, (_, i) => Math.max(e.peaks?.[i * 2] ?? 0, e.peaks?.[i * 2 + 1] ?? 0))
      : Array.from({ length: 48 }, (_, i) => 0.25 + 0.2 * Math.abs(Math.sin(i * 0.7)));
    return (
      <span className="relative flex h-full w-full items-center gap-3 px-4">
        {large ? <PlayButton entry={e} /> : <span className="size-9 shrink-0" />}
        <span className={cn("flex min-w-0 flex-1 items-center gap-[3px]", large ? "h-24" : "h-12")} aria-hidden="true">
          {bars.map((p, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: bars in a fixed order
              key={i}
              className={cn("min-w-[1px] flex-1 rounded-full transition-colors", mine && i / bars.length < playing.at ? "bg-white/80" : "bg-white/25")}
              style={{ height: `${Math.max(6, p * 100)}%` }}
            />
          ))}
        </span>
      </span>
    );
  }
  if (e.kind === "video" && hovered && e.previewUrl) {
    // biome-ignore lint/a11y/useMediaCaption: a silent preview of the clip
    return <video src={e.previewUrl} poster={e.thumbUrl ?? undefined} autoPlay muted loop playsInline className="max-h-full max-w-full object-contain" />;
  }
  if (e.kind === "gif" && hovered && e.previewUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- the GIF itself, playing
    return <img src={e.previewUrl} alt="" draggable={false} className="max-h-full max-w-full object-contain" />;
  }
  if (e.thumbUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a local picture of the item
      <img
        src={e.thumbUrl}
        alt=""
        draggable={false}
        className={cn(
          "max-h-full max-w-full object-contain",
          e.brand && e.kind === "image" && !e.thumbUrl.includes("?as=") && "max-h-[46%] max-w-[70%]",
          e.kind === "pdf" && "max-h-[88%] rounded-[3px] shadow-[0_2px_10px_rgba(0,0,0,0.5)]",
        )}
      />
    );
  }
  if (e.kind === "link") {
    return (
      <span className="flex flex-col items-center gap-2 px-4 text-center">
        <LinkChainHorizontalIcon aria-hidden="true" className="size-5 text-white/35" />
        <span className="line-clamp-2 text-[13px] text-white/70">{e.site}</span>
      </span>
    );
  }
  // Notes and text: the opening words, on a page.
  return (
    <span className="flex h-full w-full overflow-hidden p-3">
      <span className={cn("line-clamp-[7] w-full whitespace-pre-line text-left text-white/55 leading-[1.5]", large ? "text-[12.5px]" : "text-[11px]")}>
        {e.excerpt?.trim() || e.name}
      </span>
    </span>
  );
}

function RefCard({
  entry: e,
  now,
  folders,
  folderLabel,
  dragged,
  onDrag,
  onOpen,
  onRename,
  onMove,
  onMoveNew,
  onDelete,
  onTag,
}: {
  entry: RefEntry;
  now: number;
  folders: RefFolder[];
  folderLabel: string | null;
  dragged: boolean;
  onDrag: (on: boolean) => void;
  onOpen: () => void;
  onRename: (name: string) => void;
  onMove: (folder: string | null) => void;
  onMoveNew: (name: string) => Promise<void>;
  onDelete: () => void;
  onTag: (tag: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [menu, setMenu] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [making, setMaking] = useState(false);
  const here = folders.find((x) => x.id === e.folder) ?? null;
  const readOnly = Boolean(e.brand);
  const detail = detailOf(e);
  return (
    <li
      className={cn("group/card relative transition-opacity duration-150", dragged && "opacity-40")}
      draggable={!renaming}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onDragStart={(ev) => {
        ev.dataTransfer.setData(LIBRARY_DRAG, e.id);
        ev.dataTransfer.effectAllowed = "copyMove";
        onDrag(true);
      }}
      onDragEnd={() => onDrag(false)}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${e.name}`}
        className="flex w-full cursor-pointer flex-col gap-2.5 rounded-[14px] p-1.5 text-left outline-none transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className={cn(
            "relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-[10px] bg-[#141414] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]",
            e.ground === "light" && "bg-[#e9e6e0]",
          )}
          skullet-block=""
        >
          <RefPreview entry={e} hovered={hovered} />
          {e.kind === "video" && e.duration ? (
            <span className="pointer-events-none absolute right-2 bottom-2 rounded-[6px] bg-black/60 px-1.5 py-0.5 text-[10.5px] text-white/80 tabular-nums backdrop-blur-md">
              {formatTime(e.duration)}
            </span>
          ) : null}
        </span>
        <span className="flex flex-col gap-0.5 px-1 pb-0.5">
          <span className="flex items-baseline gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-[12.5px] text-white/90", renaming && "invisible")}>{e.name}</span>
            {!readOnly ? (
              <span className="shrink-0 text-[11px] text-white/35" suppressHydrationWarning>
                {now ? ago(e.updatedAt, now) : ""}
              </span>
            ) : null}
          </span>
          <span className="truncate text-[11.5px] text-white/40">
            {KIND_NAME[e.kind]}
            {detail ? <> · {detail}</> : null}
            {folderLabel ? ` · ${folderLabel}` : null}
          </span>
        </span>
      </button>
      {e.kind === "audio" && e.fileUrl ? (
        <span className="pointer-events-none absolute inset-x-1.5 top-1.5 flex aspect-[4/3] items-center ps-4">
          <PlayButton entry={e} />
        </span>
      ) : null}
      {e.tags.length ? (
        <span className="flex flex-wrap gap-1 px-2.5 pb-1">
          {e.tags.slice(0, 3).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTag(t)}
              className="inline-flex h-5 cursor-pointer items-center rounded-[6px] bg-white/[0.05] px-1.5 text-[10.5px] text-white/50 outline-none hover:bg-white/[0.09] hover:text-white/80 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t}
            </button>
          ))}
          {e.tags.length > 3 ? <span className="px-1 text-[10.5px] text-white/35">+{e.tags.length - 3}</span> : null}
        </span>
      ) : null}

      {renaming ? (
        <RenameField
          value={e.name}
          className={cn("absolute right-2 left-2 h-6 text-[12.5px]", e.tags.length ? "bottom-[52px]" : "bottom-[28px]")}
          onDone={(next) => {
            setRenaming(false);
            if (next) onRename(next);
          }}
        />
      ) : null}

      {!readOnly ? (
        <Popover.Root
          open={menu}
          onOpenChange={(next) => {
            setMenu(next);
            if (!next) setMoveOpen(false);
            if (next) setMaking(false);
          }}
        >
          <Hint label="More">
            <Popover.Trigger
              aria-label={`More for ${e.name}`}
              className="absolute top-3.5 right-3.5 z-10 inline-flex size-7 cursor-pointer items-center justify-center rounded-[8px] bg-black/55 text-white/85 opacity-0 outline-none backdrop-blur-md transition-opacity hover:bg-black/70 hover:text-white focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/card:opacity-100 data-popup-open:opacity-100 [&_svg]:size-4"
            >
              <ThreeDotsMenuHorizontalIcon aria-hidden="true" />
            </Popover.Trigger>
          </Hint>
          <Popover.Portal>
            <Popover.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={12} className="z-50">
              <Popover.Popup className={cn(SURFACE, MENU_POPUP, "w-max min-w-[156px] max-w-[260px]")}>
                <button
                  type="button"
                  className={ITEM}
                  onClick={() => {
                    setMenu(false);
                    setRenaming(true);
                  }}
                >
                  <PencilEditIcon aria-hidden="true" />
                  Rename
                </button>
                <button
                  type="button"
                  className={ITEM}
                  onClick={() => {
                    setMenu(false);
                    onOpen();
                  }}
                >
                  <TagIcon aria-hidden="true" />
                  Tags and note
                </button>
                <Popover.Root open={moveOpen} onOpenChange={setMoveOpen}>
                  <Popover.Trigger openOnHover delay={80} className={cn(ITEM, "data-popup-open:bg-white/[0.07] data-popup-open:text-white")}>
                    <FolderIcon aria-hidden="true" />
                    <span className="flex-1 text-left">Move to folder</span>
                    <ChevronRightIcon aria-hidden="true" className="ms-3 !size-3.5 text-white/40" />
                  </Popover.Trigger>
                  <Popover.Portal>
                    <Popover.Positioner side="right" align="start" sideOffset={10} alignOffset={-6} collisionPadding={12} className="z-50">
                      <Popover.Popup className={cn(SURFACE, MENU_POPUP, "w-max min-w-[168px] max-w-[260px]")}>
                        {here ? (
                          <button
                            type="button"
                            className={ITEM}
                            onClick={() => {
                              setMenu(false);
                              onMove(null);
                            }}
                          >
                            <GridDashboard02Icon aria-hidden="true" />
                            <span className="truncate">Take out of {here.name}</span>
                          </button>
                        ) : null}
                        {folders.map((x) => (
                          <button
                            key={x.id}
                            type="button"
                            className={ITEM}
                            disabled={x.id === e.folder}
                            onClick={() => {
                              setMenu(false);
                              onMove(x.id);
                            }}
                          >
                            <FolderIcon aria-hidden="true" />
                            <span className="min-w-0 flex-1 truncate">{x.name}</span>
                            {x.id === e.folder ? <span className="shrink-0 text-[11.5px] text-white/40">In it now</span> : null}
                          </button>
                        ))}
                        {making ? (
                          <RenameField
                            value=""
                            placeholder="Moodboards"
                            className="m-1 h-8 min-w-[180px] text-[12.5px]"
                            onDone={(name) => {
                              setMaking(false);
                              if (name) {
                                setMenu(false);
                                void onMoveNew(name);
                              }
                            }}
                          />
                        ) : (
                          <button type="button" className={ITEM} onClick={() => setMaking(true)}>
                            <PlusIcon aria-hidden="true" />
                            New folder
                          </button>
                        )}
                      </Popover.Popup>
                    </Popover.Positioner>
                  </Popover.Portal>
                </Popover.Root>
                <div className="mx-2 my-1 h-px bg-white/[0.07]" />
                <button
                  type="button"
                  className={cn(ITEM, DANGER_ITEM)}
                  onClick={() => {
                    setMenu(false);
                    onDelete();
                  }}
                >
                  <DeleteDustbin01Icon aria-hidden="true" />
                  Delete
                </button>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      ) : null}
    </li>
  );
}

// ─── One item, open ───────────────────────────────────────────────────────────

// An item, larger, with its name, tags and note to change. The note is kept
// as you type (when you leave the box or close), so closing never loses it.
function RefPanel({
  entry: e,
  folders,
  allTags,
  onClose,
  onRename,
  onChange,
  onMove,
  onDelete,
  onOpenKit,
}: {
  entry: RefEntry;
  folders: RefFolder[];
  allTags: string[];
  onClose: () => void;
  onRename: (name: string) => void;
  onChange: (change: { note?: string; tags?: string[] }) => void;
  onMove: (folder: string | null) => void;
  onDelete: () => void;
  onOpenKit: (id: string) => void;
}) {
  const [note, setNote] = useState(e.note);
  const [tagText, setTagText] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const readOnly = Boolean(e.brand);
  const tagsRef = useRef(e.tags);
  const latest = useRef({ note, tagText });
  useEffect(() => {
    latest.current = { note, tagText };
  });

  const addTag = (raw: string) => {
    const t = raw.trim().replace(/,$/, "").trim();
    if (!t || tagsRef.current.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    tagsRef.current = [...tagsRef.current, t];
    onChange({ tags: tagsRef.current });
  };
  const removeTag = (t: string) => {
    tagsRef.current = tagsRef.current.filter((x) => x !== t);
    onChange({ tags: tagsRef.current });
  };
  // Keeps the note, and a tag still being typed, then closes.
  const done = useCallback(() => {
    const { note: n, tagText: t } = latest.current;
    if (!readOnly && n !== e.note) onChange({ note: n });
    if (!readOnly && t.trim()) addTag(t);
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the latest values through refs
  }, [e.note, readOnly, onChange, onClose]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || ev.defaultPrevented) return;
      // A rename or the folder menu takes its own Esc first.
      if (renaming || document.querySelector("[data-library-panel] [data-popup-open]")) return;
      ev.preventDefault();
      ev.stopPropagation();
      done();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [done, renaming]);

  const suggestions = allTags.filter((t) => !e.tags.some((x) => x.toLowerCase() === t.toLowerCase())).slice(0, 8);
  const here = folders.find((f) => f.id === e.folder) ?? null;
  const detail = detailOf(e);
  const showFile = e.fileUrl && e.kind !== "audio";

  return (
    <div
      data-backdrop=""
      data-library-panel=""
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-6 backdrop-blur-[2px] animate-in fade-in-0"
      onPointerDown={(ev) => {
        if (ev.target === ev.currentTarget) done();
      }}
    >
      <div
        role="dialog"
        aria-label={e.name}
        className={cn(CARD, "flex max-h-full w-[min(760px,100%)] flex-col overflow-hidden animate-in fade-in-0 zoom-in-[0.98] duration-150")}
      >
        <header className="flex h-12 shrink-0 items-center gap-2 ps-4 pe-2">
          {renaming ? (
            <RenameField
              value={e.name}
              className="h-7 min-w-0 flex-1 text-[13px]"
              onDone={(name) => {
                setRenaming(false);
                if (name) onRename(name);
              }}
            />
          ) : (
            <button
              type="button"
              disabled={readOnly}
              onClick={() => setRenaming(true)}
              className="min-w-0 truncate rounded-[6px] px-1 py-0.5 text-left font-medium text-[13px] text-white/90 outline-none enabled:cursor-text enabled:hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
              title={readOnly ? undefined : "Rename"}
            >
              {e.name}
            </button>
          )}
          <span className="me-auto shrink-0 text-[11.5px] text-white/40">
            {KIND_NAME[e.kind]}
            {detail ? <> · {detail}</> : null}
            {e.size ? <> · <span className="tabular-nums">{sizeText(e.size)}</span></> : null}
          </span>
          <Hint label="Close" keys={["Esc"]}>
            <button type="button" onClick={done} aria-label="Close" className={ICON_BUTTON}>
              <MultipleCrossCancelIcon aria-hidden="true" />
            </button>
          </Hint>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-row">
          <div
            className={cn(
              "flex aspect-[4/3] w-full shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-[#101010] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] sm:w-[58%]",
              e.ground === "light" && "bg-[#e9e6e0]",
            )}
          >
            {e.kind === "video" && e.fileUrl ? (
              // biome-ignore lint/a11y/useMediaCaption: the item itself
              <video src={e.fileUrl} poster={e.thumbUrl ?? undefined} controls playsInline className="max-h-full max-w-full" />
            ) : e.kind === "image" && e.fileUrl && !e.brand && ["png", "jpg", "jpeg", "webp", "svg", "avif"].includes(e.ext ?? "") ? (
              // eslint-disable-next-line @next/next/no-img-element -- the item itself
              <img src={e.fileUrl} alt="" className="max-h-full max-w-full object-contain" />
            ) : (
              <RefPreview entry={e} hovered large />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {readOnly ? (
              <>
                <p className="text-[12px] text-white/55 leading-relaxed">
                  From the {e.brand?.name} brand kit. Add it to any prompt from the library; change it in the kit.
                </p>
                <button type="button" onClick={() => e.brand && onOpenKit(e.brand.id)} className={cn(PILL_BUTTON, "self-start bg-white/[0.08] text-white/80 hover:bg-white/[0.12]")}>
                  Open the kit
                </button>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <span className="px-1 text-[11.5px] text-white/45">Tags</span>
                  <div className="flex flex-wrap items-center gap-1 rounded-[10px] bg-white/[0.05] p-1 focus-within:ring-1 focus-within:ring-white/15">
                    {e.tags.map((t) => (
                      <span key={t} className="inline-flex h-6 items-center gap-0.5 rounded-[7px] bg-white/[0.09] ps-2 pe-0.5 text-[11.5px] text-white/80">
                        {t}
                        <button
                          type="button"
                          aria-label={`Remove the tag ${t}`}
                          onClick={() => removeTag(t)}
                          className="inline-flex size-5 cursor-pointer items-center justify-center rounded-[5px] text-white/45 outline-none hover:bg-white/[0.1] hover:text-white focus-visible:ring-1 focus-visible:ring-white/40 [&_svg]:size-3"
                        >
                          <MultipleCrossCancelIcon aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                    <input
                      aria-label="Add a tag"
                      value={tagText}
                      maxLength={24}
                      onChange={(ev) => {
                        const v = ev.target.value;
                        if (v.endsWith(",")) {
                          addTag(v);
                          setTagText("");
                        } else setTagText(v);
                      }}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter") {
                          ev.preventDefault();
                          addTag(tagText);
                          setTagText("");
                        } else if (ev.key === "Backspace" && !tagText && e.tags.length) {
                          removeTag(e.tags[e.tags.length - 1]);
                        }
                      }}
                      placeholder={e.tags.length ? "" : "launch, warm light"}
                      className="h-6 min-w-[90px] flex-1 bg-transparent px-1.5 text-[12px] text-white outline-none placeholder:text-white/25"
                    />
                  </div>
                  {suggestions.length ? (
                    <div className="flex flex-wrap gap-1 px-0.5">
                      {suggestions.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => addTag(t)}
                          className="inline-flex h-5 cursor-pointer items-center gap-1 rounded-[6px] px-1.5 text-[11px] text-white/40 outline-none hover:bg-white/[0.06] hover:text-white/75 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-2.5"
                        >
                          <PlusIcon aria-hidden="true" />
                          {t}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <label className="flex flex-col gap-1.5">
                  <span className="px-1 text-[11.5px] text-white/45">Note</span>
                  <textarea
                    value={note}
                    rows={4}
                    maxLength={2000}
                    onChange={(ev) => setNote(ev.target.value)}
                    onBlur={() => note !== e.note && onChange({ note })}
                    placeholder="Why you saved it, or how to use it"
                    className="resize-none rounded-[10px] bg-white/[0.05] px-2.5 py-2 text-[12.5px] text-white/90 leading-relaxed outline-none placeholder:text-white/25 focus:ring-1 focus:ring-white/15"
                  />
                </label>
                <div className="flex flex-col gap-1">
                  <Popover.Root open={folderOpen} onOpenChange={setFolderOpen}>
                    <Popover.Trigger className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-[10px] bg-white/[0.05] px-2.5 text-[12px] outline-none transition-colors hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-white/[0.08]">
                      <span className="text-white/50">Folder</span>
                      <span className="ms-auto truncate text-white/85">{here?.name ?? "None"}</span>
                      <ChevronRightIcon aria-hidden="true" className="size-3.5 text-white/35" />
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={12} className="z-50">
                        <Popover.Popup className={cn(SURFACE, MENU_POPUP, "w-max min-w-[168px] max-w-[260px]")}>
                          <button
                            type="button"
                            className={ITEM}
                            disabled={!e.folder}
                            onClick={() => {
                              setFolderOpen(false);
                              onMove(null);
                            }}
                          >
                            <GridDashboard02Icon aria-hidden="true" />
                            None
                          </button>
                          {folders.map((f) => (
                            <button
                              key={f.id}
                              type="button"
                              className={ITEM}
                              disabled={f.id === e.folder}
                              onClick={() => {
                                setFolderOpen(false);
                                onMove(f.id);
                              }}
                            >
                              <FolderIcon aria-hidden="true" />
                              <span className="truncate">{f.name}</span>
                            </button>
                          ))}
                        </Popover.Popup>
                      </Popover.Positioner>
                    </Popover.Portal>
                  </Popover.Root>
                  {e.from ? (
                    <p className="px-1 pt-1 text-[11.5px] text-white/40">
                      Saved from “{e.from.title}”
                    </p>
                  ) : null}
                </div>
                <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                  {showFile || e.kind === "audio" ? (
                    <a
                      href={e.fileUrl ?? undefined}
                      target="_blank"
                      rel="noreferrer noopener"
                      className={cn(PILL_BUTTON, "bg-white/[0.08] text-white/80 hover:bg-white/[0.12]")}
                    >
                      <ExternalLinkSquareIcon aria-hidden="true" />
                      {e.kind === "link" ? "Open the link" : "Open the original"}
                    </a>
                  ) : null}
                  <button type="button" onClick={onDelete} className={cn(PILL_BUTTON, "text-[#ff9592] hover:bg-[#e5484d]/12")}>
                    <DeleteDustbin01Icon aria-hidden="true" />
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Its drawing ──────────────────────────────────────────────────────────────

// An empty library: one picture, with a second card tucked behind it that
// leans out a little on hover. Plain greys, like the studio's other drawings.
const MID = "rgb(255 255 255 / 0.16)";
const GROUND = "#0b0b0b";
const MOVE = "transition-[translate,rotate] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] [transform-box:view-box] motion-reduce:transition-none";
export function LibraryDoodle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 84" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cn("shrink-0 overflow-visible", className)}>
      <g className={cn(MOVE, "[transform-origin:60px_74px] rotate-[10deg] motion-safe:group-hover/doodle:rotate-[16deg]")}>
        <rect x={40} y={18} width={40} height={50} rx={6} fill={GROUND} stroke="currentColor" strokeWidth={1.5} className="text-white/30" />
      </g>
      <g className={cn(MOVE, "motion-safe:group-hover/doodle:-translate-y-[3px]")}>
        <rect x={40} y={18} width={40} height={50} rx={6} fill="#1d1d1d" stroke="currentColor" strokeWidth={1.5} className="text-white/55" />
        <path d="M46 60 L56 48 L63 55 L67 51 L74 60 Z" fill={MID} />
        <circle cx={68} cy={30} r={3.5} fill={MID} />
      </g>
    </svg>
  );
}
