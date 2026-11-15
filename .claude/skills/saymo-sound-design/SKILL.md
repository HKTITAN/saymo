---
name: saymo-sound-design
description: Read before writing or changing a studio film's sound (films/<id>/sound/score.js). How the score works (a music bed of looping parts, Tone.js hits at exact film times), how to render it and "hear" the result, the Saymo sonic language, syncing to the film's moments, ducking under speech in video films, loudness, following reference sounds the person attaches, and licences.
---

# Sound design in the studio

Every studio film, motion or video, can have a sound track. You write it as a **score** in `sound/score.js`; the studio renders it to `sound/sound.wav`, exactly as long as the film, plays it in sync while the person watches, and mixes it into every render. The person never sees the code; they hear the film.

The contract is `src/lib/studio/sound/sound.ts`. Read it once.

## The score

`sound/score.js` is an ES module with one default export. It may not import anything: Tone is provided.

```js
export default {
  // Music: a music bed, parts that loop at one tempo.
  music: {
    bpm: 120,
    parts: {
      pulse: { sound: "sine", notes: "c1 . c1 .", decay: 0.5, sustain: 0, lowpass: 180, gain: 0.9 },
      pad: {
        sound: "sawtooth",
        notes: "c3+eb3+g3 | ab2+c3+eb3",
        attack: 0.6, sustain: 0.8, release: 1.2,
        lowpass: { from: 500, to: 1200, shape: "sine", bars: 8 },
        gain: 0.06,
        room: 0.4,
      },
    },
  },
  musicGain: 0.5,      // 0..1, default 0.6
  musicStart: 0,       // film seconds, default 0
  musicFadeOut: 1,     // seconds at the end, default 1
  duck: 0.3,           // video films: music level while someone speaks (1 = no dip)

  // Effects: Tone.js, scheduled at exact film times.
  async effects({ Tone, at, duration, marks, params, fps, graphics, speech }) {
    const tick = new Tone.MembraneSynth().toDestination();
    tick.triggerAttackRelease("G4", 0.05, at(marks.find((m) => m.label === "Cover").t));
  },
  effectsGain: 0.8,
};
```

- `at(seconds)` turns film time into audio time. Always schedule with it.
- `marks` are film.json's moments, plus, in a video edit, the moments in edit.json's `marks`, which hang on spoken words and are handed over in film time after every cut. Find a hit's moment by its label (`marks.find((m) => m.label === "Reveal")`), never by a time you typed, so it stays on its word when the edit changes. `params` are the film's current values (a `speed` param changes when things happen: divide times by it, as the starters do).
- Video films also get `graphics` (each graphic on the timeline: `graphic`, `start`, `duration`) and `speech` (spans of film time where someone talks). Other films get empty lists.
- **Deterministic only.** No `Math.random`, `Date.now`, `performance.now` or anything clock-timed in your own code: a score must sound identical every render. The bed's noise and rooms are seeded, and so is Tone's noise.
- `Tone.Reverb` builds its room asynchronously: make `effects` `async` and `await reverb.ready` before playing into it.

### When to use which

| The music bed (`music`) | Tone.js (`effects`) |
| --- | --- |
| Beds, pulses, rhythm, chords, anything that repeats in bars | One-off hits that must land on an exact moment |
| Tempo is `bpm`; a bar is `beatsPerBar` beats (default 4) | Times are film seconds via `at()` |
| Example: a sub pulse, a soft arpeggio, a pad | Example: a whoosh into a mark, a tick, one bright note |

### The music bed

`music` is `{ bpm, beatsPerBar, parts }`. Each part is named for what it plays (`pulse`, `pad`, `arp`, `glints`) and loops on its own; the contract with every setting is `MusicBed` in `src/lib/studio/sound/sound.ts`.

**Notes.** `notes` is one loop of the part: bars split by `|`, each bar into equal steps by spaces.

- A step is a note (`c2`, `eb3`, `f#4`; middle C is `c4`), notes joined by `+` for a chord (`c3+eb3+g3`), `.` for a rest, `_` to hold the step before for one more step (also across a bar line), or `x` for a hit with no pitch (noise parts).
- `"c1 . c1 ."` is four steps a bar with a note on 1 and 3. `"c2 | ab1"` is one note a bar, two bars, looping. `"c3+g3+eb4 | _"` is one chord held for two bars. A bar can have any number of steps: `". . g5 d6"` puts two quick notes at the end.

