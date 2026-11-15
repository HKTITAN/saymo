// Listens to the mic for dictation (use-dictation.ts): 16 kHz mono, the
// rate whisper reads, cut into pieces of about 30 seconds where you pause,
// so a long recording is written down while you're still talking. Each
// piece comes out as a WAV file.
//
// The browser runs its sound through the Mac's audio output; if that isn't
// running (no output device, or it's stuck), no sound reaches the page this
// way. Then the recorder switches to the browser's plain recorder after a
// moment: no level meter and one piece at the end, but nothing is lost.

const RATE = 16000;
const BLOCK = 512; // 32 ms: one level reading, one step of the pause finder
const BLOCK_S = BLOCK / RATE;
// A piece is cut at the first pause after SOFT seconds, or at the quietest
// moment of its last few seconds once it reaches HARD.
const SOFT = 20;
const HARD = 30;
const PAUSE_BLOCKS = 10; // about a third of a second

export class MicError extends Error {}

// What went wrong when asking for the mic, and how to fix it, in words.
async function whyNoMic(error: unknown): Promise<string> {
  const name = error instanceof DOMException ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    // Chrome says "Permission denied by system" when macOS is the one saying no.
    if (/system/i.test(message)) {
      return "Mac blocks the mic, turn on Chrome in System Settings › Privacy & Security › Microphone";
    }
    return "Mic blocked, allow it from the icon left of the address bar";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No mic found, plug one in and try again";
  }
  if (name === "NotSupportedError") {
    return "The mic only works in Chrome on localhost";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "Mic busy in another app, close it and try again";
  }
  return "Unable to start the mic, try again";
}

// The worklet, written out here so it needs no file of its own: it passes
// the mic's samples on in blocks, and sends what's left when asked.
const TAP = `
class StudioTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(${BLOCK});
    this.n = 0;
    this.port.onmessage = () => {
      this.port.postMessage({ last: true, samples: this.buf.slice(0, this.n) });
      this.n = 0;
    };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          this.port.postMessage({ samples: this.buf.slice(0) });
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("studio-tap", StudioTap);
`;

function wav(samples: Float32Array): Blob {
  const data = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) data.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  data.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, RATE, true);
  data.setUint32(28, RATE * 2, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  text(36, "data");
  data.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    data.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([data.buffer], { type: "audio/wav" });
}

// From the context's own rate down to 16 kHz, averaging what falls in each
// step (enough of a low-pass for speech). Only used when the browser can't
// run the context at 16 kHz itself.
function downsample(input: Float32Array, from: number, carry: { pos: number }): Float32Array {
  if (from === RATE) return input;
  const step = from / RATE;
  const out: number[] = [];
  let pos = carry.pos;
  while (pos + step <= input.length) {
    let sum = 0;
    let count = 0;
    for (let i = Math.floor(pos); i < Math.floor(pos + step); i++) {
      sum += input[i];
      count++;
    }
    out.push(count ? sum / count : 0);
    pos += step;
  }
  carry.pos = pos - input.length;
  return Float32Array.from(out);
}

