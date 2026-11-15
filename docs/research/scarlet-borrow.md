# What Saymo should borrow from Scarlet

Researched 2026-11-14. Scarlet read at commit `8fb7129` (github.com/Forward-Future/scarlet, 2026-11-13, MIT). Saymo read at commit `ae26215`.

This report borrows ideas and designs only. No Scarlet code was copied and none should be: every design below is described in our own words, to be written fresh. Scarlet's repo was read as data; none of its scripts were run.

## TL;DR

The top 5 to borrow, in order:

1. **Let Claude see the film it made.** Give it a command that returns stills of its own film at chosen moments, with a before row, so it stops finishing blind.
2. **Number each change and give it a card.** One sentence on what it did, an amber "check this" flag when Claude is unsure, a Before/After toggle, and Undo or Revise for that one change.
3. **Name words, let code place the cut (video edits).** Claude picks words by number, a tool snaps the edges onto real silence, and a read-back shows what the edit actually plays, joins included.
4. **Learn standing rules from what people ask.** A small side run reads each prompt for a "from now on" rule and offers it on the Rules page, where one click approves it.
5. **Write the agent contract down before open-sourcing.** One doc that says what Claude decides, what Saymo measures and guards, where each kind of instruction lives, and why each rule exists.

## Scarlet in one paragraph

Scarlet is a desktop video editor for interviews and podcasts. You ask Claude Code or Codex for a change, and the agent edits a timeline through Scarlet's own MCP tools. The whole design rests on one split, written down in `docs/AI-AGENTS.md`: the model makes the taste calls, the harness (Claude Code, Codex) runs the agent loop, and Scarlet measures the footage, applies edits safely, versions every edit and shows the editor only what needs their eye. Most of its cleverness is in measurement: tools that turn sound and pictures into numbers and images the model can read, so the model "can only edit what it can see" and sees enough.

Saymo already shares a lot of that thinking (a locked-down Claude, one live "what it's doing" line, short replies, undo per turn, a queue, a Rules page, carry-on after limits). The gaps are mostly in **checking work** and in **reviewing changes one at a time**.

## Ranking at a glance

| # | Idea | Helps | Effort | Risk | Phase |
|---|---|---|---|---|---|
| 1 | Claude sees its own film (stills, before and after) | Both | M | Low | 1 |
| 2 | Numbered changes with a card each | Both | L (in three S/M steps) | Medium | 2 |
| 3 | Word-numbered cuts, measured edges, edit read-back | Video edits | M | Medium | 1 |
| 4 | Rules learned from prompts, approved on the Rules page | Both | M | Low | 3 |
| 5 | An agent contract doc, and slimmer skills | Both | S | Low | 1 |
| 6 | Suggestions as one-tap chips, not only edits | Both | S (after 2) | Low | 3 |
| 7 | Evals: keep every turn's trace, grade with code | Both | M | Low | 3 |
| 8 | Sound picture: waveform, spectrogram, words and marks as one image | Both | M | Low | Later |
| 9 | Export a video edit to DaVinci Resolve (.otio) | Video edits | M | Medium | Later |
| 10 | A capabilities table per AI, instead of rewriting prompt text | Both | S | Low | Later |

---

## 1. Let Claude see the film it made

**What Scarlet does**

| Evidence | What it says |
|---|---|
| `docs/AI-AGENTS.md`, rule 9 | Every model gets a way to check its own work in text and numbers; pictures and audio are extras for models that can use them. |
| `packages/mcp/src/server.ts`, `frame_contact_sheet` and `frame_contact_sheet_batch` | Timestamped frames from a source **or from a version of the edit**, up to 120 s per window, up to 8 windows in one call. |
| `skills/add-captions/SKILL.md` | "`frame_contact_sheet` shows the captions composed on a version." The agent looks at the finished composite, not just the footage. |
| `server.ts`, `change_review_cut` | Compares one changed spot on the old and new versions, reports new black frames, freezes and sudden level jumps, with labelled side-by-side frames. |
| `packages/shared/src/capabilities.ts` | Picture tools are only offered when the AI can actually receive images. |

**What Saymo does today**

