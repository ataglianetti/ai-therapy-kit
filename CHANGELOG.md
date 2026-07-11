# Changelog

All notable changes to Inner Dialogue.

---

## [Unreleased]

### Added
- **Profile provenance — dated writes + a staleness review ritual.** Ports the context library's "a synthesis is a hypothesis with a date on it" discipline to `profile.md`. Current-state profile entries now carry a trailing `*(YYYY-MM-DD)*` stamp marking when they were last confirmed; `Background`/formative history stays undated by design. At session start, when current-state content has gone stale — older than ~90 days *and* at least ~3 sessions since — the therapist offers *once*, at a neutral lull, to walk through the stale items as questions and refresh what still fits (same "the person outranks the housekeeping" discipline as the seeding offer; a decline writes a ~30-day marker). A new `review my profile` command triggers the same walk-through on demand, and is the migration path for legacy undated profiles — which converge to dated through confirmation alone, with **zero fabricated dates** (an invented date is a false provenance claim). Rules live in one new framework file, `profile-protocol.md` → `.therapy/profile-protocol.md`, referenced (not duplicated) by `CLAUDE.template.md` and `commands.md`. `CLAUDE.template.md 1.1.0 → 1.2.0`, `commands.md 1.4.0 → 1.5.0`.
- **`doctor` checks for the profile-protocol file.** Warns (not errors) when `.therapy/profile-protocol.md` is absent, so pre-feature installs keep validating clean until they run `update`.
- **Mechanical safety-net hook.** New `hooks/safety-net.js`, a `UserPromptSubmit` hook shipped to `.therapy/hooks/safety-net.js` and registered in `.claude/settings.json`. On every message it pattern-matches explicit first-person crisis language; on a match it injects the Emergency Resources block (kept verbatim-in-sync with `safety-protocol.md`, test-enforced) plus a directive to re-read the safety protocol into that turn. This is a backstop keyword matcher, not crisis detection — the prose safety protocol remains the primary safety layer, and the injected notice tells the model the client, not the pattern, is the authority on whether this is a crisis. Scoped to first-person crisis language per the recorded product ruling (third-person reports, grief, media, and topical mentions stay silent); English-only at launch; fail-open — on any error the hook exits silently and never interrupts a session.
- **`doctor` verifies the safety net.** Checks that the hook script is present, matches its shipped version (hash against `version.json`; a modified hook warns with the recommendation not to edit it and the `update --force` restore path), and is registered in `.claude/settings.json`. A malformed settings file is named as the problem with manual-fix guidance rather than a "run update" loop.
- **Surgical `.claude/settings.json` merge.** `install` and `update` register the hook by appending it to an existing settings file rather than overwriting: snapshot backup first, atomic write (temp file + rename), and a file that isn't valid JSON is left untouched. Surfaced in `update` output (and `--dry-run`) as `settings_merge`.
- **`doctor` checks the Claude Code version.** The safety-net hook's registration format requires Claude Code 2.1.139 or newer — on older versions the hook is silently inert even when correctly installed. `doctor` now reads `claude --version` and warns below that floor with update instructions; if the CLI isn't on PATH or the output is unparseable, the check skips silently.
- **CI runs the unit test suite.** `npm test` now runs in the publish workflow's smoke-test job, and the PR paths filter covers `hooks/`, `claude-settings.template.json`, and `manifest.json` so changes to safety-relevant delivery surfaces trigger CI.

### Fixed
- **`npm test` on Node 21+.** The test entry point passed a bare directory to `node --test`, which fails on Node 21+. Replaced with an unquoted glob that works on Node 20 (shell expansion) and Node 21+ (internal glob).

