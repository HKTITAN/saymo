# Found on the second Mac

Measured on 2026-11-02 and 3, while building parallel versions of dictation, rules and reference sounds. Those versions were never pushed, because the first Mac's versions came first. They're in a git stash on the second Mac only.

## The reference-sound listener: tempo right, key wrong

`scripts/studio/listen.mjs` was checked against rekordbox's own analysis of its demo tracks, with rekordbox's numbers as the answer key:

| Track | rekordbox | listen.mjs |
| --- | --- | --- |
| Demo Track 1 | 128 BPM, F minor (4A) | 127.7 BPM; "Key: F major (clear, fit 0.79; next F minor 0.68)" |
| Demo Track 2 | 120 BPM, F minor (4A) | 120.0 BPM; "Key: C minor (likely, fit 0.61; next F minor 0.59)" |

- **Tempo** is right on both.
- **The key** is wrong on both, and once it's called "clear". The right key is the runner-up both times.
- **A second attempt failed too.** A parallel listener on the second Mac was also wrong with Krumhansl-Kessler and with Temperley profiles, at 2048 and 8192-point FFTs, so it dropped the key.

Options: drop the key, or give the top two when their fits are within about 0.15 ("F major or F minor") and never call it clear. Test again either way.

Test files with known answers, through the local rekordbox MCP (`library_search` with `analyzed_only`, then `track_detail` for each file's path):

- `~/Music/PioneerDJ/Demo Tracks/Demo Track 1.mp3` and `Demo Track 2.mp3`: full tracks, the real test of key.
- `~/Music/rekordbox/Sampler/GROOVE CIRCUIT/PRESET/4-Floor Breaks Kit/`: Breaks1 (130 BPM, 7A), Breaks2 (139.8, 8A), Breaks3 (120.99, 8A), House3 (139.82, 1A), House4 (150, 1A). These are 7 to 13 s drum loops, so their keys are weak evidence. They do catch a tempo trap: a plain autocorrelation reads them at half or two-thirds speed unless it takes the fastest strong repeat between 90 and 180 BPM.

Camelot keys: nA is minor, so 1A is Ab, 4A is F, 7A is D and 8A is A.

## whisper.cpp

- **Don't shorten whisper's audio window** (`-ac`, or `audio_ctx` per request) with large-v3-turbo. It was faster, but it turned clean prompts into nonsense, mixed in Urdu and Devanagari, repeated sentences, and made up a page of text from silence. The dictation doesn't use it today; keep it that way.
- **Without voice detection, silence comes back as "you".** Silero VAD fixes it, and the dictation already uses it.
- **whisper-server's "listening at" line never arrives through a pipe,** because stdout is block-buffered there. Wait for its port to accept a connection instead.
- **`@remotion/install-whisper-cpp` can't fetch quantised models.** Its `downloadWhisperModel` rejects names like `large-v3-turbo-q5_0`, writes the file in place and never checks its size.
- **whisper-server answers any web page** (`Access-Control-Allow-Origin: *`) and has a `/load` endpoint that takes a file path. The dictation's secret `--request-path` covers this.
- **A crash may leave the server running.** The dictation stops the server on a normal exit (`process.once("exit")`). Check whether a hard crash of `next dev` leaves one running; a watchdog that checks the parent process every 2 s closes that gap.
- **Speed on the M1 Pro (32 GB),** with large-v3-turbo-q5_0, Silero VAD and a warm server: about 1.2 s for a 4 s prompt, and about 2.5 s from cold.
