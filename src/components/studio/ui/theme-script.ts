// The studio's chosen look, set on <html> before the first paint so the
// page never flashes the wrong one. theme.ts keeps it in step afterwards.
export const THEME_KEY = "saymo:theme";
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||(t==="system"&&matchMedia("(prefers-color-scheme: light)").matches))document.documentElement.dataset.theme="light"}catch(e){}`;
