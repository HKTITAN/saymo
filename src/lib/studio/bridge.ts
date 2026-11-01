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
  };

  window.addEventListener("message", (e) => {
    if (e.source !== window.parent || e.origin !== location.origin) return;
    const m = (e.data ?? {}) as { type?: string; t?: number; params?: Values; on?: boolean; edit?: unknown };
    if (m.type === "studio:seek") seek(Number(m.t));
    else if (m.type === "studio:point") setPointing(Boolean(m.on));
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
      post({ type: "studio:ready", duration: FILM.duration, fps: FILM.fps, width: FILM.width, height: FILM.height });
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
