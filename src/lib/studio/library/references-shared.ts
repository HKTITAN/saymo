// The reference library: saved pictures, clips, GIFs, sounds, PDFs, notes
// and links, shared by every film, plus each brand kit's logos, guideline
// files and rules (read-only, straight from brands/<id>/). Anything in it
// can be attached to a prompt like a file from Finder.
//
// library/                     git ignores it, like films/
//   folders.json               the library's own folders
//   <id>/item.json             RefItem
//   <id>/original.<ext>        the file as it came in, never changed
//   <id>/thumb.webp            the card's picture
//   <id>/preview.mp4           clips: a small silent copy that plays on hover
//   <id>/still-1..4.jpg        clips: frames attached in place of the clip
//   <id>/attach.png            pictures Claude can't open as they are (SVG, TIFF)
//   .trash/<id>/               deleted items, kept a day so they can come back
//
// Routes (all guarded by allowed()):
// GET    /api/studio/library                    → LibraryList
// POST   /api/studio/library                    body = a file, name in x-file-name
//                                               (x-library-folder: a folder id)
// POST   /api/studio/library  {link, folder?}   → a link
// POST   /api/studio/library  {note, folder?}   → a note
// POST   /api/studio/library  {film, path|media, name?} → copied from a film
// PATCH  /api/studio/library/<id> {name?, note?, tags?, folder?}
// DELETE /api/studio/library/<id>               → to the trash
// POST   /api/studio/library/<id>/restore       → back from the trash
// POST   /api/studio/library/<id>/attach {film} → Attachment[] in the film's refs/
// GET    /api/studio/library/<id>/<file>        → its files (thumb, original, ...)
// GET    /api/studio/library/brand/<kit>/<path> → a kit's file made attachable
// GET|POST /api/studio/library/folders, PATCH|DELETE /api/studio/library/folders/<fid>

export type RefKind = "image" | "gif" | "video" | "audio" | "pdf" | "text" | "doc" | "note" | "link";

export type RefItem = {
  id: string; // 8 lower-case letters and digits
  kind: RefKind;
  name: string; // shown on the card, without the extension
  folder: string | null;
  tags: string[];
  note: string;
  createdAt: string;
  updatedAt: string;
  file: string | null; // "original.png"; null for notes and links
  ext?: string; // the original's extension, "png"
  size?: number; // bytes
  width?: number;
  height?: number;
  duration?: number; // seconds, clips and sounds
  pages?: number; // PDFs
  thumb: string | null; // "thumb.webp"
  preview?: string | null; // "preview.mp4"
  stills?: string[]; // ["still-1.jpg", ...]
  attachFile?: string | null; // "attach.png" when the original can't be attached as it is
  peaks?: number[]; // sounds: 96 values, 0..1
  excerpt?: string; // notes and text: the opening words
  url?: string; // links
  site?: string; // links: "vimeo.com"
  description?: string; // links: the page's own summary
  from?: { film: string; title: string }; // saved from a film
};

// What the page gets: the item and where its files are.
export type RefEntry = RefItem & {
  thumbUrl: string | null;
  fileUrl: string | null; // the original, to open or play
  previewUrl: string | null; // clips: plays on hover; GIFs: the GIF itself
  attach: { url: string; name: string }[]; // fetched and attached as files
  brand?: { id: string; name: string }; // a brand kit's own file (read-only)
  ground?: "light" | "dark"; // a logo: the ground it's drawn for
};

export type RefFolder = { id: string; name: string; createdAt: string };

export type LibraryList = { items: RefEntry[]; folders: RefFolder[]; brands: RefEntry[] };

export const KIND_NAME: Record<RefKind, string> = {
  image: "Image",
  gif: "GIF",
  video: "Clip",
  audio: "Sound",
  pdf: "PDF",
  text: "Text",
  doc: "Doc",
  note: "Note",
  link: "Link",
};

export const EXTS: Record<Exclude<RefKind, "note" | "link">, string[]> = {
  image: ["png", "jpg", "jpeg", "webp", "heic", "heif", "svg", "avif", "tif", "tiff", "bmp"],
  gif: ["gif"],
  video: ["mp4", "mov", "m4v", "webm", "mkv", "avi"],
  audio: ["mp3", "wav", "m4a", "aif", "aiff", "aac", "ogg", "flac"],
  pdf: ["pdf"],
  text: ["txt", "md", "csv", "json"],
  doc: ["docx"],
};

export const MB = 1024 * 1024;
// The same caps as attachments, and room for short clips.
export const MAX_BYTES: Record<Exclude<RefKind, "note" | "link">, number> = {
  image: 25 * MB,
  gif: 25 * MB,
  video: 500 * MB,
  audio: 50 * MB,
  pdf: 25 * MB,
  text: 5 * MB,
  doc: 25 * MB,
};

export const refKindOf = (fileName: string): Exclude<RefKind, "note" | "link"> | null => {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!fileName.includes(".")) return null;
  for (const [kind, list] of Object.entries(EXTS)) if (list.includes(ext)) return kind as Exclude<RefKind, "note" | "link">;
  return null;
};

export const LIBRARY_ACCEPT = Object.values(EXTS)
  .flat()
  .map((e) => `.${e}`)
  .join(",");

// What a dragged library item carries (its id), so only the places that
// take one light up.
export const LIBRARY_DRAG = "application/x-studio-library";

export const MAX_TAGS = 12;
export const cleanTags = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const tag = t.trim().replace(/\s+/g, " ").slice(0, 24);
    if (tag && !out.some((o) => o.toLowerCase() === tag.toLowerCase())) out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
};
