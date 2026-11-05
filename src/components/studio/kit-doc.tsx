"use client";

import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { CheckTickCircleIcon, CopyIcon, MultipleCrossCancelIcon, PencilEditIcon, PlusIcon } from "@/components/icons";
import type { BrandFont, BrandKit, ColorRoles } from "@/lib/studio/brand";
import { cn } from "@/lib/utils";
import { brandFile } from "./brand-api";
import { ColorRow } from "./color-row";
import { CARD } from "./panel";
import { useOutsideClose } from "./use-outside";

// A brand kit set as a brand book: a light page in a comfortable reading
// column, numbered sections with a contents bar that follows along,
// colours as swatches (click to copy), Do and Don't cards, the fonts as
// live specimens and the logos on their grounds, and the long guideline as
// properly set Markdown. The book's own type is the system font; the
// brand's fonts appear only in its specimens. Each section opens in place
// to edit, and Claude's changes show as they land.

type Change = (label: string, fn: (k: BrandKit) => BrandKit) => void;

// Each of the kit's fonts loads under its own name, so two kits with a font
// of the same name never mix.
export const fontName = (kit: BrandKit, family: string) => `kit ${kit.id} ${family}`;

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

// Rules that say what never to do read as Don'ts; short absolute ones
// ("once", "never", "always", "only") are the key rules, set as callouts.
const isDont = (rule: string) => /^(don['’]?t|never|no\b|avoid|not\b)/i.test(rule.trim());
const isKey = (rule: string) => rule.length <= 110 && /\b(once|never|always|only)\b/i.test(rule);

type Section = { id: string; n: string; title: string };

export function KitDoc({
  kit,
  version,
  left,
  right,
  arrival,
  onDismissArrival,
  change,
  onCopy,
  onOpenPanel,
}: {
  kit: BrandKit;
  version: string;
  left: number;
  right: number;
  arrival: string | null;
  onDismissArrival: () => void;
  change: Change;
  onCopy: (hex: string) => void;
  onOpenPanel: (group: string) => void;
}) {
  const r = kit.colors.roles;
  const family = (f: BrandFont | undefined) => (f ? `"${fontName(kit, f.family)}", system-ui` : "system-ui");
  const [editing, setEditing] = useState<string | null>(null);
  // The swatch just copied shows a tick for a moment.
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1400);
    return () => clearTimeout(t);
  }, [copied]);
  const scroller = useRef<HTMLDivElement>(null);

  // The "- guide/<file>" lines list pictures for Claude to look at; the page
  // leaves them out rather than show a list of file names.
  const { guide } = useMemo(() => {
    const picture = /^\s*-\s*(guide\/[^\s]+\.(?:jpe?g|png|webp))\s*$/i;
    const lines = (kit.notes ?? "").split("\n");
    const found = lines.map((l) => l.match(picture)?.[1]).filter((f): f is string => Boolean(f));
    const kept = lines.filter((l) => !picture.test(l)).join("\n").replace(/\n#+ [^\n]*\n*$/, "\n");
    return { guide: parseMarkdown(found.length ? kept : (kit.notes ?? "")) };
  }, [kit.notes]);
  const sections = useMemo(() => {
    const list: Omit<Section, "n">[] = [
      { id: "colour", title: "Colour" },
      { id: "type", title: "Type" },
      { id: "logos", title: "Logos" },
      ...(kit.texture ? [{ id: "texture", title: "Line texture" }] : []),
      { id: "rules", title: "Rules" },
      ...(kit.notes?.trim() ? [{ id: "guideline", title: "Guideline" }] : []),
    ];
    return list.map((s, i) => ({ ...s, n: String(i + 1).padStart(2, "0") }));
  }, [kit.texture, kit.notes]);
  const active = useActiveSection(scroller, sections.map((s) => s.id));

  const go = (id: string) => {
    const el = scroller.current?.querySelector(`#kit-${id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div ref={scroller} className="absolute inset-0 overflow-y-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex flex-col pt-[72px] pb-24 transition-[padding] duration-300" style={{ paddingLeft: left, paddingRight: right }}>
        {/* Contents: follows along, the section being read is lit. */}
        <nav aria-label="Contents" className="sticky top-4 z-10 mx-auto mb-4 max-w-full">
          <ol className={cn(CARD, "flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden")}>
            {sections.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => go(s.id)}
                  aria-current={active === s.id ? "true" : undefined}
                  className={cn(
                    "flex h-7 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    active === s.id ? "bg-white/[0.14] text-white" : "text-white/50 hover:text-white/85",
                  )}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <article className="mx-auto w-full max-w-[880px] rounded-[20px] bg-[#161616] px-[clamp(20px,6vw,64px)] py-14 text-white/90 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_30px_80px_-30px_rgba(0,0,0,0.7)]">
          <header className="mx-auto flex max-w-[68ch] flex-col gap-3 pb-10">
            <h1 className="font-semibold text-[44px] leading-[1.05] tracking-[-0.02em]">{kit.name}</h1>
            {kit.source ? <p className="text-[14px] text-white/60 leading-relaxed">{kit.source}</p> : null}
            {arrival ? <Arrival text={arrival} onDismiss={onDismissArrival} onCopy={onCopy} /> : null}
          </header>

          {/* 01 Colour */}
          <DocSection id="colour" title="Colour" onEdit={() => setEditing(editing === "colour" ? null : "colour")} editing={editing === "colour"}>
            {editing === "colour" ? (
              <EditTray onDone={() => setEditing(null)} note="Ramps are in the Kit panel on the right.">
                {ROLES.map((role) => (
                  <ColorRow key={role.key} label={role.label} value={r[role.key]} onChange={(hex) => change(role.label, (k) => ({ ...k, colors: { ...k.colors, roles: { ...k.colors.roles, [role.key]: hex } } }))} />
                ))}
              </EditTray>
            ) : null}
            <h3 className="font-medium text-[15px]">Roles</h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
              {ROLES.map((role) => (
                <button
                  key={role.key}
                  type="button"
                  onClick={() => {
                    onCopy(r[role.key]);
                    setCopied(role.key);
                  }}
                  className="group relative flex cursor-pointer flex-col overflow-hidden rounded-[12px] bg-white/[0.04] text-left shadow-[0_0_0_1px_rgba(255,255,255,0.07)] outline-none transition-shadow hover:shadow-[0_0_0_1px_rgba(255,255,255,0.14)] focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`${role.label} ${r[role.key]}, copy`}
                >
                  <span className="h-20 shadow-[inset_0_-1px_0_rgba(255,255,255,0.05)]" style={{ background: r[role.key] }} />
                  {/* Copy, in the swatch's top right corner, shown on hover. */}
                  <span
                    className={cn(
                      "absolute top-2 right-2 grid size-7 place-items-center rounded-[8px] bg-black/45 text-white/90 backdrop-blur-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 [&_svg]:col-start-1 [&_svg]:row-start-1 [&_svg]:size-3.5 [&_svg]:transition-[opacity,scale,filter] [&_svg]:duration-200 [&_svg]:ease-out",
                      copied === role.key ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden="true"
                  >
                    {/* Copy turns into a tick once the code is copied. */}
                    <CopyIcon className={copied === role.key ? "scale-50 opacity-0 blur-[2px]" : "scale-100 opacity-100 blur-0"} />
                    <CheckTickCircleIcon className={copied === role.key ? "scale-100 opacity-100 blur-0" : "scale-50 opacity-0 blur-[2px]"} />
                  </span>
                  <span className="flex flex-col gap-0.5 p-3">
                    <span className="font-medium text-[13px]">{role.label}</span>
                    <span className="text-[11.5px] text-[#706b62] tabular-nums">
                      {r[role.key]}
                    </span>
                    <span className="text-[11.5px] text-white/45 leading-snug">{role.note}</span>
                  </span>
                </button>
              ))}
            </div>
            {kit.colors.ramps.length ? (
              <>
                <h3 className="pt-4 font-medium text-[15px]">Ramps</h3>
                <div className="flex flex-col gap-4">
                  {kit.colors.ramps.map((ramp, i) => (
                    <div key={`${ramp.name}-${i}`} className="flex flex-col gap-1.5">
                      <p className="text-[13px] text-white/60">
                        {ramp.name} <span className="text-white/35">· {ramp.steps.length} steps, light to dark</span>
                      </p>
                      <div className="flex overflow-hidden rounded-[10px] shadow-[0_0_0_1px_rgba(255,255,255,0.07)]">
                        {ramp.steps.map((s, j) => (
                          <button
                            key={`${s.hex}-${j}`}
                            type="button"
                            onClick={() => onCopy(s.hex)}
                            title={`${s.name} ${s.hex}, click to copy`}
                            aria-label={`${s.name} ${s.hex}, copy`}
                            className="group relative h-14 flex-1 cursor-pointer outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring"
                            style={{ background: s.hex }}
                          >
                            <span className="absolute inset-x-0 bottom-1 hidden text-center tabular-nums text-[9.5px] text-white mix-blend-difference group-hover:block group-focus-visible:block">
                              {s.hex.replace("#", "")}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </DocSection>

          {/* 02 Type */}
          <DocSection id="type" title="Type" onEdit={() => onOpenPanel("Fonts")}>
            {kit.fonts.length ? (
              <div className="flex flex-col gap-4">
                {kit.fonts.map((f, i) => (
                  <figure key={`${f.file}-${f.role}-${i}`} className="flex flex-col gap-4 overflow-hidden rounded-[16px] bg-white/[0.04] p-6 text-white/90 shadow-[0_0_0_1px_rgba(255,255,255,0.07)]">
                    <figcaption className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12px] text-white/45" style={{ fontFamily: "system-ui" }}>
                      <span className="font-medium">{f.family}</span>
                      <span>{f.role === "display" ? "Display" : f.role === "text" ? "Text" : "Mono"}</span>
                      <span className="tabular-nums">weights {f.weights}</span>
                      {f.licence ? <span>{f.licence}</span> : null}
                    </figcaption>
                    <span className="text-[clamp(44px,7vw,72px)] leading-none" style={{ fontFamily: family(f), fontWeight: f.role === "display" ? 600 : 400 }}>
                      Aa Bb Cc 0123
                    </span>
                    <span className="max-w-[34ch] text-[22px] leading-snug" style={{ fontFamily: family(f) }}>
                      Every rate, risk and approval, scattered, until one moment resolves them.
                    </span>
                  </figure>
                ))}
              </div>
            ) : (
              <Empty>No fonts yet. Drop font files anywhere on this page.</Empty>
            )}
          </DocSection>

          {/* 03 Logos */}
          <DocSection id="logos" title="Logos" onEdit={() => onOpenPanel("Logos")}>
            {kit.logos.length ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
                {kit.logos.map((l, i) => (
                  <figure key={`${l.file}-${i}`} className="flex flex-col overflow-hidden rounded-[14px] bg-white/[0.04] shadow-[0_0_0_1px_rgba(255,255,255,0.07)]">
                    <div className="grid h-36 grid-cols-2">
                      {(["light", "dark"] as const).map((ground) => (
                        <div
                          key={ground}
                          className={cn("flex items-center justify-center p-6", l.on !== "any" && l.on !== ground && "opacity-25")}
                          style={{ background: ground === "light" ? r.surface : r.background }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- the kit's own logo file */}
                          <img src={brandFile(kit.id, l.file, version)} alt="" className="max-h-full max-w-full object-contain" />
                        </div>
                      ))}
                    </div>
                    <figcaption className="flex items-center gap-2 p-3">
                      <span className="min-w-0 flex-1 truncate font-medium text-[13px]">{l.name}</span>
                      <span className="text-[12px] text-white/45">{l.on === "any" ? "Any ground" : l.on === "light" ? "For light grounds" : "For dark grounds"}</span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <Empty>No logos yet. Drop SVG or PNG logos anywhere on this page.</Empty>
            )}
          </DocSection>

          {/* 04 Line texture */}
          {kit.texture ? (
            <DocSection id="texture" title="Line texture" onEdit={() => onOpenPanel("Line texture")}>
              <LineField kit={kit} />
              <p className="text-[14px] text-white/60 leading-relaxed">
                <span className="text-[13px] tabular-nums">
                  {kit.texture.stroke} px lines, {kit.texture.gap} px gaps
                </span>
                {kit.texture.note ? `. ${kit.texture.note}` : null}
              </p>
            </DocSection>
          ) : null}

          {/* 05 Rules */}
          <DocSection id="rules" title="Rules">
            {RULES.map((group) => (
              <RuleGroup
                key={group.key}
                label={group.label}
                rules={kit.rules[group.key]}
                editing={editing === `rules-${group.key}`}
                onEdit={() => setEditing(editing === `rules-${group.key}` ? null : `rules-${group.key}`)}
                onChange={(next, label) => change(label, (k) => ({ ...k, rules: { ...k.rules, [group.key]: next } }))}
                onCopy={onCopy}
              />
            ))}
          </DocSection>

          {/* 06 Guideline */}
          {kit.notes?.trim() || editing === "guideline" ? (
            <DocSection id="guideline" title="Guideline" onEdit={() => setEditing(editing === "guideline" ? null : "guideline")} editing={editing === "guideline"}>
              {editing === "guideline" ? (
                <EditTray onDone={() => setEditing(null)} note="Markdown: # headings, - lists, **bold**, `values`, | tables |.">
                  <textarea
                    // biome-ignore lint/a11y/noAutofocus: opened on purpose to edit
                    autoFocus
                    aria-label="The guideline"
                    value={kit.notes}
                    onChange={(e) => change("Guideline", (k) => ({ ...k, notes: e.target.value }))}
                    className="min-h-[360px] w-full resize-y rounded-[10px] bg-white/[0.05] p-3 tabular-nums text-[12px] text-white/90 leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-white/20 [scrollbar-width:none]"
                  />
                </EditTray>
              ) : (
                <>
                  <Markdown blocks={guide} onCopy={onCopy} />
                </>
              )}
            </DocSection>
          ) : null}
        </article>
      </div>
    </div>
  );
}

// The section the reader is in: the last heading above the upper third.
function useActiveSection(scroller: React.RefObject<HTMLDivElement | null>, ids: string[]) {
  const [active, setActive] = useState(ids[0] ?? "");
  const key = ids.join(",");
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => {
      const line = el.getBoundingClientRect().top + el.clientHeight * 0.33;
      let current = key.split(",")[0];
      for (const id of key.split(",")) {
        const section = el.querySelector(`#kit-${id}`);
        if (section && section.getBoundingClientRect().top <= line) current = id;
      }
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) current = key.split(",").at(-1) ?? current;
      setActive(current);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [scroller, key]);
  return active;
}

