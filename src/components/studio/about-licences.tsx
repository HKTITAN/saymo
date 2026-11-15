"use client";

import { Popover } from "@base-ui/react/popover";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowLeftIcon, ChevronDownIcon, ExternalLinkSquareIcon, InformationCircleIcon, MultipleCrossCancelIcon, SearchIcon } from "@/components/icons";
import { LABEL, ROW, ROW_BUTTON, SURFACE, VALUE } from "@/components/tool/dial";
import { EDITION, IS_PRODUCT } from "@/lib/studio/edition";
import { cn } from "@/lib/utils";
import { version as STUDIO_VERSION } from "../../../package.json";
import { Hint, ICON_BUTTON } from "./panel";

// "About and licences": the studio's version, then everything in it made by
// others, grouped by licence, with a search. Each row opens its licence
// text. The list is public/licences.json, made by `npm run licences`
// (scripts/licences.mjs) along with THIRD-PARTY-NOTICES.md. It is
// shown in both editions (in-house, it says the list is the product's). Esc or a
// press outside closes it.

type Item = {
  name: string;
  version: string;
  kind: "npm" | "crate" | "model" | "program" | "font" | "icons" | "skill" | "vendored";
  licence: string;
  copyright: string[];
  author: string | null;
  url: string | null;
  text: string | null;
  notice: string | null;
  note: string | null;
};
type Group = { licence: string; count: number; items: Item[] };
type Licences = {
  studio: { name: string; version: string; edition: string };
  total: number;
  groups: Group[];
  texts: Record<string, string>;
};

const KIND_WORDS: Record<Item["kind"], string> = {
  npm: "Package",
  crate: "Rust crate",
  model: "Speech model",
  program: "Program",
  font: "Font",
  icons: "Icons",
  skill: "Claude skill",
  vendored: "Copied in",
};

const POPUP =
  "origin-(--transform-origin) outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0";
const NO_SCROLLBAR = "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
const SHOW_AT_MOST = 300;
const count = new Intl.NumberFormat("en");

// Loaded once per page, the first time the panel opens.
let loading: Promise<Licences> | null = null;
const loadLicences = () =>
  (loading ??= fetch("/licences.json", { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<Licences>;
  }).catch((error) => {
    loading = null;
    throw error;
  }));