| Where | What |
|---|---|
| `src/lib/studio/agent/claude.ts`, `claudeArgs` | Claude may Read stills of the **footage** (`films/.work/<id>/frames`, made by `media-tool frames`), run the checker, and run a draft render. It can't open an mp4, so the draft render gives it nothing to look at. |
| `scripts/studio/check-film.mjs` | HTML films: `hyperframes check` (lint, runtime, layout, contrast) and a 3D layer budget. React films: the component bundles. Rust: the crate builds. All text, no pictures. |
| `.claude/skills/saymo-video-edit/SKILL.md`, reel step 8 and the popout and fade layouts | Asks Claude to "look at `frames` from a draft" and "check a draft frame there". There is no command that makes stills of the composed edit, so it can't. |

**The gap.** On a motion film, Claude never sees a single picture of what it made. It checks that the code runs and the layout measures pass, then reports "the title now slides in from the left" without having seen it. On a video edit, it sees the raw footage but never the result: graphics over the speaker, captions on the seam, a popout's head crossing the line.

**Design for Saymo**

- New command `scripts/studio/look-film.mjs <id> [t ...] [--marks] [--before <n>] [--sizes]`:
  - HTML films: wraps the local HyperFrames CLI's `snapshot` command, which is already installed in `studio/hyperframes` (v0.8.227 lists `snapshot` and `compare`). React and video films: renders stills from the stage bundle. Rust films: pulls frames from the draft video.
  - Returns **one contact sheet** (up to 12 frames, about 480 px each, time and mark label burned in) saved to `films/.work/<id>/stills/`, and prints the path to Read.
  - `--marks` takes one frame at each mark in film.json. `--before <n>` adds a second row with the same moments from the snapshot taken before this turn. `--sizes` shows one moment at 16:9, 1:1, 4:5 and 9:16, to catch what "Every size" would cut off.
- `src/lib/studio/agent/claude.ts`: allow `Bash(<look-film> *)` and `Read(films/.work/<id>/stills/**)`, add a step label ("Looking at the film"), add one line to the system prompt and to `codexInstructions`.
- `.claude/skills/saymo-film/SKILL.md` "Before you finish": look at the film at its marks after any visual change. `saymo-video-edit` step 8 and the layout checks point at the new command instead of "a draft".

**What the person sees.** A new step on the live line, "Looking at the film", and fewer follow-up prompts like "the headline is cut off" or "the logo sits on the speaker's face". Optional later: show the contact sheet in the chat under Claude's reply as a receipt.

| Effort | Risk | Helps |
|---|---|---|
| M | Adds seconds and image tokens to a turn: cap frames and size, and let Claude choose when to look. Snapshots must not queue behind a final render. Films are already seekable and deterministic, so stills are reliable. | Both |

---

## 2. Number each change and give it a card

**What Scarlet does**

| Evidence | What it says |
|---|---|
| `packages/mcp/src/prompt.ts`, `SCARLET_INTRO`, "Writing for the editor" | Each edit gets a title of at most 50 characters, a one-sentence `summary` of what it did (side effects included), and a `check` only when a doubt is left that the editor must settle by watching or listening. |
| `server.ts`, `timeline_propose`, the `timelineEdits` field | The edit list is structured data: label, time range on the new timeline, check (at most 120 characters), summary, and `replaces` when it revises an earlier edit. |
| `docs/AI-AGENTS.md`, rule 14 | Only creative decisions reach the editor. Each edit can be reviewed, revised or undone on its own, so the agent can act first and the editor corrects the exceptions. |
| `AGENTS.md`, the simple view's card (`.edit-card`) | One card over the timeline: the summary as a small caption, a Before icon (`\` switches Before and After), Undo edit (U), Revise (R), Keep (K). Flagged edits are amber and counted as "N need you". |
| `AGENTS.md`, Undo edit | Undo on one edit is **a request to the agent** to put back just that edit. The chat shows it as "Undo". |
| `prompt.ts`, `selectedEdit` | A request about one edit carries what Scarlet told the editor about it: its number, title, summary and check. The editor is answering those words, so the model sees them. |
| `apps/web/src/components/review/` `BeforeToggle.tsx`, `ThreadEdits.tsx`, `TimelineMarkers.tsx` | Where that card, the edit list and the numbered timeline dots live. |