### For Existing Users
Run `npx inner-dialogue@latest update --path <your-folder>` to receive the hook and its registration automatically — the script is copied to `.therapy/hooks/safety-net.js` and appended to `.claude/settings.json` (backup taken first). The same `update` also delivers the new `.therapy/profile-protocol.md` and the refreshed `commands.md` that activates the profile-provenance behavior. Your `profile.md`, `sessions/`, and `CLAUDE.md` remain untouched as always — existing profiles simply start getting dated as entries are confirmed, and legacy undated notes are picked up by the first review (never backfilled with invented dates).

---

## [2.8.0] - 2026-06-24

### Added
- **`context/` knowledge graph — structure layer.** A new top-level folder for subject-level reference: `context/{people,places,concepts,events}/`. Subject files are free-form markdown; event filenames use `YYYY-MM-DD-slug.md` so dates are visible at a glance. `context/index.md` is the routing layer, scaffolded on install from a new `context/index.template.md`. Entries follow `- **Subject** (\`subfolder/slug.md\`) — synthesis. **Active (YYYY-MM-DD).**`. Lives alongside `profile.md` (about the client) and `sessions/` (chronological) — synthesized per-subject so the therapist doesn't have to grep session history to reconstruct what's known.
- **`context/` knowledge graph — protocol layer.** `CLAUDE.template.md` now teaches the therapist how to read, trust, create, update, and reconcile `context/`. A new *The Context Library* section establishes the three-store split (profile = the client, sessions = the chronological authority, context = the world around them) and the drift discipline that keeps the cache from going confidently stale: **recent sessions always win** over context synthesis; context is held *lightly* (a dated hypothesis offered back for confirmation, never asserted as the client's current truth); and a flag model governs auto-loading. `**Core**` marks the small (≈3–5) always-load-bearing set — always *loaded*, never assumed *current*, so reconciled every session. `**Active (YYYY-MM-DD)**` marks in-focus subjects, the date being the staleness signal (drift more than ~2 weeks behind the latest session note → re-verify against sessions; correct if contradicted, downgrade to dormant if merely quiet). `**Provisional (YYYY-MM-DD)**` marks history-distilled entries not yet confirmed live, held even more lightly. Unflagged = dormant (loaded only when raised). Session-start read step (index + flagged entries, bounded), session-end update step (reconcile, refresh dates, create sparingly, prune), and event past/future framing via the v2.7.0 current-time signal are all wired in. `CLAUDE.template.md` `1.0.2 → 1.1.0`.
- **Opt-in, supervised history backfill.** On the first session where `context/` exists, has no live entries, and `sessions/` has history, the therapist offers *once* to seed the library from past sessions — never automatically. On accept, it proposes candidate subjects (bounded by the same recurrence/significance bar, favoring recent history) and the client confirms before anything is written; seeded entries are flagged `**Provisional**` and marked distilled-from-history until confirmed in a live session. Declining writes a dated marker into `context/index.md` so it doesn't re-ask. Real-care (`therapist:`-frontmatter) sessions are eligible sources but keep their clinical-authority deference. Re-triggerable on demand via a new `commands.md` entry (`commands.md` `1.3.0 → 1.4.0`).
- **`update.js` scaffold path extended.** The `plan.scaffolded` array (introduced in 2.7.0 for `.claude/settings.json`) now also covers `context/index.md` and the four `context/` subdirectories. Visible in `--dry-run`; the apply phase creates dirs via idempotent `mkdir -p` and copies templates only when the target doesn't exist.
- **Ideal Parent Figure (IPF) modality.** New modality file based on Daniel P. Brown and David Elliott's attachment-repair protocol (*Attachment Disturbances in Adults*, 2016). Covers the five conditions of secure attachment, the full imagery protocol with step-by-step guidance, attachment-style-specific calibration (anxious/preoccupied, dismissive-avoidant, disorganized), titration notes for disorganized clients, and handling of the common "this doesn't feel real" block. Cross-referenced bidirectionally with IFS, CFT, Lifespan Integration, Psychodynamic, Polyvagal, and Somatic Experiencing, pointing to IPF as the experiential corrective layer when those modalities have surfaced an early attachment wound. Wired into the setup menu, README, and getting-started docs as the 13th selectable approach.

### Changed
- **`doctor`** warns (not errors) when `context/` or `context/index.md` is missing, suggesting `update` to scaffold. Warnings (not errors) so pre-feature installs don't fail validation before they've upgraded.
- **`manifest.json` `1.3.0 → 1.4.0`.** Adds `context-index` component with `scaffold_only: true`, matching the pattern established for `claude-settings` in 2.7.0.
- **`context/index.template.md` `0.2.0 → 1.0.0`.** The scaffold-awaiting-protocol marker is cleared now that the protocol layer has landed; its flag note now also names `**Provisional (YYYY-MM-DD)**` alongside `**Active**` and `**Core**` (all flag semantics remain defined in `CLAUDE.md`).
- **npm package `files`** array includes `context/` so the template ships.

### For Existing Users
Run `inner-dialogue update --path <your-folder>` to scaffold `context/` and pick up the new `commands.md` (which carries the "build my context library" command). Additive — no existing files are touched.

**One caveat worth understanding:** `update` never rewrites an existing install's `CLAUDE.md` (it's in `ALWAYS_SKIP_RELATIVE`), so the protocol layer — the session-start read, drift discipline, session-end update, and the first-run seeding offer — reaches **new installs and reinstalls only**. After `update`, your install has the staged `context/` folder and the on-demand command, but the therapist won't yet auto-read `context/` or apply the drift rules. Three ways to get the full protocol:

