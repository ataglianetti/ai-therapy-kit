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
import { hashString } from '../lib/hash.js';

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
const HOOK_FIXTURE_CONTENT = '// fixture stand-in for the real hook\n';

function makeInstall({
  hookScript = true,
  hookContent = HOOK_FIXTURE_CONTENT,
  hookRecordHash = null,
  settings = settingsWith([TIME_HOOK_ENTRY, EXEC_FORM_ENTRY]),
} = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'doctor-safety-net-'));

  const therapy = path.join(root, '.therapy');
  mkdirSync(therapy, { recursive: true });
  const versionFiles = {};
  if (hookRecordHash) {
    versionFiles['.therapy/hooks/safety-net.js'] = {
      version: null,
      hash: hookRecordHash,
      source: 'hooks/safety-net.js',
    };
  }
  writeFileSync(
    path.join(therapy, 'version.json'),
    JSON.stringify({ kit_version: '2.8.0', files: versionFiles }, null, 2)
  );
  for (const f of [
    'safety-protocol.md',
    'persona.md',
    'session-structure.md',
    'commands.md',
    'usage-reflection.md',
  ]) {
    writeFileSync(path.join(therapy, f), `# ${f}\n`);
  }

  writeFileSync(
    path.join(root, 'profile.md'),
    '# Profile\n\n## Background\n\n## Current Focus\n\n## Notes\n'
  );

  mkdirSync(path.join(root, 'context'), { recursive: true });
  writeFileSync(path.join(root, 'context', 'index.md'), '# Index\n');

  // The usage-stats hook is not the subject of this suite; ship it so the
  // fixture keeps its "passes every other doctor check" contract (otherwise
  // doctor's usage-stats checks would emit their own missing-file warnings).
  const hooksDir = path.join(therapy, 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(
    path.join(hooksDir, 'usage-stats.js'),
    '// fixture stand-in for the usage-stats hook\n'
  );

  if (hookScript) {
    writeFileSync(path.join(hooksDir, 'safety-net.js'), hookContent);
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
    // claudeVersionOutput: null skips the real `claude --version` spawn so
    // these fixtures stay independent of whatever CLI this machine has
    // installed. The version check has its own suite
    // (doctor-claude-version.test.js).
    return await doctor({ path: root, claudeVersionOutput: null });
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

// F20: malformed settings must be named as the problem, not reported as a
// plain "present" ok. And the fix must be a hand edit — `update` deliberately
// skips malformed files, so prescribing it would loop forever.
test('settings.json unparseable: named as malformed, no "run update" prescription, doctor passes', async () => {
  const result = await runDoctor(
    makeInstall({ settings: '{ this is not json' })
  );
  assert.equal(result.ok, true, 'warnings must not fail validation');

  assert.ok(
    !result.checks.some((c) => c === '.claude/settings.json present'),
    'malformed file is not reported as plain present-ok'
  );

  const malformedWarning = result.warnings.find((w) =>
    w.includes('not valid JSON')
  );
  assert.ok(malformedWarning, 'warning names the malformed JSON');
  assert.ok(
    /fix the json syntax by hand/i.test(malformedWarning),
    'warning carries manual-fix guidance'
  );
  assert.ok(
    /\(.+\)/.test(malformedWarning),
    'warning includes the parse error detail'
  );

  assert.ok(
    !registrationWarning(result),
    'no stacked not-registered warning (registration is unverifiable, and its fix would prescribe update)'
  );
  for (const w of result.warnings) {
    assert.ok(
      !w.includes('npx inner-dialogue@latest update'),
      `no warning prescribes update: ${w}`
    );
  }
});

// F18 (PM ruling 2026-07-05): doctor compares the installed hook against the
// hash recorded in version.json. Mismatch → WARNING (users may edit, but the
// posture is that they shouldn't) with a restore path. No record → skip.
const tamperWarning = (r) =>
  r.warnings.find((w) => w.includes('modified from the shipped version'));
const integrityOk = (r) =>
  r.checks.some((c) => c.includes('safety-net hook matches its installed version'));

test('hook hash matches version.json record: integrity ok, no tamper warning', async () => {
  const result = await runDoctor(
    makeInstall({ hookRecordHash: hashString(HOOK_FIXTURE_CONTENT) })
  );
  assert.equal(result.ok, true);
  assert.ok(integrityOk(result), 'integrity ok entry present');
  assert.ok(!tamperWarning(result), 'no tamper warning');
});

test('hook hash mismatch: warning (not error) with posture and --force restore path', async () => {
  const result = await runDoctor(
    makeInstall({
      hookRecordHash: hashString(HOOK_FIXTURE_CONTENT),
      hookContent: HOOK_FIXTURE_CONTENT + '// user edit\n',
    })
  );
  assert.equal(result.ok, true, 'mismatch is a warning, not an error');
  assert.equal(result.errors.length, 0, 'no errors');
  const warning = tamperWarning(result);
  assert.ok(warning, 'tamper warning present');
  assert.ok(!integrityOk(result), 'no integrity ok entry');
  assert.ok(
    /recommend you don't|safety net is there for a reason/i.test(warning),
    'warning carries the posture'
  );
  assert.ok(
    warning.includes('npx inner-dialogue@latest update --path') &&
      warning.includes('--force'),
    'warning gives the --force restore path'
  );
  assert.ok(
    /also overwrites|backed up|backup/i.test(warning),
    'warning notes the --force blast radius / backup'
  );
});

test('no version.json record for the hook: integrity check skipped gracefully', async () => {
  const result = await runDoctor(makeInstall({ hookRecordHash: null }));
  assert.equal(result.ok, true);
  assert.ok(!tamperWarning(result), 'no tamper warning without a record');
  assert.ok(!integrityOk(result), 'no integrity ok entry without a record');
  assert.ok(scriptOk(result), 'script presence still reported ok');
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
