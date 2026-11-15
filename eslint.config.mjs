import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
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