- **On-demand command (lowest friction).** Run `update`, then ask the therapist to "build my context library" — it backfills from your history with your confirmation. This works even with an unchanged `CLAUDE.md` (the command is self-contained), but it does not give you automatic session-start reads or drift reconciliation — just the library.
- **Reinstall in place (full protocol).** `inner-dialogue install --force --path <your-folder>` regenerates `CLAUDE.md` and the library from the new template while preserving `profile.md` and `sessions/` untouched. This is the clean way to pick up the auto-read and drift discipline.
- **Re-onboard with import.** Set up fresh and import your existing notes — the setup flow converts them into `sessions/`, and the new template offers seeding once history is present. Given the import feature, starting clean is low-friction if you'd rather.

Prefer surgical edits? Copy the new *The Context Library* section and the session-start/session-end context steps from the template into your `CLAUDE.md` by hand.

---

## [2.7.1] - 2026-06-10

### Fixed
- **Therapist no longer mislabels its own session notes with `therapist:` frontmatter.** When a client has imported real-care records (which carry a `therapist:` field per the *Working Alongside Real-World Care* protocol), the therapist reads them for continuity at session start — and could then pattern-complete that same frontmatter onto its *own* end-of-session note, falsely attributing its words to the real provider. The only safeguard was a parenthetical in the protocol section, read at session start and far from the point where notes are actually written. Hardened in two places in `CLAUDE.template.md`: the protocol line is now a standalone imperative ("never write that frontmatter onto a note you authored," with the trust-boundary-inversion spelled out), and the *At Session End* write block gains an explicit point-of-action prohibition ("start with the `# Session:` heading, with no frontmatter… reading a file that carries the field is not a format to replicate"). `CLAUDE.template.md` `1.0.1 → 1.0.2`.

### For Existing Users
By design, `update` does not modify an existing install's `CLAUDE.md` (it is in `ALWAYS_SKIP_RELATIVE`), so this fix reaches **new installs only**. Existing installs that have imported real-care records are the ones exposed; to pick up the fix, reinstall (`install --force`, which preserves `profile.md` and `sessions/`) or copy the two hardened sections into your `CLAUDE.md` by hand.

---

## [2.7.0] - 2026-06-10

