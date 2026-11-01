// Links people paste when making a brand kit, sorted by what the studio can
// do with them. Shared by the page (to show each as a chip) and the server
// (to decide what Claude may open). No secrets here: the Figma token only
// ever lives on the server (figma.ts).

export type LinkKind = "figma" | "framer" | "notion" | "drive" | "video" | "website";

export type SharedLink = { url: string; kind: LinkKind; label: string };

export const LINK_LABEL: Record<LinkKind, string> = {
  figma: "Figma",
  framer: "Framer",
  notion: "Notion",
  drive: "Google Drive",
  video: "Video",
  website: "Website",
};

export function linkKind(url: URL): LinkKind {
  const host = url.hostname.replace(/^www\./, "");
  if (host === "figma.com" || host.endsWith(".figma.com")) return "figma";
  if (host.endsWith("framer.app") || host.endsWith("framer.website") || host === "framer.com" || host.endsWith(".framer.com")) return "framer";
  if (host === "notion.so" || host.endsWith(".notion.so") || host.endsWith(".notion.site")) return "notion";
  if (host === "drive.google.com" || host === "docs.google.com") return "drive";
  if (host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com") || host === "vimeo.com" || host.endsWith(".vimeo.com")) return "video";
  return "website";
}

// Every http(s) link in a piece of text, once each, in order.
export function findLinks(text: string): SharedLink[] {
  const seen = new Set<string>();
  const out: SharedLink[] = [];
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>"'`)\]]+/gi)) {
    const raw = match[0].replace(/[.,;:!?]+$/, "");
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (!url.hostname.includes(".") || seen.has(url.href)) continue;
    seen.add(url.href);
    const kind = linkKind(url);
    out.push({ url: url.href, kind, label: labelFor(url, kind) });
  }
  return out;
}

function labelFor(url: URL, kind: LinkKind) {
  if (kind === "figma") {
    const name = url.pathname.split("/")[3];
    return name ? decodeURIComponent(name).replace(/-/g, " ") : "Figma file";
  }
  const host = url.hostname.replace(/^www\./, "");
  const page = url.pathname.replace(/\/$/, "");
  return page && page !== "/" ? `${host}${page}`.slice(0, 60) : host;
}

// Links Claude may open itself (it reads the page): websites, Framer sites
// and public Notion pages.
export const fetchable = (kind: LinkKind) => kind === "website" || kind === "framer" || kind === "notion";
