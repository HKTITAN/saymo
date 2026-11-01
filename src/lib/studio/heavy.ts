// One heavy job at a time across the studio. Video renders and sound
// renders both drive Chrome flat out; run together they only slow each
// other, so each queue claims this gate before it starts a job and gives
// it back when the job ends, waking whoever waited.

type Gate = { busy: string | null; waiting: (() => void)[] };
const g = globalThis as { __studioHeavy?: Gate };
const gate = (g.__studioHeavy ??= { busy: null, waiting: [] });

// True if `who` may start now. If not, `wake` is called once the gate frees.
export function claim(who: string, wake: () => void): boolean {
  if (gate.busy === null || gate.busy === who) {
    gate.busy = who;
    return true;
  }
  if (!gate.waiting.includes(wake)) gate.waiting.push(wake);
  return false;
}

export function release(who: string) {
  if (gate.busy !== who) return;
  gate.busy = null;
  for (const wake of gate.waiting.splice(0)) wake();
}

export const heavyBusy = () => gate.busy;