### Added
- **Current-time hook via `.claude/settings.json`.** A new `claude-settings.template.json` ships with a `UserPromptSubmit` hook that runs `date` and surfaces current local time to the therapist on every message. Helps with session pacing (length, time-of-day awareness — a 2am message warrants a softer pace than a midday check-in). Pure local shell command — no data transmitted. Scaffolded by `install` (new `.claude/` mkdir + copy) and by `update` for existing installs that pre-date the feature. Never overwritten if a settings file already exists (same `existsSync` protection as `profile.md`).
- **`update` gains a top-level `scaffold` plan path.** New `plan.scaffolded` array surfaces files that are created once and never overwritten. Visible in `--dry-run`. Currently used for `.claude/settings.json`; lays the groundwork for future scaffold-only files.

### Changed
- **`CLAUDE.template.md` `1.0.0 → 1.0.1`.** Adds a brief "Time awareness" subsection under Session Startup Protocol. The guidance is defensively phrased: *if* a `Current local time:` line is present at the top of a user message, use it for pacing/tone; *if not*, proceed without — never reach for a time the model doesn't have. Hook absence is treated as a normal state (pre-existing settings file, Claude surface that doesn't run hooks, user hasn't run `update` yet).
- **`doctor`** now warns (not errors) when `.claude/settings.json` is missing, suggesting `update` to scaffold it.
- **`manifest.json` `1.2.0 → 1.3.0`.** Adds `claude-settings` component with a new `scaffold_only` flag indicating files that are created once and never overwritten on update.
- **npm package `files`** array includes `claude-settings.template.json` so the template ships.

### For Existing Users
Run `inner-dialogue update --path <your-folder>` to scaffold `.claude/settings.json`. Additive — no existing files are touched. `profile.md`, `sessions/`, and `CLAUDE.md` remain protected as always.

### Follow-up
A separate PR will land the `context/` knowledge graph for subject-level synthesis of people, places, concepts, and events — split out from this change so the protocol layer (how the therapist trusts and reconciles `context/` against sessions) can be designed carefully alongside the structure.

---

## [2.6.0] - 2026-06-08

### Changed
- **Voice-adherence fix extended to all personas.** v2.5.0 fixed `grounded-real`; this adds a `Default Length` block to the other seven (`coach`, `direct-challenging`, `warm-supportive`, `contemplative`, `philosophical`, `creative`, `warm-4o`), each tuned to that persona's own register rather than a one-size block — `direct-challenging` runs 1–3 sentences and ends blunt; `contemplative` keeps brevity as *space* rather than efficiency; `philosophical` is told to resist the monologue; `warm-4o`'s native casual brevity is reinforced so the template stops overriding it. All personas 1.1.0 → 1.2.0.
- **This is the change that reaches existing installs.** Persona files propagate via `update` (the template does not), so putting the discipline in every persona is what actually delivers the voice fix to current users — whichever persona they run, provided they haven't customized their persona file.

### Validation
- Field-condition test (old five-beat template still present + new persona, fixed fictional vignette): median reply length came in at direct-challenging 38w, creative 55w, warm-4o 62w, coach 73w, philosophical 88w (down from ~250w pre-fix), contemplative brief-and-spacious — all staying in-register, none reverting to the five-beat essay.

---

## [2.5.0] - 2026-06-08

### Changed
- **Response shape and length now defer to the persona instead of a fixed five-beat.** The template's `Response Guidelines` previously prescribed an Acknowledge → Reflect/Validate → Observe → Suggest → Close structure on *every* turn, which pulled responses toward long, generic-sounding "AI therapist" essays regardless of the selected persona. Replaced with a *Shape* section that hands turn structure to the persona and explicitly permits single-move replies, and a *Length* section that makes the persona's length guidance authoritative and defaults to brevity. In A/B testing on a fixed prompt (5 samples per condition), this cut median response length ~60% and reflexive question-endings from 80% to 20%, with non-overlapping distributions — a real effect, not run-to-run variance.
- **`grounded-real` persona gains an explicit Default Length block** — brief by default (2–4 sentences), going long only when the client opens real depth, and ending on a statement rather than a reflexively tacked-on question. (Persona 1.1.0 → 1.2.0; propagates to existing installs via `update`.)