**What Saymo does today**

| Where | What |
|---|---|
| `src/lib/studio/films/films.ts`, `snapshotFilm` | The whole film is copied before every turn (last 30 kept). |
| `src/lib/studio/films/contract.ts`, `Version` | Versions are labelled by prompt ("After: <prompt>"). |
| `src/lib/studio/agent/claude.ts`, `noteUndo` | Undo puts back the whole last turn. |
| `systemPrompt` and `userMessage` in `claude.ts` | The reply is at most two sentences, under 35 words. There is no list of what changed. |
| `ChatEvent` in `contract.ts` | A turn reports `changed` files, not changes a person would recognise. |

**The gap.** A turn that fixes the title, slows the outro and recolours the bars is one lump: you can only keep or undo all three, and you can't see where on the timeline each one happened. Claude also has no way to say "I changed this but you should look at it".

**Design for Saymo**

Step A, receipts and dots (S to M):

- `contract.ts`: add `TurnEdit = { n, title, from?, to?, summary, check? }` and `edits?: TurnEdit[]` on Claude's `ChatMessage`.
- Claude writes `films/<id>/turn.json` (`{ "edits": [...] }`) as its last act. After the turn, `claude.ts` reads it, checks it (times inside the film, at most 8 edits, title at most 50 characters), stores it with the chat message and the version, then deletes the file. No range means "the whole film" (a colour change everywhere). A missing receipt falls back to the turn as one edit.
- `check-film.mjs` validates `turn.json` when present, so a bad receipt is caught while Claude can still fix it.
- `timeline.tsx`: numbered dots for the latest turn's edits, amber when they carry a check. `chat.tsx`: one line under the reply, "Made 3 edits", that opens the rows.

Step B, the card and per-edit undo (M):

- New `edit-card.tsx` over the timeline: the summary, Revise (R), Undo edit (U), Keep (K, clears the amber flag).
- Undo edit and Revise send an ordinary turn with the edit in its context (`ChatContext.edit = { turn, n, title, summary, from, to }`). `userMessage` adds a note quoting what Claude said about that edit. Undo is Claude putting it back, as in Scarlet, because a motion film is code, not a list of operations.

Step C, Before and After (M):