**Sound.** `sound`: `sine`, `triangle`, `square`, `sawtooth`, or noise as `white`, `pink`, `brown`. No samples. Make drums in Tone instead (`MembraneSynth` for a kick or tick, `NoiseSynth` through a filter for a hat, `MetalSynth` sparingly).

**Shape.** Each note has a linear envelope held for its length: `attack`, `decay`, `sustain` (a level, 0 to 1) and `release`, in seconds. A pluck is `decay: 0.12, sustain: 0`; a pad is `attack: 0.6, sustain: 0.8, release: 1.2`. Then `lowpass` and `highpass` (Hz) with `lowpassQ` and `highpassQ` (dB, default 1), `gain` (1 is one strong voice; bed parts usually sit between 0.02 and 0.5), `pan` (-1 left to 1 right), `room` and `roomSize` (how much goes into a room, and its length in seconds), and `delay`, `delayTime` (seconds) and `delayFeedback` for an echo.

**Slow movement.** `lowpass`, `highpass`, `gain` and `pan` can be a slow wave instead of a number: `{ from: 300, to: 1100, shape: "sine", bars: 8 }`. Shapes are `sine` (starts in the middle, rising), `rise`, `fall`, `triangle` and `square`; `bars` is how long one sweep takes. It glides through every note; add `hold: true` to fix each note at the wave's value when it starts.

**Sync the tempo to the film.** Pick `bpm` so a bar lines up with the film's moments: if things happen every 2 s, `bpm: 120` (4 beats a bar), or half or double. Start the music at a mark with `musicStart`; bar 1 starts there.

**Music drawn with Tone.** For something the bed can't express, `music` can be an async function like `effects` (it gets the same kit, plus `start`, the music's start). Prefer the bed: it's easier to change one part of.

**Older films.** In-house, films made before the bed may have Strudel code (a string) as their music. It still plays. Leave it alone unless the person asks to change the music; then change it in place, as little as possible. Never write new Strudel music: new music is always a bed. A developer can turn a film's Strudel music into a bed with `node scripts/studio/convert-score.mjs <film-id>` (it keeps the original as `score.strudel.js`); that's not something to do in a chat turn.

## Hear what you made

After writing the score, run exactly:

```
node <project>/scripts/studio/sound.mjs <film-id>
```

(the system prompt gives the full command). It renders and prints:

- the length, loudness (LUFS) and true peak;
- how many music notes played and at what tempo;
- every **onset** (where a sound starts) with the film mark or graphic it lands on, e.g. `0.60 s at -12 dBFS on "Accent arrives" (0.60 s, exact)`.

Read it like a mix engineer: each intended hit should show as an onset on its mark (within 20 ms). A missing onset means the hit is too soft, masked by the bed, or scheduled at the wrong time. Too many onsets means clutter. Then run the film checker; it renders the score twice and fails if it isn't deterministic.