### Added
- **"Working Alongside Real-World Care" protocol in the template.** When a client also sees a real in-person therapist or provider, session notes tagged with a `therapist:` frontmatter field are treated as real-care continuity carrying clinical authority, and the AI positions itself as *adjunct* — helping prep for and process real sessions, reinforcing the provider's work, and deferring diagnosis/medication/crisis/treatment decisions to the provider. Fully generic and de-identified; no provider names ship in the framework.
- **Care Team stub in `profile.template.md`** for recording real-world providers.
- **Setup import flow now distinguishes real-therapy records from AI-chat history** (`CLAUDE.md`): real-therapy imports get `therapist:` frontmatter and follow the adjunct protocol; AI-chat history converts to ordinary session notes.

### Note
- `CLAUDE.template.md` changes reach **new installs**; by design, `update` does not modify an existing install's `CLAUDE.md`. The persona change *does* propagate via `update`, and in testing carried most of the voice improvement on its own. Existing users who want the full template change should reinstall or copy the new sections in.

---

## [2.4.2] - 2026-05-25

### Removed
- **`start-session.command` and `start-session.bat` launcher files no longer ship.** Pre-CLI versions of these scripts had a broken shebang (`#\!/bin/bash`) that prevented them from opening on macOS. Even when generated correctly by later CLI versions, the launchers depend on the standalone `claude` command being on PATH — which most users now don't have because Claude Code is built into the Claude AI app. Start sessions by opening the Claude AI app and navigating to your therapy folder, or by running `claude` in Terminal from that folder.

### Changed
- **`update` now removes deprecated launcher files from existing vaults.** When the launcher matches an unmodified shipped pattern (either the pre-CLI broken shebang or the post-CLI correct version), it's deleted and reported under `Removed deprecated launcher files`. Customized launchers are left in place and surfaced in `skipped_user_edited` so users can decide what to do with them. Backups still cover the launcher files in `.therapy.bak-<timestamp>` regardless.
- **`install` no longer creates launcher files.** The install success message now points users to the Claude AI app or Terminal directly.
- Documentation updated across `README.md`, `docs/GETTING-STARTED.md`, `MIGRATING.md`, and `CLAUDE.md` to remove launcher references.

---

## [2.4.1] - 2026-05-23

### Fixed
- **`update` now refreshes active files, not just the library.** Previously, running `update` would refresh the reference copies under `.therapy/library/` but leave the active files your session actually loads (`.therapy/persona.md`, `.therapy/session-structure.md`, `.therapy/modalities/*.md`) on the prior version. Result: users who ran `update` after the v2.4.0 release got the new modality library content but their sessions kept loading the v1.0.0 files. This was a latent bug going back further — any prior library content release had the same gap — it just became loud with v2.4.0's substantial rewrites.
- **Active files are now hash-gated like library files.** Refresh happens only when the on-disk content matches either the explicitly-recorded active hash, the previously-recorded library hash, or (for persona/session-structure) any library file's known hash of the same kind. Customized active files are preserved and reported in `skipped_user_edited` — re-run with `--force` to overwrite.
- **Legacy installs (no active entries in version.json) are now backfilled.** For modalities, the active filename gives the library source directly. For persona and session-structure, hash-matching identifies the source. Once refreshed, version.json gains the active entries for cleaner future updates.

### Known Limitation
If you ran `update` against v2.4.0 (which refreshed the library to 1.1.0 but left the active files at 1.0.0), your `version.json` no longer remembers the 1.0.0 library hashes. The 2.4.1 update flow will mark your active modality/persona files as "customized" rather than auto-refreshing them. Re-run with `--force` to overwrite, or manually copy from `.therapy/library/` to the active slots.

---

