"use client";

import { Popover } from "@base-ui/react/popover";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  CopyIcon,
  DeleteDustbin01Icon,
  DownloadDownIcon,
  EyeOffIcon,
  EyeOnIcon,
  HomeIcon,
  MultipleCrossCancelIcon,
  PlusIcon,
  ThreeDotsMenuHorizontalIcon,
} from "@/components/icons";
import { Spinner } from "@/components/ui/spinner";
import { DialButton, DialGroup, DialNote, DialSlider, DialText, LABEL, ROW, SURFACE } from "@/components/tool/dial";
import type { BrandFont, BrandKit, BrandLogo, ColorRoles } from "@/lib/studio/brand";
import type { Attachment, ChatMessage } from "@/lib/studio/contract";
import { cn } from "@/lib/utils";
import { StudioError } from "./api";
import { brandApi, brandFile, FOLDER_ACCEPTS, FONT_FILE, type KitFolder, LOGO_FILE } from "./brand-api";
import { ColorRow } from "./color-row";
import { undoKey } from "./history";
import { Choice } from "./inspector";
import { CARD, Hint, ICON_BUTTON, PANEL_MOTION, PILL_BUTTON, Panel } from "./panel";
import { fontName, KitDoc } from "./kit-doc";
import { Skeleton } from "@/components/skeleton";
import { Opening } from "./opening";
import { PromptBox } from "./prompt-box";
import { SentFiles } from "./sent-files";
import { useAttachments } from "./use-attachments";

// A brand kit's own page, at /studio?brand=<id>. The kit reads as a brand
// book (kit-doc.tsx: colours, type, logos, line texture, rules, the long
// guideline); the panels float over it: Claude on the left, the kit's
// settings on the right. Every change shows at once and saves a moment
// later; ⌘Z undoes it.

const ROLES: { key: keyof ColorRoles; label: string; note: string }[] = [
  { key: "background", label: "Background", note: "The ground most films sit on" },
  { key: "surface", label: "Surface", note: "Panels, cards and bars" },
  { key: "ink", label: "Ink", note: "Main type" },
  { key: "muted", label: "Muted", note: "Secondary type" },
  { key: "accent", label: "Accent", note: "The one colour that means this matters" },
  { key: "onAccent", label: "On accent", note: "Type on the accent" },
  { key: "line", label: "Line", note: "Rules and the line field" },
];
const RULES: { key: keyof BrandKit["rules"]; label: string }[] = [
  { key: "visual", label: "Look" },
  { key: "motion", label: "Motion" },
  { key: "sound", label: "Sound" },
  { key: "words", label: "Words" },
];

type Step = { label: string; before: BrandKit; at: number };

