// The tool is one page: /tool lists the posts and /tool?post=<id> edits
// one. Moving between them changes the address without reloading, and the
// browser's back button works as usual.

const NAVIGATE = "tool:navigate";

export function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(NAVIGATE, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(NAVIGATE, onChange);
  };
}

export const currentSearch = () => window.location.search;

export function openPost(id: string | null) {
  window.history.pushState(null, "", id ? `/tool?post=${id}` : "/tool");
  window.dispatchEvent(new Event(NAVIGATE));
}
