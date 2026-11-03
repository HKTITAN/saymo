"use client";

import { Popover } from "@base-ui/react/popover";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ChevronDownIcon, FileIcon, MultipleCrossCancelIcon, PhotoImagePlusIcon, PlusIcon, UploadUpIcon, UserIcon } from "@/components/icons";
import { DialGroup, DialNote, DialText, LABEL, ROW, ROW_BUTTON, SURFACE } from "@/components/tool/dial";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { STUDIO_HEADERS } from "@/lib/studio/contract";
import {
  CAPTION_STYLES,
  type CaptionStyle,
  contrast,
  type Energy,
  type FacePick,
  type PersonalStyle as Style,
  SHIPPED_FONTS,
  shippedFontUrl,
  type Voice,
} from "@/lib/studio/personal-style";
import type { BrandKit } from "@/lib/studio/brand";
import { cn } from "@/lib/utils";
import { ColorRow } from "./color-row";
import { readFontFile } from "./font-file";
import { ITEM, MENU_POPUP } from "./home-parts";
import { CARD, DiscardAsk, Hint, ICON_BUTTON, PILL_BUTTON } from "./panel";

// Personal style: a brand kit in two minutes, for someone whose brand is
// themselves. Name, photo, three or four colours, two faces and a few rules,
// with a reel card that shows the style as it's set. Saved as an ordinary
// kit (personal-style.ts, /api/studio/brands/personal).

// ─── "New kit": the two ways to make one ────────────────────────────────────

export type KitWay = "personal" | "guideline";

