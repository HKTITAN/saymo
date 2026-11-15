"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Fragment, type ReactNode, useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { post } from "@/content/post";
import { cn } from "@/lib/utils";
import type { PostContent } from "./content";
import { EVENT_ICONS } from "./icons";
import { drawPanel, type Look, MOTION_BY_ID, PANEL_H, PANEL_W, type MotionId } from "./lines";
import { PALETTE } from "./palette";
import { TeamSide } from "./team";

// The post is laid out at its export size, 1920 x 1080, in post pixels.
export const POST_W = 1920;
export const POST_H = 1080;
export const LEFT_W = POST_W - PANEL_W; // 1000
export const MARGIN = 72;
export const PHOTO = 240; // the speaker's square photo, as scripts/photo.mjs makes it
// The headline: nudged so the letter stems line up with the photo's left
// edge and the cap height lines up with the top of the logo. The nudges are
// measured at 86px and scale with a headline the tool has shrunk to fit.
export const HEADLINE = { size: 86, leading: 1.04, nudgeX: 4.3, nudgeY: 16 };
// The when-and-where row sits this far under the headline.
export const EVENT_GAP = 56;

export function headlineBox(size: number) {
  const k = size / HEADLINE.size;
  return { left: MARGIN - HEADLINE.nudgeX * k, top: MARGIN - HEADLINE.nudgeY * k };
}

export type PostHandle = { renderAt: (seconds: number) => void };

// The parts of the post the tool lets you change in place: each headline
// line, the speaker's name, role and company, each line of the date and
// the location, and the date's icon, which opens the calendar.
export type PostPart =
  | `title.${number}`
  | "name"
  | "role"
  | "company"
  | `date.${number}`
  | `location.${number}`
  | "date.icon";

const asIs = (_part: PostPart, node: ReactNode) => node;

// Ordinal endings after a number (20th, 21st) set small and raised, their
// tops level with the figures. Tailwind's base styles already keep a <sup>
// from opening up the line.
export function ordinals(text: string) {
  return text.split(/(?<=\d)(st|nd|rd|th)\b/).map((part, i) =>
    i % 2 ? (
      <sup key={`${i}-${part}`} style={{ fontSize: "0.6em", top: "-0.48em" }}>
        {part}
      </sup>
    ) : (
      part
    ),
  );
}

// A line with its accent words in orange and its ordinals raised.
function accented(line: string, accent?: string | readonly string[]) {
  if (Array.isArray(accent)) return accentedWords(line, accent);
  const at = accent ? line.indexOf(accent as string) : -1;
  if (!accent || at < 0) return ordinals(line);
  return (
    <>
      {ordinals(line.slice(0, at))}
      <span style={{ color: PALETTE.orangeLine }}>{ordinals(accent as string)}</span>
      {ordinals(line.slice(at + accent.length))}
    </>
  );
}