The studio normalises every sound to about **-16 LUFS** with peaks under **-1.5 dBTP** (right for LinkedIn, X and Instagram, which all play around -14 to -16). So balance the parts against each other (`musicGain`, `effectsGain`, each node's gain); don't chase overall loudness.

## Changing one part

The person sees the sound on the timeline as two lanes, **Music** (your music bed) and **Effects** (your Tone.js `effects`), rendered as two stems (`sound/music.wav`, `sound/effects.wav`) that add up to `sound.wav`. They can pick a span of one lane and either change its volume themselves or ask you about just that bit. Then the message carries a `<sound>` note: the stem and the film times.

- Change only what plays on that stem between those times. Everything else must render byte-identical: the same notes, hits, times and gains outside the span, and nothing on the other stem moves. Read the score first and find exactly which notes or hits fall in the span.
- Effects: retime, replace or reshape only the hits scheduled inside the span (a tail that rings past its end is fine).
- Music: parts loop in bars, so gate the change to the span with `from` and `to` (film seconds): end the old part there (`to`), add the new part with `from` and `to` set to the span, and if the old part plays again after it, add a copy of it from the span's end. Notes are gated by when they start, and every part keeps counting bars from `musicStart`, so the rhythm doesn't shift. Don't change `bpm`, `musicStart`, `musicGain` or the other parts: they move the whole bed.
- "Try another" means a fresh take on that span only: a different sound, rhythm or note in the same place, same overall level.
- Render with the sound command as usual and check the onsets outside the span are unchanged.

**Their own volume edits** live in `sound/mix.json`: spans of one stem made louder, quieter or muted, with 20 ms fades at the edges. The studio applies them on top of whatever you render (the stems are mixed again with them, then given the same loudness gain), and they stay when you change the score. Never edit `mix.json` (or the stems, `master.json` or the peaks files). The sound command's report lists them, so you know a quiet span may be their choice rather than the score.

## Reference sounds

The person can attach sound files to a prompt (often with a picked span): "make this feel like that". They're saved in the film's `refs/`, and the message carries a `<references>` note. You can't hear and can't Read audio, so listen with the listening tool (the note gives the exact command):

```
node <project>/scripts/studio/listen.mjs --film <id> refs/<file> [--from s --to s]
node <project>/scripts/studio/listen.mjs --film <id> --stem music|effects|mix [--from s --to s]
```

It prints tempo (BPM, confidence) and beats, onsets, how hits attack and decay, the key and main notes over time, loudness (LUFS) and a loudness envelope, brightness (spectral centroid) over time, the low, mid and high balance, stereo width, and any words. The `--stem` form hears the film's own rendered sound in film seconds, so you can compare like with like.

1. Listen to each reference. Pick out the two or three qualities that matter for the ask: often tempo or rhythm, the shape of the hits (sharp and short, or soft and ringing), brightness and register, how busy it is, how wide.
2. Listen to the picked span of the film's stem with the same `--from` and `--to`, and note the gap.
3. Change only the picked stem and span (as in "Changing one part"), towards those qualities, in the Saymo sonic language: a "huge trailer hit" reference becomes the cleanest version of that, not a boom.
4. Render with the sound command, listen to the stem again, and check the numbers moved the right way (tempo, attack, centroid, balance).
5. Start your reply by naming what you took from each reference in a few words: "From beat.mp3: its 92 BPM swing and soft, short kick."

References are guidance only. Never copy, sample, load or play the reference audio in the film, never point the score or the edit at a file in `refs/`, and don't lift a melody note for note. Make an original sound that shares the qualities. If they want that exact recording in a video film, tell them to bring it in as media.

## The Saymo sonic language

The default for the `clean` kit and any kit without its own. Another kit's `rules.sound` wins where it differs.

Clean, minimal, digital, warm underneath: flat, precise, nothing decorative.

- **A low pulse** (sine sub, 40 to 70 Hz, short decay) as the floor. Slow: one or two beats a second at most.
- **Soft ticks** for small events: a text line rising, a figure counting, a card landing. Short (under 0.1 s), high and quiet.
- **Air that follows the picture**: when something sweeps across the screen, its sound travels the same way. Filtered pink noise, its band rising (400 Hz to 3 kHz), panned from the side it enters (0.8 to 0.9) to the centre, peaking exactly as it lands.
- **One bright accent when the accent colour lands**: a single FM or sine bell note (G5 or C6), with a little room. Once per film, like the accent itself.
- **Leaving**: brown noise through a falling lowpass as the frame clears.
- **Never cheesy**: no risers that scream, no booms, no stock "corporate" chords, no laser zaps, no stacked whooshes. If in doubt, take a sound away.
- Keys that sit well: C minor, A flat major, sparse notes from C, Eb, G, Bb.

## Video films: leave room for speech

- The footage's own sound always sits on top; the score goes under it.
- Music dips to `duck` (default 0.3, about -10 dB) while someone speaks, eased in and out. Use 0.2 for dense talk, 0.5 for sparse lines, 1 to switch it off.
- Prefer no music under a talking head unless asked; a light hit on each graphic is enough (the starter does this).
- Hits should not land on a word. Use `speech` to nudge a hit into the gap before or after.
- Music-led edits (event recaps): pick `bpm` so cuts land on bar lines; tell the person where the beats are so cuts can follow.

## Licences

- **The music bed** is the studio's own code, played with **Tone.js** (MIT), as are the effects. The rendered audio is ours to use anywhere.
- **Strudel**, which older in-house films' music is written in, is **AGPL-3.0**. It's only in the in-house edition; never add it to anything else, and don't suggest it for new music.
- **Reference sounds** the person attaches belong to someone else, often under copyright. They only guide the sound; nothing of theirs (audio, samples, a recognisable melody) goes into the film.

## Before you finish

1. Run the sound command and read the report: hits on their marks, no clutter, nothing clipping.
2. Run the film checker (it confirms the score is deterministic).
3. Tell the person in plain words what they'll hear and when ("a soft whoosh as the title arrives at 0.6 s, then a low pulse under it"), never the code.
