import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import globals from "globals";

// Saymo runs on the Mac and on Windows. What differs between them lives in
// two places only (src/lib/studio/server/platform.ts for the studio,
// scripts/studio/platform.mjs for the scripts), so a change made for one
// works on the other. These catch code that would work on one of them only.
const MAC_ONLY_PROGRAMS = "sips|textutil|qlmanage|osascript|say|swiftc|sandbox-exec|otool|codesign|install_name_tool|sysctl|defaults|open|lsof|xcrun|brew|ditto|zipinfo|mdls|mdfind|pbcopy|pbpaste|afplay|afconvert|hdiutil|plutil|security|launchctl";
const bothPlatforms = [
  {
    selector: "MemberExpression[object.name='process'][property.name='platform']",
    message:
      "Use IS_MAC or IS_WINDOWS from src/lib/studio/server/platform.ts (scripts: scripts/studio/platform.mjs), or better a helper there, so the Mac and Windows stay in one place.",
  },
  {
    selector: "Property[key.name='detached']",
    message: "Spread OWN_GROUP from the platform module instead (a process group on the Mac, no console window on Windows), and stop it with killTree.",
  },
  {
    selector: "CallExpression[callee.object.name='process'][callee.property.name='kill'] > UnaryExpression[operator='-']",
    message: "Windows has no process groups: use killTree(pid) from the platform module.",
  },
  {
    selector: "Literal[value=/node_modules[\\\\/]\\.bin/]",
    message: "node_modules/.bin holds .cmd files on Windows that only a shell can start: use packageBin() from scripts/studio/platform.mjs.",
  },
  {
    selector: `CallExpression > Literal.arguments:first-child[value=/^(\\/usr\\/bin\\/)?(${MAC_ONLY_PROGRAMS})$/]`,
    message:
      "A Mac-only program. Give Windows its twin (see the platform module and scripts/native/), then mark this line with `// eslint-disable-next-line no-restricted-syntax -- Mac only; Windows: <the twin>`.",
  },
  {
    selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='PATH']",
    message: "Use which() or pathDirs() from src/lib/studio/server/platform.ts: Windows separates PATH with ';' and names programs .exe.",
  },
  {
    selector: "TemplateElement[value.raw=/(Edit|Read|Write)\\(\\/$/]",
    message: "Build a permission rule's path with rulePath() from src/lib/studio/server/platform.ts: Claude Code matches Windows paths as //c/...",
  },
  {
    selector: "TemplateLiteral:has(TemplateElement[value.raw=/(^|\\s)node $/]) > CallExpression[callee.object.name='path'][callee.property.name='join']",
    message: "A path in a command Claude runs goes through shellPath() from src/lib/studio/server/platform.ts: Git Bash on Windows reads backslashes as escapes.",
  },
  {
    selector: "ImportExpression > CallExpression.source[callee.object.name='path']",
    message: "On Windows import() needs a file URL, not C:\\...: wrap the path in pathToFileURL(...).href (node:url).",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.mjs", "studio/*/scripts/**/*.mjs"],
    ignores: ["src/lib/studio/server/platform.ts", "scripts/studio/platform.mjs"],
    rules: { "no-restricted-syntax": ["error", ...bothPlatforms] },
  },
  // TypeScript checks names in src/; the plain-JS scripts get the same from
  // no-undef, so a helper used without its import fails here, not at runtime.
  {
    files: ["scripts/**/*.mjs", "studio/*/scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
    rules: { "no-undef": "error" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Installed agent skills, with their own examples and scripts.
    ".claude/**",
    // Libraries copied in as they ship, minified.
    "**/vendor/**",
    // Films, brand kits and the reference library live on each Mac; git
    // ignores them, and their bundles are built output.
    "films/**",
    "brands/**",
    "library/**",
    // The engines' own installs and the Mac app's build.
    "studio/**/node_modules/**",
    "desktop/build/**",
  ]),
]);

export default eslintConfig;
