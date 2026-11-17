// Checks that what differs between the Mac and Windows works on the
// computer it runs on. CI runs it on both (.github/workflows/check.yml), so
// a change to the platform modules that breaks one of them fails there.
//
//   node scripts/studio/platform-check.mjs

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { accessList, killTree, othersCanRead, ownerOnly, packageBin } from "./platform.mjs";
import { machine } from "./machine.mjs";
import { IS_WINDOWS, launcher, minimalEnv, OWN_GROUP, privateDir, rulePath, shellPath, which } from "../../src/lib/studio/server/platform.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const work = mkdtempSync(path.join(tmpdir(), "saymo-platform-"));
let failed = 0;
const check = async (name, fn) => {
  try {
    const result = await fn();
    console.log(`${result === "skip" ? "skip" : "ok  "}  ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL  ${name}: ${error.message}`);
  }
};
const expect = (ok, why) => {
  if (!ok) throw new Error(why);
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await check("which finds node", () => expect(which("node"), "node isn't found on the PATH"));

await check("packageBin starts next with node", () => {
  const next = packageBin(ROOT, "next");
  expect(next, "next isn't installed");
  const r = spawnSync(next[0], [...next[1], "--version"], { encoding: "utf8" });
  expect(r.status === 0 && /\d+\.\d+/.test(r.stdout), `next --version failed: ${r.stderr}`);
});

await check("launcher runs an npm .cmd through node", () => {
  if (!IS_WINDOWS) return "skip";
  const dir = path.join(work, "shim");
  privateDir(dir);
  writeFileSync(path.join(dir, "hello.js"), 'console.log("hi")');
  writeFileSync(path.join(dir, "hello.cmd"), '@ECHO off\r\n"%_prog%"  "%dp0%\\hello.js" %*\r\n');
  const [cmd, args] = launcher(path.join(dir, "hello.cmd"));
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  expect(r.stdout.trim() === "hi", `got ${JSON.stringify(r.stdout)}`);
});

await check("killTree stops a process and what it started", async () => {
  // A parent that starts a child, both waiting a minute.
  const script = "const { spawn } = require('node:child_process'); const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' }); console.log(c.pid); setTimeout(() => {}, 60000);";
  const parent = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "ignore"], ...OWN_GROUP });
  const child = await new Promise((resolve) => parent.stdout.once("data", (d) => resolve(Number(String(d).trim()))));
  expect(alive(child), "the child didn't start");
  killTree(parent.pid);
  for (let i = 0; i < 50 && (alive(parent.pid) || alive(child)); i++) await wait(100);
  expect(!alive(parent.pid), "the parent is still running");
  expect(!alive(child), "the child is still running");
});

await check("privateDir keeps a folder to this user", () => {
  const dir = path.join(work, "private");
  privateDir(dir);
  const file = path.join(dir, "secret.json");
  writeFileSync(file, "{}", { mode: 0o600 });
  ownerOnly(dir);
  expect(!othersCanRead(dir, statSync(dir).mode), `someone else can open it:\n${accessList(dir)}`);
  expect(!othersCanRead(file, statSync(file).mode), `someone else can open a file in it:\n${accessList(file)}`);
});

await check("privateDir also clears a list of its own (made from an admin terminal)", () => {
  if (!IS_WINDOWS) return "skip";
  const dir = path.join(work, "own-list");
  mkdirSync(dir);
  // Administrators and Users written on the folder itself, not inherited.
  spawnSync("icacls", [dir, "/grant", "*S-1-5-32-544:(OI)(CI)F", "*S-1-5-32-545:(OI)(CI)RX"], { stdio: "ignore" });
  privateDir(dir);
  expect(!othersCanRead(dir, 0), `someone else can open it:\n${accessList(dir)}`);
});

await check("Claude's permission rules and commands use paths it matches", () => {
  const film = path.join(ROOT, "films", "abc");
  const rule = rulePath(film);
  expect(rule.startsWith("//") && !rule.includes("\\") && !rule.includes(":"), `rule path ${rule}`);
  const cmd = shellPath(film);
  expect(IS_WINDOWS ? !cmd.includes("\\") : cmd === film, `command path ${cmd}`);
});

await check("minimalEnv keeps what programs need", () => {
  const env = minimalEnv();
  expect(env.PATH, "no PATH");
  if (IS_WINDOWS) expect(env.SystemRoot && env.USERPROFILE, "no SystemRoot or USERPROFILE");
});

await check("machine picks workers and encoders", async () => {
  const m = await machine();
  expect(m.cores > 0 && m.memoryGb > 0, "no cores or memory");
  console.log(`      ${m.model}, ${m.cores} cores; final ${m.finalEncoder ?? "x264"}, draft ${m.draftEncoder ?? "x264"}`);
});

rmSync(work, { recursive: true, force: true });
if (failed) {
  console.log(`\n${failed} failed.`);
  process.exit(1);
}
console.log("\nThis computer is ready.");