export function KitPage({
  id,
  openingRef,
  arrivalRef,
  onHome,
  onOpenKit,
  onGone,
}: {
  id: string;
  openingRef: React.RefObject<{ prompt: string; url: string } | null>;
  arrivalRef: React.RefObject<{ id: string; reply: string } | null>;
  onHome: () => void;
  onOpenKit: (id: string) => void;
  onGone: () => void;
}) {
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [missing, setMissing] = useState(false);
  const [save, setSave] = useState<"saved" | "saving" | "failed">("saved");
  const [hidden, setHidden] = useState(false);
  const [folded, setFolded] = useState({ chat: false, kit: false });
  const [note, setNote] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [version, setVersion] = useState(() => Date.now().toString(36));
  // A kit Claude just made opens with its note on what it found and guessed.
  const [arrival, setArrival] = useState<string | null>(null);
  useEffect(() => {
    const a = arrivalRef.current;
    if (!a || a.id !== id) return;
    arrivalRef.current = null;
    setArrival(a.reply || null);
  }, [arrivalRef, id]);
  const kitRef = useRef<BrandKit | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undo = useRef<Step[]>([]);
  const redo = useRef<Step[]>([]);

  useEffect(() => {
    kitRef.current = kit;
  });

  useEffect(() => {
    let live = true;
    brandApi
      .get(id)
      .then((k) => live && setKit(k))
      .catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
  }, [id]);

  // The kit's own fonts, so the type specimen is set in them.
  useKitFonts(kit, version);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const now = kitRef.current;
    if (!now) return;
    setSave("saving");
    try {
      await brandApi.save(now);
      setSave("saved");
    } catch (e) {
      setSave("failed");
      setNote(e instanceof StudioError ? e.message : "Unable to save the kit. Make any change to try again.");
    }
  }, []);
  const schedule = useCallback(() => {
    setSave("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 400);
  }, [flush]);

  // Every manual change: shown at once, saved shortly, and undoable. Quick
  // changes to the same thing (a colour being dragged) undo as one.
  const change = useCallback(
    (label: string, fn: (k: BrandKit) => BrandKit) => {
      const before = kitRef.current;
      if (!before) return;
      const last = undo.current.at(-1);
      if (!last || last.label !== label || Date.now() - last.at > 700) undo.current.push({ label, before, at: Date.now() });
      else last.at = Date.now();
      redo.current = [];
      const next = fn(before);
      kitRef.current = next;
      setKit(next);
      schedule();
    },
    [schedule],
  );

  const chat = useKitChat(id, (k) => {
    kitRef.current = k;
    setKit(k);
    setVersion(Date.now().toString(36));
  });

  // While Claude works, the page follows the kit as it's written.
  const running = chat.running;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      brandApi
        .get(id)
        .then((k) => {
          kitRef.current = k;
          setKit(k);
        })
        .catch(() => {});
    }, 1500);
    return () => clearInterval(t);
  }, [running, id]);

  const step = useCallback(
    async (direction: "undo" | "redo") => {
      const from = direction === "undo" ? undo.current : redo.current;
      const to = direction === "undo" ? redo.current : undo.current;
      const entry = from.pop();
      const now = kitRef.current;
      if (!entry || !now) {
        // Nothing of yours to undo: undo Claude's last change instead.
        if (direction === "undo" && !chat.running) {
          const said = await chat.undo();
          setNote(said ?? "Undid Claude’s last change");
        }
        return;
      }
      to.push({ label: entry.label, before: now, at: 0 });
      kitRef.current = entry.before;
      setKit(entry.before);
      schedule();
      setNote(`${direction === "undo" ? "Undid" : "Redid"}: ${entry.label}`);
    },
    [chat, schedule],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // In a text field the browser's own typing and text undo stay in charge.
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const which = undoKey(e);
      if (which) {
        e.preventDefault();
        void step(which);
        return;
      }
      if (e.key.toLowerCase() === "h" && !e.metaKey && !e.ctrlKey && !e.altKey) setHidden((h) => !h);
      if (e.key === "Escape" && !e.defaultPrevented) setNote(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 2600);
    return () => clearTimeout(t);
  }, [note]);

  // Dropped or chosen files go into the kit; fonts and logos join it.
  const upload = useCallback(
    async (files: File[], folder?: KitFolder) => {
      if (!files.length) return;
      await flush();
      const added: { font: string[]; logo: string[] } = { font: [], logo: [] };
      for (const [i, file] of files.entries()) {
        setUploading(`Adding ${file.name} (${i + 1} of ${files.length})`);
        try {
          const { file: path } = await brandApi.upload(id, file, folder);
          if (path.startsWith("fonts/") && FONT_FILE.test(path)) added.font.push(path);
          else if (path.startsWith("logos/") && LOGO_FILE.test(path)) added.logo.push(path);
        } catch (e) {
          setNote(e instanceof StudioError ? e.message : `Unable to add ${file.name}. Try again.`);
        }
      }
      setUploading(null);
      setVersion(Date.now().toString(36));
      if (added.font.length || added.logo.length) {
        change("Added files", (k) => ({
          ...k,
          fonts: [
            ...k.fonts,
            ...added.font
              .filter((f) => !k.fonts.some((x) => x.file === f))
              .map((file, i): BrandFont => ({ family: familyFrom(file), role: k.fonts.length || i ? "text" : "display", file, weights: "400" })),
          ],
          logos: [
            ...k.logos,
            ...added.logo
              .filter((l) => !k.logos.some((x) => x.file === l))
              .map((file): BrandLogo => ({ name: nameFrom(file), kind: /mark|icon|symbol/i.test(file) ? "mark" : "wordmark", file, on: /dark|white|reverse|negative/i.test(file) ? "dark" : "light" })),
          ],
        }));
      }
    },
    [id, change, flush],
  );

  if (missing) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div className={cn(CARD, "flex max-w-[360px] flex-col items-start gap-3 p-5")}>
          <p className="font-medium text-[14px] text-white/90">This kit no longer exists</p>
          <button type="button" onClick={onHome} className={cn(PILL_BUTTON, "bg-white text-[#141414] hover:bg-white/90")}>
            Back to the studio
          </button>
        </div>
      </div>
    );
  }
  if (!kit) return <Opening what="kit" />;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the whole page takes dropped files
    <div
      className="absolute inset-0"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void upload([...e.dataTransfer.files]);
      }}
    >
      <KitDoc
        kit={kit}
        version={version}
        left={hidden || folded.chat ? 24 : 372}
        right={hidden || folded.kit ? 24 : 352}
        arrival={arrival}
        onDismissArrival={() => setArrival(null)}
        change={change}
        onCopy={(hex) => {
          void navigator.clipboard?.writeText(hex).then(
            () => setNote(`Copied ${hex}`),
            () => setNote(hex),
          );
        }}
        onOpenPanel={(group) => {
          setHidden(false);
          setFolded((f) => ({ ...f, kit: false }));
          // Open that group in the Kit panel and bring it into view.
          requestAnimationFrame(() => {
            const panel = document.querySelector<HTMLElement>('section[aria-label="Kit"]');
            const button = [...(panel?.querySelectorAll<HTMLButtonElement>("h2 > button") ?? [])].find((b) => b.textContent?.trim() === group);
            if (!button) return;
            if (button.getAttribute("aria-expanded") === "false") button.click();
            button.scrollIntoView({ behavior: "smooth", block: "start" });
            button.focus({ preventScroll: true });
          });
        }}
      />

      <TopBar
        kit={kit}
        hidden={hidden}
        save={save}
        onHome={async () => {
          await flush();
          onHome();
        }}
        onRename={(name) => change("Name", (k) => ({ ...k, name }))}
        onDuplicate={async () => {
          await flush();
          const copy = await brandApi.duplicate(id);
          onOpenKit(copy.id);
        }}
        onDelete={async () => {
          await brandApi.remove(id);
          onGone();
        }}
      />

      <div className={cn(CARD, PANEL_MOTION, "pointer-events-auto absolute top-4 right-4 flex h-11 items-center gap-1 rounded-[14px] px-1.5")}>
        <Hint label={hidden ? "Show panels" : "Hide panels"} keys={["H"]}>
          <button type="button" className={ICON_BUTTON} onClick={() => setHidden((h) => !h)} aria-label={hidden ? "Show panels" : "Hide panels"}>
            {hidden ? <EyeOnIcon aria-hidden="true" /> : <EyeOffIcon aria-hidden="true" />}
          </button>
        </Hint>
      </div>

      <KitChat
        kitId={id}
        chat={chat}
        folded={folded.chat}
        onFold={(f) => setFolded((s) => ({ ...s, chat: f }))}
        hidden={hidden}
        openingRef={openingRef}
        beforeSend={flush}
      />

      <Panel
        title="Kit"
        folded={folded.kit}
        onFold={(f) => setFolded((s) => ({ ...s, kit: f }))}
        hidden={hidden}
        className="top-[68px] right-4 bottom-4 w-[320px]"
        pillClassName="top-[68px] right-4"
        bodyClassName="flex flex-col gap-4 overflow-y-auto px-3 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <KitSettings kit={kit} change={change} onUpload={upload} uploading={uploading} />
      </Panel>

      {over ? (
        <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-[20px] border-2 border-white/40 border-dashed bg-black/40">
          <p className={cn(CARD, "px-4 py-2.5 text-[13px] text-white/90")}>Drop fonts, logos or guideline files to add them to the kit</p>
        </div>
      ) : null}
      {note || uploading ? (
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-20 -translate-x-1/2">
          <p className={cn(CARD, "flex h-9 items-center gap-2 rounded-full px-4 text-[12px] text-white/85")} aria-live="polite">
            {uploading ? <Spinner className="size-3" /> : null}
            {uploading ?? note}
          </p>
        </div>
      ) : null}
    </div>
  );
}

