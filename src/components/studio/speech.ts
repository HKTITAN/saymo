// Listening for the teleprompter, with the browser's own speech
// recognition (the Web Speech API). Newer Chrome can recognise speech on
// this Mac (it downloads a language pack once); otherwise the browser sends
// the audio to its speech service. `speechSupport` says which, so the
// prompter can tell the person in one line.

/* The Web Speech API isn't in TypeScript's DOM types yet. */
type Alternative = { transcript: string };
type Result = { isFinal: boolean; length: number; [i: number]: Alternative };
type ResultEvent = { resultIndex: number; results: { length: number; [i: number]: Result } };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  mode?: string;
  onresult: ((e: ResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: (track?: MediaStreamTrack) => void;
  stop: () => void;
  abort: () => void;
};
type Availability = "available" | "downloadable" | "downloading" | "unavailable";
type RecognitionClass = {
  new (): Recognition;
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<Availability>;
  install?: (o: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
  availableOnDevice?: (lang: string) => Promise<Availability>;
  installOnDevice?: (lang: string) => Promise<boolean>;
};

const recognitionClass = (): RecognitionClass | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

// "local": recognised on this Mac. "downloadable": could be, once the
// language pack is installed. "service": the browser's speech service.
// "none": this browser can't follow your voice.
export type SpeechSupport = { kind: "local" | "downloadable" | "service" | "none"; lang: string };

const languages = () => {
  const own = typeof navigator !== "undefined" ? navigator.language : "en-US";
  return [...new Set([own, "en-IN", "en-US", "en-GB"].filter((l) => l.toLowerCase().startsWith("en")))];
};

async function localState(C: RecognitionClass, lang: string): Promise<Availability> {
  try {
    if (C.available) return await C.available({ langs: [lang], processLocally: true });
    if (C.availableOnDevice) return await C.availableOnDevice(lang);
  } catch {}
  return "unavailable";
}

export async function speechSupport(): Promise<SpeechSupport> {
  const C = recognitionClass();
  const langs = languages();
  if (!C) return { kind: "none", lang: langs[0] ?? "en-US" };
  let downloadable: string | null = null;
  for (const lang of langs) {
    const state = await localState(C, lang);
    if (state === "available") return { kind: "local", lang };
    if ((state === "downloadable" || state === "downloading") && !downloadable) downloadable = lang;
  }
  if (downloadable) return { kind: "downloadable", lang: downloadable };
  return { kind: "service", lang: langs[0] ?? "en-US" };
}

// Installs the language pack for on-device recognition. Needs a click.
export async function installSpeech(lang: string): Promise<boolean> {
  const C = recognitionClass();
  try {
    if (C?.install) return await C.install({ langs: [lang], processLocally: true });
    if (C?.installOnDevice) return await C.installOnDevice(lang);
  } catch {}
  return false;
}

export type Listener = { stop: () => void };

// Listens until stopped, handing over everything heard so far in this
// session (final and interim words together) each time it changes. The
// browser ends a session now and then; it's started again, and the words
// carry on from where they were.
export function listen({
  lang,
  local,
  track,
  onHeard,
  onProblem,
}: {
  lang: string;
  local: boolean;
  track?: MediaStreamTrack;
  onHeard: (transcript: string) => void;
  onProblem: (message: string) => void;
}): Listener | null {
  const C = recognitionClass();
  if (!C) return null;
  let stopped = false;
  let earlier = ""; // what was heard in sessions that have ended
  let current: Recognition | null = null;
  let failures = 0;

  const begin = () => {
    const r = new C();
    current = r;
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    if (local) {
      if ("processLocally" in r) r.processLocally = true;
      else r.mode = "ondevice-only";
    }
    let session = "";
    r.onresult = (e) => {
      failures = 0;
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += `${e.results[i][0]?.transcript ?? ""} `;
      session = text;
      onHeard(`${earlier} ${session}`.replace(/\s+/g, " ").trim());
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      failures++;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        stopped = true;
        onProblem("Mic blocked, allow it or move the script with the arrow keys");
      } else if (e.error === "network") {
        onProblem("Speech service unreachable, move the script with the arrow keys");
      } else if (e.error === "language-not-supported") {
        stopped = true;
        onProblem("The browser can't follow this language. Move the script with the arrow keys.");
      }
    };
    r.onend = () => {
      earlier = `${earlier} ${session}`.slice(-2000);
      if (stopped) return;
      // Keep listening; give up after a run of failures.
      if (failures > 4) return;
      setTimeout(() => !stopped && begin(), failures ? 600 : 50);
    };
    try {
      // Newer Chrome listens to the chosen microphone; older ones ignore
      // the track and use the default one.
      if (track) r.start(track);
      else r.start();
    } catch {
      try {
        r.start();
      } catch {}
    }
  };
  begin();
  return {
    stop: () => {
      stopped = true;
      try {
        current?.abort();
      } catch {}
    },
  };
}