## [2.4.0] - 2026-05-23

### Changed
- **All 12 modality files comprehensively rewritten** to bring every modality to operational parity with DBT skills (previously the only modality with named, mnemonically packaged protocols). Each file now contains:
  - **Named protocols** — IFS's 6 F's; CBT's Socratic dialogue + 10 distortions with reframes + Behavioral Activation + Thought Record + Exposure Hierarchy; ACT's three iconic metaphors (Tug of War, Passengers on the Bus, Leaves on a Stream) in full dialogue form; CFT's Compassionate Self protocol + Inner Critic dialogue + Soothing Rhythm Breathing; Psychodynamic's Interpretive Sequence + Transference Recognition; Polyvagal's three state-specific intervention menus; SE's Resourcing + Pendulation + Discharge Recognition scripts; MI's five-level reflection ladder + Change Talk amplification; Narrative's Externalization dialogue + Unique Outcomes protocol; SFBT's Miracle → Scaling → Exceptions chain; Lifespan Integration's Timeline Construction Protocol with explicit AI-limitation framing.
  - **Signaling cues** — verbatim client language patterns each modality should listen for, pushing activation criteria into the modality files themselves rather than living only in the template router.
  - **Example AI interventions** — 4–7 full reflections per modality in actual therapist voice, replacing thin "key questions" lists.
  - **Integrates with** — cross-modality routing rules (e.g., "with compulsive behaviors, IFS leads, CBT follows downstream") so the system stops reinventing composition logic session-by-session.
  - **Pacing & limitations** including modality-specific AI honesty (SE/LI/IFS depend on real-time tracking text can't fully do) and a generic "Working alongside an external therapist" note positioning Sage to deepen rather than compete with human treatment.
  - **Homework / between-session work** — 4–6 concrete practices per modality.
- **7 of 8 persona files padded to warm-4o's depth bar.** Same structural pattern; denser content per section. New across the set: expanded Tone Qualities with nuance, Language Patterns subdivided into 6–9 categories with example phrasings, Challenge Style with a moves table, Conversation Arc as a 5-beat structure tuned to each persona's natural flow, Energy Matching for 5–6 client states. Distinct voices preserved (Coach: action-forward; Contemplative: spacious; Creative: playful/metaphor-rich; Direct-Challenging: sharp/uncompromising; Philosophical: existential; Warm-Supportive: steady reassuring presence; Grounded & Real: direct + warm).
- **Per-file version bumps `1.0.0 → 1.1.0`** across all 12 modalities and 7 personas (warm-4o was already at 1.1.0 from a prior pass).
- **`manifest.json` bumped `1.1.0 → 1.2.0`** to reflect the content release.

### For Existing Users
The `update` CLI detects per-file version changes and rolls them out cleanly:
- Files you haven't customized are upgraded automatically.
- Files you've customized are skipped with a warning — your edits are preserved. Re-run with `--force` to overwrite if you want the new versions.
- `profile.md`, `sessions/`, and `CLAUDE.md` are never touched by `update`.

If you've been using the framework in active sessions, expect noticeably sharper modality work — most of all in IFS, where the previous file stopped at naming parts; the rewrite adds the 6 F's protocol, manager-appreciation scripts, firefighter-as-part framing (vs. CBT habit-substitution), and an Exile-trust protocol for when the wounded part rejects the Self's offering.

---

## [2.3.1] - 2026-05-23

### Changed
- **README "How Sessions Work" section updated** to describe the organic profile structure shipped in 2.3.0. Surfaces the seed-then-evolve model and modality-aware sections so users understand the new behavior without having to read the changelog.

---

## [2.3.0] - 2026-05-23

### Changed
- **Profile structure is now organic, not template-driven.** New installs ship with a minimal seed (`Background`, `Current Focus`, `Notes`) instead of a fixed 6-section template. The LLM is explicitly instructed to add H2 sections as themes emerge across sessions and to organize structure around active modalities — IFS work surfaces a `Parts` section, somatic work surfaces `Body & Nervous System`, narrative work surfaces `Preferred Stories`, etc.
- **CLAUDE.template.md profile-update logic rewritten** to invite section creation when themes consolidate, consolidate fragmented content into dedicated H2s, and preserve H3 substructure (per-person relationship sections, etc.).
- **`doctor` validates structure presence, not template adherence.** A profile with 4+ H2 sections is assumed to have evolved its own coherent structure and isn't second-guessed. Smaller profiles get a soft warning if they lack a Background section (or equivalent).

### For Existing Users
Your folder isn't affected by this release — the LLM-behavior change lives in `CLAUDE.template.md`, which is generated at install time and never modified by `update` (it's user-owned). Your existing profile and CLAUDE.md keep working as they have been. If you want the new profile-evolution behavior for your therapist, either:
- Re-install over your folder with `npx inner-dialogue install --force --path <your-folder> ...` (regenerates `CLAUDE.md` from the new template; preserves `profile.md` and `sessions/`), or
- Manually copy the new "How to update profile.md" block from this repo's `CLAUDE.template.md` into your therapist's `CLAUDE.md`.