const familyFrom = (file: string) =>
  file
    .replace(/^fonts\//, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[-_](variable|regular|bold|medium|light|semibold|italic|vf|\[.*\])+$/gi, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim() || "Font";
const nameFrom = (file: string) =>
  file
    .replace(/^logos\//, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

// ─── Fonts on the page ───────────────────────────────────────────────────────

// Loads each of the kit's fonts under its own name ("kit <id> <family>") so
// two kits with a font of the same name never mix.

function useKitFonts(kit: BrandKit | null, version: string) {
  useEffect(() => {
    if (!kit || typeof FontFace === "undefined") return;
    const faces: FontFace[] = [];
    const seen = new Set<string>();
    for (const f of kit.fonts) {
      const key = `${f.family}|${f.file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const face = new FontFace(fontName(kit, f.family), `url(${brandFile(kit.id, f.file, version)})`, { weight: f.weights });
      faces.push(face);
      face
        .load()
        .then((loaded) => document.fonts.add(loaded))
        .catch(() => {});
    }
    return () => {
      for (const face of faces) document.fonts.delete(face);
    };
  }, [kit, version]);
}

// ─── Top left: home, the kit's name, its menu ────────────────────────────────

const POPUP =
  "origin-(--transform-origin) outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0";
const ITEM =
  "flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-2 text-left text-[12.5px] text-white/80 outline-none transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:bg-white/[0.07] disabled:cursor-default disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-white/50";

function TopBar({
  kit,
  hidden,
  save,
  onHome,
  onRename,
  onDuplicate,
  onDelete,
}: {
  kit: BrandKit;
  hidden: boolean;
  save: "saved" | "saving" | "failed";
  onHome: () => void;
  onRename: (name: string) => void;
  onDuplicate: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(kit.name);
  const [editing, setEditing] = useState(false);
  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    try {
      await job();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      inert={hidden}
      className={cn(
        CARD,
        PANEL_MOTION,
        "pointer-events-auto absolute top-4 left-4 z-10 flex h-11 w-[300px] items-center gap-1 rounded-[14px] ps-1.5 pe-1.5",
        hidden && "pointer-events-none -translate-y-1 opacity-0",
      )}
    >
      <Hint label="All films and kits">
        <button type="button" className={cn(ICON_BUTTON, "size-8")} onClick={onHome} aria-label="All films and kits">
          <HomeIcon aria-hidden="true" />
        </button>
      </Hint>
      {editing ? (
        <input
          // biome-ignore lint/a11y/noAutofocus: opened on purpose to rename
          autoFocus
          aria-label="Kit name"
          value={name}
          maxLength={80}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (name.trim() && name.trim() !== kit.name) onRename(name.trim());
            else setName(kit.name);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setName(kit.name);
              setEditing(false);
            }
          }}
          className="h-7 w-48 rounded-[6px] bg-white/[0.08] px-1.5 text-[12.5px] text-white outline-none ring-1 ring-white/20"
        />
      ) : (
        <Hint label="Rename">
          <button
            type="button"
            onClick={() => {
              setName(kit.name);
              setEditing(true);
            }}
            className="h-7 max-w-56 cursor-text truncate rounded-[6px] px-1.5 font-medium text-[12.5px] text-white/90 outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
          >
            {kit.name}
          </button>
        </Hint>
      )}
      <span className={cn("px-1 text-[11.5px]", save === "failed" ? "text-[#ff9592]" : "text-white/35")}>
        {save === "saving" ? "Saving…" : save === "failed" ? "Not saved" : "Saved"}
      </span>
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setConfirm(false);
        }}
      >
        <Hint label="More">
          <Popover.Trigger className={cn(ICON_BUTTON, "size-8 data-popup-open:bg-white/[0.08]")} aria-label="More for this kit">
            <ThreeDotsMenuHorizontalIcon aria-hidden="true" />
          </Popover.Trigger>
        </Hint>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="start" sideOffset={10} collisionPadding={12} className="z-50">
            <Popover.Popup className={cn(SURFACE, POPUP, "flex flex-col gap-0.5 p-1.5", confirm ? "w-[260px]" : "w-max min-w-[156px]")}>
              {confirm ? (
                <div className="flex flex-col gap-2 p-2">
                  <p className="font-medium text-[13px] text-white/90">Delete “{kit.name}”?</p>
                  <p className="text-[12px] text-white/50 leading-relaxed">
                    This removes the kit and its files. Films that use it go back to Aerchain’s kit. You can’t undo this.
                  </p>
                  <div className="mt-1 flex gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(onDelete)}
                      className="inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[9px] bg-[#e5484d] font-medium text-[12px] text-white outline-none hover:bg-[#ec5d5e] focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                    >
                      {busy ? <Spinner className="size-3" /> : null}
                      Delete kit
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirm(false)}
                      className="inline-flex h-8 flex-1 cursor-pointer items-center justify-center rounded-[9px] bg-white/[0.08] font-medium text-[12px] text-white/80 outline-none hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Keep it
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button type="button" className={ITEM} disabled={busy} onClick={() => run(onDuplicate)}>
                    <CopyIcon aria-hidden="true" />
                    Duplicate kit
                  </button>
                  <a className={ITEM} href={brandApi.exportUrl(kit.id)} download onClick={() => setOpen(false)}>
                    <DownloadDownIcon aria-hidden="true" />
                    Export as a file
                  </a>
                  <button
                    type="button"
                    className={cn(ITEM, "text-[#ff9592] hover:bg-[#e5484d]/12 hover:text-[#ffaaa8] [&>svg]:text-[#ff9592]")}
                    onClick={() => setConfirm(true)}
                  >
                    <DeleteDustbin01Icon aria-hidden="true" />
                    Delete kit
                  </button>
                </>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

// ─── The kit's settings, on the right ─────────────────────────────────────────

function KitSettings({
  kit,
  change,
  onUpload,
  uploading,
}: {
  kit: BrandKit;
  change: (label: string, fn: (k: BrandKit) => BrandKit) => void;
  onUpload: (files: File[], folder?: KitFolder) => Promise<void>;
  uploading: string | null;
}) {
  const r = kit.colors.roles;
  return (
    <>
      <AddToKit uploading={uploading} onUpload={onUpload} />
      <DialGroup title="Colours">
        {ROLES.map((role) => (
          <ColorRow
            key={role.key}
            label={role.label}
            value={r[role.key]}
            onChange={(hex) => change(role.label, (k) => ({ ...k, colors: { ...k.colors, roles: { ...k.colors.roles, [role.key]: hex } } }))}
          />
        ))}
      </DialGroup>

      <DialGroup title="Colour ramps" defaultOpen={false}>
        {kit.colors.ramps.map((ramp, ri) => (
          <DialGroup key={`${ri}-${kit.colors.ramps.length}`} title={ramp.name} defaultOpen={false}>
            <DialText
              label="Name"
              value={ramp.name}
              onChange={(name) => change(`Ramp ${ri + 1} name`, (k) => ({ ...k, colors: { ...k.colors, ramps: k.colors.ramps.map((x, i) => (i === ri ? { ...x, name } : x)) } }))}
            />
            {ramp.steps.map((s, si) => (
              <ColorRow
                key={si}
                label={s.name}
                value={s.hex}
                onChange={(hex) =>
                  change(`${s.name}`, (k) => ({
                    ...k,
                    colors: {
                      ...k.colors,
                      ramps: k.colors.ramps.map((x, i) => (i === ri ? { ...x, steps: x.steps.map((y, j) => (j === si ? { ...y, hex } : y)) } : x)),
                    },
                  }))
                }
              />
            ))}
            <div className="flex gap-1.5">
              <DialButton
                onClick={() =>
                  change("Added a step", (k) => ({
                    ...k,
                    colors: {
                      ...k.colors,
                      ramps: k.colors.ramps.map((x, i) =>
                        i === ri ? { ...x, steps: [...x.steps, { name: `${x.name} ${x.steps.length + 1}`, hex: x.steps.at(-1)?.hex ?? "#808080" }] } : x,
                      ),
                    },
                  }))
                }
              >
                Add a step
              </DialButton>
              <DialButton
                className="text-[#ff9592]"
                onClick={() => change("Removed a ramp", (k) => ({ ...k, colors: { ...k.colors, ramps: k.colors.ramps.filter((_, i) => i !== ri) } }))}
              >
                Remove ramp
              </DialButton>
            </div>
          </DialGroup>
        ))}
        <DialButton
          onClick={() =>
            change("Added a ramp", (k) => ({
              ...k,
              colors: { ...k.colors, ramps: [...k.colors.ramps, { name: `Ramp ${k.colors.ramps.length + 1}`, steps: [{ name: "Step 1", hex: k.colors.roles.accent }] }] },
            }))
          }
        >
          <PlusIcon aria-hidden="true" />
          Add a ramp
        </DialButton>
      </DialGroup>

      <DialGroup title="Fonts">
        {kit.fonts.map((f, fi) => (
          <div key={`${f.file}-${fi}`} className="flex flex-col gap-1.5 rounded-[12px] bg-white/[0.02] p-1">
            <DialText label="Family" value={f.family} onChange={(family) => change(`Font ${fi + 1} family`, (k) => ({ ...k, fonts: k.fonts.map((x, i) => (i === fi ? { ...x, family } : x)) }))} />
            <Choice
              label="Use"
              value={f.role}
              options={[
                { value: "display", label: "Display" },
                { value: "text", label: "Text" },
                { value: "mono", label: "Mono" },
              ]}
              onChange={(role) => change(`Font ${fi + 1} use`, (k) => ({ ...k, fonts: k.fonts.map((x, i) => (i === fi ? { ...x, role: role as BrandFont["role"] } : x)) }))}
            />
            <DialText
              label="Weights"
              value={f.weights}
              placeholder="400 or 200 800"
              onChange={(weights) => change(`Font ${fi + 1} weights`, (k) => ({ ...k, fonts: k.fonts.map((x, i) => (i === fi ? { ...x, weights } : x)) }))}
            />
            <RemoveRow label={f.file.replace(/^fonts\//, "")} onRemove={() => change("Removed a font", (k) => ({ ...k, fonts: k.fonts.filter((_, i) => i !== fi) }))} />
          </div>
        ))}
        {!kit.fonts.length ? <DialNote>Drop font files (TTF, OTF, WOFF) on the page, or choose them below.</DialNote> : null}
      </DialGroup>

      <DialGroup title="Logos">
        {kit.logos.map((l, li) => (
          <div key={`${l.file}-${li}`} className="flex flex-col gap-1.5 rounded-[12px] bg-white/[0.02] p-1">
            <DialText label="Name" value={l.name} onChange={(name) => change(`Logo ${li + 1} name`, (k) => ({ ...k, logos: k.logos.map((x, i) => (i === li ? { ...x, name } : x)) }))} />
            <Choice
              label="Kind"
              value={l.kind}
              options={[
                { value: "wordmark", label: "Wordmark" },
                { value: "mark", label: "Mark" },
                { value: "lockup", label: "Lockup" },
              ]}
              onChange={(kind) => change(`Logo ${li + 1} kind`, (k) => ({ ...k, logos: k.logos.map((x, i) => (i === li ? { ...x, kind: kind as BrandLogo["kind"] } : x)) }))}
            />
            <Choice
              label="For"
              value={l.on}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "any", label: "Any" },
              ]}
              onChange={(on) => change(`Logo ${li + 1} ground`, (k) => ({ ...k, logos: k.logos.map((x, i) => (i === li ? { ...x, on: on as BrandLogo["on"] } : x)) }))}
            />
            <RemoveRow label={l.file.replace(/^logos\//, "")} onRemove={() => change("Removed a logo", (k) => ({ ...k, logos: k.logos.filter((_, i) => i !== li) }))} />
          </div>
        ))}
        {!kit.logos.length ? <DialNote>Drop SVG or PNG logos on the page, or choose them below.</DialNote> : null}
      </DialGroup>

      <DialGroup title="Line texture" defaultOpen={false}>
        {kit.texture ? (
          <>
            <DialSlider
              label="Line"
              value={kit.texture.stroke}
              min={1}
              max={40}
              format={(v) => `${Math.round(v)} px`}
              onChange={(v) => change("Line width", (k) => ({ ...k, texture: { ...(k.texture ?? { gap: 4 }), stroke: Math.round(v) } }))}
            />
            <DialSlider
              label="Gap"
              value={kit.texture.gap}
              min={0}
              max={40}
              format={(v) => `${Math.round(v)} px`}
              onChange={(v) => change("Gap width", (k) => ({ ...k, texture: { ...(k.texture ?? { stroke: 8 }), gap: Math.round(v) } }))}
            />
            <DialButton onClick={() => change("Removed the line texture", (k) => ({ ...k, texture: undefined }))}>This brand has no line texture</DialButton>
          </>
        ) : (
          <DialButton onClick={() => change("Added a line texture", (k) => ({ ...k, texture: { stroke: 8, gap: 4 } }))}>Give the brand a line texture</DialButton>
        )}
      </DialGroup>

      {RULES.map((group) => (
        <DialGroup key={group.key} title={`Rules: ${group.label.toLowerCase()}`} defaultOpen={false}>
          {kit.rules[group.key].map((rule, i) => (
            <RuleRow
              key={`${group.key}-${i}-${kit.rules[group.key].length}`}
              n={i + 1}
              value={rule}
              onChange={(text) => change(`${group.label} rule ${i + 1}`, (k) => ({ ...k, rules: { ...k.rules, [group.key]: k.rules[group.key].map((x, j) => (j === i ? text : x)) } }))}
              onRemove={() => change(`Removed a ${group.label.toLowerCase()} rule`, (k) => ({ ...k, rules: { ...k.rules, [group.key]: k.rules[group.key].filter((_, j) => j !== i) } }))}
            />
          ))}
          <DialButton onClick={() => change(`Added a ${group.label.toLowerCase()} rule`, (k) => ({ ...k, rules: { ...k.rules, [group.key]: [...k.rules[group.key], ""] } }))}>
            <PlusIcon aria-hidden="true" />
            Add a rule
          </DialButton>
        </DialGroup>
      ))}
    </>
  );
}

// Adding to the kit: one quiet row that takes dropped files, with three
// small targets that each open the right picker and file what's chosen in
// the right place.
const TARGETS: { folder: KitFolder; label: string; hint: string }[] = [
  { folder: "fonts", label: "Fonts", hint: "TTF, OTF" },
  { folder: "logos", label: "Logos", hint: "SVG, PNG" },
  { folder: "guide", label: "Guideline", hint: "PDF, images" },
];

function AddToKit({ uploading, onUpload }: { uploading: string | null; onUpload: (files: File[], folder?: KitFolder) => Promise<void> }) {
  const [over, setOver] = useState(false);
  const pickers = useRef<Partial<Record<KitFolder, HTMLInputElement | null>>>({});
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target; the three buttons are the keyboard way in
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        void onUpload([...e.dataTransfer.files]);
      }}
      className={cn(
        "flex flex-col gap-1.5 rounded-[12px] p-1.5 transition-colors",
        over ? "bg-white/[0.1] ring-1 ring-white/30" : "bg-white/[0.04]",
      )}
    >
      <div className="flex h-7 items-center gap-2 px-1.5">
        <span className="font-medium text-[12px] text-white/85">Add to the kit</span>
        <span className="ms-auto truncate text-[11px] text-white/35">
          {uploading ? <span className="studio-shimmer">{uploading}</span> : over ? "Drop to add" : "or drop files here"}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {TARGETS.map((t) => (
          <Fragment key={t.folder}>
            <input
              ref={(el) => {
                pickers.current[t.folder] = el;
              }}
              type="file"
              multiple
              accept={FOLDER_ACCEPTS[t.folder]}
              className="hidden"
              tabIndex={-1}
              onChange={(e) => {
                void onUpload([...(e.target.files ?? [])], t.folder);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={!!uploading}
              onClick={() => pickers.current[t.folder]?.click()}
              className="flex cursor-pointer flex-col items-start gap-0.5 rounded-[9px] bg-white/[0.05] px-2.5 py-2 text-left outline-none transition-colors hover:bg-white/[0.09] focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50"
            >
              <span className="flex items-center gap-1 text-[12px] text-white/90 [&_svg]:size-3 [&_svg]:text-white/45">
                <PlusIcon aria-hidden="true" />
                {t.label}
              </span>
              <span className="text-[10.5px] text-white/35">{t.hint}</span>
            </button>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function RemoveRow({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <div className={cn(ROW, "ps-3 pe-1")}>
      <span className={cn(LABEL, "min-w-0 truncate tabular-nums text-[11px] text-white/40")}>{label}</span>
      <Hint label="Remove">
        <button type="button" onClick={onRemove} className={cn(ICON_BUTTON, "ms-auto")} aria-label={`Remove ${label}`}>
          <DeleteDustbin01Icon aria-hidden="true" />
        </button>
      </Hint>
    </div>
  );
}

function RuleRow({ n, value, onChange, onRemove }: { n: number; value: string; onChange: (v: string) => void; onRemove: () => void }) {
  return (
    <div className={cn(ROW, "h-auto min-h-9 items-start gap-2 py-1.5 ps-3 pe-1")}>
      <span className="pt-0.5 text-[11px] text-white/35 tabular-nums">{n}</span>
      <textarea
        aria-label={`Rule ${n}`}
        value={value}
        rows={Math.max(1, Math.ceil(value.length / 34))}
        placeholder="One plain sentence"
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 resize-none bg-transparent text-[12px] text-white/90 leading-snug outline-none placeholder:text-white/30"
      />
      <button type="button" onClick={onRemove} className={ICON_BUTTON} aria-label={`Remove rule ${n}`}>
        <MultipleCrossCancelIcon aria-hidden="true" />
      </button>
    </div>
  );
}

// ─── Claude, for the kit ─────────────────────────────────────────────────────

type KitTurn = { running: boolean; text: string; steps: string[]; error: string | null };
const IDLE: KitTurn = { running: false, text: "", steps: [], error: null };

function useKitChat(id: string, onKit: (kit: BrandKit) => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [turn, setTurn] = useState<KitTurn>(IDLE);
  // False until the chat so far has been read: the panel draws shapes until then.
  const [loaded, setLoaded] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const kitCallback = useRef(onKit);
  useEffect(() => {
    kitCallback.current = onKit;
  });

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async (first: boolean) => {
      const h = await brandApi.history(id).catch(() => null);
      if (!live) return;
      if (first) setLoaded(true);
      if (!h) return;
      setMessages(h.messages);
      if (h.running) {
        setTurn((t) => (t.running ? t : { ...IDLE, running: true }));
        timer = setTimeout(() => check(false), 2000);
      } else if (!first) {
        setTurn(IDLE);
        const kit = await brandApi.get(id).catch(() => null);
        if (live && kit) kitCallback.current(kit);
      }
    };
    void check(true);
    return () => {
      live = false;
      clearTimeout(timer);
      abort.current?.abort();
    };
  }, [id]);

  const send = useCallback(
    async (prompt: string, url: string, attachments: Attachment[] = []) => {
      const words = prompt.trim();
      if (!words || abort.current) return;
      const controller = new AbortController();
      abort.current = controller;
      setMessages((m) => [
        ...m,
        {
          role: "you",
          text: url ? `${words}\n\n${url}` : words,
          at: new Date().toISOString(),
          ...(attachments.length ? { context: { t: 0, pick: null, attachments } } : {}),
        },
      ]);
      setTurn({ ...IDLE, running: true });
      let text = "";
      let steps: string[] = [];
      try {
        await brandApi.chat(
          id,
          { prompt: words, ...(url ? { url } : {}), ...(attachments.length ? { attachments } : {}) },
          (event) => {
            if (event.kind === "text") {
              text += event.text;
              setTurn((t) => ({ ...t, text }));
            } else if (event.kind === "step") {
              steps = [...steps, event.label];
              setTurn((t) => ({ ...t, steps }));
            } else if (event.kind === "done") {
              kitCallback.current(event.film as unknown as BrandKit);
            } else if (event.kind === "error") {
              setTurn((t) => ({ ...t, error: event.message }));
            }
          },
          controller.signal,
        );
      } catch (e) {
        setTurn((t) => ({ ...t, error: e instanceof StudioError ? e.message : "Claude stopped unexpectedly. Try again." }));
      }
      abort.current = null;
      const saved = await brandApi.history(id);
      setMessages(saved.messages);
      setTurn((t) => ({ ...IDLE, error: t.error }));
    },
    [id],
  );

  const stop = useCallback(async () => {
    await brandApi.stop(id).catch(() => {});
    abort.current?.abort();
  }, [id]);

  const undo = useCallback(async (): Promise<string | null> => {
    try {
      const kit = await brandApi.undo(id);
      kitCallback.current(kit);
      setMessages((await brandApi.history(id)).messages);
      return null;
    } catch (e) {
      return e instanceof StudioError ? e.message : "There’s nothing to undo.";
    }
  }, [id]);

  return { messages, turn, running: turn.running, send, stop, undo, loaded };
}

const KIT_IDEAS = ["Tidy the rules into short sentences", "Write the motion rules for this brand", "Fill in the colour ramps from the logo"];

function KitChat({
  kitId,
  chat,
  folded,
  onFold,
  hidden,
  openingRef,
  beforeSend,
}: {
  kitId: string;
  chat: ReturnType<typeof useKitChat>;
  folded: boolean;
  onFold: (f: boolean) => void;
  hidden: boolean;
  openingRef: React.RefObject<{ prompt: string; url: string } | null>;
  beforeSend: () => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [undoNote, setUndoNote] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const { messages, turn } = chat;

  // A kit made from files starts with Claude reading them.
  useEffect(() => {
    const first = openingRef.current;
    if (!first) return;
    openingRef.current = null;
    void chat.send(first.prompt, first.url);
  }, [openingRef, chat]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, turn.text, turn.steps.length]);

  const files = useAttachments(`/api/studio/brands/${kitId}/attachments`);

  const send = async () => {
    const attached = await files.flush();
    const words = draft.trim() || (attached.length ? "Have a look at what I attached." : "");
    if (!words) return;
    setDraft("");
    files.clear();
    await beforeSend();
    void chat.send(words, "", attached);
  };
  const step = turn.steps.at(-1) ?? "Reading the kit";

  return (
    <Panel
      title="Claude"
      folded={folded}
      onFold={onFold}
      hidden={hidden}
      className="top-[68px] bottom-4 left-4 w-[300px]"
      pillClassName="top-[68px] left-4"
      bodyClassName="flex flex-col"
      actions={
        messages.some((m) => m.role === "claude") ? (
          <Hint label="Undo Claude’s last change" keys={["⌘", "Z"]}>
            <button
              type="button"
              disabled={turn.running}
              onClick={async () => setUndoNote(await chat.undo())}
              className={cn(PILL_BUTTON, "h-7 px-2.5 text-white/60 hover:bg-white/[0.08] hover:text-white")}
            >
              Undo
            </button>
          </Hint>
        ) : null
      }
    >
      <div ref={list} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {!chat.loaded ? (
          // The chat so far is on its way: a few lines' worth of shapes.
          <Skeleton loading label="Loading the chat">
            <div className="flex flex-col gap-3 pt-1">
              <p className="self-end rounded-[12px] px-3 py-2 text-[12.5px]">Build the kit from our guideline PDF</p>
              <p className="text-[12.5px] leading-relaxed">I read the guideline and set the colours, the type and both logos from it.</p>
            </div>
          </Skeleton>
        ) : !messages.length && !turn.running ? (
          <div className="flex flex-col gap-2.5">
            <p className="text-[12.5px] text-white/55 leading-relaxed">
              Ask Claude to build or tidy this kit. It reads the files you add (a guideline PDF, screenshots, logos, fonts)
              and any links you paste: the website, Framer or Notion pages, a Figma file.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {KIT_IDEAS.map((idea) => (
                <button key={idea} type="button" onClick={() => setDraft(idea)} className="rounded-[8px] bg-white/[0.06] px-2 py-1 text-[11.5px] text-white/65 outline-none hover:bg-white/[0.1] hover:text-white focus-visible:ring-2 focus-visible:ring-ring">
                  {idea}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {messages.map((m, i) =>
          m.role === "you" ? (
            <div key={`${m.at}-${i}`} className="ms-8 flex flex-col items-end gap-1 self-end">
              <p className="whitespace-pre-wrap break-words rounded-[12px] rounded-br-[4px] bg-white/[0.09] px-3 py-2 text-[12.5px] text-white/90 leading-relaxed">
                {m.text}
              </p>
              <SentFiles files={m.context?.attachments ?? []} urlOf={(path) => brandFile(kitId, path)} />
            </div>
          ) : (
            <p key={`${m.at}-${i}`} className="pe-4 whitespace-pre-wrap text-[12.5px] text-white/80 leading-relaxed">
              {m.text}
            </p>
          ),
        )}
        {turn.running ? (
          <div className="flex flex-col gap-1.5 pe-4" aria-live="polite">
            <p className="h-4 overflow-hidden text-[11.5px]">
              <span key={`${turn.steps.length}-${step}`} className="studio-shimmer block animate-in fade-in slide-in-from-bottom-1 duration-200">
                {step}
              </span>
            </p>
            {turn.text ? <p className="whitespace-pre-wrap text-[12.5px] text-white/80 leading-relaxed">{turn.text}</p> : null}
          </div>
        ) : null}
        {turn.error ? <p className="text-[12.5px] text-[#ff9592] leading-relaxed">{turn.error}</p> : null}
        {undoNote ? <p className="text-[12.5px] text-white/50 leading-relaxed">{undoNote}</p> : null}
      </div>
      <div className="flex shrink-0 flex-col gap-1.5 px-2 pb-2">
        <PromptBox
          value={draft}
          onChange={setDraft}
          onSend={() => void send()}
          onStop={chat.stop}
          running={turn.running}
          attachments={files}
          placeholder="Make the motion rules calmer, or paste a link"
        />
      </div>
    </Panel>
  );
}