- `src/app/studio/stage/[id]/route.ts` and `[...path]/route.ts`: serve a snapshot with `?v=<n>` from `.history/<n>/`, falling back to the film's `media/` (snapshots skip footage).
- `stage.tsx`: `\` swaps the stage to the snapshot and back at the same playhead, playing from a second before the edit to a second after.

| Effort | Risk | Helps |
|---|---|---|
| L in total, shippable in the three steps above | Claude may forget the receipt or give loose ranges: fall back gracefully and ask for it in the checker. Per-edit undo by request can touch neighbouring work: the card's summary and range keep it scoped. | Both |

---

## 3. Name words, let code place the cut (video edits)

**What Scarlet does**

| Evidence | What it says |
|---|---|
| `docs/AI-AGENTS.md`, rule 10 | The model names words by transcript number (`fromWord`, `toWord`) and Scarlet finds the exact edge in measured silence. A pause is named by the word before it, with how much to `leave`. Pauses typed in seconds left a median 0.54 s where the human editor's cut left 0.25 s. |
| `server.ts`, `timeline_first_cut` | Keeps are given as word ranges. An edge that would leave a piece of a sound playing moves onto the quiet that ends it (at most 0.12 s) and is reported back as a moved edge. A keep that ends inside a sounding word is refused. |
| `server.ts`, `timeline_propose`; rule 6 | Any audible clip edge, however it was made, is measured. One inside a sounding word refuses the edit and names the quiet second beside it. Scarlet never silently changes the model's work: every adjustment is reported with its evidence. |
| `packages/mcp/src/perception-tools.ts`, `timeline_transcript` | What the audience hears on a version: the words in playback order on the film's clock, with a `‖` line at every join showing the words either side. |
| `perception-tools.ts`, `timeline_join_audit` | Per join: the last word, time from that word to the cut, clipped words, a verdict. |
| `packages/mcp/src/dialogue-leftovers.ts`, `gap-sound.ts` | After cutting: pauses still left in, words played twice in a row across a join, and gaps in the transcript that actually hold sound ("a gap is not a pause until the recording says so"). |

**What Saymo does today**

| Where | What |
|---|---|
| `src/lib/studio/films/edit.ts`, `Clip` | Claude writes source seconds (`from`, `to`) by hand. |
| `saymo-video-edit/SKILL.md`, "Cutting talking heads" | Hand rules: start 0.1 s before the first word, end 0.15 to 0.25 s after the last, never clip a word, cut pauses over about 0.7 s. |
| `scripts/studio/media-tool.mjs` | `words` gives timed lines in source seconds; `silences` gives quiet stretches. Each media item also has `peaks.json` at 100 values a second. |
| Same skill: "Read the transcript again over the new timings with `words`" | `words` reads the source, not the edit, so Claude has to do the timeline arithmetic in its head to check its own cuts. |
| `check-film.mjs`, `checkEdit` | Checks shape, overlaps and that clips fit their footage. Nothing checks whether an edge cuts a word. |

**The gap.** The fiddliest, most mechanical part of cutting talk (exact edges) is left to arithmetic in the model's head, and nothing measures the result. Scarlet's own numbers say this is where models are weakest.

**Design for Saymo**

- `media-tool words` prints word numbers (`#212 three`).
- New `media-tool keep <media> <#from>-<#to> [...] [--leave 0.25]`: returns ready-to-paste clips whose edges sit on measured quiet (transcript plus `peaks.json`), each moved edge listed with how far and why.
- New `media-tool played`: reads edit.json and prints what the viewer hears, on the film's clock, with a `‖` at each join and the words either side. It flags a word cut short at an edge, the same word twice across a join, a leftover gap over 0.7 s, and sound at speaking level with no word ("something is said here that the transcript missed").
- `check-film.mjs`: an audible clip edge inside a sounding word is an error that names the nearest quiet second. Report, never fix silently.
- `saymo-video-edit/SKILL.md`: swap the lead-in and tail arithmetic for "use `keep`, then read `played`". Keep the taste (what to cut, what to keep, pacing by platform).

**What the person sees.** Fewer clipped words and doubled words in first cuts, and Claude's reply can say "took out 14 s of pauses" with numbers it measured.

| Effort | Risk | Helps |
|---|---|---|
| M | whisper.cpp word times drift (Scarlet measured about 90 ms before it added forced alignment): search the level dip near each word boundary rather than trusting word ends. Only check tracks with speech, not music. | Video edits |

---

## 4. Learn standing rules from what people ask

**What Scarlet does**

| Evidence | What it says |
|---|---|
| `docs/AI-AGENTS.md`, rule 17 | Every request is read for a standing rule as it is sent, by a short separate run that sees no footage. It offers one sentence, the skill it belongs in, and what that skill already says that the rule would override, quoted word for word. Nothing is saved without the editor's approval. |
| `apps/server/src/services/learnings.ts`, `startLearningCheck` | Only human requests are read. A message that only names a workflow ("/dialogue-pass"), a resumed run, and anything Scarlet sent itself are skipped. It runs beside the request, outside the queue, so it never slows the edit. |
| `learningCheckContext` | The check sees the request, what it was aimed at, the last 6 requests in the project and up to 30 rules already known. |
| `packages/mcp/src/prompt.ts`, `buildLearningCheckPrompt` | The one question: does the message say how they want something done from now on, in any video like this, and not only here? If not, call nothing. |
| `learnings.ts`, `quotedFrom` and `requireApprovedLearningEdit` | A quote that isn't in the skill word for word is sent back. The save may only add the approved rule and remove the quoted passages; anything else is refused. |
| `apps/web/src/components/review/LearningsPanel.tsx`; `AGENTS.md` | Each rule shows: the rule, "You said:" with their words, "Replaces" in amber with the old words, then Revise, Approve and a small × to decline. Empty: "Nothing to learn yet." |

**What Saymo does today**