Most existing users won't need to do either — your therapist has likely already been creating H2 sections organically (the old "don't create new H2s" instruction was widely ignored in practice once profiles got rich enough).

---

## [2.2.3] - 2026-05-23

### Changed
- **`doctor` now distinguishes errors from warnings.** Template H2 section misses in `profile.md` are demoted from errors to soft warnings — the template's own prompt invites users to add custom sections, and the LLM's update logic targets existing H2s rather than template-specific ones. Profiles that evolved their own structure (common for any folder older than a few weeks) no longer fail `doctor`. Real structural problems (missing `.therapy/`, malformed `version.json`, missing `profile.md`, zero H2s) remain errors.
- `doctor` exits 0 on warnings-only, 1 on errors. Output visually separates errors (`!!`) from warnings (`~~`).
- Legacy `version.json` schema is now a warning, not an error — the file still works, the migration is just recommended.

---

## [2.2.2] - 2026-05-23

### Fixed
- **Migration from legacy `version.json` schema now produces a complete registry.** Previously, `update --force` against a pre-2.2.0 folder only recorded hashes for files it wrote — every other framework file that already matched bundled content was left unregistered, causing future updates to re-flag them as "unknown origin." Now `update` detects the legacy schema and folds all `unchanged` files into the new registry alongside any writes, so a single migration run produces a fully-tracked folder. Dry-run output also surfaces this as "Folded into new registry (N)" so users see what the migration accomplishes before applying.

---

## [2.2.1] - 2026-05-23

### Added
- **MIGRATING.md** — Step-by-step guide for users with pre-2.2.0 therapy folders. Documents the one-time `update --force` migration that refreshes framework files and generates a fresh hash registry while leaving `profile.md`, `sessions/`, and root `CLAUDE.md` untouched.

### Fixed
- **`update --force --dry-run` now actually previews the forced overwrites.** Previously the force-reshuffle of skipped files happened after the dry-run early-return, so users couldn't preview what `--force` would do — making MIGRATING.md's preview step misleading.

---

## [2.2.0] - 2026-05-22

### Added
- **`inner-dialogue` CLI** — Published to npm. `npx inner-dialogue install`, `update`, and `doctor` commands. The conversational setup flow now calls the CLI under the hood instead of asking the LLM to perform `mkdir`/`cp`/`chmod` from prose instructions.
- **Hash-aware updater** — `update` records a SHA-256 of every framework file at install time. On re-run, files whose current content matches the registered hash are safely overwritten with the new version; files that have been edited are skipped with a warning. Run with `--force` to overwrite anyway. `--dry-run` previews the plan without writing.
- **Automatic backups** — Every `update` snapshots `.therapy/` to `.therapy.bak-<timestamp>/` before any write. Roll back by restoring from the snapshot.
- **`doctor` command** — Validates folder integrity (presence of framework files, `profile.md` H2 structure intact, `version.json` schema). Catches the drift modes that motivated 2.1.2.
- **Direct CLI install path** — `npx inner-dialogue install` works without Claude Code for scripting / power-user setups, with interactive prompts when run in a TTY.

