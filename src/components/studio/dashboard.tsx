"use client";

import { useRef, useState } from "react";
import { MultipleCrossCancelIcon, PlusIcon, UploadUpIcon } from "@/components/icons";
import { DialText } from "@/components/tool/dial";
import type { BrandSummary } from "@/lib/studio/brand";
import type { FilmSummary } from "@/lib/studio/contract";
import { cn } from "@/lib/utils";
import { KIT_ACCEPTS } from "./brand-api";
import { Swatches } from "./brand-row";
import { FirstFilm } from "./first-film";
import { CARD, Hint, ICON_BUTTON, PILL_BUTTON } from "./panel";

// The studio's front page, at /studio: every film, and every brand kit.
// A film opens in the studio; a kit opens on its own page, where it can be
// changed by hand or by Claude. New films start from the same two ways as
// before (edit a video, or describe motion graphics).

type Overlay = null | "film" | "kit-files";

export function Dashboard({
  films,
  kits,
  busy,
  error,
  onOpenFilm,
  onStartFilm,
  onStartVideo,
  onOpenKit,
  onNewKit,
  onImportKit,
  onMakeKit,
}: {
  films: FilmSummary[];
  kits: BrandSummary[] | null;
  busy: boolean;
  error: string | null;
  onOpenFilm: (id: string) => void;
  onStartFilm: (prompt: string | null, width: number, height: number) => void;
  onStartVideo: (files: File[], width: number, height: number) => void;
  onOpenKit: (id: string) => void;
  onNewKit: () => void;
  onImportKit: (file: File) => void;
  onMakeKit: (name: string, files: File[], url: string) => void;
}) {
  const [overlay, setOverlay] = useState<Overlay>(films.length ? null : "film");
  const zip = useRef<HTMLInputElement>(null);

  return (
    <>
      <div className="absolute inset-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-10 px-6 pt-24 pb-16">
          <section aria-labelledby="films-heading" className="flex flex-col gap-3">
            <header className="flex items-center gap-3 px-1">
              <h2 id="films-heading" className="font-medium text-[13px] text-white/90">
                Films
              </h2>
              <span className="font-mono text-[11.5px] text-white/35 tabular-nums">{films.length}</span>
            </header>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              <li className="p-1.5">
                <button
                  type="button"
                  onClick={() => setOverlay("film")}
                  className="flex aspect-video w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-[10px] border border-white/12 border-dashed text-[12.5px] text-white/55 outline-none transition-colors hover:border-white/25 hover:bg-white/[0.03] hover:text-white/85 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <PlusIcon className="size-4" aria-hidden="true" />
                  New film
                </button>
              </li>
              {films.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => onOpenFilm(f.id)}
                    className="group flex w-full cursor-pointer flex-col gap-2 rounded-[14px] p-1.5 text-left outline-none transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-[10px] bg-[#141414] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
                      {f.poster ? (
                        // eslint-disable-next-line @next/next/no-img-element -- a local still of the film
                        <img src={f.poster} alt="" className="max-h-full max-w-full object-contain" />
                      ) : (
                        <span
                          className="rounded-[3px] bg-white/[0.06] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                          style={{ width: f.width >= f.height ? "56%" : `${(f.width / f.height) * 56}%`, aspectRatio: `${f.width} / ${f.height}`, maxHeight: "70%" }}
                        />
                      )}
                    </span>
                    <span className="flex flex-col gap-0.5 px-1 pb-0.5">
                      <span className="truncate text-[12.5px] text-white/90">{f.title}</span>
                      <span className="text-[11.5px] text-white/40">
                        {f.kind === "video" ? "Video edit" : "Motion graphics"} ·{" "}
                        <span className="font-mono tabular-nums">{f.duration.toFixed(1)} s</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="kits-heading" className="flex flex-col gap-3">
            <header className="flex flex-wrap items-center gap-2 px-1">
              <h2 id="kits-heading" className="me-auto font-medium text-[13px] text-white/90">
                Brand kits
              </h2>
              <input
                ref={zip}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                tabIndex={-1}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onImportKit(file);
                  e.target.value = "";
                }}
              />
              <button type="button" disabled={busy} onClick={() => zip.current?.click()} className={cn(PILL_BUTTON, "text-white/70 hover:bg-white/[0.07] hover:text-white")}>
                <UploadUpIcon aria-hidden="true" />
                Import a kit
              </button>
              <button type="button" disabled={busy} onClick={() => setOverlay("kit-files")} className={cn(PILL_BUTTON, "text-white/70 hover:bg-white/[0.07] hover:text-white")}>
                Make a kit from files
              </button>
              <button type="button" disabled={busy} onClick={onNewKit} className={cn(PILL_BUTTON, "bg-white text-[#141414] hover:bg-white/90")}>
                <PlusIcon aria-hidden="true" />
                New kit
              </button>
            </header>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
              {(kits ?? []).map((k) => (
                <li key={k.id}>
                  <KitCard kit={k} onOpen={() => onOpenKit(k.id)} />
                </li>
              ))}
            </ul>
            {kits === null ? <p className="px-1 text-[12px] text-white/40">Loading kits…</p> : null}
          </section>
          {error ? <p className="px-1 text-[12px] text-[#ff9592] leading-relaxed">{error}</p> : null}
        </div>
      </div>

      {/* Top: the studio's name. */}
      <div className={cn(CARD, "pointer-events-auto absolute top-4 left-4 flex h-11 items-center gap-2 rounded-[14px] px-4")}>
        <h1 className="font-medium text-[12.5px] text-white/90">Motion studio</h1>
      </div>

      {overlay ? (
        <div className="absolute inset-0 z-10 bg-black/55 backdrop-blur-[2px]">
          {overlay === "film" ? (
            <FirstFilm busy={busy} error={error} onStart={onStartFilm} onStartVideo={onStartVideo} />
          ) : (
            <MakeKit busy={busy} onMake={onMakeKit} />
          )}
          {overlay === "kit-files" || films.length ? (
            <Hint label="Close">
              <button type="button" onClick={() => setOverlay(null)} className={cn(CARD, ICON_BUTTON, "absolute top-4 right-4 size-11 rounded-[14px]")} aria-label="Close">
                <MultipleCrossCancelIcon aria-hidden="true" />
              </button>
            </Hint>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

// A kit as a card: its logo on its own surface, its colours as lines.
function KitCard({ kit, onOpen }: { kit: BrandSummary; onOpen: () => void }) {
  const [background, surface] = kit.swatches;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full cursor-pointer flex-col gap-2 rounded-[14px] p-1.5 text-left outline-none transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex aspect-[16/9] w-full flex-col overflow-hidden rounded-[10px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]" style={{ background: surface }}>
        <span className="flex flex-1 items-center justify-center p-6">
          {kit.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- the kit's own logo file
            <img src={kit.logo} alt="" className="max-h-9 max-w-[70%] object-contain" />
          ) : (
            <span className="text-[13px]" style={{ color: kit.swatches[2] }}>
              {kit.name}
            </span>
          )}
        </span>
        {/* The kit's colours as a run of lines, like the line field. */}
        <span className="flex h-9 flex-col justify-end gap-[3px] px-0 pb-0" style={{ background }} aria-hidden="true">
          {kit.swatches.map((c, i) => (
            <span key={`${c}-${i}`} className="h-[5px]" style={{ background: c, marginLeft: `${i * 18}%` }} />
          ))}
        </span>
      </span>
      <span className="flex items-center gap-2 px-1 pb-0.5">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[12.5px] text-white/90">{kit.name}</span>
          <span className="truncate text-[11.5px] text-white/40">{kit.font ?? "No fonts yet"}</span>
        </span>
        <Swatches colors={kit.swatches} className="h-4" />
      </span>
    </button>
  );
}

// Drop a guideline (PDF, screenshots) with logos and fonts, maybe a
// website; Claude builds the kit from them.
function MakeKit({ busy, onMake }: { busy: boolean; onMake: (name: string, files: File[], url: string) => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  // Copied at once: the picker empties its live list right after.
  const add = (list: FileList | null) => {
    const picked = [...(list ?? [])];
    setFiles((f) => [...f, ...picked].slice(0, 40));
  };
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <section aria-labelledby="make-kit" className={cn(CARD, "flex w-full max-w-[540px] flex-col gap-4 p-5")}>
        <div className="flex flex-col gap-1.5">
          <h2 id="make-kit" className="font-medium text-[15px] text-white/95">
            Make a kit from files
          </h2>
          <p className="text-[12.5px] text-white/55 leading-relaxed">
            Drop the brand’s guideline (a PDF or screenshots), its logos and its font files. Claude reads them and fills in
            the kit: colours, type, logos and rules. You can change anything afterwards.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <DialText label="Brand name" value={name} placeholder="Acme" onChange={setName} />
          <DialText label="Website (optional)" value={url} placeholder="https://acme.com/brand" onChange={setUrl} />
        </div>
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
        {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target; the button inside it is the keyboard way in */}
        <div
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            add(e.dataTransfer.files);
          }}
          className={cn(
            "flex min-h-32 flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed p-4 text-center transition-colors",
            over ? "border-white/50 bg-white/[0.07]" : "border-white/15 bg-white/[0.02]",
          )}
        >
          {files.length ? (
            <ul className="flex w-full flex-col gap-1 text-left">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-[12px] text-white/70">
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="font-mono text-[11px] text-white/35 tabular-nums">{Math.max(1, Math.round(f.size / 1024))} KB</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-white/60">Drop a guideline, logos and fonts here</p>
          )}
          <button type="button" onClick={() => picker.current?.click()} className={cn(PILL_BUTTON, "mt-1 text-white/70 hover:bg-white/[0.07] hover:text-white")}>
            <UploadUpIcon aria-hidden="true" />
            {files.length ? "Add more files" : "Choose files"}
          </button>
        </div>
        <button
          type="button"
          disabled={busy || (!files.length && !url.trim())}
          onClick={() => onMake(name.trim() || "New brand", files, url.trim())}
          className={cn(PILL_BUTTON, "self-end bg-white text-[#141414] hover:bg-white/90")}
        >
          Make the kit
        </button>
      </section>
    </div>
  );
}
