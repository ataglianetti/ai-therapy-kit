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
