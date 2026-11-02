// The film's timeline: a Motion sequence (Motion 14.3.1, motion.dev, MIT;
// its build is assets/vendor/motion.min.js, its licence beside it) that the
// studio and the renderer can seek to any time and get exactly that frame,
// straight away.
//
//   const tl = filmTimeline(sequence, { duration: FILM.duration });
//   window.__timelines = window.__timelines || {};
//   window.__timelines.main = tl;
//
// `sequence` is what Motion's animate() takes for a sequence:
//   [[element, { x: [from, to] }, { at: 0.6, duration: 0.8, ease }], ...]
// Springs work too: { type: "spring", stiffness, damping, at }.
//
// Parts drawn from the clock rather than by Motion (assets/parts/, such as
// the sphere carousel) go in `parts`; each one's draw(t) runs on every seek:
//   filmTimeline(sequence, { duration: FILM.duration, parts: [sphere] })
//
// How it stays exact:
// - Motion runs every value on the page's main thread here, never on the
//   browser's own animations, so nothing moves unless the timeline is
//   sought, and the renderer has only one clock to set.
// - Seeking draws at once: Motion normally draws on the next animation
//   frame, so seek() runs that frame's work right away.
//
// The returned object is shaped like the timelines the studio has always
// sought (seek, pause, play, time, duration), so the stage, the renderer
// and HyperFrames drive it the same way.
(function () {
  const Motion = window.Motion;
  if (!Motion) throw new Error("filmTimeline needs assets/vendor/motion.min.js loaded first.");

  // Motion asks once whether the browser can run animations itself, and
  // remembers the answer. Ask with that hidden, so the answer is "no" and
  // every value runs on the main thread, where seeking sets it exactly.
  const proto = Element.prototype;
  const own = Object.getOwnPropertyDescriptor(proto, "animate");
  if (own) {
    delete proto.animate;
    try {
      Motion.supportsWaapi();
    } finally {
      Object.defineProperty(proto, "animate", own);
    }
  }

  // One animation frame of Motion's work, done now: work out the values,
  // then write them to the page.
  const flush = () => {
    const data = Motion.frameData;
    const was = data.isProcessing;
    data.isProcessing = true;
    try {
      for (const step of Object.keys(Motion.frameSteps)) Motion.frameSteps[step].process(data);
    } finally {
      data.isProcessing = was;
    }
  };

  function filmTimeline(sequence, options = {}) {
    const { duration: length = 0, parts = [], ...rest } = options;
    const animation = Motion.animate(sequence, rest);
    animation.pause();
    let now = 0;
    const end = () => Math.max(Number(length) || 0, animation.duration || 0);
    const tl = {
      animation,
      seek(t) {
        now = Math.max(0, Math.min(end(), Number(t) || 0));
        animation.pause();
        animation.time = Math.min(now, animation.duration || 0);
        flush();
        for (const part of parts) part?.draw?.(now);
        return tl;
      },
      pause() {
        animation.pause();
        return tl;
      },
      play() {
        animation.play();
        return tl;
      },
      time(t) {
        return t === undefined ? now : tl.seek(t);
      },
      duration: end,
    };
    tl.seek(0);
    return tl;
  }

  filmTimeline.flush = flush;
  window.filmTimeline = filmTimeline;
})();
