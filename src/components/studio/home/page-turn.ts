// Moving between the studio's pages (home, a film, a kit): the page you're
// on fades out quickly, then the next one fades in and its panels come into
// place with the panels' own motion (PANEL_MOTION). The CSS is in
// globals.css, keyed on two marks on the studio's <main>:
//   data-leaving   the page going away fades out, and takes no clicks
//   data-arriving  what appears fades in; panels rise into place
// With reduced motion it's a plain fade.

const LEAVE_MS = 140;
// New panels keep coming in this way for a while, as a film can take a
// moment to load after its page opens.
const ARRIVE_MS = 900;

let leaving: ReturnType<typeof setTimeout> | null = null;
let arriving: ReturnType<typeof setTimeout> | null = null;

export function turnPage(go: () => void) {
  const main = document.querySelector("main");
  if (!main) {
    go();
    return;
  }
  // A second click while the page fades: the newest one wins.
  if (leaving) clearTimeout(leaving);
  main.dataset.leaving = "";
  main.inert = true;
  leaving = setTimeout(() => {
    leaving = null;
    main.dataset.arriving = "";
    go();
    // Let go of the fade once the next page is in, two frames on.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (leaving) return;
        delete main.dataset.leaving;
        main.inert = false;
      }),
    );
    if (arriving) clearTimeout(arriving);
    arriving = setTimeout(() => {
      arriving = null;
      delete main.dataset.arriving;
    }, ARRIVE_MS);
  }, LEAVE_MS);
}
