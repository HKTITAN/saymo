import { existsSync } from "node:fs";

// The Chrome that renders frames. Remotion's own headless Chrome crashes on
// this Mac (its GPU helper can't find its ICU data, macOS 26), so the
// installed Google Chrome renders instead, as it does for `npm run export`.
// Without it, Remotion downloads and uses its own.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export const browser = existsSync(CHROME)
  ? { browserExecutable: CHROME, chromeMode: "chrome-for-testing" }
  : { browserExecutable: null, chromeMode: "headless-shell" };