function DocSection({
  id,
  title,
  onEdit,
  editing,
  children,
}: {
  id: string;
  title: string;
  onEdit?: () => void;
  editing?: boolean;
  children: ReactNode;
}) {
  return (
    <section id={`kit-${id}`} aria-labelledby={`kit-${id}-title`} className="mx-auto flex max-w-[68ch] scroll-mt-[72px] flex-col gap-4 border-white/[0.07] border-t py-10 first-of-type:border-t-0">
      <div className="flex items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 id={`kit-${id}-title`} className="font-semibold text-[28px] leading-tight tracking-[-0.01em]">
            {title}
          </h2>
        </div>
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            aria-expanded={editing}
            data-edit-toggle=""
            className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12.5px] text-white/60 outline-none transition-colors hover:bg-white/[0.06] hover:text-white/90 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
          >
            <PencilEditIcon aria-hidden="true" />
            {editing ? "Done" : "Edit"}
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

// An edit tray inside the page: dark DialKit rows, like the panels. Changes
// save as they're made, so a press outside it or Esc simply closes it (the
// Edit buttons open and close trays themselves). Esc hands the focus back to
// the Edit button that opened it.
function EditTray({ children, note, onDone }: { children: ReactNode; note?: string; onDone: () => void }) {
  const tray = useRef<HTMLDivElement>(null);
  const outside = useOutsideClose(tray, onDone, { ignore: (target) => Boolean(target.closest("[data-edit-toggle]")) });
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
      e.preventDefault();
      document.querySelector<HTMLElement>('[data-edit-toggle][aria-expanded="true"]')?.focus();
      done.current();
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, []);
  return (
    <div ref={tray} {...outside} className="flex flex-col gap-1.5 rounded-[14px] bg-[#161616] p-2.5 text-white animate-in fade-in slide-in-from-top-1 duration-200">
      {children}
      <div className="flex items-center gap-2 px-1 pt-1">
        {note ? <p className="me-auto text-[11.5px] text-white/45">{note}</p> : <span className="me-auto" />}
        <button type="button" onClick={onDone} className="h-7 cursor-pointer rounded-full bg-white px-3 font-medium text-[12px] text-[#141414] outline-none hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-ring">
          Done
        </button>
      </div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-[12px] bg-white/[0.04] px-4 py-6 text-[14px] text-white/45">{children}</p>;
}

// "Found: … / Guessed: …" from Claude, at the top of a kit it just made.
function Arrival({ text, onDismiss, onCopy }: { text: string; onDismiss: () => void; onCopy: (hex: string) => void }) {
  const parts = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const pick = (word: string) => parts.find((p) => p.toLowerCase().startsWith(`${word}:`))?.slice(word.length + 1).trim();
  const found = pick("found") ?? (parts.length ? parts[0] : null);
  const guessed = pick("guessed");
  return (
    <aside className="relative mt-3 flex flex-col gap-3 rounded-[14px] bg-white/[0.04] p-5 pe-12 shadow-[0_0_0_1px_rgba(255,255,255,0.07)] animate-in fade-in slide-in-from-top-1 duration-300" aria-label="What Claude did">
      {found ? (
        <div className="flex flex-col gap-1">
          <p className="font-medium text-[12px] text-white/90">What Claude found</p>
          <p className="text-[14px] text-white/60 leading-relaxed"><Inline text={found} onCopy={onCopy} /></p>
        </div>
      ) : null}
      {guessed ? (
        <div className="flex flex-col gap-1">
          <p className="font-medium text-[12px] text-[#FF8048]">What it guessed</p>
          <p className="text-[14px] text-white/60 leading-relaxed"><Inline text={guessed} onCopy={onCopy} /></p>
        </div>
      ) : null}
      <button type="button" onClick={onDismiss} aria-label="Dismiss what Claude did" className="absolute top-3 right-3 inline-flex size-7 cursor-pointer items-center justify-center rounded-full text-white/45 outline-none hover:bg-white/[0.06] hover:text-white/90 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5">
        <MultipleCrossCancelIcon aria-hidden="true" />
      </button>
    </aside>
  );
}

// One group of rules: its key rules first, then what to do and not do.
function RuleGroup({
  label,
  rules,
  editing,
  onEdit,
  onChange,
  onCopy,
}: {
  label: string;
  rules: string[];
  editing: boolean;
  onEdit: () => void;
  onChange: (rules: string[], label: string) => void;
  onCopy: (hex: string) => void;
}) {
  const keys = rules.filter(isKey).slice(0, 3);
  const rest = rules.filter((r) => !keys.includes(r));
  const dos = rest.filter((r) => !isDont(r));
  const donts = rest.filter(isDont);
  return (
    <div className="flex flex-col gap-3 pt-4">
      <div className="flex items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="font-semibold text-[18px]">{label}</h3>
        </div>
        <button
          type="button"
          onClick={onEdit}
          aria-expanded={editing}
          data-edit-toggle=""
          className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[12px] text-white/60 outline-none hover:bg-white/[0.06] hover:text-white/90 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3"
        >
          <PencilEditIcon aria-hidden="true" />
          {editing ? "Done" : "Edit"}
        </button>
      </div>
      {editing ? (
        <EditTray onDone={onEdit} note="Rules starting with “Never” or “Don’t” show as Don’ts.">
          {rules.map((rule, i) => (
            <div key={`${i}-${rules.length}`} className="flex min-h-9 items-start gap-2 rounded-[10px] bg-white/[0.05] py-1.5 ps-3 pe-1">
              <span className="pt-0.5 text-[11px] text-white/35 tabular-nums">{i + 1}</span>
              <textarea
                aria-label={`${label} rule ${i + 1}`}
                value={rule}
                rows={Math.max(1, Math.ceil(rule.length / 70))}
                placeholder="One plain sentence"
                onChange={(e) => onChange(rules.map((x, j) => (j === i ? e.target.value : x)), `${label} rule ${i + 1}`)}
                className="min-w-0 flex-1 resize-none bg-transparent text-[12.5px] text-white/90 leading-snug outline-none placeholder:text-white/30"
              />
              <button
                type="button"
                onClick={() => onChange(rules.filter((_, j) => j !== i), `Removed a ${label.toLowerCase()} rule`)}
                aria-label={`Remove rule ${i + 1}`}
                className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[8px] text-white/45 outline-none hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
              >
                <MultipleCrossCancelIcon aria-hidden="true" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange([...rules, ""], `Added a ${label.toLowerCase()} rule`)}
            className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-white/[0.05] text-[12px] text-white/75 outline-none hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
          >
            <PlusIcon aria-hidden="true" />
            Add a rule
          </button>
        </EditTray>
      ) : rules.length ? (
        <>
          {keys.length ? (
            // The key rules: plain lines, each marked with one small orange
            // square, the brand's own way of saying "this matters".
            <ul className="flex flex-col divide-y divide-white/[0.07] border-white/[0.07] border-y">
              {keys.map((rule) => (
                <li key={rule} className="flex gap-3.5 py-3.5 font-medium text-[15.5px] text-white/90 leading-snug">
                  <span className="mt-[7px] size-1.5 shrink-0 bg-studio" aria-hidden="true" />
                  <span>
                    <Inline text={rule} onCopy={onCopy} />
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <RuleList tone="do" rules={dos} onCopy={onCopy} />
          <RuleList tone="dont" rules={donts} onCopy={onCopy} />
        </>
      ) : (
        <Empty>No rules yet. Choose Edit to add one.</Empty>
      )}
    </div>
  );
}

// Do or Don't: a quiet label, then one rule per line, full width.
function RuleList({ tone, rules, onCopy }: { tone: "do" | "dont"; rules: string[]; onCopy: (hex: string) => void }) {
  if (!rules.length) return null;
  return (
    <div className="flex flex-col gap-1 pt-2">
      <p className="font-medium text-[11.5px] text-white/40 uppercase tracking-[0.08em]">{tone === "do" ? "Do" : "Don’t"}</p>
      <ul className="flex flex-col">
        {rules.map((rule) => (
          <li key={rule} className="flex gap-3.5 py-2 text-[14.5px] text-white/75 leading-relaxed">
            <span
              className={cn(
                "mt-[9px] size-1.5 shrink-0",
                tone === "do" ? "bg-white/35" : "shadow-[inset_0_0_0_1px_#FF8048]",
              )}
              aria-hidden="true"
            />
            <span>
              <Inline text={rule} onCopy={onCopy} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
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
    <svg viewBox={`0 0 ${W} ${rows * pitch}`} className="w-full overflow-hidden rounded-[12px]" role="img" aria-label="The kit's line texture">
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

// ─── Markdown ────────────────────────────────────────────────────────────────

type Block =
  | { t: "h"; level: number; text: string }
  | { t: "p"; text: string }
  | { t: "ul" | "ol"; items: { text: string; sub: string[] }[] }
  | { t: "quote"; text: string }
  | { t: "code"; text: string }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "hr" };

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push({ t: "code", text: body.join("\n") });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      // House style numbers things 1, 2, 3: "01 The Prism Principle"
      // reads as "1. The Prism Principle".
      const text = h[2].replace(/\s+#+\s*$/, "").replace(/^0*(\d{1,2})\.?\s+/, "$1. ");
      blocks.push({ t: "h", level: h[1].length, text });
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }
    if (line.startsWith("|") && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1].trim())) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      blocks.push({ t: "table", head, rows });
      continue;
    }
    if (line.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) body.push(lines[i++].trim().replace(/^>\s?/, ""));
      blocks.push({ t: "quote", text: body.join(" ") });
      continue;
    }
    const bullet = /^([-*+]|\d+[.)])\s+/;
    if (bullet.test(line)) {
      const ordered = /^\d/.test(line);
      const items: { text: string; sub: string[] }[] = [];
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          // A blank line ends the list unless the next line carries on with it.
          if (i + 1 < lines.length && bullet.test(lines[i + 1].trim())) {
            i++;
            continue;
          }
          break;
        }
        const indent = l.length - l.trimStart().length;
        if (bullet.test(l.trim())) {
          const text = l.trim().replace(bullet, "");
          if (indent >= 2 && items.length) items[items.length - 1].sub.push(text);
          else items.push({ text, sub: [] });
          i++;
        } else if (items.length && indent >= 2) {
          items[items.length - 1].text += ` ${l.trim()}`;
          i++;
        } else break;
      }
      blocks.push({ t: ordered ? "ol" : "ul", items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\||[-*+]\s|\d+[.)]\s|-{3,}$)/.test(lines[i].trim())) para.push(lines[i++].trim());
    if (para.length) blocks.push({ t: "p", text: para.join(" ") });
    else i++;
  }
  return blocks;
}

function Markdown({ blocks, onCopy }: { blocks: Block[]; onCopy: (hex: string) => void }) {
  return (
    <div className="flex flex-col gap-4 text-[15.5px] text-white/75 leading-[1.7]">
      {blocks.map((b, i) => {
        const key = `${b.t}-${i}`;
        switch (b.t) {
          case "h":
            return b.level <= 2 ? (
              <h3 key={key} className="pt-5 font-semibold text-[20px] text-white/90 leading-snug tracking-[-0.005em]">
                <Inline text={b.text} onCopy={onCopy} />
              </h3>
            ) : (
              <h4 key={key} className="pt-3 font-semibold text-[16px] text-white/90 leading-snug">
                <Inline text={b.text} onCopy={onCopy} />
              </h4>
            );
          case "p":
            return (
              <p key={key}>
                <Inline text={b.text} onCopy={onCopy} />
              </p>
            );
          case "ul":
          case "ol": {
            const List = b.t === "ul" ? "ul" : "ol";
            return (
              <List key={key} className={cn("flex flex-col gap-1.5 ps-5 marker:text-white/35", b.t === "ul" ? "list-disc" : "list-decimal marker:tabular-nums marker:text-[13px]")}>
                {b.items.map((item, j) => (
                  <li key={j} className="ps-1">
                    <Inline text={item.text} onCopy={onCopy} />
                    {item.sub.length ? (
                      <ul className="mt-1.5 flex list-[circle] flex-col gap-1 ps-5 marker:text-white/35">
                        {item.sub.map((s, k) => (
                          <li key={k} className="ps-1">
                            <Inline text={s} onCopy={onCopy} />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </List>
            );
          }
          case "quote":
            return (
              <blockquote key={key} className="rounded-[12px] border-studio border-l-[3px] bg-studio/[0.08] px-4 py-3 font-medium text-white/90">
                <Inline text={b.text} onCopy={onCopy} />
              </blockquote>
            );
          case "code":
            return (
              <pre key={key} className="overflow-x-auto rounded-[12px] bg-black/40 p-4 tabular-nums text-[12.5px] text-white/85 leading-relaxed [scrollbar-width:none]">
                {b.text}
              </pre>
            );
          case "table":
            return (
              <div key={key} className="overflow-x-auto rounded-[12px] shadow-[0_0_0_1px_rgba(255,255,255,0.09)] [scrollbar-width:none]">
                <table className="w-full border-collapse text-left text-[14px]">
                  <thead className="bg-white/[0.04]">
                    <tr>
                      {b.head.map((h, j) => (
                        <th key={j} className="px-3 py-2 font-semibold text-[12.5px] text-white/90">
                          <Inline text={h} onCopy={onCopy} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, j) => (
                      <tr key={j} className="border-white/[0.06] border-t">
                        {row.map((c, k) => (
                          <td key={k} className="px-3 py-2 align-top">
                            <Inline text={c} onCopy={onCopy} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "hr":
            return <hr key={key} className="my-2 border-white/[0.1]" />;
          default:
            return null;
        }
      })}
    </div>
  );
}

// Bold, italics, `values`, links and colour codes (as swatches to copy).
function Inline({ text, onCopy }: { text: string; onCopy: (hex: string) => void }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\([^)\s]+\)|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null;
        if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(part)) return <Swatch key={i} hex={part.toUpperCase()} onCopy={onCopy} />;
        if (part.startsWith("`") && part.endsWith("`")) {
          const inner = part.slice(1, -1);
          if (/^#[0-9a-fA-F]{6}$/.test(inner)) return <Swatch key={i} hex={inner.toUpperCase()} onCopy={onCopy} />;
          return (
            <code key={i} className="rounded-[5px] bg-white/[0.06] px-1.5 py-0.5 tabular-nums text-[0.85em] text-white/90">
              {inner}
            </code>
          );
        }
        if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) {
          return (
            <strong key={i} className="font-semibold text-white/90">
              <Inline text={part.slice(2, -2)} onCopy={onCopy} />
            </strong>
          );
        }
        if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
        if (link) {
          const safe = /^https?:\/\//.test(link[2]);
          return safe ? (
            <a key={i} href={link[2]} target="_blank" rel="noreferrer noopener" className="text-[#FF8048] underline decoration-[#FF8048]/40 underline-offset-2 hover:decoration-[#FF8048]">
              {link[1]}
            </a>
          ) : (
            <Fragment key={i}>{link[1]}</Fragment>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

function Swatch({ hex, onCopy }: { hex: string; onCopy: (hex: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onCopy(hex)}
      title={`${hex}, click to copy`}
      className="inline cursor-pointer whitespace-nowrap rounded-[4px] bg-white/[0.06] px-[0.3em] py-[0.12em] align-baseline tabular-nums text-[0.85em] text-white/90 outline-none transition-colors [box-decoration-break:clone] hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="me-[0.35em] inline-block size-[0.72em] rounded-[2px] align-[-0.04em] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]" style={{ background: hex }} aria-hidden="true" />
      {hex}
    </button>
  );
}