// Words as the tool picks them: letters and figures, with any apostrophes
// and hyphens inside them.
export const WORD = /([\p{L}\p{N}'’-]+)/u;

// Each picked word in orange wherever it appears in the line, whatever its
// case. A space between two orange words is orange too, so a phrase like
// "Kuala Lumpur" stays one run.
function accentedWords(line: string, words: readonly string[]) {
  const wanted = new Set(words.map((w) => w.toLocaleLowerCase()));
  const parts = line.split(WORD); // the gaps and words in turn: gap, word, gap, ...
  const orange = parts.map((part, i) => i % 2 === 1 && wanted.has(part.toLocaleLowerCase()));
  parts.forEach((part, i) => {
    if (i % 2 === 0 && /^\s+$/.test(part) && orange[i - 1] && orange[i + 1]) orange[i] = true;
  });
  const runs: { text: string; orange: boolean }[] = [];
  parts.forEach((text, i) => {
    const last = runs.at(-1);
    if (!text) return;
    if (last && last.orange === orange[i]) last.text += text;
    else runs.push({ text, orange: orange[i] });
  });
  return runs.map((run, i) =>
    run.orange ? (
      <span key={i} style={{ color: PALETTE.orangeLine }}>
        {ordinals(run.text)}
      </span>
    ) : (
      <Fragment key={i}>{ordinals(run.text)}</Fragment>
    ),
  );
}

type PostProps = {
  motion: MotionId;
  playing: boolean;
  // Canvas pixels per post pixel: 1 when exporting, more on a sharp screen.
  pixelScale: number;
  // When false nothing runs on its own and the exporter sets each frame.
  live?: boolean;
  // The viewer's Before/After switch; softer landings otherwise.
  look?: Look;
  // The words and images; the original post unless the tool passes its own.
  content?: PostContent;
  // The tool's editing: each part is handed over and drawn as returned.
  // Left out, every part is drawn as it is.
  wrap?: (part: PostPart, node: ReactNode) => ReactNode;
  ref?: Ref<PostHandle>;
};

export function Post({
  motion,
  playing,
  pixelScale,
  live = true,
  look,
  content = post,
  wrap = asIs,
  ref,
}: PostProps) {
  // The speaker post keeps its own softer landings ("refined"); a post can
  // ask for Scenes as measured from the reference instead (the team post).
  const shownLook: Look = look ?? content.look ?? "refined";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elapsed = useRef(0);

  const render = (seconds: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
    drawPanel(ctx, motion, seconds, shownLook, {
      partners: content.partners,
      flip: content.logoFlip,
      colors: content.panelColors,
      logoScale: content.logoScale,
    });
  };

  // A moment set from outside is remembered, so a resize redraws it.
  useImperativeHandle(ref, () => ({
    renderAt: (seconds: number) => {
      elapsed.current = seconds;
      render(seconds);
    },
  }));

  // Size the canvas backing store to the pixels it actually covers.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.round(PANEL_W * pixelScale);
    canvas.height = Math.round(PANEL_H * pixelScale);
    render(elapsed.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixelScale]);

  // Each motion starts on its still frame, the same one the export opens on.
  useEffect(() => {
    elapsed.current = content.videoStart ?? MOTION_BY_ID[motion].still;
    render(elapsed.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motion]);

  // A new look or new content redraws the same moment.
  useEffect(() => {
    render(elapsed.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownLook, content]);

  useEffect(() => {
    if (!live || !playing) return;
    let raf = 0;
    let last = performance.now();
    const duration = MOTION_BY_ID[motion].duration;
    const tick = (now: number) => {
      elapsed.current = (elapsed.current + (now - last) / 1000) % duration;
      last = now;
      render(elapsed.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // `content` too: switching posts must restart the loop, or it keeps
    // drawing the panel with the previous post's settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, playing, motion, pixelScale, shownLook, content]);

  // Centring: measure the three blocks on the stone side and slide them
  // together so the widest one has equal room on both sides. Written to the
  // DOM directly, once the fonts are in, so the export never sees a frame
  // before it moves.
  const blockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const block = blockRef.current;
    if (!block) return;
    const centre = () => {
      if (!content.centred) {
        block.style.transform = "";
        return;
      }
      const kids = [...block.children] as HTMLElement[];
      const left = Math.min(...kids.map((k) => k.offsetLeft));
      const right = Math.max(...kids.map((k) => k.offsetLeft + k.offsetWidth));
      // The stone side is wider when the panel gives some of its width up.
      const side = LEFT_W + (content.panelCut ?? 0);
      const shift = (content.shift ?? 0) * side;
      block.style.transform = `translateX(${(side - (right - left)) / 2 - left + shift}px)`;
    };
    centre();
    document.fonts.ready.then(centre);
    const watch = new ResizeObserver(centre);
    for (const k of block.children) watch.observe(k);
    return () => watch.disconnect();
  }, [content]);

  const { title, speaker, event, skyline } = content;
  // The panel can give up some of its left edge to the words: it slides
  // under the left side, which grows by the same amount.
  const cut = content.panelCut ?? 0;
  const titleSize = content.titleSize ?? HEADLINE.size;
  const headline = headlineBox(titleSize);

  return (
    <div
      className="relative overflow-hidden"
      style={{
        width: POST_W,
        height: POST_H,
        background: content.team ? PALETTE.ink : PALETTE.stone,
        fontFamily: "var(--font-post)",
      }}
      data-post
    >
      {/* Left: headline, when and where, and the speaker on stone */}
      <div className="absolute inset-y-0 left-0" style={{ width: LEFT_W + cut }}>
        <div ref={blockRef} className="absolute inset-0">
        {content.team ? (
          <TeamSide team={content.team} width={LEFT_W + cut} />
        ) : (
        <>
        <h1
          className="absolute font-semibold"
          style={{
            left: headline.left,
            top: headline.top,
            fontSize: titleSize,
            lineHeight: HEADLINE.leading,
            letterSpacing: "-0.01em",
            color: PALETTE.ink,
          }}
          data-part="headline"
        >
          {/* The first line leads at full strength; the rest sits back at 60%,
              which still reads at 4.4:1 on stone when the post is seen small. */}
          {title.map((line, i) => (
            <span key={i} className={cn("block whitespace-nowrap", i > 0 && "opacity-60")}>
              {wrap(`title.${i}`, line)}
            </span>
          ))}
        </h1>

        {/* When and where, side by side under the headline, laid out like the
            event's own artwork: an outlined tile with the icon, a small
            tracked label, then the detail on two lines. The icons take the
            labels' neutral; the accent words take the palette's deeper
            orange, which reads at 3.2:1 on stone where the brand orange
            would not. */}
        <div
          className="absolute flex"
          style={{
            left: MARGIN,
            top: headline.top + title.length * titleSize * HEADLINE.leading + EVENT_GAP,
            gap: 40,
          }}
          data-part="event"
        >
          {event.map((item) => {
            const tile = (
              <div
                className="flex shrink-0 items-center justify-center"
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 14,
                  border: "1.5px solid rgb(20 20 20 / 0.14)",
                }}
              >
                <HugeiconsIcon
                  icon={EVENT_ICONS[item.id]}
                  size={28}
                  strokeWidth={1.5}
                  color={PALETTE.muted}
                  aria-hidden="true"
                />
              </div>
            );
            return (
              <div key={item.id} className="flex items-center" style={{ gap: 16 }}>
                {item.id === "date" ? wrap("date.icon", tile) : tile}
                <div>
                  <p
                    className="font-medium uppercase"
                    style={{ fontSize: 12, lineHeight: 1.2, letterSpacing: "0.16em", color: PALETTE.muted }}
                  >
                    {item.label}
                  </p>
                  <p
                    className="font-semibold"
                    style={{
                      fontSize: 20,
                      lineHeight: 1.2,
                      letterSpacing: "-0.01em",
                      marginTop: 5,
                      color: PALETTE.ink,
                    }}
                  >
                    {item.lines.map((line, i) => (
                      <span key={i} className="block whitespace-nowrap">
                        {wrap(`${item.id}.${i}`, accented(line, item.accent))}
                      </span>
                    ))}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div
          className="absolute flex items-end"
          style={{ left: MARGIN, bottom: MARGIN, gap: 40 }}
        >
          {/* A plain img on purpose: the photo is pre-sized for the export
              and must not be resampled again by an image optimiser. */}
          {speaker.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={speaker.photo.x1}
              srcSet={`${speaker.photo.x1} 1x, ${speaker.photo.x2} 2x`}
              width={PHOTO}
              height={PHOTO}
              alt={speaker.name}
              className="block shrink-0"
              draggable={false}
            />
          ) : (
            <div className="shrink-0" style={{ width: PHOTO, height: PHOTO, background: PALETTE.stoneField }} />
          )}
          {/* Bottom-aligned with the photo: the last line's box reaches 8.4px
              below its baseline at these sizes, so hanging the column 8.4px
              low would sit that baseline on the photo's bottom edge; it hangs
              6.4px, nudged 2px up by eye. */}
          <div style={{ marginBottom: -6.4 }} data-part="speaker">
            <p
              className="font-medium"
              style={{ fontSize: 30, lineHeight: 1.2, letterSpacing: "-0.01em", color: PALETTE.ink }}
            >
              {wrap("name", speaker.name)}
            </p>
            <p
              style={{ fontSize: 24, lineHeight: 1.35, marginTop: 6, color: PALETTE.muted }}
            >
              {wrap("role", speaker.role)}
              <br />
              {wrap("company", speaker.company)}
            </p>
          </div>
        </div>
      </>
        )}
      </div>

      </div>

      {/* Right: the line field and the logo, both drawn on the canvas */}
      <div
        className="absolute inset-y-0 right-0 overflow-hidden"
        style={{ width: PANEL_W - cut, background: PALETTE.gap }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 block"
          style={{ width: PANEL_W, height: PANEL_H, left: -cut }}
          role="img"
          aria-label="Aerchain"
        />
        {/* The landmark stands centred on the bottom edge, in front of the
            lines. */}
        {skyline && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={skyline.x1}
            srcSet={`${skyline.x1} 1x, ${skyline.x2} 2x`}
            width={skyline.width ?? PANEL_W}
            height={skyline.height ?? PANEL_H}
            alt={skyline.landmark}
            className="absolute block"
            style={{
              // Centred on the part of the panel that shows.
              left: (PANEL_W - (skyline.width ?? PANEL_W)) / 2 - cut / 2,
              bottom: 0,
              // Its own size even where the panel is cut narrower; the base
              // styles would otherwise shrink it to fit.
              maxWidth: "none",
              transform: `translate(${skyline.place.x}px, ${-skyline.place.y}px) scale(${skyline.place.scale})`,
              transformOrigin: "50% 100%",
            }}
            draggable={false}
            data-part="landmark"
          />
        )}
      </div>
    </div>
  );
}
