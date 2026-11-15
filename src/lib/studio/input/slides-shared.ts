// What the slides import and the studio page share: the files it takes,
// the shapes it hands back and the events its routes stream. No Node here,
// so the page can import it.

export const DECK_EXTS = ["pdf", "pptx", "ppt", "key", "odp"] as const;
export const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "heic", "heif"] as const;
export const SLIDE_EXTS: readonly string[] = [...DECK_EXTS, ...IMAGE_EXTS];
export const SLIDE_ACCEPTS = SLIDE_EXTS.map((e) => `.${e}`).join(",");

export const MAX_SLIDES = 150;
export const MAX_DECK_BYTES = 200 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

// Seconds each slide is on screen, when it isn't fitted to the voiceover.
export const SECONDS = { min: 2, max: 12, normal: 4 };

export const extOf = (name: string) => (name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "");
export const isSlideFile = (name: string) => SLIDE_EXTS.includes(extOf(name));
export const isImageFile = (name: string) => (IMAGE_EXTS as readonly string[]).includes(extOf(name));

export type Box = { x: number; y: number; w: number; h: number }; // fractions of the slide
export type SlidePicture = { file: string; box: Box };
export type SlideChart = {
  type: string; // bar, column, line, pie, area, doughnut, scatter…
  title: string;
  box: Box | null;
  categories: string[];
  series: { name: string; values: (number | null)[] }[];
};
export type Slide = {
  key: string; // unique in its import
  image: string | null; // PNG file name in the import folder; null when it couldn't be drawn
  width: number;
  height: number;
  title: string;
  text: string;
  notes: string;
  from: string; // the file it came from
  page: number; // its number in that file
  pictures: SlidePicture[];
  charts: SlideChart[];
};
export type SlideImport = { id: string; slides: Slide[]; notes: string[]; files: number; createdAt: string };

export type SlidesEvent =
  | { kind: "step"; label: string }
  | { kind: "done"; import: SlideImport }
  | { kind: "made"; id: string; prompt: string }
  | { kind: "error"; message: string };

export type SlidesWay = "animate" | "motion";