| Where | What |
|---|---|
| `src/lib/studio/agent/rules.ts` | `studio/rules.json`, up to 40 rules (title, body, scope, on), in git and shared by the team. |
| `src/components/studio/settings/rules-panel.tsx` | Edited by hand on the home page. |
| `rulesNote` in `rules.ts` | Every turn carries the rules that apply to the film's kind. |

**The gap.** People say "never bounce the logo" or "always end on the wordmark" in prompts all the time. Today that stays in one film's chat. The Rules page only grows when someone remembers to go and type it.

**Design for Saymo**

- New `src/lib/studio/learnings.ts`: after each human prompt (not "carry on", not a Try 3 pick, not an automatic turn), start a side run in the background: `claude -p` with no tools, a small cheap model, and only text: their words, what they pointed at, the film's kind, their last 6 prompts, and every rule with its id. It answers with JSON: no rule, or `{ title, body, scope, replaces? }` where `replaces` is an existing rule's id.
- Saved to `studio/learnings.json` as suggested or declined. A rule id that doesn't exist is dropped.
- `rules-panel.tsx`, top: "Suggested from what you asked". Each block: the rule, "You said: ...", "Replaces: ..." in amber when it overrides one, Reword, Approve, ×. A small dot on the Rules link while one waits. Nothing in the film's chat.
- Approve writes `rules.json` directly. Saymo's rules are short list items, so no agent is needed to merge text, which removes the hardest part of Scarlet's version.
- Since `rules.json` is shared through git, the card says so: "Every film follows this rule".

