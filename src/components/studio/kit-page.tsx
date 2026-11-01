"use client";

import { Popover } from "@base-ui/react/popover";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
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
  UploadUpIcon,
} from "@/components/icons";
import { Spinner } from "@/components/ui/spinner";
import { DialButton, DialGroup, DialNote, DialSlider, DialText, LABEL, ROW, SURFACE } from "@/components/tool/dial";
import type { BrandFont, BrandKit, BrandLogo, ColorRoles } from "@/lib/studio/brand";
import type { ChatMessage } from "@/lib/studio/contract";
import { cn } from "@/lib/utils";
import { StudioError } from "./api";
import { brandApi, brandFile, FONT_FILE, KIT_ACCEPTS, LOGO_FILE } from "./brand-api";
import { ColorRow } from "./color-row";
import { undoKey } from "./history";
import { Choice } from "./inspector";
import { CARD, Hint, ICON_BUTTON, PANEL_MOTION, PILL_BUTTON, Panel } from "./panel";
import { PromptBox } from "./prompt-box";

// A brand kit's own page, at /studio?brand=<id>. The kit is laid out as a
// specimen board (colours, type, logos, line texture, rules, notes); the
// panels float over it: Claude on the left, the kit's settings on the right.
// Every change shows at once and saves a moment later; ⌘Z undoes it.

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
  onHome,
  onOpenKit,
  onGone,
}: {
  id: string;
  openingRef: React.RefObject<{ prompt: string; url: string } | null>;
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
      setNote(e instanceof StudioError ? e.message : "The kit couldn't be saved.");
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
    async (files: File[]) => {
      if (!files.length) return;
      await flush();
      const added: { font: string[]; logo: string[] } = { font: [], logo: [] };
      for (const [i, file] of files.entries()) {
        setUploading(`Adding ${file.name} (${i + 1} of ${files.length})`);
        try {
          const { file: path } = await brandApi.upload(id, file);
          if (path.startsWith("fonts/") && FONT_FILE.test(path)) added.font.push(path);
          else if (path.startsWith("logos/") && LOGO_FILE.test(path)) added.logo.push(path);
        } catch (e) {
          setNote(e instanceof StudioError ? e.message : `${file.name} couldn't be added.`);
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
          <p className="font-medium text-[14px] text-white/90">This kit isn’t here any more</p>
          <button type="button" onClick={onHome} className={cn(PILL_BUTTON, "bg-white text-[#141414] hover:bg-white/90")}>
            Back to the studio
          </button>
        </div>
      </div>
    );
  }
  if (!kit) return null;

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
      <Board kit={kit} version={version} hidden={hidden} folded={folded} />

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
const fontName = (kit: BrandKit, family: string) => `kit ${kit.id} ${family}`;

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

// ─── The specimen board ───────────────────────────────────────────────────────

function Board({ kit, version, hidden, folded }: { kit: BrandKit; version: string; hidden: boolean; folded: { chat: boolean; kit: boolean } }) {
  const r = kit.colors.roles;
  const display = kit.fonts.find((f) => f.role === "display") ?? kit.fonts[0];
  const text = kit.fonts.find((f) => f.role === "text") ?? display;
  const family = (f: BrandFont | undefined) => (f ? `"${fontName(kit, f.family)}", system-ui` : "system-ui");
  const left = hidden || folded.chat ? 24 : 372;
  const right = hidden || folded.kit ? 24 : 352;
  return (
    <div className="absolute inset-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex flex-col gap-12 pt-24 pb-24 transition-[padding] duration-300" style={{ paddingLeft: left, paddingRight: right }}>
        <header className="flex flex-col gap-2">
          <p className="text-[12px] text-white/40">Brand kit</p>
          <h1 className="text-[56px] text-white leading-none" style={{ fontFamily: family(display), fontWeight: 600 }}>
            {kit.name}
          </h1>
          {kit.source ? <p className="max-w-[640px] text-[12.5px] text-white/45 leading-relaxed">{kit.source}</p> : null}
        </header>

        <Section title="Colour roles">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
            {ROLES.map((role) => (
              <div key={role.key} className="flex flex-col overflow-hidden rounded-[12px] bg-white/[0.04]">
                <div className="h-24" style={{ background: r[role.key] }} />
                <div className="flex flex-col gap-0.5 p-2.5">
                  <span className="text-[12px] text-white/85">{role.label}</span>
                  <span className="font-mono text-[11px] text-white/45 tabular-nums">{r[role.key]}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {kit.colors.ramps.length ? (
          <Section title="Colour ramps">
            <div className="flex flex-col gap-4">
              {kit.colors.ramps.map((ramp, i) => (
                <div key={`${ramp.name}-${i}`} className="flex flex-col gap-1.5">
                  <span className="text-[12px] text-white/70">{ramp.name}</span>
                  <div className="flex overflow-hidden rounded-[10px]">
                    {ramp.steps.map((s, j) => (
                      <div key={`${s.hex}-${j}`} className="group relative h-14 flex-1" style={{ background: s.hex }} title={`${s.name} ${s.hex}`}>
                        <span className="absolute inset-x-0 bottom-1 hidden text-center font-mono text-[9.5px] text-white mix-blend-difference group-hover:block">
                          {s.hex}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        <Section title="Type">
          {kit.fonts.length ? (
            <div className="flex flex-col gap-3">
              {kit.fonts.map((f, i) => (
                <div key={`${f.file}-${f.role}-${i}`} className="flex flex-col gap-3 rounded-[14px] p-5" style={{ background: r.surface, color: r.ink }}>
                  <span className="text-[11.5px] opacity-60" style={{ fontFamily: "system-ui" }}>
                    {f.family} · {f.role === "display" ? "Display" : f.role === "text" ? "Text" : "Mono"} · weights {f.weights}
                  </span>
                  <span className="text-[64px] leading-none" style={{ fontFamily: family(f), fontWeight: f.role === "display" ? 600 : 400 }}>
                    Aa Bb Cc 0123
                  </span>
                  <span className="max-w-[720px] text-[18px] leading-snug" style={{ fontFamily: family(f) }}>
                    Every rate, risk and approval, scattered, until one moment resolves them.
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <Empty>No fonts yet. Drop font files anywhere on this page.</Empty>
          )}
        </Section>

        <Section title="Logos">
          {kit.logos.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2">
              {kit.logos.map((l, i) => (
                <div key={`${l.file}-${i}`} className="flex flex-col overflow-hidden rounded-[12px] bg-white/[0.04]">
                  <div className="grid h-32 grid-cols-2">
                    {(["light", "dark"] as const).map((ground) => (
                      <div
                        key={ground}
                        className={cn("flex items-center justify-center p-5", l.on !== "any" && l.on !== ground && "opacity-25")}
                        style={{ background: ground === "light" ? r.surface : r.background }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- the kit's own logo file */}
                        <img src={brandFile(kit.id, l.file, version)} alt="" className="max-h-full max-w-full object-contain" />
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 p-2.5">
                    <span className="min-w-0 flex-1 truncate text-[12px] text-white/85">{l.name}</span>
                    <span className="text-[11px] text-white/40">{l.on === "any" ? "Any ground" : l.on === "light" ? "Light grounds" : "Dark grounds"}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty>No logos yet. Drop SVG or PNG logos anywhere on this page.</Empty>
          )}
        </Section>

        {kit.texture ? (
          <Section title="Line texture">
            <div className="flex flex-col gap-2">
              <LineField kit={kit} />
              <p className="text-[12px] text-white/45">
                <span className="font-mono tabular-nums">
                  {kit.texture.stroke} px lines, {kit.texture.gap} px gaps
                </span>
                {kit.texture.note ? ` · ${kit.texture.note}` : null}
              </p>
            </div>
          </Section>
        ) : null}

        <Section title="Rules">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
            {RULES.map((group) => (
              <div key={group.key} className="flex flex-col gap-2">
                <span className="text-[12px] text-white/70">{group.label}</span>
                {kit.rules[group.key].length ? (
                  <ol className="flex flex-col gap-1.5">
                    {kit.rules[group.key].map((rule, i) => (
                      <li key={`${i}-${rule.slice(0, 12)}`} className="flex gap-2 text-[12.5px] text-white/75 leading-relaxed">
                        <span className="w-4 shrink-0 font-mono text-[11px] text-white/30 tabular-nums">{i + 1}</span>
                        {rule}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-[12px] text-white/35">None yet.</p>
                )}
              </div>
            ))}
          </div>
        </Section>

        {kit.notes ? (
          <Section title="Guideline">
            <Notes text={kit.notes} fontFamily={family(text)} />
          </Section>
        ) : null}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium text-[13px] text-white/90">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-[12px] bg-white/[0.03] px-4 py-6 text-[12.5px] text-white/45">{children}</p>;
}

// The kit's line field: its texture in its line and accent colours, the
// accent arriving from the right as a staircase.
function LineField({ kit }: { kit: BrandKit }) {
  const t = kit.texture;
  if (!t) return null;
  const r = kit.colors.roles;
  const W = 960;
  const pitch = t.stroke + t.gap;
  const rows = Math.max(6, Math.floor(180 / pitch));
  const field = (hex: string) => t.fields?.[hex.toUpperCase()] ?? { lit: hex, gap: r.background };
  const accent = field(r.accent);
  return (
    <svg viewBox={`0 0 ${W} ${rows * pitch}`} className="w-full max-w-[960px] overflow-hidden rounded-[12px]" role="img" aria-label="The kit's line texture">
      <rect width={W} height={rows * pitch} fill={r.background} />
      {Array.from({ length: rows }, (_, i) => {
        const y = i * pitch;
        const from = W - Math.round(((rows - i) / rows) * W * 0.6);
        return (
          <g key={i}>
            <rect y={y + t.gap / 2} width={W} height={t.stroke} fill={r.line} />
            <rect x={from} y={y} width={W - from} height={pitch} fill={accent.gap} />
            <rect x={from} y={y + t.gap / 2} width={W - from} height={t.stroke} fill={accent.lit} />
          </g>
        );
      })}
    </svg>
  );
}

// The guideline in Markdown: headings, lists and paragraphs, nothing more.
function Notes({ text, fontFamily }: { text: string; fontFamily: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="flex list-disc flex-col gap-1 ps-5">
        {list.map((l, i) => (
          <li key={i}>{inline(l)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flushList();
      continue;
    }
    if (/^[-*] /.test(line)) {
      list.push(line.slice(2));
      continue;
    }
    flushList();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const size = h[1].length === 1 ? "text-[20px]" : h[1].length === 2 ? "text-[16px]" : "text-[14px]";
      blocks.push(
        <p key={`h-${blocks.length}`} className={cn("pt-3 font-medium text-white/90", size)}>
          {h[2]}
        </p>,
      );
    } else blocks.push(<p key={`p-${blocks.length}`}>{inline(line)}</p>);
  }
  flushList();
  return (
    <div className="flex max-w-[760px] flex-col gap-2.5 text-[13.5px] text-white/70 leading-relaxed" style={{ fontFamily }}>
      {blocks}
    </div>
  );
}

// **bold** inside a line.
function inline(line: string) {
  return line.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-white/90">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
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
        "pointer-events-auto absolute top-4 left-4 z-10 flex h-11 max-w-[420px] items-center gap-1 rounded-[14px] ps-1.5 pe-1.5",
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
            <Popover.Popup className={cn(SURFACE, POPUP, "flex w-[260px] flex-col gap-0.5 p-1.5")}>
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
                    Duplicate this kit
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
                    Delete this kit
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
  onUpload: (files: File[]) => Promise<void>;
  uploading: string | null;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const r = kit.colors.roles;
  return (
    <>
      <input
        ref={picker}
        type="file"
        multiple
        accept={KIT_ACCEPTS}
        className="hidden"
        tabIndex={-1}
        onChange={(e) => {
          void onUpload([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
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
              onChange={(name) => change(`Ramp ${ri} name`, (k) => ({ ...k, colors: { ...k.colors, ramps: k.colors.ramps.map((x, i) => (i === ri ? { ...x, name } : x)) } }))}
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
                  change("Add a step", (k) => ({
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
                onClick={() => change("Remove a ramp", (k) => ({ ...k, colors: { ...k.colors, ramps: k.colors.ramps.filter((_, i) => i !== ri) } }))}
              >
                Remove ramp
              </DialButton>
            </div>
          </DialGroup>
        ))}
        <DialButton
          onClick={() =>
            change("Add a ramp", (k) => ({
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
            <DialText label="Family" value={f.family} onChange={(family) => change(`Font ${fi} family`, (k) => ({ ...k, fonts: k.fonts.map((x, i) => (i === fi ? { ...x, family } : x)) }))} />
            <Choice
              label="Use"
              value={f.role}
              options={[
                { value: "display", label: "Display" },
                { value: "text", label: "Text" },
                { value: "mono", label: "Mono" },
              ]}
              onChange={(role) => change(`Font ${fi} use`, (k) => ({ ...k, fonts: k.fonts.map((x, i) => (i === fi ? { ...x, role: role as BrandFont["role"] } : x)) }))}
            />
            <DialText
              label="Weights"
              value={f.weights}
              placeholder="400 or 200 800"
              onChange={(weights) => change(`Font ${fi} weights`, (k) => ({ ...k, fonts: k.fonts.map((x, i) => (i === fi ? { ...x, weights } : x)) }))}
            />
            <RemoveRow label={f.file.replace(/^fonts\//, "")} onRemove={() => change("Remove a font", (k) => ({ ...k, fonts: k.fonts.filter((_, i) => i !== fi) }))} />
          </div>
        ))}
        {!kit.fonts.length ? <DialNote>Drop font files (TTF, OTF, WOFF) on the page, or choose them below.</DialNote> : null}
      </DialGroup>

      <DialGroup title="Logos">
        {kit.logos.map((l, li) => (
          <div key={`${l.file}-${li}`} className="flex flex-col gap-1.5 rounded-[12px] bg-white/[0.02] p-1">
            <DialText label="Name" value={l.name} onChange={(name) => change(`Logo ${li} name`, (k) => ({ ...k, logos: k.logos.map((x, i) => (i === li ? { ...x, name } : x)) }))} />
            <Choice
              label="Kind"
              value={l.kind}
              options={[
                { value: "wordmark", label: "Wordmark" },
                { value: "mark", label: "Mark" },
                { value: "lockup", label: "Lockup" },
              ]}
              onChange={(kind) => change(`Logo ${li} kind`, (k) => ({ ...k, logos: k.logos.map((x, i) => (i === li ? { ...x, kind: kind as BrandLogo["kind"] } : x)) }))}
            />
            <Choice
              label="For"
              value={l.on}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "any", label: "Any" },
              ]}
              onChange={(on) => change(`Logo ${li} ground`, (k) => ({ ...k, logos: k.logos.map((x, i) => (i === li ? { ...x, on: on as BrandLogo["on"] } : x)) }))}
            />
            <RemoveRow label={l.file.replace(/^logos\//, "")} onRemove={() => change("Remove a logo", (k) => ({ ...k, logos: k.logos.filter((_, i) => i !== li) }))} />
          </div>
        ))}
        {!kit.logos.length ? <DialNote>Drop SVG or PNG logos on the page, or choose them below.</DialNote> : null}
      </DialGroup>

      <DialButton loading={!!uploading} onClick={() => picker.current?.click()}>
        <UploadUpIcon aria-hidden="true" />
        Add fonts, logos or a guideline
      </DialButton>

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
            <DialButton onClick={() => change("No line texture", (k) => ({ ...k, texture: undefined }))}>This brand has no line texture</DialButton>
          </>
        ) : (
          <DialButton onClick={() => change("Line texture", (k) => ({ ...k, texture: { stroke: 8, gap: 4 } }))}>Give the brand a line texture</DialButton>
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
              onRemove={() => change(`Remove a ${group.label.toLowerCase()} rule`, (k) => ({ ...k, rules: { ...k.rules, [group.key]: k.rules[group.key].filter((_, j) => j !== i) } }))}
            />
          ))}
          <DialButton onClick={() => change(`Add a ${group.label.toLowerCase()} rule`, (k) => ({ ...k, rules: { ...k.rules, [group.key]: [...k.rules[group.key], ""] } }))}>
            <PlusIcon aria-hidden="true" />
            Add a rule
          </DialButton>
        </DialGroup>
      ))}
    </>
  );
}

function RemoveRow({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <div className={cn(ROW, "ps-3 pe-1")}>
      <span className={cn(LABEL, "min-w-0 truncate font-mono text-[11px] text-white/40")}>{label}</span>
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
      <span className="pt-0.5 font-mono text-[11px] text-white/35 tabular-nums">{n}</span>
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
  const abort = useRef<AbortController | null>(null);
  const kitCallback = useRef(onKit);
  useEffect(() => {
    kitCallback.current = onKit;
  });

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async (first: boolean) => {
      const h = await brandApi.history(id);
      if (!live) return;
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
    async (prompt: string, url: string) => {
      const words = prompt.trim();
      if (!words || abort.current) return;
      const controller = new AbortController();
      abort.current = controller;
      setMessages((m) => [...m, { role: "you", text: url ? `${words}\n\n${url}` : words, at: new Date().toISOString() }]);
      setTurn({ ...IDLE, running: true });
      let text = "";
      let steps: string[] = [];
      try {
        await brandApi.chat(
          id,
          { prompt: words, ...(url ? { url } : {}) },
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

  return { messages, turn, running: turn.running, send, stop, undo };
}

const KIT_IDEAS = ["Tidy the rules into short sentences", "Write the motion rules for this brand", "Fill in the colour ramps from the logo"];

function KitChat({
  chat,
  folded,
  onFold,
  hidden,
  openingRef,
  beforeSend,
}: {
  chat: ReturnType<typeof useKitChat>;
  folded: boolean;
  onFold: (f: boolean) => void;
  hidden: boolean;
  openingRef: React.RefObject<{ prompt: string; url: string } | null>;
  beforeSend: () => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [url, setUrl] = useState("");
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

  const send = async () => {
    const words = draft;
    setDraft("");
    await beforeSend();
    void chat.send(words, url.trim());
  };
  const step = turn.steps.at(-1) ?? "Reading the kit";

  return (
    <Panel
      title="Claude"
      folded={folded}
      onFold={onFold}
      hidden={hidden}
      className="top-[68px] bottom-4 left-4 w-[340px]"
      pillClassName="top-[68px] left-4"
      bodyClassName="flex flex-col"
    >
      <div ref={list} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {!messages.length && !turn.running ? (
          <div className="flex flex-col gap-2.5">
            <p className="text-[12.5px] text-white/55 leading-relaxed">
              Ask Claude to build or tidy this kit. It reads the files you add (a guideline PDF, screenshots, logos, fonts)
              and, if you give one, the brand’s website.
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
            <p key={`${m.at}-${i}`} className="ms-8 self-end whitespace-pre-wrap break-words rounded-[12px] rounded-br-[4px] bg-white/[0.09] px-3 py-2 text-[12.5px] text-white/90 leading-relaxed">
              {m.text}
            </p>
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
      </div>
      <div className="flex shrink-0 flex-col gap-1.5 px-2 pb-2">
        <DialText label="Website" value={url} placeholder="Optional" onChange={setUrl} />
        <PromptBox value={draft} onChange={setDraft} onSend={() => void send()} onStop={chat.stop} running={turn.running} placeholder="Make the motion rules calmer" />
      </div>
    </Panel>
  );
}
