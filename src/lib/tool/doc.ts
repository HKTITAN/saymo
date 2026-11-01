import type { PostContent } from "@/components/post/content";
import type { MotionId } from "@/components/post/lines";

// One post made in the tool, stored as posts/<id>/post.json. The words and
// placements are edited in the browser and saved as they change; the photo
// and image files are made on the server when they are uploaded.

export type Placement = { x: number; y: number; scale: number };

// The square crop of the speaker photo, in the uploaded photo's pixels.
export type Crop = { x: number; y: number; size: number };

// The dates picked in the calendar, which write the two date lines.
export type DatePick = { start: string; end: string; time: string; endTime: string };

export type PostDoc = {
  id: string;
  createdAt: string;
  updatedAt: string;
  // The post's own name in the list; the speaker's name when left out.
  name?: string;
  // Which of the four animations the post plays; Scenes when left out.
  motion?: MotionId;
  title: string[];
  // Fitted in the browser: 86, or less when a line is too long to fit.
  titleSize: number;
  speaker: { name: string; role: string; company: string };
  date: { lines: [string, string]; pick: DatePick | null };
  // `orange`: the words picked to be set in orange, wherever they appear.
  // Posts from before the word picker have `accent`, a run of text, instead.
  location: { lines: [string, string]; orange?: string[]; accent?: string };
  photo: {
    x1: string;
    x2: string;
    // The uploaded photo, kept so the crop can change later.
    source: { width: number; height: number; preview: string } | null;
    crop: Crop | null;
    // Background replaced with the plain grey behind the other speakers.
    plain: boolean;
  } | null;
  image: {
    name: string;
    x1: string;
    x2: string;
    // Its size at 100%, in post pixels.
    width: number;
    height: number;
    place: Placement;
    // What happened to the background, shown under the image.
    note: string;
    // The earlier try it came from, when it was made with AI.
    take?: string;
  } | null;
  // Landmarks made with AI for this post, newest first, to switch back to.
  takes?: Take[];
};

export type Take = {
  file: string;
  url: string;
  name: string;
  width: number;
  height: number;
  note: string;
};

// The part of a post the browser saves; the rest belongs to the uploads.
export type DocEdit = Pick<PostDoc, "motion" | "title" | "titleSize" | "speaker" | "date" | "location"> & {
  image: { name: string; place: Placement } | null;
};

export const motionOf = (doc: PostDoc): MotionId => doc.motion ?? "scenes";

// The words set in orange; an older post's run of text becomes its words.
export const orangeOf = (doc: PostDoc): string[] =>
  doc.location.orange ?? (doc.location.accent ?? "").split(/\s+/).filter(Boolean);

export const toEdit = (doc: PostDoc): DocEdit => ({
  motion: motionOf(doc),
  title: doc.title,
  titleSize: doc.titleSize,
  speaker: doc.speaker,
  date: doc.date,
  location: { lines: doc.location.lines, orange: orangeOf(doc) },
  image: doc.image && { name: doc.image.name, place: doc.image.place },
});

export const slugify = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export function toContent(doc: PostDoc): PostContent {
  return {
    title: doc.title,
    titleSize: doc.titleSize,
    speaker: {
      ...doc.speaker,
      photo: doc.photo && { x1: doc.photo.x1, x2: doc.photo.x2 },
    },
    event: [
      { id: "date", label: "Date", lines: doc.date.lines },
      { id: "location", label: "Location", lines: doc.location.lines, accent: orangeOf(doc) },
    ],
    skyline: doc.image && {
      landmark: doc.image.name,
      x1: doc.image.x1,
      x2: doc.image.x2,
      width: doc.image.width,
      height: doc.image.height,
      place: doc.image.place,
    },
    slug: slugify(doc.speaker.name) || "speaker",
  };
}

// Export progress, as the status route reports it.
export type ExportFiles = { video4k: string; video: string; image4k: string; image: string };
export type ExportStatus =
  | { state: "none" }
  | { state: "queued"; ahead: number }
  | { state: "running"; percent: number; startedAt: string }
  | { state: "done"; finishedAt: string; docUpdatedAt: string; files: ExportFiles }
  | { state: "failed"; error: string };

export type PostSummary = { doc: PostDoc; export: ExportStatus };

// What the list and the editor call a post.
export const postName = (doc: Pick<PostDoc, "name" | "speaker">) => doc.name?.trim() || doc.speaker.name.trim();
