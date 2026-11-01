import {
  EVENT_GAP,
  HEADLINE,
  headlineBox,
  LEFT_W,
  MARGIN,
  PHOTO,
  POST_H,
  POST_W,
} from "@/components/post/post";

// Keeps a typed-in post looking designed. A headline line that runs past
// the stone panel's margin shrinks the whole headline, as does a headline
// so tall that the date row would crowd the photo. What cannot shrink is
// reported, so it can be shortened.

const MAX_W = LEFT_W - 2 * MARGIN; // 856: the headline's widest line
const PHOTO_TOP = POST_H - MARGIN - PHOTO; // 768
const EVENT_H = 60; // the date row's icon tiles
const CLEAR = 48; // the least room between the date row and the photo
const MIN_SIZE = 40;

// The headline's text, measured off screen with the post's own type.
let ruler: HTMLSpanElement | null = null;
function widest(lines: string[], size: number) {
  if (!ruler) {
    ruler = document.createElement("span");
    Object.assign(ruler.style, {
      position: "fixed",
      left: "-100000px",
      top: "0",
      visibility: "hidden",
      whiteSpace: "pre",
      fontFamily: "var(--font-post)",
      fontWeight: "600",
      letterSpacing: "-0.01em",
    });
    ruler.setAttribute("aria-hidden", "true");
    document.body.append(ruler);
  }
  ruler.style.fontSize = `${size}px`;
  let most = 0;
  for (const line of lines) {
    ruler.textContent = line;
    most = Math.max(most, ruler.getBoundingClientRect().width);
  }
  return most;
}

export function fitHeadline(lines: string[]) {
  let size = HEADLINE.size;
  // Tall: the date row has to clear the photo.
  const bottom = (s: number) =>
    headlineBox(s).top + lines.length * s * HEADLINE.leading + EVENT_GAP + EVENT_H;
  while (size > MIN_SIZE && bottom(size) > PHOTO_TOP - CLEAR) size -= 1;
  // Wide: a few rounds, as the optical size axis changes letter widths a
  // little with every size.
  for (let round = 0; round < 4; round++) {
    const width = widest(lines, size);
    if (width <= MAX_W) break;
    size = Math.max(MIN_SIZE, Math.floor(((size * MAX_W) / width) * 10) / 10);
  }
  return size;
}

// The right edge of the words themselves, leaving out the box being typed
// in, which reaches a little past them.
function wordsRight(el: Element) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let right = -Infinity;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    range.selectNodeContents(node);
    right = Math.max(right, range.getBoundingClientRect().right);
  }
  return right;
}

// What still does not fit once the post has rendered, as plain advice.
export function layoutProblems(post: HTMLElement) {
  const frame = post.getBoundingClientRect();
  const scale = frame.width / POST_W;
  const toPost = (r: DOMRect) => ({
    left: (r.left - frame.left) / scale,
    right: (r.right - frame.left) / scale,
    top: (r.top - frame.top) / scale,
  });
  const edge = LEFT_W - MARGIN / 2; // where the stone panel's text must stop
  const problems: string[] = [];

  const headline = post.querySelector("[data-part=headline]");
  if (headline && (wordsRight(headline) - frame.left) / scale > edge) {
    problems.push("The headline is too long even at its smallest. Split a long line in two.");
  }
  const event = [...post.querySelectorAll("[data-part=event] span")];
  if (event.some((s) => toPost(s.getBoundingClientRect()).right > edge)) {
    problems.push("The date or location runs into the line panel. Shorten a line, or move words onto the second line.");
  }
  const speaker = post.querySelector("[data-part=speaker]");
  if (speaker && toPost(speaker.getBoundingClientRect()).top < PHOTO_TOP - 4) {
    problems.push("The name and role are taller than the photo. Shorten the role.");
  }
  return problems;
}