export function NewKitMenu({ busy, onPick, className }: { busy?: boolean; onPick: (way: KitWay) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const pick = (way: KitWay) => {
    setOpen(false);
    onPick(way);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger disabled={busy} className={cn(PILL_BUTTON, "bg-studio text-[#1f0612] hover:bg-studio-hover data-popup-open:bg-white/85", className)}>
        <PlusIcon aria-hidden="true" />
        New kit
        <ChevronDownIcon aria-hidden="true" className="-me-1 opacity-50" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={12} className="z-50">
          <Popover.Popup aria-label="Ways to make a kit" className={cn(SURFACE, MENU_POPUP, "w-max max-w-[300px]")}>
            <MenuWay icon={<UserIcon aria-hidden="true" />} title="Personal style" note="Your name, colours, fonts and a few rules. About two minutes." onClick={() => pick("personal")} />
            <MenuWay
              icon={<FileIcon aria-hidden="true" />}
              title="Brand kit from a guideline"
              note="Share a guideline, links and files, and Claude builds the kit."
              onClick={() => pick("guideline")}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function MenuWay({ icon, title, note, onClick }: { icon: ReactNode; title: string; note: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn(ITEM, "items-start py-2 [&>svg]:mt-px")}>
      {icon}
      <span className="flex flex-col gap-0.5">
        <span className="text-white/90">{title}</span>
        <span className="text-[11.5px] text-white/45 leading-snug">{note}</span>
      </span>
    </button>
  );
}

// ─── The form ───────────────────────────────────────────────────────────────

type Slot = "heading" | "text";
type Upload = { file: File; family: string; weights: string; axes?: string; face: string | null };
type Pick = { shipped: string } | { upload: Slot };

const START = {
  name: "",
  ground: "#F4F1EA",
  text: "#161616",
  accent: "#2F5BFF",
  heading: { shipped: "bricolage-grotesque" } as Pick,
  body: { shipped: "inter" } as Pick,
  energy: "calm" as Energy,
  captions: true,
  captionStyle: "highlight" as CaptionStyle,
  voice: "casual" as Voice,
  line: "",
};

const sameFace = (a: Pick, b: Pick) => ("shipped" in a && "shipped" in b ? a.shipped === b.shipped : "upload" in a && "upload" in b && a.upload === b.upload);
const shippedFace = (id: string) => `ps-${id}`;

export function PersonalStyleMaker({ onDone, onClose }: { onDone: (kit: BrandKit) => void; onClose: () => void }) {
  const [name, setName] = useState(START.name);
  const [ground, setGround] = useState(START.ground);
  const [text, setText] = useState(START.text);
  const [accent, setAccent] = useState(START.accent);
  const [accent2, setAccent2] = useState<string | null>(null);
  const [heading, setHeading] = useState<Pick>(START.heading);
  const [body, setBody] = useState<Pick>(START.body);
  const [uploads, setUploads] = useState<Partial<Record<Slot, Upload>>>({});
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [energy, setEnergy] = useState<Energy>(START.energy);
  const [captions, setCaptions] = useState(START.captions);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(START.captionStyle);
  const [voice, setVoice] = useState<Voice>(START.voice);
  const [line, setLine] = useState(START.line);
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set());
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const photoPicker = useRef<HTMLInputElement>(null);

  // Each shipped face, loaded once, so the picker shows names in their own face.
  useEffect(() => {
    let live = true;
    const faces = SHIPPED_FONTS.map((f) => new FontFace(shippedFace(f.id), `url(${shippedFontUrl(f)})`, { weight: f.weights }));
    for (const [i, face] of faces.entries()) {
      face
        .load()
        .then((ok) => {
          document.fonts.add(ok);
          if (live) setLoaded((s) => new Set(s).add(SHIPPED_FONTS[i].id));
        })
        .catch(() => {});
    }
    return () => {
      live = false;
      for (const face of faces) document.fonts.delete(face);
    };
  }, []);

  // The photo's preview is let go when the card closes.
  const photoRef = useRef(photo);
  useEffect(() => {
    photoRef.current = photo;
  });
  useEffect(
    () => () => {
      if (photoRef.current) URL.revokeObjectURL(photoRef.current.url);
    },
    [],
  );

  const dirty =
    Boolean(name.trim() || line.trim() || photo || accent2 || uploads.heading || uploads.text) ||
    ground !== START.ground ||
    text !== START.text ||
    accent !== START.accent ||
    !sameFace(heading, START.heading) ||
    !sameFace(body, START.body) ||
    energy !== START.energy ||
    captions !== START.captions ||
    captionStyle !== START.captionStyle ||
    voice !== START.voice;

  const close = () => (dirty ? setAsking(true) : onClose());

  // Esc closes, asking first if something would be lost. A press on the
  // dimmed space around the card arrives here as Esc too (dashboard.tsx).
  // Esc inside a colour or font picker is that picker's.
  const state = useRef({ dirty, asking, saving });
  useEffect(() => {
    state.current = { dirty, asking, saving };
  });
  // The card opens with the name field ready to type in.
  useEffect(() => {
    (panel.current?.querySelector("input:not([type=file])") as HTMLInputElement | null)?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof Element && !panel.current?.contains(t) && t.closest("[data-open]")) return;
      e.preventDefault();
      const s = state.current;
      if (s.saving) return;
      if (s.asking) setAsking(false);
      else if (s.dirty) setAsking(true);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const addPhoto = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    try {
      const ready = /\.svg$/i.test(file.name) || file.type === "image/svg+xml" ? file : await asPng(file);
      setPhoto((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { file: ready, url: URL.createObjectURL(ready) };
      });
    } catch {
      setProblem("That picture couldn't be read. Try a PNG, JPG, WebP or SVG.");
    }
  };

  const addFont = async (slot: Slot, file: File) => {
    setProblem(null);
    if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) {
      setProblem("Upload a font as a TTF, OTF or WOFF2 file.");
      return;
    }
    try {
      const info = await readFontFile(file);
      const faceName = `ps-upload-${slot}-${Date.now().toString(36)}`;
      const face = await new FontFace(faceName, info.buffer, { weight: info.weights }).load();
      document.fonts.add(face);
      setUploads((u) => ({ ...u, [slot]: { file, family: info.family, weights: info.weights, axes: info.axes, face: faceName } }));
      (slot === "heading" ? setHeading : setBody)({ upload: slot });
    } catch {
      setProblem("That font file couldn't be read. Try another TTF, OTF or WOFF2.");
    }
  };

  const faceOf = (pick: Pick) => {
    if ("shipped" in pick) {
      const f = SHIPPED_FONTS.find((s) => s.id === pick.shipped);
      return { family: f?.family ?? "", css: loaded.has(pick.shipped) ? `"${shippedFace(pick.shipped)}", system-ui` : undefined };
    }
    const u = uploads[pick.upload];
    return { family: u?.family ?? "", css: u?.face ? `"${u.face}", system-ui` : undefined };
  };

  const canSave = Boolean(name.trim()) && !saving;
  const save = async () => {
    if (!name.trim()) {
      setProblem("Add your name or handle first.");
      return;
    }
    if (saving) return;
    setSaving(true);
    setProblem(null);
    const face = (pick: Pick): FacePick => {
      if ("shipped" in pick) return pick;
      const u = uploads[pick.upload] as Upload;
      return { upload: pick.upload, family: u.family, weights: u.weights, ...(u.axes ? { axes: u.axes } : {}) };
    };
    const style: Style = {
      name: name.trim(),
      colors: { ground, text, accent, ...(accent2 ? { accent2 } : {}) },
      heading: face(heading),
      body: face(body),
      energy,
      captions: { on: captions, style: captionStyle },
      voice,
      line: line.trim(),
    };
    const form = new FormData();
    form.set("style", JSON.stringify(style));
    if (photo) form.set("photo", photo.file);
    for (const slot of ["heading", "text"] as const) {
      const used = [heading, body].some((p) => "upload" in p && p.upload === slot);
      const u = uploads[slot];
      if (used && u) form.set(slot, u.file);
    }
    try {
      const res = await fetch("/api/studio/brands/personal", { method: "POST", body: form, headers: STUDIO_HEADERS });
      const out = (await res.json().catch(() => null)) as (BrandKit & { error?: string }) | null;
      if (!res.ok || !out) throw new Error(out?.error || "The style couldn't be saved. Try again.");
      onDone(out);
    } catch (e) {
      setProblem(e instanceof TypeError ? "Unable to reach the studio. Check that it's still running, then try again." : (e as Error).message);
      setSaving(false);
    }
  };

  const low = contrast(ground, text) < 3;

  return (
    // The card fits the window: its title and Save stay put, and only the
    // rows scroll between them.
    <div data-backdrop="" className="absolute inset-0 flex items-center justify-center p-4 sm:p-6">
      <section
        ref={panel}
        aria-labelledby="personal-style"
        className={cn(CARD, "relative flex max-h-full w-full max-w-[760px] flex-col gap-4 p-5 animate-in fade-in-0 zoom-in-[0.98] duration-200")}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
      >
        <div className="flex flex-col gap-1.5 pe-10">
          <h2 id="personal-style" className="font-medium text-[15px] text-white/95">
            Personal style
          </h2>
          <p className="text-[12.5px] text-white/55 leading-relaxed">
            Your name, colours, fonts and a few rules. Every film made with it looks and sounds like you.
          </p>
        </div>

        <div className="-mx-5 grid min-h-0 flex-1 items-start gap-5 overflow-y-auto px-5 [mask-image:linear-gradient(to_bottom,transparent,black_10px,black_calc(100%-10px),transparent)] [scrollbar-width:none] sm:grid-cols-[1fr_232px] [&::-webkit-scrollbar]:hidden">
          <div className="order-2 flex min-w-0 flex-col gap-3 sm:order-1">
            <DialGroup title="You">
              <DialText label="Name or handle" value={name} placeholder="@maya.makes" onChange={setName} />
              <input
                ref={photoPicker}
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.svg"
                className="hidden"
                tabIndex={-1}
                onChange={(e) => {
                  void addPhoto(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <div className="flex gap-1.5">
                <button type="button" className={ROW_BUTTON} onClick={() => photoPicker.current?.click()}>
                  <span className={LABEL}>Photo or mark</span>
                  <span className="ms-auto flex min-w-0 items-center gap-2 text-white/90">
                    {photo ? (
                      <>
                        <span className="truncate text-white/55">{photo.file.name}</span>
                        {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the picked file */}
                        <img src={photo.url} alt="" className="size-5 shrink-0 rounded-full bg-white/10 object-cover" />
                      </>
                    ) : (
                      <>
                        <span className="text-white/45">Optional</span>
                        <PhotoImagePlusIcon aria-hidden="true" className="size-4 text-white/55" />
                      </>
                    )}
                  </span>
                </button>
                {photo ? (
                  <button
                    type="button"
                    className={cn(ICON_BUTTON, "size-9 shrink-0 rounded-[10px] bg-white/[0.05]")}
                    aria-label="Remove the photo"
                    onClick={() =>
                      setPhoto((old) => {
                        if (old) URL.revokeObjectURL(old.url);
                        return null;
                      })
                    }
                  >
                    <MultipleCrossCancelIcon aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </DialGroup>

            <DialGroup title="Colours">
              <ColorRow label="Ground" value={ground} onChange={setGround} />
              <ColorRow label="Text" value={text} onChange={setText} />
              <ColorRow label="Accent" value={accent} onChange={setAccent} />
              {accent2 ? (
                <div className="flex gap-1.5">
                  <ColorRow label="Second accent" value={accent2} onChange={setAccent2} />
                  <button type="button" className={cn(ICON_BUTTON, "size-9 shrink-0 rounded-[10px] bg-white/[0.05]")} aria-label="Remove the second accent" onClick={() => setAccent2(null)}>
                    <MultipleCrossCancelIcon aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <button type="button" className={cn(ROW_BUTTON, "text-white/55 hover:text-white/85")} onClick={() => setAccent2("#FFC83D")}>
                  <PlusIcon aria-hidden="true" className="size-3.5" />
                  Add a second accent
                </button>
              )}
              {low ? <DialNote>The text and ground are close in tone, so words may be hard to read.</DialNote> : null}
            </DialGroup>

            <DialGroup title="Fonts">
              <FontRow label="Heading" pick={heading} uploads={uploads} loaded={loaded} faceOf={faceOf} onPick={setHeading} onUpload={(f) => void addFont("heading", f)} />
              <FontRow label="Text" pick={body} uploads={uploads} loaded={loaded} faceOf={faceOf} onPick={setBody} onUpload={(f) => void addFont("text", f)} />
            </DialGroup>

            <DialGroup title="Rules">
              <SlideRow
                label="Energy"
                value={energy}
                options={[
                  { value: "calm", label: "Calm" },
                  { value: "punchy", label: "Punchy" },
                ]}
                onChange={setEnergy}
              />
              <SlideRow
                label="Captions"
                value={captions}
                options={[
                  { value: false, label: "Off" },
                  { value: true, label: "On" },
                ]}
                onChange={setCaptions}
              />
              {captions ? <SlideRow label="Caption style" value={captionStyle} options={CAPTION_STYLES} onChange={setCaptionStyle} segment={72} /> : null}
              <SlideRow
                label="Words"
                value={voice}
                options={[
                  { value: "casual", label: "Casual" },
                  { value: "formal", label: "Formal" },
                ]}
                onChange={setVoice}
              />
              <DialText label="Also" value={line} placeholder="lowercase captions, no emojis" onChange={setLine} />
            </DialGroup>
          </div>

          <div className="order-1 flex justify-center sm:sticky sm:top-0 sm:order-2">
            <ReelCard
              name={name}
              colors={{ ground, text, accent, accent2 }}
              heading={faceOf(heading).css}
              body={faceOf(body).css}
              photo={photo?.url ?? null}
              energy={energy}
              captions={captions ? captionStyle : null}
              voice={voice}
            />
          </div>
        </div>

        {asking ? (
          <DiscardAsk what="your style" onKeep={() => setAsking(false)} onDiscard={onClose} />
        ) : (
          <div className="flex items-center gap-3">
            <p className={cn("me-auto text-[12px] leading-relaxed", problem ? "text-[#ff9592]" : "text-white/45")} role={problem ? "alert" : undefined}>
              {problem ?? "It’s saved as a brand kit, so you can change anything later."}
            </p>
            <span className="hidden items-center gap-1.5 text-[11px] text-white/35 sm:inline-flex">
              <KbdGroup>
                <Kbd>⌘</Kbd>
                <Kbd>↵</Kbd>
              </KbdGroup>
            </span>
            <button
              type="button"
              disabled={!canSave}
              onClick={() => void save()}
              className={cn(PILL_BUTTON, "bg-studio text-[#1f0612] hover:bg-studio-hover disabled:bg-studio/60")}
            >
              {saving ? <span className="studio-shimmer">Saving</span> : "Save style"}
            </button>
          </div>
        )}

        <Hint label="Close" keys={["Esc"]}>
          <button type="button" onClick={close} className={cn(ICON_BUTTON, "absolute top-3.5 right-3.5")} aria-label="Close personal style">
            <MultipleCrossCancelIcon aria-hidden="true" />
          </button>
        </Hint>
      </section>
    </div>
  );
}

// A raster picture as a PNG of at most 1024 px, which every kit takes.
async function asPng(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
  if (!blob) throw new Error("unreadable");
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "photo"}.png`, { type: "image/png" });
}

// ─── Rows ───────────────────────────────────────────────────────────────────

// A label on the left and options on the right, with one highlight that
// slides to the chosen one (as in the rules panel).
function SlideRow<T extends string | boolean>({
  label,
  value,
  options,
  onChange,
  segment = 64,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  segment?: number;
}) {
  const at = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className={cn(ROW, "gap-3 ps-3 pe-1")}>
      <span className={LABEL}>{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className="relative ms-auto grid h-7 shrink-0 rounded-[8px] p-0.5"
        style={{ gridTemplateColumns: `repeat(${options.length}, ${segment}px)` }}
      >
        <span
          aria-hidden="true"
          className="absolute top-0.5 bottom-0.5 left-0.5 rounded-[7px] bg-white/[0.13] shadow-[0_1px_2px_rgba(0,0,0,0.3)] transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
          style={{ width: segment, transform: `translateX(${at * segment}px)` }}
        />
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative cursor-pointer rounded-[7px] text-[12px] outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring",
              o.value === value ? "text-white" : "text-white/45 hover:text-white/75",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// A face: the row shows it in its own face; the list holds the studio's
// fonts, any uploaded here, and a way to upload one.
function FontRow({
  label,
  pick,
  uploads,
  loaded,
  faceOf,
  onPick,
  onUpload,
}: {
  label: string;
  pick: Pick;
  uploads: Partial<Record<Slot, Upload>>;
  loaded: Set<string>;
  faceOf: (p: Pick) => { family: string; css?: string };
  onPick: (p: Pick) => void;
  onUpload: (file: File) => void;
}) {
  const [open, setOpen] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const now = faceOf(pick);
  const choose = (p: Pick) => {
    onPick(p);
    setOpen(false);
  };
  const uploaded = (["heading", "text"] as const).filter((s) => uploads[s]);
  const option = (key: string, p: Pick, family: string, css: string | undefined, note: string) => {
    const on = sameFace(p, pick);
    return (
      <button
        key={key}
        type="button"
        role="menuitemradio"
        aria-checked={on}
        onClick={() => choose(p)}
        className={cn(
          ITEM,
          "min-h-9 gap-2 ps-2.5",
          "before:size-1.5 before:shrink-0 before:rounded-full before:content-['']",
          on ? "text-white before:bg-white/85" : "text-white/75 before:bg-transparent",
        )}
      >
        <span className="flex-1 text-[15px] leading-none" style={{ fontFamily: css }}>
          {family}
        </span>
        <span className="ps-4 text-[11px] text-white/35">{note}</span>
      </button>
    );
  };
  return (
    <>
      <input
        ref={picker}
        type="file"
        accept=".ttf,.otf,.woff,.woff2"
        className="hidden"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          e.target.value = "";
        }}
      />
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger className={ROW_BUTTON}>
          <span className={LABEL}>{label}</span>
          <span className="ms-auto flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[14px] text-white/90 leading-none" style={{ fontFamily: now.css }}>
              {now.family}
            </span>
            <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0 text-white/40" />
          </span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={12} className="z-50">
            <Popover.Popup aria-label={`${label} font`} className={cn(SURFACE, MENU_POPUP, "w-max min-w-[240px]")}>
              {SHIPPED_FONTS.map((f) => option(f.id, { shipped: f.id }, f.family, loaded.has(f.id) ? `"${shippedFace(f.id)}", system-ui` : undefined, f.kind))}
              {uploaded.map((s) => {
                const u = uploads[s] as Upload;
                return option(`upload-${s}`, { upload: s }, u.family, u.face ? `"${u.face}", system-ui` : undefined, "Uploaded");
              })}
              <div className="mx-2 my-1 h-px bg-white/[0.07]" />
              <button
                type="button"
                className={ITEM}
                onClick={() => {
                  setOpen(false);
                  picker.current?.click();
                }}
              >
                <UploadUpIcon aria-hidden="true" />
                Upload a font
                <span className="ms-auto ps-4 text-[11px] text-white/35">TTF, OTF, WOFF2</span>
              </button>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}

// ─── The live preview ───────────────────────────────────────────────────────

const COPY = {
  casual: { title: ["3 things I wish I knew ", "sooner"], caption: ["so here's what ", "actually", " happened"], tag: "Part 1" },
  formal: { title: ["Three lessons from a year of ", "making"], caption: ["Here is what I ", "learned", " this year"], tag: "Part 1" },
} as const;

// A 9:16 reel card in the style as it's set: the title in the heading face
// with one word in the accent, a caption in the caption style, and the name.
function ReelCard({
  name,
  colors,
  heading,
  body,
  photo,
  energy,
  captions,
  voice,
}: {
  name: string;
  colors: { ground: string; text: string; accent: string; accent2: string | null };
  heading?: string;
  body?: string;
  photo: string | null;
  energy: Energy;
  captions: CaptionStyle | null;
  voice: Voice;
}) {
  const copy = COPY[voice];
  const punchy = energy === "punchy";
  const shown = name.trim() || "@yourname";
  const initial = (shown.replace(/^@/, "")[0] ?? "Y").toUpperCase();
  const onAccent = contrast(colors.accent, colors.text) >= contrast(colors.accent, colors.ground) ? colors.text : colors.ground;
  return (
    <figure aria-label="Preview of a reel in this style" className="flex w-[200px] flex-col gap-2 sm:w-[232px]">
      <div
        className="relative flex aspect-[9/16] w-full flex-col overflow-hidden rounded-[18px] p-[18px] shadow-[0_0_0_1px_rgba(255,255,255,0.08)] transition-colors duration-300"
        style={{ background: colors.ground, color: colors.text }}
      >
        <div className="flex h-5 items-center">
          {colors.accent2 ? (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] leading-none transition-colors duration-300"
              style={{ background: colors.accent2, color: contrast(colors.accent2, colors.text) >= contrast(colors.accent2, colors.ground) ? colors.text : colors.ground, fontFamily: body, fontWeight: 600 }}
            >
              {copy.tag}
            </span>
          ) : null}
        </div>
        <p
          className="mt-auto transition-[font-weight,letter-spacing] duration-300"
          style={{
            fontFamily: heading,
            fontSize: punchy ? 30 : 26,
            lineHeight: punchy ? 0.98 : 1.1,
            fontWeight: punchy ? 800 : 500,
            letterSpacing: punchy ? "-0.03em" : "-0.01em",
          }}
        >
          {copy.title[0]}
          <span className="transition-colors duration-300" style={{ color: colors.accent }}>
            {copy.title[1]}
          </span>
        </p>
        <div className="mt-auto flex min-h-[54px] items-end justify-center pb-4">
          {captions ? (
            <p className="text-center text-[12.5px] leading-snug" style={{ fontFamily: body, fontWeight: captions === "boxed" ? 600 : 500 }}>
              {captions === "boxed" ? (
                <span className="box-decoration-clone rounded-[4px] px-1.5 py-0.5" style={{ background: colors.text, color: colors.ground }}>
                  {copy.caption.join("")}
                </span>
              ) : captions === "highlight" ? (
                <>
                  {copy.caption[0]}
                  <span style={{ color: colors.accent }}>{copy.caption[1]}</span>
                  {copy.caption[2]}
                </>
              ) : (
                copy.caption.join("")
              )}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local preview of the picked file
            <img src={photo} alt="" className="size-6 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] transition-colors duration-300" style={{ background: colors.accent, color: onAccent, fontFamily: heading, fontWeight: 700 }}>
              {initial}
            </span>
          )}
          <span className="truncate text-[11.5px]" style={{ fontFamily: body, fontWeight: 500, opacity: name.trim() ? 1 : 0.45 }}>
            {shown}
          </span>
        </div>
      </div>
      <figcaption className="text-center text-[11px] text-white/35">Preview</figcaption>
    </figure>
  );
}
