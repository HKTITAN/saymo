# Selling Motion Studio: what to do

Written on 2026-11-03 on the second Mac, for whoever picks this up next, person or agent. It's the plan for turning the studio into a product people pay for, based on a check of the licence of everything it ships. It isn't legal advice: have a lawyer read it before launch.

| File | What's in it |
| --- | --- |
| [licences.md](licences.md) | The licence check: what blocks selling, what's fine and what each needs |
| [ai-providers.md](ai-providers.md) | Why the Claude plan sign-in can't be in a product, and what to use instead |
| [gsap-to-motion.md](gsap-to-motion.md) | Moving films off GSAP to Motion (Framer Motion) or the browser's own animations |
| [findings.md](findings.md) | Measured on the second Mac: the reference-sound listener's key estimate, and whisper.cpp traps |

## Decided so far

- **Ownership:** the owner says ownership isn't a concern. Nothing to do here.
- **AI:** no claude.ai sign-in in the product. The owner doesn't expect Anthropic to approve it, so customers bring their own API key, or turns run on ours and we charge for them. See [ai-providers.md](ai-providers.md).
- **GSAP:** move films off it, to Motion or the browser's own animations, once one test film proves frames still come out exact. See [gsap-to-motion.md](gsap-to-motion.md).

## To do, in order

1. [ ] **Replace the Strudel sound engine.** It's AGPL-3.0, so the studio can't be sold closed while it's in, neither as a download nor as a website. Write the music in Tone.js (MIT), which the same engine already uses for effects. See [licences.md](licences.md).
2. [ ] **Move films off GSAP.** See [gsap-to-motion.md](gsap-to-motion.md).
3. [x] **AI by API key only.** Remove "Claude on your Claude plan" and "Codex on your ChatGPT plan" from product builds (`src/lib/studio/providers.ts`, `src/lib/studio/ai-types.ts`). See [ai-providers.md](ai-providers.md).
   Done: with `STUDIO_EDITION=product`, "Claude with an API key" is the only AI and the default (`OFFERED_PROVIDERS` in `ai-types.ts`), in Connections, the prompt box's picker and the chat route's check. Every Claude run (a film's chat, the kit maker, the script writer) goes through `claudeEnvFor()` in `providers.ts`: the saved key as `ANTHROPIC_API_KEY`, every other sign-in variable removed, and Claude Code's settings in `.studio/claude`, so the Mac's own Claude sign-in is never seen. The studio never asks Claude Code about a plan sign-in. With no key, each run stops before it starts and says where to paste one. The key stays in `.studio/connections/anthropic.json` (mode 600); `STUDIO_ANTHROPIC_KEY_FILE` can point at another file. The in-house edition is unchanged. Later options (Bedrock, Vertex, other models) join `PROVIDER_IDS` and the product's list.
4. [ ] **Remotion:** free while the company has 3 employees or fewer, even for a SaaS; past that, buy a Company License. Never let users upload their own Remotion code to render. Or drop the Remotion engine. See [licences.md](licences.md).
5. [ ] **Take out Aerchain's material:** the brand kit (`studio/brands/aerchain`), the three `aerchain-*` skills in `.claude/skills`, and the Aerchain wording in prompts, vocabulary and docs (47 files under `src/` and `scripts/` mention it), including the README's "in-house use at Aerchain". Ship a neutral starter kit instead.
6. [x] **Add a Licences screen and a THIRD-PARTY-NOTICES file**, generated from the installed packages (script in [licences.md](licences.md)), never written by hand.
   Done: `npm run licences` (`scripts/licences.mjs`) follows the dependencies of the app and its three engines, reads the Rust crates in `studio/starters/rust/Cargo.lock` from `~/.cargo/registry`, and adds the speech models, whisper.cpp, Bricolage Grotesque, PikaIcons and the four borrowed skills. It writes `THIRD-PARTY-NOTICES.md` and `public/licences.json`, grouped by licence with each shared licence text printed once. The product edition leaves out the Strudel family and GSAP (`PRODUCT_LEAVES_OUT`). The product's home page has an About and licences button (top right) with the studio's version, the list by licence, a search, and each one's licence text. Run `STUDIO_EDITION=product npm run licences` before a product build. Still to look at: 134 Rust crates aren't downloaded on this Mac (most are for other systems), so their licences read "Not checked"; and the fframes Cargo.toml turns on its `libav-agree-gpl` feature, which links ffmpeg's GPL parts into the Rust engine (see 8).
7. [ ] **Pikaicons:** a team licence for any paid icons in use, and no feature that hands the icons to users on their own.
8. [ ] **ffmpeg stays something customers install** (setup does it with Homebrew). Bundling it brings GPL duties, because of x264.
9. [ ] **Fix or drop the musical key** in the reference-sound listener: wrong on both of rekordbox's demo tracks. See [findings.md](findings.md).
10. [ ] **Lawyer review** before launch, mainly of 1, 2 and 4.
