// Read by the Remotion CLI (`npm run studio`, `npx remotion render`).
// scripts/studio/render.mjs renders through scripts/frames.mjs instead.
import { Config } from "@remotion/cli/config";
import { browser } from "./browser.js";

Config.setEntryPoint("src/index.js");
Config.setStudioPort(3206);
Config.setBrowserExecutable(browser.browserExecutable);
Config.setChromeMode(browser.chromeMode);
// Lossless frames and BT.709 colour, so the orange stays the orange.
Config.setVideoImageFormat("png");
Config.setColorSpace("bt709");
Config.setOverwriteOutput(true);
