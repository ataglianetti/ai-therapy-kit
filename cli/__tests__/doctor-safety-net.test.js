// Tests for the doctor safety-net backstop checks: hook script on disk
// (.therapy/hooks/safety-net.js) and registration in .claude/settings.json.
// Both are WARNING severity by design — pre-feature installs must not fail
// validation (DECISIONS.md 2026-07-05).
//
// Fixtures are minimal hand-built installs rather than real `install` runs so
// the suite stays independent of parallel install-path work and runs fast.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { doctor } from '../doctor.js';

// Exec-form registration (the shape update/install write). Plain single-quoted
// string on purpose: ${CLAUDE_PROJECT_DIR} is a literal placeholder, not a
// template substitution.
const EXEC_FORM_ENTRY = {
  type: 'command',
  command: 'node',
  args: ['${CLAUDE_PROJECT_DIR}/.therapy/hooks/safety-net.js'],
};

const TIME_HOOK_ENTRY = {
  type: 'command',
  command:
    'date \'+{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Current local time: %H:%M"}}\'',
};

function settingsWith(hookEntries) {
  return {
    hooks: {
      UserPromptSubmit: [{ matcher: '', hooks: hookEntries }],
    },
  };
}

// Builds a minimal install that passes every other doctor check, so the only
// errors/warnings in play are the ones under test.
function makeInstall({
  hookScript = true,
  settings = settingsWith([TIME_HOOK_ENTRY, EXEC_FORM_ENTRY]),
} = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'doctor-safety-net-'));

  const therapy = path.join(root, '.therapy');
  mkdirSync(therapy, { recursive: true });
  writeFileSync(
    path.join(therapy, 'version.json'),
    JSON.stringify({ kit_version: '2.8.0', files: {} }, null, 2)
  );
  for (const f of [
    'safety-protocol.md',
    'persona.md',
    'session-structure.md',
    'commands.md',
  ]) {
    writeFileSync(path.join(therapy, f), `# ${f}\n`);
  }

  writeFileSync(
    path.join(root, 'profile.md'),
    '# Profile\n\n## Background\n\n## Current Focus\n\n## Notes\n'
  );

  mkdirSync(path.join(root, 'context'), { recursive: true });
  writeFileSync(path.join(root, 'context', 'index.md'), '# Index\n');

  if (hookScript) {
    const hooksDir = path.join(therapy, 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(
      path.join(hooksDir, 'safety-net.js'),
      '// fixture stand-in for the real hook\n'
    );
  }

  if (settings !== null) {
    mkdirSync(path.join(root, '.claude'), { recursive: true });
    writeFileSync(
      path.join(root, '.claude', 'settings.json'),
      typeof settings === 'string'
        ? settings
        : JSON.stringify(settings, null, 2)
    );
  }

  return root;
}

async function runDoctor(root) {
  try {
    return await doctor({ path: root });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const scriptOk = (r) =>
  r.checks.some((c) => c.includes('.therapy/hooks/safety-net.js present'));
const scriptWarning = (r) =>
  r.warnings.some((w) => w.includes('safety-net hook script missing'));
const registrationOk = (r) =>
  r.checks.some((c) =>
    c.includes('safety-net hook registered in .claude/settings.json')
  );
const registrationWarning = (r) =>
  r.warnings.some((w) =>
    w.includes('safety-net hook not registered in .claude/settings.json')
  );
const warningsCarryFix = (r) =>
  r.warnings
    .filter((w) => w.includes('safety-net'))
    .every((w) => w.includes('npx inner-dialogue@latest update --path'));

test('both present: ok entries, no safety-net warnings', async () => {
  const result = await runDoctor(makeInstall());
  assert.equal(result.ok, true);
  assert.ok(scriptOk(result), 'script ok entry present');
  assert.ok(registrationOk(result), 'registration ok entry present');
  assert.ok(!scriptWarning(result), 'no script warning');
  assert.ok(!registrationWarning(result), 'no registration warning');
});

test('script missing: warning with update fix, registration still ok, doctor passes', async () => {
  const result = await runDoctor(makeInstall({ hookScript: false }));
  assert.equal(result.ok, true, 'warnings must not fail validation');
  assert.ok(scriptWarning(result), 'script warning present');
  assert.ok(registrationOk(result), 'registration ok entry present');
  assert.ok(!scriptOk(result), 'no script ok entry');
  assert.ok(warningsCarryFix(result), 'warning carries the one-line fix');
});

test('registration missing: warning with update fix, script still ok, doctor passes', async () => {
  const result = await runDoctor(
    makeInstall({ settings: settingsWith([TIME_HOOK_ENTRY]) })
  );
  assert.equal(result.ok, true, 'warnings must not fail validation');
  assert.ok(registrationWarning(result), 'registration warning present');
  assert.ok(scriptOk(result), 'script ok entry present');
  assert.ok(!registrationOk(result), 'no registration ok entry');
  assert.ok(warningsCarryFix(result), 'warning carries the one-line fix');
});

test('both missing (pre-feature install): two warnings, doctor still passes', async () => {
  const result = await runDoctor(
    makeInstall({ hookScript: false, settings: settingsWith([TIME_HOOK_ENTRY]) })
  );
  assert.equal(result.ok, true, 'pre-feature installs must not FAIL validation');
  assert.equal(result.errors.length, 0, 'no errors, only warnings');
  assert.ok(scriptWarning(result), 'script warning present');
  assert.ok(registrationWarning(result), 'registration warning present');
  assert.ok(warningsCarryFix(result), 'both warnings carry the one-line fix');
});

test('settings.json absent entirely: registration warning joins the existing settings warning', async () => {
  const result = await runDoctor(makeInstall({ settings: null }));
  assert.equal(result.ok, true);
  assert.ok(registrationWarning(result), 'registration warning present');
  assert.ok(
    result.warnings.some((w) => w.includes('.claude/settings.json missing')),
    'existing settings-missing warning still reported'
  );
});

test('settings.json unparseable: registration warning, doctor passes', async () => {
  const result = await runDoctor(
    makeInstall({ settings: '{ this is not json' })
  );
  assert.equal(result.ok, true);
  assert.ok(registrationWarning(result), 'registration warning present');
  assert.ok(warningsCarryFix(result), 'warning carries the one-line fix');
});

test('registration via shell command string (not exec form) is recognized', async () => {
  const result = await runDoctor(
    makeInstall({
      settings: settingsWith([
        {
          type: 'command',
          command: 'node "$CLAUDE_PROJECT_DIR/.therapy/hooks/safety-net.js"',
        },
      ]),
    })
  );
  assert.ok(registrationOk(result), 'command-string registration recognized');
  assert.ok(!registrationWarning(result), 'no registration warning');
});
