"use client";

import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUpIcon, CheckTickCircleIcon, MultipleCrossCancelIcon, PaperclipVerticalIcon } from "@/components/icons";
import type { BrandKit } from "@/lib/studio/brand";
import { STUDIO_HEADERS } from "@/lib/studio/contract";
import { findLinks, LINK_LABEL, type SharedLink } from "@/lib/studio/links";
import { cn } from "@/lib/utils";
import { StudioError } from "./api";
import { brandApi, brandFile, KIT_ACCEPTS } from "./brand-api";
import { CARD, Hint, ICON_BUTTON, PILL_BUTTON } from "./panel";

// Making a brand kit: one prompt box to pour everything into (words, links,
// guideline PDFs, screenshots, logos, fonts), then Claude builds the kit
// while the card shows it filling in, step by step, with time left.

type FileKind = "PDF" | "Font" | "Logo" | "Image" | "Notes";
type Shared = { id: string; file: File; kind: FileKind; preview: string | null };

const HINTS = [
  "What does the brand sell, and to whom?",
  "How should it sound? Calm, bold, playful, precise…",
  "Colours you know, with hex codes if you have them",
  "Fonts it uses, and where",
  "Things it would never do",
  "Paste links: website, Figma, Framer, Notion",
];

const kindOf = (file: File): FileKind | null => {
  const name = file.name.toLowerCase();
  if (/\.(ttf|otf|woff2?)$/.test(name)) return "Font";
  if (name.endsWith(".pdf")) return "PDF";
  if (/\.(txt|md)$/.test(name)) return "Notes";
  if (name.endsWith(".svg") || (/\.(png|webp)$/.test(name) && /logo|mark|wordmark|lockup/.test(name))) return "Logo";
  if (/\.(png|jpe?g|webp)$/.test(name)) return "Image";
  return null;
};

// What a link chip says when Claude can't open that kind of link.
const linkNote = (link: SharedLink, figmaReady: boolean): string | null => {
  if (link.kind === "figma" && !figmaReady) {
    return "Claude can't open Figma links yet. Export the frames as PDF or PNG and drop them in, or add a Figma token.";
  }
  if (link.kind === "drive") return "Google Drive links can't be opened from here. Download the file and drop it in.";
  if (link.kind === "video") return "Claude can't watch videos from here. Add a note on what's in it.";
  return null;
};

type Phase = { key: string; label: string };

