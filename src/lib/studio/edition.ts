// Which build this is. "in-house" (the default) is the studio as the team
// uses it: Claude on your own plan, old films with Strudel music and GSAP
// motion still play and render. "product" is the build that could be sold
// (see docs/launch): AI by API key only, no AGPL Strudel, no GSAP, a
// Licences screen. Set STUDIO_EDITION=product in .env.local to try it.
export type Edition = "in-house" | "product";

export const EDITION: Edition = process.env.STUDIO_EDITION === "product" ? "product" : "in-house";
export const IS_PRODUCT = EDITION === "product";