| Effort | Risk | Helps |
|---|---|---|
| M | One small extra run per prompt (tokens on the person's plan): use a small model and allow switching it off. Noisy suggestions: the prompt defaults to "no rule" and the person declines in one click. | Both |

---

## 5. Write the agent contract down before open-sourcing

**What Scarlet does**

| Evidence | What it says |
|---|---|
| `docs/AI-AGENTS.md`, "Three layers" | Model: taste. Harness: the agent loop. Scarlet: measuring, safe editing, the interface. "When code in Scarlet starts deciding what belongs in the video, or starts running the agent's loop, it is in the wrong layer." |
| Rule 3 | Say each thing once, in the right place: tool mechanics in tool descriptions, taste in skills, the product's contract in one intro. "If you find the same rule in two of these, delete one." |
| Rule 4 | Add instructions only for observed failures, prefer a better tool to another sentence, and after each model upgrade run the evals and delete the rules the model no longer needs. |
| Comments across `server.ts`, `tasks.ts`, `prompt.ts` | Rules carry the dated failure behind them, for example a slash-command mix-up on 2026-11-07 and a clipped "uh" on 2026-11-12. |
| `skills/*/SKILL.md` | Shipped skills are 11 to 23 lines each, because mechanics live with the tools. |
| Checklists at the end of `AI-AGENTS.md` | For adding a tool, changing the prompt or a skill, adding something the editor reviews, and adding a new AI. |

**What Saymo does today**

| Where | What |
|---|---|
| `claude.ts` header comment, `docs/security.md` | The permission model is documented well. |
| `saymo-film/SKILL.md` (166 lines), `saymo-video-edit/SKILL.md` (204 lines) | Taste mixed with mechanics: edit.json's shape, every part's options, the media tool's commands. |
| `systemPrompt` and `userMessage` in `claude.ts` | Reply rules said twice. This one is deliberate (a resumed session keeps its first system prompt), but nothing records why for the next contributor. |
| `claudeArgs` and `brand-claude.ts` | `TodoWrite` is in the tool list of every turn, though the chat only shows the latest step. |

**The gap.** Once Saymo is open source, contributors will add prompt lines to fix single bad turns. Without a written contract the prompt and skills will grow and repeat themselves.

**Design for Saymo**

- New `docs/AI-AGENTS.md` for Saymo: the three layers in Saymo's terms (Claude or Codex decides the look; Saymo measures, guards permissions, versions and shows); where each kind of text lives (system prompt, per-turn message, skills, command `--help` output); rules with dates; the checklists, adapted to "adding a command Claude may run".
- Split the parts catalogue out of `saymo-film` into its own skill, read only when a part is used. Move media-tool and edit.json mechanics into the tools' own usage output.
- Measure, then likely drop, `TodoWrite`: Scarlet turned its harness to-do tool off after measuring a median of about 15 s extra per request (comment in `capabilities.ts`, 2026-11-08) once its chat stopped showing plans. Run 10 turns with and without in Saymo before deciding.

| Effort | Risk | Helps |
|---|---|---|
| S | Low. Splitting skills needs a quick before and after on a few real prompts. | Both |

---

## 6. Suggestions as one-tap chips, not only edits

**What Scarlet does**

| Evidence | What it says |
|---|---|
| `prompt.ts`, `SCARLET_INTRO` | Requested edits apply. Optional or preview-only ideas are a `suggestion`; competing options are an `alternative`. |
| `server.ts`, `intentInput` | Every edit declares one of those intents. Leaving it out keeps the edit in review. |
| `README.md` | "Requested edits go on the working timeline. Suggestions wait for you to apply them." |
| `AGENTS.md` | A suggestion opens in the same card: Scarlet's words, Before, Revise, Apply. |

**What Saymo does today.** Try 3 (`src/lib/studio/films/takes.ts`) makes three alternatives, but only when asked. Otherwise Claude may "offer one alternative" in words (`systemPrompt` in `claude.ts`), and trying it means typing it again.

**The gap.** Claude's good extra ideas end up as a sentence that's easy to miss and costs a retype.

**Design for Saymo.** Add `suggestions: [{ title, prompt }]` (at most 2) to the receipt from idea 2. `chat.tsx` shows each as a one-line chip under the reply with a small play mark. A click runs it as a normal turn (undoable as usual); a modifier-click runs it through Try 3 so nothing changes until a pick. The prompt says to suggest only what Claude deliberately held back.

| Effort | Risk | Helps |
|---|---|---|
| S, after idea 2 | Chip clutter: cap at two, and none is fine. | Both |

---

## 7. Evals: keep every turn's trace, grade with code

**What Scarlet does**

| Evidence | What it says |
|---|---|
| `evals/README.md` | Grades outcomes with code: what was removed by kind, whether each join lands in silence, clipped words, leftover gaps and doubled words, agreement with the editor's own cut. Trace numbers: active time, time to first change, tool calls and errors by tool, tokens. |
| `docs/AI-AGENTS.md`, rules 18 and 19 | Replay stored plans through new code; run several trials per model; rerun when a model ships to find rules it no longer needs. LLM judges only for trend charts. Never commit user media or numbers derived from it. |
| `apps/server/src/services/changes.ts`, `briefToPlayableMs` | The product itself records how long from the request to the first moment the editor can judge. |

**What Saymo does today.** No evals. `claude.ts` keeps only the latest turn's stream (`last-turn.jsonl`, deleted at the start of each turn).

**The gap.** No way to tell whether a prompt change, a skill split (idea 5) or a new model made films better or worse.

**Design for Saymo**

- Keep each turn's stream with its version (`.history/<n>/turn.jsonl`), pruned with the snapshots.
- `scripts/studio/evals/trace.mjs`: per turn, time to first file change, steps, how many checker runs and failures, whether the last check passed, tokens, reply length.
- `scripts/studio/evals/run.mjs`: a small fixed set of prompts on synthetic fixture films, N runs per model, a table out. Video cases scored with `played` from idea 3 (clipped words, doubled words, dead air).
- Data stays outside the repo, as Scarlet insists.

| Effort | Risk | Helps |
|---|---|---|
| M | Running models costs usage: keep the set small and run it on demand. | Both |

---

## 8. Sound picture

**What Scarlet does.** `server.ts`, `sound_picture`, drawn by `packages/render/src/soundPicture.ts`: up to 15 s of a recording as its waveform over its spectrogram (0 to 8 kHz), with the transcript's words at their times. With `remove`, a second row shows the passage as it would play with those ranges out, each join a red line. Rule 11 explains why: no harness delivers audio to the model today, so what an editor would hear has to arrive as a measurement or a picture.

**What Saymo does today.** `scripts/studio/listen.mjs` describes reference sounds and the film's stems in text (tempo, onsets, key, loudness, brightness). `sound.mjs` reports in text where each hit lands.

**The gap.** Small. Text covers most needs. A picture would help with "does the whoosh land on the logo" and with a breath or click at a cut.

**Design for Saymo.** `listen.mjs --picture` draws a stem with the film's marks as vertical lines and each hit labelled. `media-tool picture <media> <from> <to> [--remove a-b]` does the same for footage with words. Both save a JPEG for Claude to Read.

| Effort | Risk | Helps |
|---|---|---|
| M | Low. Image tokens per look. | Both |

---

## 9. Export a video edit to DaVinci Resolve

**What Scarlet does.** `packages/timeline/src/otio.ts` writes OpenTimelineIO JSON in the subset Resolve imports: timeline, video tracks bottom up then audio, clips pointing at the original files, gaps, markers with colours, and captions as markers because Resolve has no OTIO subtitle import. The `export_otio` tool and the Export dialog offer it next to MP4.

**What Saymo does today.** Renders MP4 only (`src/lib/studio/films/render.ts`, `RenderQuality`).

**The gap.** A designer can't hand a cut to an editor to finish in Resolve.

**Design for Saymo.** "For an editor (.otio)" in the render menu of video films only. Footage clips map one to one onto `media/<id>/original.*`. Graphics can't stay editable, so render them once as a see-through overlay video on V2, and write captions as markers plus an `.srt` beside the file. Written fresh from the open OTIO format.

| Effort | Risk | Helps |
|---|---|---|
| M | Resolve's import quirks; graphics arrive baked. | Video edits |

---

## 10. A capabilities table per AI

**What Scarlet does.** `packages/shared/src/capabilities.ts` records what each AI really receives (images, audio, file writes, a to-do tool), confirmed by testing headless. Tools and prompt text adapt to it. Rule 8: never ask the model "only if you can hear".

**What Saymo does today.** `claude.ts` rewrites the Claude prompt for Codex with text replacements (`forCodex`, and regexes in `codexInstructions` that swap whole paragraphs).

**The gap.** Regex surgery on prose breaks quietly when the prompt is edited. More AIs (once open source) make it worse.

**Design for Saymo.** `src/lib/studio/ai-capabilities.ts` with per-AI facts (skills as a tool or as files, web or none, how files are edited). `systemPrompt` builds the affected sentences from it instead of rewriting finished text.

| Effort | Risk | Helps |
|---|---|---|
| S | Low. | Both |

---

## Worth borrowing later, not now

| Idea | Scarlet evidence | Why later |
|---|---|---|
| Render only the changed seconds | `packages/timeline/src/cutReview.ts` plays 2 s before and 3 s after a cut (at most 12 s); `packages/render/src/segments.ts` caches rendered segments by what's in them, so unchanged stretches are reused. | Saymo's stage plays HTML and React films live, so previews are already instant. Only Rust drafts and final renders are slow. Revisit for final renders of video edits. |
| Notes pinned to a moment | `notes_list`, `note_reply`, `note_resolve` in `server.ts` | Matches "Review links" in `docs/roadmap.md` (item 9). Use this note model when that's built. |
| A skill from an approved change | `skill_from_change` in `prompt.ts` and `docs/skills-and-tools.md` | Matches "Make another like this one" in `docs/roadmap.md` (item 4). |

## What not to borrow, and why

| Scarlet piece | Why it doesn't fit Saymo |
|---|---|
| Tauri desktop shell, Windows support, the Rust host, native playback | Saymo is a Next.js studio with its own Swift Mac app in progress. Nothing here is needed. |
| An MCP server as the agent's only toolset | Saymo gets the same lock-down from Claude Code's "don't ask" mode plus allowlisted commands, and the same commands work for Codex. Moving to MCP is a large rewrite for no user-visible gain. |
| The dialogue-pass machinery: CrisperWhisper, wav2vec2 forced alignment, re-reading transcript holes, retake groups, filler detection, numbered "calls" waiting on the editor, the repeat-check loop | Built for 45-minute interviews. Saymo cuts short social videos and makes motion graphics. Take only the light pieces in idea 3. |
| The full simple-view spec in `AGENTS.md` (call numbering rules, "N need you" across passes, queue tray semantics, hold-for-rewording) | Far more interface than Saymo needs. Borrow the card, the dots and the Before toggle only. |
| A server-side SQL task queue | Saymo's browser queue (`use-chat.ts`) is enough for one person at a desk. |
| Telemetry on by default (PostHog, with review decisions; `docs/telemetry.md`) | For an open-source internal tool, anything like this should be off by default and opt in. |
| Showing the agent's plan or to-do list | Scarlet built it and then took it out of the chat; Saymo already shows one live step. |
| `--ephemeral` Codex runs | Saymo already keeps Codex out of the person's own Codex history with a separate `CODEX_HOME` per film (`codex.ts`), and keeps each film's conversation. Better for us as is. |
| A Gemini runner | Scarlet notes Gemini CLI stopped serving consumer accounts in June 2026. |

## Suggested build order

**Phase 1: Claude checks its own work (about a week)**

1. Idea 5: write `docs/AI-AGENTS.md`, split the parts catalogue out of `saymo-film`, measure `TodoWrite`.
2. Idea 1: `look-film.mjs` with `--marks` and `--before`, allowed in `claude.ts`, named in both skills' "Before you finish".
3. Idea 3: word numbers in `words`, the `played` read-back, and the checker error for edges inside words. Add `keep` once `played` shows where cuts go wrong.

**Phase 2: review one change at a time**

4. Idea 2, step A: `turn.json` receipts, numbered dots, "Made 3 edits".
5. Idea 2, step B: the card with Undo edit and Revise as scoped requests.
6. Idea 2, step C: the Before/After toggle from snapshots.

**Phase 3: get better over time**

7. Idea 4: learned rules on the Rules page.
8. Idea 6: suggestion chips on the receipt.
9. Idea 7: keep traces and run a small eval set before and after each of the above.

## Surprises the teammate's summary missed

1. **Scarlet's per-edit Undo is not a code revert.** It is a new request to the agent to "put back just that edit", shown as "Undo" in the chat (`AGENTS.md`). That is what makes per-change undo possible for Saymo's motion films, which are code rather than a list of operations.
2. **Scarlet switched its plan display off after measuring it.** The harness to-do tool cost a median of about 15 s per request, so it is off for every AI (`capabilities.ts`, rule 15). Saymo still passes `TodoWrite` on every turn and in the kit maker.
3. **The learning check is guarded twice.** Its quotes must appear in the skill word for word or they are sent back, and the save that follows may only insert the approved rule and remove the quoted passages (`requireApprovedLearningEdit` in `learnings.ts`). Saymo can skip the second guard because its rules are list items.
4. **Rule 17 is about ownership as much as loading.** Shipped skills are copied into the user's library once; an untouched copy gets updates, an edited copy is the user's and is never changed or merged. Saymo has the opposite problem on its list: "skill updates overwrite the 'In Saymo' notes" (`docs/roadmap.md`, item 15). Keeping Saymo's notes in a separate file next to each borrowed skill, or tracking whether a copy was edited, would solve it the same way.
5. **Saymo's skills ask for checks Claude can't do.** The video-edit skill says to look at frames from a draft, but no allowed command produces them (idea 1).
6. **The HyperFrames CLI Saymo already ships has `snapshot` and `compare`.** Idea 1 is mostly wiring, not new rendering code, for HTML films.
7. **Scarlet measures speed as "request to the first moment you can judge"** and stores it on each change (`briefToPlayableMs`), not only render time.
8. **Scarlet locks the owner's approved interface decisions in `AGENTS.md`**, each paragraph ending "The editor chose this design. Get their approval before changing its layout or labels", with the test file that checks it. A pattern worth copying into Saymo's `CLAUDE.md` before outside contributors arrive.
9. **A prompt that starts with "/" breaks Claude Code** (it is read as a slash command), so Scarlet prefixes the editor's words (`firstMessage` in `tasks.ts`). Saymo is safe today because the request sits inside a longer message, but worth a line in the contract doc.
10. **Scarlet's skills credit their source**, workflows adapted from Alex's DaVinci editing skills under MIT, with the licence shipped in the app. Saymo already does the same for its borrowed skills; keep doing it when open-sourcing.
