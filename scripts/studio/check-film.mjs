// Checks the studio film in the current folder, the way its engine allows:
//   html  HyperFrames' own check: lint, runtime, layout, motion, contrast
//   react the component bundles (catches typos and missing imports)
//   rust  the crate builds, offline, inside a sandbox
//
// This is the one command the studio's Claude may run to check its work
// (see src/lib/studio/claude.ts), so it takes no arguments: it always
// checks the film it is run from, and nothing else.
//
// usage (from films/<id>/): node <project>/scripts/studio/check-film.mjs

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dir = process.cwd();

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (path.dirname(dir) !== path.join(ROOT, "films") || !existsSync(path.join(dir, "film.json"))) {
  fail("Run this from a film's folder (films/<id>/).");
}
const film = JSON.parse(readFileSync(path.join(dir, "film.json"), "utf8"));

const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd: dir, stdio: "inherit", ...opts });
    proc.on("close", (code) => resolve(code ?? 1));
    proc.on("error", (error) => {
      console.error(String(error));
      resolve(1);
    });
  });

if (film.engine === "html") {
  const bin = path.join(ROOT, "studio/hyperframes/node_modules/.bin/hyperframes");
  if (!existsSync(bin)) fail("The film checker isn't installed: run `npm ci` in studio/hyperframes.");
  process.exit(
    await run(bin, ["check", dir, "--max-issues=30"], {
      // CI=1: no warm checker left running in the background afterwards.
      env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", CI: "1" },
    }),
  );
}

if (film.engine === "react") {
  const esbuild = path.join(ROOT, "studio/hyperframes/node_modules/.bin/esbuild");
  const entry = path.join(dir, "src/Film.jsx");
  if (!existsSync(entry)) fail("src/Film.jsx is missing: a react film's component lives there.");
  const code = await run(esbuild, [
    entry,
    "--bundle",
    "--format=esm",
    "--jsx=automatic",
    "--loader:.js=jsx",
    "--log-level=warning",
    `--outfile=${path.join(tmpdir(), `studio-check-${film.id}.js`)}`,
  ], { env: { ...process.env, NODE_PATH: path.join(ROOT, "studio/remotion/node_modules") } });
  if (code === 0) console.log("The component bundles cleanly.");
  process.exit(code);
}

if (film.engine === "rust") {
  // Building runs code (build scripts, macros), so: no build scripts or
  // proc-macro crates of the film's own, no network (only crates already
  // downloaded), and writes only to the film, cargo's cache and temp.
  const manifest = readFileSync(path.join(dir, "Cargo.toml"), "utf8");
  if (existsSync(path.join(dir, "build.rs")) || /^\s*build\s*=/m.test(manifest) || /proc-macro\s*=\s*true/.test(manifest)) {
    fail("Studio films can't have build scripts or proc-macros. Remove build.rs / `build =` / `proc-macro`.");
  }
  const cargoHome = process.env.CARGO_HOME ?? path.join(homedir(), ".cargo");
  const profile = [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    "(deny file-write*)",
    `(allow file-write* (subpath ${JSON.stringify(dir)}) (subpath ${JSON.stringify(cargoHome)})`,
    '  (subpath "/private/tmp") (subpath "/private/var/folders") (literal "/dev/null"))',
  ].join("\n");
  const cargo = existsSync(path.join(cargoHome, "bin/cargo")) ? path.join(cargoHome, "bin/cargo") : "cargo";
  process.exit(await run("sandbox-exec", ["-p", profile, cargo, "build", "--release", "--offline", "--quiet"]));
}

fail(`Unknown engine "${film.engine}" in film.json.`);