### Changed
- **Setup CLAUDE.md slimmed down** — The 700-line procedural setup file is now a ~150-line conversation script. File operations live in the tested CLI, not in LLM-followed prose.
- **`version.json` schema** — Now tracks per-file hashes (`files[path]: {version, hash, source}`) instead of just component versions. Old format auto-migrates on first `update` (treated as unknown-origin until the user confirms).

### For Existing Users
See [MIGRATING.md](MIGRATING.md) for the one-time migration to the hash-aware updater. Your `profile.md`, `sessions/`, and root `CLAUDE.md` are never touched.

---

## [2.1.2] - 2026-05-09

### Fixed
- **Profile updates now target specific sections** — At session end, the AI must match each update to an existing H2 section in `profile.md` rather than appending freeform. Prevents `profile.md` from accumulating unstructured content over many sessions.

---

## [2.1.1] - 2026-02-08

### Fixed
- **Setup import flow now fully implemented** — Step 6 now includes complete logic for categorizing files (profile.md, ChatGPT exports, markdown, PDF), extracting profile information, and converting conversations to dated session files. Previously the setup instructions referenced import handling but didn't include the processing steps.

---

## [2.1.0] - 2026-02-08

### Added
- **Import command** — Import notes anytime during a session, not just at setup. Say "import" or "I have files to import" and provide a path.
- **Manifest-based updates** — Updates now use `manifest.json` to discover all available components. Existing users can get new features automatically.
- **Smart modality recommendations** — If you import notes during setup, your therapist reads them and recommends modalities based on your history.

### Changed
- **Smarter import handling** — Imported files now become session history (`sessions/YYYY-MM-DD.md`) with original dates, plus key patterns extracted to `profile.md`. This gives natural relevance decay like real memory.
- **Commands moved to updatable file** — Customization commands now live in `.therapy/commands.md` so existing users receive new commands via updates.
- **Setup flow reordered** — Import step now comes before modality selection, enabling personalized recommendations.

### For Existing Users
Run "update" or "check for updates" during a session to get these features.

---

## [2.0.0] - 2026-02-01

### Added
- **8 communication styles** (up from 2):
  - Warm 4o-Style
  - Direct & Challenging
  - Warm & Supportive
  - Coach
  - Grounded & Real
  - Contemplative & Spacious
  - Philosophical & Existential
  - Creative & Playful

- **12 therapeutic modalities** (up from 1):
  - CBT (Cognitive Behavioral Therapy)
  - ACT (Acceptance and Commitment Therapy)
  - CFT (Compassion-Focused Therapy)
  - DBT Skills
  - IFS (Internal Family Systems)
  - Lifespan Integration
  - Motivational Interviewing
  - Narrative Therapy
  - Polyvagal-Informed Work
  - Psychodynamic
  - SFBT (Solution-Focused Brief Therapy)
  - Somatic Experiencing

- **Split-file architecture** — Components now live in `.therapy/` folder for independent updates
- **Self-contained therapist folders** — No need to keep the repo after setup
- **Update command** — Say "update" to check for and apply updates from GitHub
- **Customization commands** — Switch persona, add/remove modalities, change session structure during sessions

### Changed
- Therapist folders now include full library of options for switching styles

---

## [1.0.0] - 2026-01-15

### Initial Release
- Basic AI therapist setup with persistent sessions
- CBT modality
- Warm 4o-Style and Coach personas
- Session notes saved to `sessions/` folder
- Client profile in `profile.md`
- Safety and crisis protocols