export class Recorder {
  // Levels of the last moments, 0 to 1, newest last, for the meter.
  readonly levels = new Float32Array(48);
  seconds = 0;
  // The loudest moment so far, to tell a silent mic from a quiet room.
  peak = 0;
  // Each piece, with its loudest moment.
  onPiece: (wav: Blob, seconds: number, loudest: number) => void = () => {};
  onLost: () => void = () => {};

  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private url: string | null = null;
  private chunks: Float32Array[] = [];
  private length = 0;
  private blocks: number[] = []; // loudness of each block of the piece so far
  private quiet: number[] = []; // loudness of every block, for the noise floor
  private pending = new Float32Array(0);
  private carry = { pos: 0 };
  private done = false;
  private finishing: ((value: void) => void) | null = null;
  // The plain recorder, when the sound path above doesn't run.
  private plain: MediaRecorder | null = null;
  private plainParts: Blob[] = [];
  private plainClock: ReturnType<typeof setInterval> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private heard = false;
  // True once the plain recorder took over.
  get fallback() {
    return this.plain !== null;
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new MicError("The mic only works when the studio is opened at localhost or 127.0.0.1.");
    }
    try {
      const state = await navigator.permissions?.query({ name: "microphone" as PermissionName });
      if (state?.state === "denied") throw new DOMException("denied", "NotAllowedError");
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") throw new MicError(await whyNoMic(error));
      // Some browsers can't be asked; getUserMedia below still decides.
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      throw new MicError(await whyNoMic(error));
    }
    const track = this.stream.getAudioTracks()[0];
    if (!track) {
      this.release();
      throw new MicError("No mic was found. Plug one in, or choose one in System Settings, under Sound, then Input.");
    }
    track.addEventListener("ended", () => {
      if (this.done) return;
      void this.stop().then(() => this.onLost());
    });
    try {
      try {
        this.ctx = new AudioContext({ sampleRate: RATE, latencyHint: "interactive" });
      } catch {
        this.ctx = new AudioContext();
      }
      this.url = URL.createObjectURL(new Blob([TAP], { type: "text/javascript" }));
      await this.ctx.audioWorklet.addModule(this.url);
      const source = this.ctx.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.ctx, "studio-tap", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit", channelInterpretation: "speakers" });
      this.node.port.onmessage = (e: MessageEvent<{ samples: Float32Array; last?: boolean }>) => {
        this.take(downsample(e.data.samples, this.ctx?.sampleRate ?? RATE, this.carry));
        if (e.data.last) this.finishing?.();
      };
      source.connect(this.node);
      // Joined to the speakers at zero volume, so the browser keeps it running.
      const mute = this.ctx.createGain();
      mute.gain.value = 0;
      this.node.connect(mute).connect(this.ctx.destination);
      if (this.ctx.state === "suspended") await this.ctx.resume();
    } catch {
      // The sound path couldn't be built: record plainly instead.
      this.switchToPlain();
      return;
    }
    this.watchdog = setTimeout(() => {
      if (!this.heard && !this.done) this.switchToPlain();
    }, 1500);
  }

  private switchToPlain() {
    if (!this.stream || this.plain || typeof MediaRecorder === "undefined") return;
    this.node?.port.close();
    this.node?.disconnect();
    this.node = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
    try {
      this.plain = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
    } catch {
      return;
    }
    // Whatever the sound path heard so far goes first.
    this.cut(this.length);
    this.peak = 1; // can't be measured, so never reported as silent
    this.plain.addEventListener("dataavailable", (e) => {
      if (e.data.size) this.plainParts.push(e.data);
    });
    this.plain.start(1000);
    const started = performance.now() - this.seconds * 1000;
    this.plainClock = setInterval(() => (this.seconds = (performance.now() - started) / 1000), 250);
  }

  // Ends the recording; the last piece comes out before this resolves.
  async stop() {
    if (this.done) return;
    this.done = true;
    if (this.plain) {
      const plain = this.plain;
      if (plain.state !== "inactive") {
        await new Promise<void>((resolve) => {
          plain.addEventListener("stop", () => resolve(), { once: true });
          plain.stop();
          setTimeout(resolve, 1500);
        });
      }
      const blob = new Blob(this.plainParts, { type: (plain.mimeType || "audio/webm").split(";")[0] });
      this.plainParts = [];
      if (blob.size) this.onPiece(blob, this.seconds, 1);
      this.release();
      return;
    }
    if (this.node) {
      await new Promise<void>((resolve) => {
        this.finishing = resolve;
        this.node?.port.postMessage("flush");
        // A context that has stopped running won't answer.
        setTimeout(resolve, 300);
      });
    }
    this.cut(this.length);
    this.release();
  }

  // Ends it without any more pieces.
  abort() {
    this.done = true;
    this.chunks = [];
    this.length = 0;
    this.plainParts = [];
    if (this.plain && this.plain.state !== "inactive") this.plain.stop();
    this.release();
  }

  private release() {
    if (this.watchdog) clearTimeout(this.watchdog);
    if (this.plainClock) clearInterval(this.plainClock);
    this.watchdog = null;
    this.plainClock = null;
    this.node?.port.close();
    this.node?.disconnect();
    this.node = null;
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }

  private take(samples: Float32Array) {
    if (!samples.length || this.plain) return;
    this.heard = true;
    // Gathered into whole blocks so every block has one loudness.
    const all = new Float32Array(this.pending.length + samples.length);
    all.set(this.pending);
    all.set(samples, this.pending.length);
    let at = 0;
    while (all.length - at >= BLOCK) {
      this.block(all.subarray(at, at + BLOCK));
      at += BLOCK;
    }
    this.pending = all.slice(at);
    if (this.done && this.pending.length) {
      this.chunks.push(this.pending);
      this.length += this.pending.length;
      this.pending = new Float32Array(0);
    }
  }

  private block(b: Float32Array) {
    let sum = 0;
    for (let i = 0; i < b.length; i++) sum += b[i] * b[i];
    const rms = Math.sqrt(sum / b.length);
    this.peak = Math.max(this.peak, rms);
    this.chunks.push(b.slice());
    this.length += b.length;
    this.blocks.push(rms);
    this.quiet.push(rms);
    if (this.quiet.length > 600) this.quiet.splice(0, this.quiet.length - 600);
    this.seconds += BLOCK_S;
    // On a decibel scale, so speech fills the meter and room noise barely moves it.
    const db = 20 * Math.log10(rms + 1e-8);
    this.levels.copyWithin(0, 1);
    this.levels[this.levels.length - 1] = Math.max(0, Math.min(1, (db + 58) / 46));

    const piece = this.blocks.length * BLOCK_S;
    if (piece < SOFT) return;
    const pause = this.threshold();
    const tail = this.blocks.slice(-PAUSE_BLOCKS);
    if (tail.length === PAUSE_BLOCKS && tail.every((v) => v < pause)) {
      return this.cut((this.blocks.length - PAUSE_BLOCKS / 2) * BLOCK);
    }
    if (piece >= HARD) {
      // No pause: cut at the quietest moment of the last eight seconds.
      const from = Math.max(1, this.blocks.length - Math.round(8 / BLOCK_S));
      let best = from;
      for (let i = from; i < this.blocks.length; i++) if (this.blocks[i] < this.blocks[best]) best = i;
      this.cut(best * BLOCK + BLOCK / 2);
    }
  }

  // The room's own level, from the quietest tenth of what was heard.
  private threshold() {
    const sorted = [...this.quiet].sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
    return Math.max(0.006, Math.min(0.03, floor * 3));
  }

  // Sends the first `at` samples as a piece; the rest start the next one.
  private cut(at: number) {
    if (!this.length) return;
    const all = new Float32Array(this.length);
    let o = 0;
    for (const c of this.chunks) {
      all.set(c, o);
      o += c.length;
    }
    const head = all.subarray(0, Math.min(at, all.length));
    const rest = all.slice(head.length);
    const keepBlocks = Math.floor(rest.length / BLOCK);
    let loudest = 0;
    for (let i = 0; i < this.blocks.length - keepBlocks; i++) loudest = Math.max(loudest, this.blocks[i]);
    // The last sliver, shorter than a block, takes the loudness of the end.
    if (!keepBlocks && head.length % BLOCK) loudest = Math.max(loudest, this.peakOf(head.subarray(head.length - (head.length % BLOCK))));
    this.blocks = keepBlocks ? this.blocks.slice(-keepBlocks) : [];
    this.chunks = rest.length ? [rest] : [];
    this.length = rest.length;
    // A sliver too short to hold a word isn't worth sending.
    if (head.length >= RATE * 0.25) this.onPiece(wav(head), head.length / RATE, loudest);
  }

  private peakOf(samples: Float32Array) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    return samples.length ? Math.sqrt(sum / samples.length) : 0;
  }
}
