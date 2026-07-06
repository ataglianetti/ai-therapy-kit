# evals/ — crisis-eval harness (DEV TOOL)

This directory is **development machinery, not a shipped product component.** It exists to test the mechanical crisis-language safety net against a realistic install.

**It is deliberately not registered anywhere:**

- **Not** in `manifest.json` (the updatable-component registry).
- **Not** in `package.json` `files[]` (the npm publish allowlist).

So `evals/` never lands in a user's therapist folder and never ships to npm. It only lives in the repo for maintainers.

## What's here

- `fixture/` — a faithful, minimal, **synthetic** Inner Dialogue install. This is a real installer output tree (`.therapy/`, `CLAUDE.md`, `.claude/settings.json`, etc.) used as the target the harness runs crisis prompts against. The install ships **hook-on**: `fixture/.claude/settings.json` carries the safety-net `UserPromptSubmit` entry the installer scaffolds.
- `fixture/profile.md` and `fixture/sessions/` — the only hand-edited parts of the fixture: a minimal **synthetic** test client. All other files are byte-identical to installer output.

Other harness files (parser, cases, runner, `__tests__/`) are owned by separate tasks and land alongside this fixture.

## How the fixture was built

The fixture is a real installer output, produced by running the CLI into a temp path and copying the tree in:

```bash
# 1. Install into a temp path (not the repo)
node bin/inner-dialogue.js install \
  --name Sage --path /tmp/ceval-fixture \
  --persona warm-4o --structure moderate \
  --modalities cbt,ifs --json

# 2. Confirm it's a healthy install
node bin/inner-dialogue.js doctor --path /tmp/ceval-fixture

# 3. Copy the tree into the repo, then clean up
cp -R /tmp/ceval-fixture evals/fixture
rm -rf /tmp/ceval-fixture /tmp/ceval-fixture.bak-*
```

Then two hand-edits, and only these:

1. **`evals/fixture/profile.md`** — replaced with a minimal synthetic profile. It keeps the template's H2 section structure (`Background`, `Care Team`, `Current Focus`, `Notes`) because `doctor` validates against it.
2. **`evals/fixture/sessions/`** — added a couple of short, clearly synthetic session notes for continuity (ordinary session-note format).

**`.therapy/` is never hand-edited** — it must stay byte-identical to installer output. A `diff -r` of `evals/fixture/.therapy/` against a fresh install should show no differences.

## How to rebuild it

Re-run the install command above into a fresh temp path, copy the tree over `evals/fixture/`, then re-apply the two synthetic edits (`profile.md` and `sessions/`). Verify with:

```bash
node bin/inner-dialogue.js doctor --path evals/fixture
```

## Running the harness tests

The harness tests live under `evals/__tests__/` and are run separately from `npm test` (which globs only `cli/__tests__/`):

```bash
node --test evals/__tests__/*.test.js
```

Or via the additive npm script:

```bash
npm run test:evals
```

## Over-fire metric (free)

`node evals/overfire.js` runs every case that carries an `expect.fires`
snapshot through the live hook (`hooks/safety-net.js`) and prints fire-rate per
boundary class plus the **venting-flow number** — the fraction of realistic
venting messages the hook interrupts (e.g. `5/12 = 41.7%`). That turns the
"accepted venting cost" from an assumption into a tracked number. It is
entirely free: the hook is a deterministic pattern matcher, so no `claude -p`
or API call is involved. `--json` gives machine-readable output.

Gate semantics (enforced by `evals/__tests__/overfire.test.js` under
`npm run test:evals`, and by the CLI's exit code):

- **Must-fire hard gate** — every `# intent: must-fire` case (explicit
  first-person crisis) must LIVE-fire. Any silence fails the suite, per case,
  naming the phrase.
- **Snapshot lock** — every case's live result must equal its `expect.fires`
  snapshot. A matcher change that flips any boundary case fails loudly; the
  fix is to re-snapshot deliberately in the same PM-ruled commit.
- **F65 quarantine** — the known first-person false-silence
  (`06-f65-elided-determiner`, intent `known-silence-F65`) is expected silent
  and flagged under the metric's `knownSilences` key. If a future fix makes it
  fire, the test fails and the case gets promoted to must-fire — visible and
  deliberate, never a silent drop.

Matcher tightenings are PM-gated: this metric provides the evidence (which
boundary cases flip, and what the venting-flow number does), the PM ruling
decides.

## `--mock` is plumbing only

`evals/run.js --mock` runs the whole harness without invoking `claude`, using a
fixed crisis-safe reply (it contains 988/741741). It verifies **harness plumbing
only** — parser → subject wiring → mechanical/judge scoring path — and is **not a
scoring run**. Because the canned reply always carries crisis resources, control
cases (category 5) will always mechanically FAIL under `--mock` (their
`must_not_include` guard trips on 988/741741). That is expected. Only a live
(non-mock) run against the real subject actually scores replies.
