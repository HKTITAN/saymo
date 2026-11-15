"use client";

import { useEffect, useState } from "react";
import { THEME_KEY as KEY } from "./theme-script";

// The studio's look: dark (the default), light, or whatever the Mac is set
// to. Kept in this browser only. The page sets it before it paints (see
// THEME_SCRIPT), so there's no flash of the wrong one.

export type Theme = "dark" | "light" | "system";
const CHANGED = "saymo:theme";

export function savedTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "system" ? t : "dark";
  } catch {
    return "dark";
  }
}

function apply(t: Theme) {
  const light = t === "light" || (t === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
  if (light) document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
}

export function setTheme(t: Theme) {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // Private windows may not keep it; it still applies for now.
  }
  apply(t);
  window.dispatchEvent(new Event(CHANGED));
}

// Keeps the page in step with the choice, and with the Mac when it's "system".
export function useTheme(): Theme {
  const [theme, set] = useState<Theme>("dark");
  useEffect(() => {
    const sync = () => {
      const t = savedTheme();
      set(t);
      apply(t);
    };
    sync();
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener("change", sync);
    window.addEventListener(CHANGED, sync);
    window.addEventListener("storage", sync);
    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener(CHANGED, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return theme;
}

// For the studio's root: follows the choice while the studio is open, and
// hands the rest of the site back its own dark look when it closes.
export function useStudioTheme() {
  useTheme();
  useEffect(() => () => void delete document.documentElement.dataset.theme, []);
}