export function AboutButton() {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Hint label="About and licences">
        <Popover.Trigger className={cn(ICON_BUTTON, "size-8 data-popup-open:bg-white/[0.08]")} aria-label="About and licences">
          <InformationCircleIcon aria-hidden="true" />
        </Popover.Trigger>
      </Hint>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={10} collisionPadding={12} className="z-50">
          <Popover.Popup className={cn(SURFACE, POPUP, "flex h-[min(640px,calc(100vh-80px))] w-[380px] flex-col gap-2 p-2")}>
            <AboutPanel />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function AboutPanel() {
  const [data, setData] = useState<Licences | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const [shown, setShown] = useState<Item | null>(null);
  const deferred = useDeferredValue(query.trim().toLowerCase());

  useEffect(() => {
    let live = true;
    loadLicences()
      .then((d) => live && setData(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  // While searching, every group with a match is open and shows only those.
  const groups = useMemo(() => {
    if (!data) return [];
    if (!deferred) return data.groups;
    return data.groups
      .map((g) => ({
        ...g,
        items: g.licence.toLowerCase().includes(deferred)
          ? g.items
          : g.items.filter((i) => i.name.toLowerCase().includes(deferred) || i.version.includes(deferred)),
      }))
      .filter((g) => g.items.length);
  }, [data, deferred]);
  const matches = groups.reduce((n, g) => n + g.items.length, 0);

  if (shown && data) return <LicenceText item={shown} texts={data.texts} onBack={() => setShown(null)} />;

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className={cn(ROW, "gap-3 px-3")}>
          <span className="font-medium text-white/90">Saymo</span>
          <span className={cn(VALUE, "ms-auto")}>{STUDIO_VERSION}</span>
        </div>
        <p className="px-1 pt-0.5 text-[11.5px] text-white/45 leading-relaxed">
          {data
            ? `Built with ${count.format(data.total)} parts made by others.`
            : "Built with parts made by others."}
        </p>
        {data && data.studio.edition !== EDITION ? (
          IS_PRODUCT ? (
            <p className="rounded-[10px] bg-warm/10 px-3 py-2 text-[11.5px] text-warm leading-relaxed">
              This list is for the {data.studio.edition} edition. To update it, run{" "}
              <span className="tabular-nums">STUDIO_EDITION={EDITION} npm run licences</span>.
            </p>
          ) : (
            <p className="rounded-[10px] bg-white/[0.04] px-3 py-2 text-[11.5px] text-white/55 leading-relaxed">
              This is the {data.studio.edition} edition’s list, without Strudel and GSAP.
            </p>
          )
        ) : null}
      </div>

      {/* biome-ignore lint/a11y/noLabelWithoutControl: the input is inside */}
      <label className={cn(ROW, "cursor-text gap-2 px-3 hover:bg-white/[0.07] has-[:focus-visible]:bg-white/[0.08] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring")}>
        <SearchIcon aria-hidden="true" className="size-3.5 shrink-0 text-white/45" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="react, MIT"
          aria-label="Search packages and licences"
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent text-white/90 outline-none placeholder:text-white/30"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery("")}
            className="inline-flex size-5 cursor-pointer items-center justify-center rounded-[6px] text-white/45 outline-none hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3"
          >
            <MultipleCrossCancelIcon aria-hidden="true" />
          </button>
        ) : null}
      </label>

      <div className={cn("-mx-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-1", NO_SCROLLBAR)}>
        {failed ? (
          <p className="rounded-[10px] bg-danger/10 px-3 py-2 text-[11.5px] text-danger leading-relaxed">
            Unable to load the licences. Run <span className="tabular-nums">npm run licences</span>, then reopen this panel.
          </p>
        ) : !data ? (
          <p className="px-1 py-1 text-[11.5px]">
            <span className="studio-shimmer">Loading the licences</span>
          </p>
        ) : !groups.length ? (
          <p className="px-1 py-1 text-[11.5px] text-white/50">
            Nothing matches &ldquo;{query.trim()}&rdquo;.
          </p>
        ) : (
          <>
            {groups.map((g) => (
              <LicenceGroup
                key={g.licence}
                group={g}
                open={Boolean(deferred) || openGroups.has(g.licence)}
                onToggle={() =>
                  setOpenGroups((s) => {
                    const next = new Set(s);
                    if (next.has(g.licence)) next.delete(g.licence);
                    else next.add(g.licence);
                    return next;
                  })
                }
                onOpen={setShown}
                limit={deferred ? SHOW_AT_MOST : Number.POSITIVE_INFINITY}
              />
            ))}
            {deferred && matches > SHOW_AT_MOST ? (
              <p className="px-1 pt-1 text-[11px] text-white/35">Some matches are hidden, type more to narrow them.</p>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

function LicenceGroup({
  group,
  open,
  onToggle,
  onOpen,
  limit,
}: {
  group: Group;
  open: boolean;
  onToggle: () => void;
  onOpen: (item: Item) => void;
  limit: number;
}) {
  return (
    <section className="flex flex-col gap-0.5">
      <button type="button" aria-expanded={open} onClick={onToggle} className={cn(ROW_BUTTON, "shrink-0")}>
        <span className="min-w-0 flex-1 truncate text-white/85">{group.licence}</span>
        <span className={cn(VALUE, "text-white/45")}>{count.format(group.items.length)}</span>
        <ChevronDownIcon aria-hidden="true" className={cn("size-3.5 shrink-0 text-white/40 transition-transform duration-200", !open && "-rotate-90")} />
      </button>
      {open ? (
        <ul className="flex flex-col gap-0.5 ps-2">
          {group.items.slice(0, limit).map((item) => (
            <li key={`${item.kind}:${item.name}@${item.version}`}>
              <button
                type="button"
                onClick={() => onOpen(item)}
                className="flex h-8 w-full cursor-pointer items-center gap-3 rounded-[9px] px-3 text-left text-[12px] outline-none transition-colors hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1 truncate text-white/75">{item.name}</span>
                {item.kind !== "npm" ? <span className="shrink-0 text-[11px] text-white/30">{KIND_WORDS[item.kind]}</span> : null}
                {item.version ? <span className="max-w-[90px] shrink-0 truncate text-[11px] text-white/40 tabular-nums">{item.version}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function LicenceText({ item, texts, onBack }: { item: Item; texts: Record<string, string>; onBack: () => void }) {
  const text = item.text ? texts[item.text] : null;
  const notice = item.notice ? texts[item.notice] : null;
  const holders = item.copyright.length ? item.copyright : item.author ? [`By ${item.author}`] : [];
  return (
    <>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onBack}
          // biome-ignore lint/a11y/noAutofocus: the panel's view changed; focus goes to the way back
          autoFocus
          className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[9px] ps-2 pe-3 text-[12px] text-white/60 outline-none transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
        >
          <ArrowLeftIcon aria-hidden="true" />
          All licences
        </button>
      </div>
      <div className={cn("-mx-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-1", NO_SCROLLBAR)}>
        <div className={cn(ROW, "shrink-0 gap-3 px-3")}>
          <span className="min-w-0 flex-1 truncate font-medium text-white/90">{item.name}</span>
          {item.version ? <span className={cn(VALUE, "max-w-[120px] truncate")}>{item.version}</span> : null}
        </div>
        <div className={cn(ROW, "shrink-0 gap-3 px-3")}>
          <span className={LABEL}>Licence</span>
          <span className="ms-auto truncate text-white/85">{item.licence}</span>
        </div>
        <div className={cn(ROW, "shrink-0 gap-3 px-3")}>
          <span className={LABEL}>Kind</span>
          <span className="ms-auto truncate text-white/85">{KIND_WORDS[item.kind]}</span>
        </div>
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className={cn(ROW_BUTTON, "shrink-0 text-white/75 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-white/45")}
          >
            <span className={LABEL}>Source</span>
            <span className="ms-auto min-w-0 truncate">{item.url.replace(/^https?:\/\//, "")}</span>
            <ExternalLinkSquareIcon aria-hidden="true" />
          </a>
        ) : null}
        {holders.length ? (
          <div className="flex flex-col gap-0.5 px-1 pt-1.5 text-[11.5px] text-white/60 leading-relaxed">
            {holders.map((h) => (
              <p key={h}>{h}</p>
            ))}
          </div>
        ) : null}
        {item.note ? <p className="px-1 pt-1 text-[11.5px] text-white/45 leading-relaxed">{item.note}</p> : null}
        {text ? <TextBlock text={text} /> : <p className="px-1 pt-1 text-[11.5px] text-white/45">No licence text found.</p>}
        {notice ? (
          <>
            <p className="px-1 pt-2 font-medium text-[12px] text-white/80">Notice</p>
            <TextBlock text={notice} />
          </>
        ) : null}
      </div>
    </>
  );
}

function TextBlock({ text }: { text: string }) {
  return (
    <pre className="mt-1 shrink-0 whitespace-pre-wrap break-words rounded-[10px] bg-white/[0.04] px-3 py-2.5 tabular-nums text-[10.5px] text-white/65 leading-relaxed">
      {text}
    </pre>
  );
}
