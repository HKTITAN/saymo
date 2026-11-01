// The script every stage page runs first: it speaks the studio's side of
// the contract (StageInbound in, StageOutbound out) and hands the engine
// specific parts to an adapter.
//
//   window.__studioStage.register({ seek(t), params?(values), reload?() })
//   window.__studioStage.ready()      the film is set up and showing
//   window.__studioStage.error(text)  it failed
//   window.__studioStage.loading()    a draft is being made (rust)
//
// HTML films need no adapter of their own: this script finds their
// timeline. Pointing (a click that picks, not plays) is done here for every
// engine, from the `pick` selector: the deepest element it matches under the
// pointer. The stage's own outline is drawn in a layer the film never sees
// in a render.

export type BridgeOptions = {
  id: string; // film id, for remembering the playhead and live values across reloads
  engine: "html" | "react" | "rust";
};

export function bridgeScript({ id, engine }: BridgeOptions) {
  return `<script>(${bridge.toString()})(${JSON.stringify({ id, engine })});</script>`;
}

// Runs in the stage page, not here: plain browser JavaScript.
function bridge(options: BridgeOptions) {
  type Values = Record<string, number | string | boolean>;
  // edit: a video film's timeline, sent live while it's being cut (edit.ts).
  type Adapter = { seek(t: number): void; params?(values: Values): void; edit?(edit: unknown): void; reload?(): void };
  const w = window as unknown as {
    __film: { width: number; height: number; fps: number; duration: number };
    __params: Values;
    __timelines?: Record<string, { pause(): void; seek(t: number, suppress?: boolean): void }>;
    __studioStage: unknown;
  };
  const FILM = w.__film;
  const KEY = `studio:stage:${options.id}`;
  const post = (message: object) => {
    if (window.parent !== window) window.parent.postMessage(message, location.origin);
  };
  const store = {
    get: (k: string) => {
      try {
        return sessionStorage.getItem(`${KEY}:${k}`);
      } catch {
        return null;
      }
    },
    set: (k: string, v: string | null) => {
      try {
        if (v === null) sessionStorage.removeItem(`${KEY}:${k}`);
        else sessionStorage.setItem(`${KEY}:${k}`, v);
      } catch {}
    },
  };

  // Live values the panel sent before a reload win over film.json's.
  const live = store.get("params");
  if (live) {
    try {
      Object.assign(w.__params, JSON.parse(live));
    } catch {}
  }
  let t = Number(store.get("t")) || 0;
  let adapter: Adapter | null = null;
  let readied = false;

  const clamp = (s: number) => Math.max(0, Math.min(FILM.duration, Number.isFinite(s) ? s : 0));
  const seek = (s: number) => {
    t = clamp(s);
    adapter?.seek(t);
  };
  const reload = () => {
    store.set("t", String(t));
    location.reload();
  };

  let failed = false;
  const fail = (message: string) => {
    if (failed) return;
    failed = true;
    post({ type: "studio:error", message });
  };
  window.addEventListener("error", (e) => fail(e.message || "The film stopped with an error."));
  window.addEventListener("unhandledrejection", (e) => fail(String(e.reason?.message ?? e.reason ?? "The film stopped with an error.")));

  // Pointing: hover outlines what a click would pick; a click picks it.
  const PICK = options.engine === "react" ? "[data-part]" : options.engine === "html" ? "[id],[data-hf-id]" : null;
  let pointing = false;
  let box: HTMLDivElement | null = null;
  const target = (x: number, y: number) => {
    if (!PICK) return null;
    let el = document.elementFromPoint(x, y);
    while (el && el !== document.documentElement) {
      if (el !== box && el.matches(PICK) && !el.hasAttribute("data-composition-id") && el !== document.body) return el;
      el = el.parentElement;
    }
    return null;
  };
  const outline = (el: Element | null) => {
    if (!box) {
      box = document.createElement("div");
      box.style.cssText =
        "position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #F55A00;border-radius:4px;box-shadow:0 0 0 1px rgba(0,0,0,.4);display:none";
      document.documentElement.append(box);
    }
    if (!el) {
      box.style.display = "none";
      return;
    }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: `${r.left - 2}px`, top: `${r.top - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` });
  };
  const words = (el: Element) => {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    return text ? text.slice(0, 80) : null;
  };
  const idOf = (el: Element) =>
    options.engine === "react" ? el.getAttribute("data-part") : el.id || el.getAttribute("data-hf-id");
  window.addEventListener(
    "pointermove",
    (e) => {
      if (pointing) outline(target(e.clientX, e.clientY));
    },
    true,
  );
  window.addEventListener(
    "click",
    (e) => {
      if (!pointing) return;
      e.preventDefault();
      e.stopPropagation();
      const el = target(e.clientX, e.clientY);
      const r = el?.getBoundingClientRect();
      post({
        type: "studio:picked",
        pick: {
          x: Math.round(e.clientX),
          y: Math.round(e.clientY),
          id: el ? idOf(el) : null,
          tag: el ? el.tagName.toLowerCase() : null,
          text: el ? words(el) : null,
          rect: r ? { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } : null,
        },
      });
    },
    true,
  );
  const setPointing = (on: boolean) => {
    pointing = on;
    document.documentElement.style.cursor = on ? "crosshair" : "";
    if (!on) outline(null);
    if (on) hover(null);
  };

  // ─── Words edited in place ──────────────────────────────────────────────
  //
  // While the film is paused (the studio says so with "studio:text"), any
  // element bound to a text param with data-param shows a quiet outline on
  // hover; a click turns it into an editable line with the film's own type.
  // Enter finishes (Shift+Enter breaks the line where data-multiline is
  // set), Escape puts the words back, Tab moves to the next words on screen.
  let textOn = false;
  // Words drawn whole are edited in place; words split into letters or
  // words for their animation (each in its own span, often moved in 3D)
  // are edited in a see-through box laid exactly over them in the same
  // type, with the animated letters hidden until the edit is done.
  let editing: { el: HTMLElement; key: string; before: string; box: HTMLDivElement | null; visibility: string } | null = null;
  const valueOf = () => (editing ? textOf(editing.box ?? editing.el) : "");
  const owns = (target: EventTarget | null) =>
    Boolean(editing && target instanceof Node && (editing.el.contains(target) || editing.box?.contains(target)));
  let quiet: HTMLDivElement | null = null;
  const TEXT = "[data-param]";
  const textAt = (x: number, y: number) => {
    // Films stack their scenes; an empty, see-through layer of a later
    // scene can sit over the words on screen. Look down through those to
    // the first words that can be seen, stopping at anything painted.
    for (const hit of document.elementsFromPoint(x, y)) {
      const words = hit.closest(TEXT) as HTMLElement | null;
      if (words && visible(words)) return words;
      if (hit === document.body || hit === document.documentElement) break;
      const s = getComputedStyle(hit);
      const painted = (s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent") || s.backgroundImage !== "none";
      if (painted && visible(hit as HTMLElement)) break;
    }
    return null;
  };
  const hover = (el: Element | null) => {
    if (!quiet) {
      quiet = document.createElement("div");
      quiet.style.cssText =
        "position:fixed;pointer-events:none;z-index:2147483646;border-radius:3px;box-shadow:0 0 0 1px rgba(255,255,255,.55),0 0 0 2px rgba(0,0,0,.35);display:none";
      document.documentElement.append(quiet);
      // Selected words show in the studio's orange, not the browser's blue.
      const look = document.createElement("style");
      look.textContent =
        "[data-param][contenteditable]{outline:none;caret-color:#F55A00}[data-param][contenteditable]::selection,[data-param][contenteditable] *::selection{background:rgba(245,90,0,.38);color:inherit}";
      document.head.append(look);
    }
    if (!el) {
      quiet.style.display = "none";
      return;
    }
    const r = el.getBoundingClientRect();
    const editingNow = Boolean(editing && (editing.el === el || editing.box === el));
    Object.assign(quiet.style, {
      display: "block",
      left: `${r.left - 4}px`,
      top: `${r.top - 3}px`,
      width: `${r.width + 8}px`,
      height: `${r.height + 6}px`,
      boxShadow: editingNow
        ? "0 0 0 2px #F55A00, 0 0 0 3px rgba(0,0,0,.35)"
        : "0 0 0 1px rgba(255,255,255,.55), 0 0 0 2px rgba(0,0,0,.35)",
    });
  };
  const textOf = (el: HTMLElement) => (el.innerText ?? el.textContent ?? "").replace(/\n+$/, "");
  const visible = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) return false;
    let alpha = 1;
    for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden") return false;
      alpha *= Number(s.opacity);
    }
    return alpha > 0.2;
  };
  const sendEdit = (key: string, value: string, isEditing: boolean) => {
    w.__params[key] = value;
    (w.__studioStage as { keepParams(v: Values): void }).keepParams({ [key]: value });
    post({ type: "studio:param-edit", key, value, editing: isEditing });
  };
  const startEdit = (el: HTMLElement, selectAll: boolean, at?: number) => {
    const key = el.getAttribute("data-param");
    if (!key) return;
    if (editing && editing.el !== el) finishEdit(true);
    if (editing) return;
    const before = String(w.__params[key] ?? textOf(el));
    if (el.children.length) {
      // Split into pieces: type into a box laid over the words instead,
      // each letter in the look it is drawn in (a light word stays light,
      // a bold one bold), at the size the camera shows it.
      const r = el.getBoundingClientRect();
      const k = el.offsetWidth ? r.width / el.offsetWidth : 1;
      const px = (v: string) => (v.endsWith("px") ? `${parseFloat(v) * k}px` : v);
      const ink: { style: Partial<CSSStyleDeclaration>; rect: DOMRect }[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const parent = n.parentElement;
        if (!parent) continue;
        const c = getComputedStyle(parent);
        const style: Partial<CSSStyleDeclaration> = {
          color: c.color,
          fontFamily: c.fontFamily,
          fontSize: px(c.fontSize),
          fontWeight: c.fontWeight,
          fontStyle: c.fontStyle,
          fontVariationSettings: c.fontVariationSettings,
          letterSpacing: px(c.letterSpacing),
        };
        for (const ch of n.textContent ?? "") if (ch.trim()) ink.push({ style, rect: parent.getBoundingClientRect() });
      }
      const seen = ink.map((i) => i.rect).filter((b) => b.width > 0 && b.height > 0);
      const left = seen.length ? Math.min(...seen.map((b) => b.left)) : r.left;
      const right = seen.length ? Math.max(...seen.map((b) => b.right)) : r.right;
      const top = seen.length ? Math.min(...seen.map((b) => b.top)) : r.top;
      const bottom = seen.length ? Math.max(...seen.map((b) => b.bottom)) : r.bottom;
      // Centred words grow both ways as you type; others grow from their edge.
      const mid = (left + right) / 2;
      const anchor = Math.abs(mid - (r.left + r.right) / 2) < r.width * 0.02 ? "center" : Math.abs(right - r.right) < 2 && left - r.left > 2 ? "right" : "left";

      const box = document.createElement("div");
      box.setAttribute("contenteditable", "plaintext-only");
      box.spellcheck = false;
      Object.assign(box.style, {
        position: "fixed",
        top: `${top}px`,
        height: `${bottom - top}px`,
        lineHeight: `${bottom - top}px`,
        minWidth: "0.5em",
        margin: "0",
        padding: "0",
        whiteSpace: "pre",
        zIndex: "2147483645",
        outline: "none",
        caretColor: "#F55A00",
        ...(ink[0]?.style ?? {}),
      } as Partial<CSSStyleDeclaration>);
      // Each letter of the words takes the look of the letter drawn in its
      // place; spaces take the look of the letter before them.
      let j = 0;
      let run: HTMLSpanElement | null = null;
      let runStyle: Partial<CSSStyleDeclaration> | undefined;
      for (const ch of before) {
        const style = ch.trim() ? (ink[Math.min(j++, ink.length - 1)]?.style ?? runStyle) : runStyle;
        if (!run || style !== runStyle) {
          run = document.createElement("span");
          if (style) Object.assign(run.style, style);
          box.append(run);
          runStyle = style;
        }
        run.textContent += ch;
      }
      const place = () => {
        const wdt = box.offsetWidth;
        box.style.left = `${anchor === "center" ? mid - wdt / 2 : anchor === "right" ? right - wdt : left}px`;
      };
      document.documentElement.append(box);
      place();
      box.addEventListener("input", place);
      editing = { el, key, before, box, visibility: el.style.visibility };
      el.style.visibility = "hidden";
      box.focus();
      const sel = getSelection();
      const range = document.createRange();
      if (selectAll) range.selectNodeContents(box);
      else {
        // The caret goes after the same number of letters as were clicked past.
        let need = at ?? Infinity;
        let offset = before.length;
        for (let i = 0; i < before.length; i++) {
          if (need <= 0) {
            offset = i;
            break;
          }
          if (before[i].trim()) need--;
        }
        let rest = offset;
        const texts = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
        let placed = false;
        for (let n = texts.nextNode(); n; n = texts.nextNode()) {
          const len = n.textContent?.length ?? 0;
          if (rest <= len) {
            range.setStart(n, rest);
            range.collapse(true);
            placed = true;
            break;
          }
          rest -= len;
        }
        if (!placed) {
          range.selectNodeContents(box);
          range.collapse(false);
        }
      }
      sel?.removeAllRanges();
      sel?.addRange(range);
      hover(box);
      post({ type: "studio:param-edit", key, value: before, editing: true });
      return;
    }
    editing = { el, key, before, box: null, visibility: el.style.visibility };
    el.setAttribute("contenteditable", "plaintext-only");
    el.style.outline = "none";
    el.style.cursor = "text";
    el.focus();
    if (selectAll) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    hover(el);
    post({ type: "studio:param-edit", key, value: textOf(el), editing: true });
  };
  let rebuild = 0;
  const finishEdit = (keep: boolean) => {
    const now = editing;
    if (!now) return;
    editing = null;
    const { el, key, before, box } = now;
    let value: string;
    if (box) {
      value = keep ? textOf(box).replace(/\n+/g, " ") : before;
      box.remove();
      getSelection()?.removeAllRanges();
      el.style.visibility = now.visibility;
    } else {
      if (!keep) el.innerText = before;
      el.removeAttribute("contenteditable");
      el.style.cursor = "";
      getSelection()?.removeAllRanges();
      value = keep ? textOf(el) : before;
    }
    sendEdit(key, value, false);
    hover(null);
    // The film is built from its words, so it is rebuilt with the new ones
    // (at the same moment) once the edit is done.
    if (value !== before || !keep) {
      if (options.engine === "html") {
        clearTimeout(rebuild);
        rebuild = window.setTimeout(reload, 120);
      } else adapter?.params?.({ ...w.__params });
    }
  };
  const nextText = (from: HTMLElement) => {
    const all = [...document.querySelectorAll<HTMLElement>(TEXT)].filter(visible);
    const i = all.indexOf(from);
    return all.length ? all[(i + 1) % all.length] : null;
  };
  window.addEventListener(
    "pointermove",
    (e) => {
      if (!textOn || pointing || editing) return;
      const el = textAt(e.clientX, e.clientY);
      hover(el);
      document.documentElement.style.cursor = el ? "text" : "";
    },
    true,
  );
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (pointing) return;
      // Words can be clicked while the film plays too: the studio pauses it
      // as soon as editing starts.
      const el = textAt(e.clientX, e.clientY);
      if (owns(e.target)) return;
      if (editing) finishEdit(true);
      // Made editable before the browser handles the press, so the caret
      // lands where the click was.
      if (!el) return;
      // The caret goes beside the letter that was clicked.
      let caret: number | undefined;
      const hit = e.target instanceof Element && e.target !== el && el.contains(e.target) ? e.target : null;
      if (hit) {
        // Counted in letters, not spaces: split words often draw their
        // spaces as gaps rather than characters.
        const range = document.createRange();
        range.setStart(el, 0);
        range.setEndBefore(hit);
        const hr = hit.getBoundingClientRect();
        const letters = (t: string) => t.replace(/\s/g, "").length;
        caret = letters(range.toString()) + (e.clientX > hr.left + hr.width / 2 ? letters(hit.textContent ?? "") : 0);
      }
      startEdit(el, false, caret);
      // The box over split words takes the press; stop the browser moving
      // focus back to the hidden letters underneath.
      if (editing?.box) e.preventDefault();
    },
    true,
  );
  window.addEventListener(
    "keydown",
    (e) => {
      if (!editing) return;
      if (e.key === "Escape") {
        e.preventDefault();
        finishEdit(false);
      } else if (e.key === "Enter" && !(e.shiftKey && editing.el.hasAttribute("data-multiline"))) {
        e.preventDefault();
        finishEdit(true);
      } else if (e.key === "Tab") {
        e.preventDefault();
        const from = editing.el;
        finishEdit(true);
        const next = nextText(from);
        if (next && next !== from) startEdit(next, true);
      }
    },
    true,
  );
  window.addEventListener(
    "input",
    (e) => {
      if (!editing || !owns(e.target)) return;
      sendEdit(editing.key, valueOf(), true);
      hover(editing.box ?? editing.el);
    },
    true,
  );
  const setText = (on: boolean) => {
    textOn = on;
    if (!on) {
      if (editing) finishEdit(true);
      hover(null);
      if (!pointing) document.documentElement.style.cursor = "";
    }
  };
  // When is this text first on screen? Steps through the film (html films
  // seek in an instant) and puts the playhead back.
  const findText = (key: string) => {
    const el = () => document.querySelector<HTMLElement>(`[data-param="${CSS.escape(key)}"]`);
    if (!el()) return null;
    if (options.engine !== "html" || !adapter) return visible(el() as HTMLElement) ? t : null;
    const back = t;
    const steps = Math.max(30, Math.ceil(FILM.duration * 8));
    let found: number | null = null;
    for (let i = 0; i <= steps && found === null; i++) {
      const s = (FILM.duration * i) / steps;
      adapter.seek(s);
      const now = [...document.querySelectorAll<HTMLElement>(`[data-param="${CSS.escape(key)}"]`)].some(visible);
      // A little after it appears, so the words have settled in.
      if (now) found = Math.min(FILM.duration, s + FILM.duration / steps);
    }
    adapter.seek(back);
    return found;
  };

  window.addEventListener("message", (e) => {
    if (e.source !== window.parent || e.origin !== location.origin) return;
    const m = (e.data ?? {}) as { type?: string; t?: number; params?: Values; on?: boolean; edit?: unknown; key?: string };
    if (m.type === "studio:seek") {
      // A seek while editing would move the words being typed into.
      if (!editing) seek(Number(m.t));
    } else if (m.type === "studio:point") setPointing(Boolean(m.on));
    else if (m.type === "studio:text") setText(Boolean(m.on));
    else if (m.type === "studio:find-param" && m.key) post({ type: "studio:param-at", key: m.key, t: findText(m.key) });
    else if (m.type === "studio:focus-param" && m.key) {
      const target = [...document.querySelectorAll<HTMLElement>(`[data-param="${CSS.escape(m.key)}"]`)].find(visible);
      if (target) startEdit(target, true);
    }
    else if (m.type === "studio:params" && m.params) {
      if (adapter?.params) adapter.params(m.params);
    } else if (m.type === "studio:edit" && m.edit) {
      adapter?.edit?.(m.edit);
    } else if (m.type === "studio:reload") {
      // Files changed: film.json's values are the truth again.
      store.set("params", null);
      if (adapter?.reload) adapter.reload();
      else reload();
    }
  });

  w.__studioStage = {
    register(a: Adapter) {
      adapter = a;
    },
    ready() {
      if (readied) return;
      readied = true;
      seek(t);
      const texts = [...new Set([...document.querySelectorAll(TEXT)].map((el) => el.getAttribute("data-param") ?? ""))].filter(Boolean);
      post({ type: "studio:ready", duration: FILM.duration, fps: FILM.fps, width: FILM.width, height: FILM.height, texts });
    },
    error: fail,
    loading: () => post({ type: "studio:loading" }),
    // For adapters that rebuild on new values by reloading (html).
    keepParams(values: Values) {
      let saved: Values = {};
      try {
        saved = JSON.parse(store.get("params") ?? "{}");
      } catch {}
      store.set("params", JSON.stringify({ ...saved, ...values }));
    },
    reload,
  };

  // HTML films: the timeline at window.__timelines.main, once the page and
  // its fonts are in. New values rebuild the film, so the page reloads
  // (calmly: at most a few times a second while a slider moves).
  if (options.engine === "html") {
    let timer = 0;
    const stage = w.__studioStage as { keepParams(v: Values): void; register(a: Adapter): void; ready(): void };
    window.addEventListener("load", () => {
      const fonts = document.fonts ? document.fonts.ready : Promise.resolve();
      fonts.then(() => {
        let tries = 0;
        const wait = () => {
          const tl = w.__timelines?.main;
          if (tl) {
            tl.pause();
            stage.register({
              seek: (s) => tl.seek(s, false),
              params(values) {
                // The studio sends its values on every "ready"; if the page
                // already runs with them, reloading would only send it round
                // again (an endless flicker).
                const now = w.__params ?? {};
                if (Object.keys(values).every((k) => values[k] === now[k])) return;
                stage.keepParams(values);
                clearTimeout(timer);
                timer = window.setTimeout(reload, 150);
              },
            });
            stage.ready();
          } else if (tries++ < 150) setTimeout(wait, 20);
          else fail("The film has no timeline at window.__timelines.main.");
        };
        wait();
      });
    });
  }
}

// Styles every stage page gets: the film at its own size, nothing else.
export const STAGE_STYLE =
  "<style>html,body{margin:0;overflow:hidden;scrollbar-width:none}::-webkit-scrollbar{display:none}</style>";
