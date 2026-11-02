// Runs one command for the Mac app (the studio's server, a build or setup)
// on the Mac's own Node, and makes sure nothing it started outlives the app.
//
//   node guard.mjs <program> [args…]
//
// The app holds this process's stdin open. When the app quits, or crashes,
// stdin closes and the guard stops the command and everything it started
// (renders, Claude, the speech server), then exits. SIGTERM does the same.

import { execFileSync, spawn } from "node:child_process";

const [program, ...args] = process.argv.slice(2);
const child = spawn(program, args, { stdio: ["ignore", "inherit", "inherit"] });

// Every process below this one, deepest first.
function descendants() {
  let table;
  try {
    table = execFileSync("/bin/ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
  } catch {
    return [];
  }
  const kids = new Map();
  for (const line of table.split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!pid) continue;
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(pid);
  }
  const out = [];
  const walk = (pid) => {
    for (const kid of kids.get(pid) ?? []) {
      walk(kid);
      out.push(kid);
    }
  };
  walk(process.pid);
  return out;
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const pids = descendants();
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  const until = Date.now() + 4000;
  while (Date.now() < until && pids.some(alive)) await new Promise((r) => setTimeout(r, 100));
  for (const pid of [...pids, ...descendants()]) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  process.exit(0);
}

process.stdin.on("end", stop);
process.stdin.on("close", stop);
process.stdin.on("error", stop);
process.stdin.resume();
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("SIGHUP", stop);

child.on("exit", (code, signal) => {
  if (stopping) return;
  // The command ended on its own: tidy up anything it left behind, then
  // pass on how it ended.
  stopping = true;
  for (const pid of descendants()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  process.exit(code ?? (signal ? 1 : 0));
});
child.on("error", (error) => {
  process.stderr.write(`Couldn't start ${program}: ${error.message}\n`);
  process.exit(127);
});