export function KitMaker({
  onDone,
  onClose,
  onHide,
  onBlank,
}: {
  onDone: (kitId: string, reply: string) => void;
  onClose: () => void;
  onHide: (kitId: string | null) => void; // Esc while building: hide, keep building
  onBlank: () => void;
}) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [files, setFiles] = useState<Shared[]>([]);
  const [over, setOver] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [hint, setHint] = useState(0);
  const [figmaReady, setFigmaReady] = useState(true);
  const [build, setBuild] = useState<Build | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const links = useMemo(() => findLinks(text), [text]);
  const dirty = Boolean(text.trim() || files.length || name.trim());

  useEffect(() => {
    fetch("/api/studio/brands/figma", { headers: STUDIO_HEADERS })
      .then((r) => r.json())
      .then((r: { ready?: boolean }) => setFigmaReady(Boolean(r.ready)))
      .catch(() => setFigmaReady(false));
  }, []);

  // The hint in the empty box changes every few seconds.
  useEffect(() => {
    if (text) return;
    const t = setInterval(() => setHint((h) => (h + 1) % HINTS.length), 3600);
    return () => clearInterval(t);
  }, [text]);

  // The box grows with what's written, up to a point, then scrolls.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 132), 320)}px`;
  }, [text]);

  // Previews of dropped pictures, let go when they leave.
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  });
  useEffect(() => () => filesRef.current.forEach((f) => f.preview && URL.revokeObjectURL(f.preview)), []);

  const add = (list: FileList | File[] | null) => {
    const picked = [...(list ?? [])].flatMap((file): Shared[] => {
      const kind = kindOf(file);
      if (!kind) return [];
      const preview = kind === "Image" || kind === "Logo" ? URL.createObjectURL(file) : null;
      return [{ id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`, file, kind, preview }];
    });
    setFiles((f) => [...f, ...picked].slice(0, 40));
  };
  const removeFile = (id: string) =>
    setFiles((list) => {
      const gone = list.find((f) => f.id === id);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return list.filter((f) => f.id !== id);
    });
  const removeLink = (url: string) => setText((t) => t.split(url).join("").replace(/[ \t]{2,}/g, " ").trim());

  const canSend = Boolean(text.trim() || files.length);
  const start = () => {
    if (!canSend || build) return;
    setBuild({ name: name.trim(), text: text.trim(), files: files.map((f) => f.file), links });
  };

  // Esc: hide while building; otherwise close, asking first if something
  // would be lost.
  const buildingRef = useRef<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      if (build) onHide(buildingRef.current);
      else if (confirm) setConfirm(false);
      else if (dirty) setConfirm(true);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [build, confirm, dirty, onClose, onHide]);

  return (
    <div data-backdrop="" className="absolute inset-0 flex items-center justify-center overflow-y-auto p-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <section aria-labelledby="make-kit" className={cn(CARD, "relative my-auto flex w-full max-w-[640px] flex-col gap-4 p-5")}>
        {build ? (
          <Building build={build} buildingRef={buildingRef} onDone={onDone} onBack={() => setBuild(null)} />
        ) : (
          <>
            <div className="flex flex-col gap-1.5 pe-10">
              <h2 id="make-kit" className="font-medium text-[15px] text-white/95">
                Make a brand kit
              </h2>
              <p className="text-[12.5px] text-white/55 leading-relaxed">
                Tell Claude everything you know about the brand. Paste links, drop the guideline, logos and fonts, and write
                it all down however it comes. Claude turns it into a kit you can change afterwards.
              </p>
            </div>

            {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target; the attach button is the keyboard way in */}
            <div
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes("Files")) return;
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                add(e.dataTransfer.files);
              }}
              className={cn(
                "relative flex flex-col rounded-[14px] bg-white/[0.05] transition-colors has-[textarea:focus-visible]:bg-white/[0.07] has-[textarea:focus-visible]:ring-1 has-[textarea:focus-visible]:ring-white/15",
                over && "bg-white/[0.08] ring-1 ring-white/40",
              )}
            >
              <textarea
                ref={area}
                // biome-ignore lint/a11y/noAutofocus: the card opens to write in it
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onPaste={(e) => {
                  if (e.clipboardData.files.length) {
                    e.preventDefault();
                    add(e.clipboardData.files);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    start();
                  }
                }}
                aria-label="Everything about the brand"
                placeholder={`Tell Claude everything about the brand. ${HINTS[hint]}`}
                className="min-h-[132px] w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[13.5px] text-white/90 leading-relaxed outline-none placeholder:text-white/30 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              />

              {files.length || links.length ? (
                <ul className="flex flex-wrap gap-1.5 px-3 pb-2" aria-label="What you're sharing">
                  {files.map((f) => (
                    <Chip key={f.id} kind={f.kind} name={f.file.name} preview={f.preview} onRemove={() => removeFile(f.id)} />
                  ))}
                  {links.map((l) => (
                    <Chip key={l.url} kind={LINK_LABEL[l.kind]} name={l.label} warn={Boolean(linkNote(l, figmaReady))} onRemove={() => removeLink(l.url)} />
                  ))}
                </ul>
              ) : null}
              {links.map((l) => linkNote(l, figmaReady)).filter((n, i, all): n is string => Boolean(n) && all.indexOf(n) === i).map((note) => (
                <p key={note} className="px-4 pb-2 text-[11.5px] text-[#f5c26b]/85 leading-relaxed">
                  {note}
                </p>
              ))}

              <div className="flex items-center gap-1.5 border-white/[0.06] border-t px-2 py-2">
                <input
                  ref={picker}
                  type="file"
                  multiple
                  accept={KIT_ACCEPTS}
                  className="hidden"
                  tabIndex={-1}
                  onChange={(e) => {
                    add(e.target.files);
                    e.target.value = "";
                  }}
                />
                <Hint label="Add files">
                  <button type="button" className={ICON_BUTTON} onClick={() => picker.current?.click()} aria-label="Add files">
                    <PaperclipVerticalIcon aria-hidden="true" />
                  </button>
                </Hint>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Brand name (optional)"
                  aria-label="Brand name (optional)"
                  maxLength={80}
                  className="h-7 w-44 min-w-0 rounded-[8px] bg-transparent px-2 text-[12px] text-white/80 outline-none placeholder:text-white/30 hover:bg-white/[0.04] focus:bg-white/[0.06]"
                />
                <span className="ms-auto hidden items-center gap-1.5 text-[11px] text-white/35 sm:inline-flex">
                  <KbdGroup>
                    <Kbd>⌘</Kbd>
                    <Kbd>↵</Kbd>
                  </KbdGroup>
                  to send
                </span>
                <Hint label="Make the kit" keys={["⌘", "↵"]}>
                  <button
                    type="button"
                    disabled={!canSend}
                    onClick={start}
                    aria-label="Make the kit"
                    className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full bg-studio text-[#1f0612] outline-none transition-colors hover:bg-studio-hover focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-30 [&_svg]:size-4"
                  >
                    <ArrowUpIcon aria-hidden="true" />
                  </button>
                </Hint>
              </div>
              {over ? (
                <p className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[14px] bg-black/50 text-[13px] text-white/90">
                  Drop to add them
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-3 px-1">
              <p className="me-auto text-[12px] text-white/45">The more you give, the better the kit.</p>
              <button type="button" onClick={onBlank} className="text-[12px] text-white/45 underline-offset-2 outline-none hover:text-white/80 hover:underline focus-visible:text-white">
                Start from a blank kit
              </button>
            </div>

            {confirm ? (
              <div className="flex items-center gap-2 rounded-[12px] bg-white/[0.06] py-1.5 ps-3.5 pe-1.5" role="alertdialog" aria-label="Discard what you shared?">
                <p className="me-auto text-[12.5px] text-white/85">Discard what you’ve shared?</p>
                <button type="button" onClick={() => setConfirm(false)} className={cn(PILL_BUTTON, "h-7 text-white/70 hover:bg-white/[0.08] hover:text-white")}>
                  Keep it
                </button>
                <button
                  type="button"
                  // biome-ignore lint/a11y/noAutofocus: the one choice that needs a decision
                  autoFocus
                  onClick={onClose}
                  className={cn(PILL_BUTTON, "h-7 bg-[#ff9592]/15 text-[#ffb3b0] hover:bg-[#ff9592]/25")}
                >
                  Discard
                </button>
              </div>
            ) : null}
          </>
        )}
        <Hint label="Close" keys={["Esc"]}>
          <button
            type="button"
            onClick={() => (build ? onHide(buildingRef.current) : dirty ? setConfirm(true) : onClose())}
            className={cn(ICON_BUTTON, "absolute top-3.5 right-3.5")}
            aria-label="Close"
          >
            <MultipleCrossCancelIcon aria-hidden="true" />
          </button>
        </Hint>
      </section>
    </div>
  );
}

function Chip({ kind, name, preview, warn, onRemove }: { kind: string; name: string; preview?: string | null; warn?: boolean; onRemove: () => void }) {
  return (
    <li className="flex h-7 max-w-[260px] items-center gap-1.5 rounded-[8px] bg-white/[0.07] ps-1 pe-0.5 text-[11.5px] animate-in fade-in zoom-in-95 duration-150">
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local preview of the dropped file
        <img src={preview} alt="" className="size-5 rounded-[4px] bg-white/10 object-cover" />
      ) : null}
      <span className={cn("shrink-0 rounded-[5px] px-1.5 py-0.5 font-medium text-[10.5px]", warn ? "bg-[#f5c26b]/15 text-[#f5c26b]" : "bg-white/[0.08] text-white/65")}>
        {kind}
      </span>
      <span className="min-w-0 truncate text-white/80">{name}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-white/40 outline-none hover:bg-white/[0.1] hover:text-white focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-3"
      >
        <MultipleCrossCancelIcon aria-hidden="true" />
      </button>
    </li>
  );
}

// ─── While Claude builds it ──────────────────────────────────────────────────

type Build = { name: string; text: string; files: File[]; links: SharedLink[] };

const PHASES: Phase[] = [
  { key: "read", label: "Reading what you shared" },
  { key: "links", label: "Looking at the links" },
  { key: "colours", label: "Finding the colours" },
  { key: "fonts", label: "Matching the fonts" },
  { key: "logos", label: "Placing the logos" },
  { key: "rules", label: "Writing the rules" },
  { key: "check", label: "Checking the kit" },
];

// A first guess at the time, from how much was shared (seconds).
const estimate = (b: Build) =>
  50 + b.files.length * 12 + b.links.filter((l) => l.kind !== "drive" && l.kind !== "video").length * 22 + Math.min(60, b.text.length / 80);

function Building({
  build,
  buildingRef,
  onDone,
  onBack,
}: {
  build: Build;
  buildingRef: React.RefObject<string | null>;
  onDone: (kitId: string, reply: string) => void;
  onBack: () => void;
}) {
  const [kitId, setKitId] = useState<string | null>(null);
  const [first, setFirst] = useState<BrandKit | null>(null);
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [line, setLine] = useState("Getting ready");
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [began] = useState(() => Date.now());
  const abort = useRef<AbortController | null>(null);
  const started = useRef(false);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  // Make the kit, bring the files in, then Claude builds it.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const controller = new AbortController();
    abort.current = controller;
    void (async () => {
      let id: string | null = null;
      let reply = "";
      try {
        const made = await brandApi.create(build.name || "New brand");
        id = made.id;
        buildingRef.current = id;
        setKitId(id);
        setFirst(made);
        setKit(made);
        for (const [i, file] of build.files.entries()) {
          setLine(`Bringing in your files (${i + 1} of ${build.files.length})`);
          await brandApi.upload(id, file).catch(() => {});
        }
        setLine("Reading what you shared");
        const prompt = [
          `Make a brand kit from everything I've shared.${build.name ? ` The brand is called ${build.name}.` : " Work out the brand's name from what I shared and use it as the kit's name."}`,
          build.text,
        ]
          .filter(Boolean)
          .join("\n\n");
        let failed: string | null = null;
        await brandApi.chat(
          id,
          { prompt, links: build.links.map((l) => l.url) },
          (event) => {
            if (event.kind === "text") reply += event.text;
            else if (event.kind === "step") {
              setSteps((s) => [...s, event.label]);
              setLine(event.label);
            } else if (event.kind === "error") failed = event.message;
            else if (event.kind === "done") setKit(event.film as unknown as BrandKit);
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (failed) {
          setError(failed);
          return;
        }
        setFinished(true);
        setLine("Done");
        setTimeout(() => done.current(id as string, reply.trim()), 900);
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(e instanceof StudioError ? e.message : "The kit couldn't be made. Try again.");
      }
    })();
  }, [build, buildingRef]);

  // The kit as Claude writes it, so the board fills in live.
  useEffect(() => {
    if (!kitId || finished || error) return;
    const t = setInterval(() => {
      brandApi
        .get(kitId)
        .then(setKit)
        .catch(() => {});
      setNow(Date.now());
    }, 1200);
    return () => clearInterval(t);
  }, [kitId, finished, error]);

  const stop = async () => {
    if (kitId) await brandApi.stop(kitId).catch(() => {});
    abort.current?.abort();
    setError("Stopped. Anything Claude had already written is in the kit.");
  };

  // Which steps are done, from what the kit holds and what Claude is doing.
  const hasLinks = build.links.some((l) => l.kind !== "drive" && l.kind !== "video");
  const phases = PHASES.filter((p) => p.key !== "links" || hasLinks);
  const doneSet = useMemo(() => {
    const d = new Set<string>();
    if (!kit || !first) return d;
    const coloured = JSON.stringify(kit.colors) !== JSON.stringify(first.colors);
    const ruled = Object.values(kit.rules).some((r) => r.length);
    const wrote = steps.includes("Writing the kit") || coloured || ruled;
    if (wrote || steps.some((s) => s !== "Reading what you shared" && s !== "Looking up how to do it" && s !== "Looking at a full kit for reference")) d.add("read");
    if (wrote) d.add("links");
    if (coloured || ruled) d.add("colours");
    if (kit.fonts.length || ruled) d.add("fonts");
    if (kit.logos.length || ruled) d.add("logos");
    if (ruled) d.add("rules");
    if (finished) for (const p of PHASES) d.add(p.key);
    return d;
  }, [kit, first, steps, finished]);
  const current = phases.find((p) => !doneSet.has(p.key));
  const share = phases.filter((p) => doneSet.has(p.key)).length / phases.length;

  const elapsed = (now - began) / 1000;
  const guess = estimate(build);
  const left = finished ? 0 : share > 0.25 ? (elapsed * (1 - share)) / share : Math.max(guess - elapsed, guess * 0.3);
  const leftText = finished
    ? "Done"
    : left < 20
      ? "Almost there"
      : left < 60
        ? "Less than a minute left"
        : Math.round(left / 60) === 1
          ? "About a minute left"
          : `About ${Math.round(left / 60)} minutes left`;

  return (
    <div className="flex flex-col gap-5" aria-live="polite">
      <div className="flex flex-col gap-1 pe-10">
        <h2 className="font-medium text-[15px] text-white/95">{finished ? "Your kit is ready" : "Making the kit"}</h2>
        <p className="text-[12.5px] text-white/50">{error ? "Claude stopped before the end." : leftText}</p>
      </div>

      <div className="grid gap-5 sm:grid-cols-[1fr_220px]">
        <MiniBoard kit={kit} first={first} />
        <ol className="flex flex-col gap-2" aria-label="Steps">
          {phases.map((p) => {
            const isDone = doneSet.has(p.key);
            const isNow = !error && current?.key === p.key;
            return (
              <li key={p.key} className={cn("flex items-center gap-2.5 text-[12.5px] transition-colors duration-300", isDone ? "text-white/80" : isNow ? "text-white" : "text-white/30")}>
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full transition-[background-color,box-shadow] duration-300 [&_svg]:size-4",
                    isDone ? "text-studio" : isNow ? "shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.7)]" : "shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.15)]",
                  )}
                >
                  {isDone ? <CheckTickCircleIcon aria-hidden="true" className="animate-in zoom-in-50 duration-300" /> : isNow ? <span className="size-1.5 animate-pulse rounded-full bg-white" /> : null}
                </span>
                {isNow ? <span className="studio-shimmer">{p.label}</span> : p.label}
              </li>
            );
          })}
        </ol>
      </div>

      {error ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="me-auto text-[12.5px] text-[#ff9592] leading-relaxed">{error}</p>
          <button type="button" onClick={onBack} className={cn(PILL_BUTTON, "text-white/70 hover:bg-white/[0.08] hover:text-white")}>
            Back to what I wrote
          </button>
          {kitId ? (
            <button type="button" onClick={() => onDone(kitId, "")} className={cn(PILL_BUTTON, "bg-studio text-[#1f0612] hover:bg-studio-hover")}>
              Open the kit
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <p className="me-auto h-4 overflow-hidden text-[11.5px]">
            <span key={line} className={cn("block animate-in fade-in slide-in-from-bottom-1 duration-200", finished ? "text-white/60" : "studio-shimmer")}>
              {line}
            </span>
          </p>
          {finished ? null : (
            <button type="button" onClick={() => void stop()} className={cn(PILL_BUTTON, "h-7 text-white/60 hover:bg-white/[0.08] hover:text-white")}>
              Stop
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// The kit taking shape: colours pop in, then the name, the font in its own
// face, and the logo.
function MiniBoard({ kit, first }: { kit: BrandKit | null; first: BrandKit | null }) {
  const font = kit?.fonts.find((f) => f.role === "display") ?? kit?.fonts[0];
  const family = useLiveFont(kit, font?.file ?? null, font?.weights ?? "400");
  const logo = kit?.logos.find((l) => l.on !== "dark") ?? kit?.logos[0];
  const coloured = Boolean(kit && first && JSON.stringify(kit.colors) !== JSON.stringify(first.colors));
  const roles = kit ? Object.entries(kit.colors.roles) : [];
  const ramps = kit?.colors.ramps.slice(0, 3) ?? [];
  const r = kit?.colors.roles;
  return (
    <div className="flex flex-col gap-3 overflow-hidden rounded-[14px] p-4 transition-colors duration-500" style={{ background: coloured && r ? r.surface : "rgba(255,255,255,0.04)" }}>
      <div className="flex min-h-10 items-center justify-between gap-3">
        <span
          key={kit?.name}
          className="truncate text-[22px] leading-tight transition-colors duration-500 animate-in fade-in duration-300"
          style={{ color: coloured && r ? r.ink : "rgba(255,255,255,0.85)", fontFamily: family ? `"${family}", system-ui` : undefined, fontWeight: 600 }}
        >
          {kit && kit.name !== "New brand" ? kit.name : <span className="text-white/25">Name to come</span>}
        </span>
        {logo && kit ? (
          // eslint-disable-next-line @next/next/no-img-element -- the kit's own logo file
          <img key={logo.file} src={brandFile(kit.id, logo.file, kit.updatedAt)} alt="" className="max-h-8 max-w-[45%] object-contain animate-in fade-in zoom-in-95 duration-500" />
        ) : null}
      </div>
      <div className="flex gap-1.5">
        {coloured
          ? roles.map(([key, hex], i) => (
              <span
                key={`${key}-${hex}`}
                title={`${key} ${hex}`}
                className="h-10 flex-1 rounded-[8px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] animate-in fade-in zoom-in-75 fill-mode-both duration-300"
                style={{ background: hex, animationDelay: `${i * 70}ms` }}
              />
            ))
          : Array.from({ length: 7 }, (_, i) => <span key={i} className="h-10 flex-1 rounded-[8px] bg-white/[0.05]" />)}
      </div>
      {ramps.length ? (
        <div className="flex flex-col gap-1">
          {ramps.map((ramp, i) => (
            <div key={`${ramp.name}-${i}`} className="flex h-3 overflow-hidden rounded-[4px] animate-in fade-in slide-in-from-left-2 duration-500">
              {ramp.steps.map((s, j) => (
                <span key={`${s.hex}-${j}`} className="flex-1" style={{ background: s.hex }} />
              ))}
            </div>
          ))}
        </div>
      ) : null}
      <p className="text-[11.5px] transition-colors duration-500" style={{ color: coloured && r ? r.muted : "rgba(255,255,255,0.35)" }}>
        {font ? (
          <span key={font.family} className="animate-in fade-in duration-500" style={{ fontFamily: family ? `"${family}", system-ui` : undefined }}>
            {font.family}
          </span>
        ) : (
          "Fonts to come"
        )}
      </p>
    </div>
  );
}

// Loads the kit's font as soon as it's there, under a name of its own.
function useLiveFont(kit: BrandKit | null, file: string | null, weights: string) {
  const [ready, setReady] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!kit || !file || typeof FontFace === "undefined") return () => {};
    const name = `kitmaker ${kit.id} ${file}`;
    const face = new FontFace(name, `url(${brandFile(kit.id, file)})`, { weight: weights });
    let live = true;
    face
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
        if (live) setReady(name);
      })
      .catch(() => {});
    return () => {
      live = false;
      document.fonts.delete(face);
    };
  }, [kit?.id, file, weights]); // eslint-disable-line react-hooks/exhaustive-deps -- reload only when the font changes
  useEffect(() => load(), [load]);
  return ready;
}
