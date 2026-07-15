// Tests for the doctor usage-stats reflection checks: hook script on disk
// (.therapy/hooks/usage-stats.js), reflection guidance
// (.therapy/usage-reflection.md), and SessionStart registration in
// .claude/settings.json. All three are WARNING severity by design — a
// pre-feature or pre-`update` install must not fail validation.
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

// Exec-form registration for the safety-net hook (UserPromptSubmit) — every
// fixture includes it so the only usage-stats findings in play are the ones
// under test, and the safety-net checks stay clean.
const SAFETY_NET_ENTRY = {
  type: 'command',
  command: 'node',
  args: ['${CLAUDE_PROJECT_DIR}/.therapy/hooks/safety-net.js'],
};

// Exec-form registration for the usage-stats hook (SessionStart).
const USAGE_STATS_ENTRY = {
  type: 'command',
  command: 'node',
  args: ['${CLAUDE_PROJECT_DIR}/.therapy/hooks/usage-stats.js'],
};

function settingsWith({ usageStats = true } = {}) {
  const hooks = {
    UserPromptSubmit: [{ matcher: '', hooks: [SAFETY_NET_ENTRY] }],
  };
  if (usageStats) {
    hooks.SessionStart = [
      { matcher: 'startup|resume|clear|compact', hooks: [USAGE_STATS_ENTRY] },
    ];
  }
  return { hooks };
}

const HOOK_FIXTURE_CONTENT = '// fixture stand-in for the real usage-stats hook\n';

// Builds a minimal install that passes every other doctor check, so the only
// warnings in play are the usage-stats ones under test.
function makeInstall({
  usageHookScript = true,
  usageHookContent = HOOK_FIXTURE_CONTENT,
  usageHookRecordHash = null,
  reflectionGuidance = true,
  settings = settingsWith(),
} = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'doctor-usage-stats-'));

  const therapy = path.join(root, '.therapy');
  mkdirSync(therapy, { recursive: true });

  const versionFiles = {};
  if (usageHookRecordHash) {
    versionFiles['.therapy/hooks/usage-stats.js'] = {
      version: null,
      hash: usageHookRecordHash,
      source: 'hooks/usage-stats.js',
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
  ]) {
    writeFileSync(path.join(therapy, f), `# ${f}\n`);
  }

  writeFileSync(
    path.join(root, 'profile.md'),
    '# Profile\n\n## Background\n\n## Current Focus\n\n## Notes\n'
  );

  mkdirSync(path.join(root, 'context'), { recursive: true });
  writeFileSync(path.join(root, 'context', 'index.md'), '# Index\n');

  // The safety-net hook script always present so its own checks stay clean.
  const hooksDir = path.join(therapy, 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(
    path.join(hooksDir, 'safety-net.js'),
    '// fixture stand-in for the real safety-net hook\n'
  );
  if (usageHookScript) {
    writeFileSync(path.join(hooksDir, 'usage-stats.js'), usageHookContent);
  }

  if (reflectionGuidance) {
    writeFileSync(
      path.join(therapy, 'usage-reflection.md'),
      '# Usage reflection\n'
    );
  }

  if (settings !== null) {
    mkdirSync(path.join(root, '.claude'), { recursive: true });
    writeFileSync(
      path.join(root, '.claude', 'settings.json'),
      typeof settings === 'string' ? settings : JSON.stringify(settings, null, 2)
    );
  }

  return root;
}

async function runDoctor(root) {
  try {
    // claudeVersionOutput: null skips the real `claude --version` spawn so
    // these fixtures stay independent of whatever CLI this machine has.
    return await doctor({ path: root, claudeVersionOutput: null });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const scriptOk = (r) =>
  r.checks.some((c) => c.includes('.therapy/hooks/usage-stats.js present'));
const scriptWarning = (r) =>
  r.warnings.some((w) => w.includes('usage-stats hook script missing'));
const reflectionOk = (r) =>
  r.checks.some((c) => c.includes('.therapy/usage-reflection.md present'));
const reflectionWarning = (r) =>
  r.warnings.some((w) => w.includes('usage-reflection guidance missing'));
const registrationOk = (r) =>
  r.checks.some((c) =>
    c.includes('usage-stats hook registered in .claude/settings.json')
  );
const registrationWarning = (r) =>
  r.warnings.some((w) =>
    w.includes('usage-stats hook not registered in .claude/settings.json')
  );
const tamperWarning = (r) =>
  r.warnings.find(
    (w) =>
      w.includes('usage-stats hook') && w.includes('modified from the shipped version')
  );
const integrityOk = (r) =>
  r.checks.some((c) => c.includes('usage-stats hook matches its installed version'));
const usageWarnings = (r) =>
  r.warnings.filter((w) => w.toLowerCase().includes('usage'));

test('all present: ok entries, no usage-stats warnings, doctor passes', async () => {
  const result = await runDoctor(makeInstall());
  assert.equal(result.ok, true);
  assert.ok(scriptOk(result), 'script ok entry present');
  assert.ok(reflectionOk(result), 'reflection ok entry present');
  assert.ok(registrationOk(result), 'registration ok entry present');
  assert.equal(usageWarnings(result).length, 0, 'no usage-stats warnings');
});

test('hook script missing: warning with update fix, others still ok, doctor passes', async () => {
  const result = await runDoctor(makeInstall({ usageHookScript: false }));
  assert.equal(result.ok, true, 'warnings must not fail validation');
  assert.equal(result.errors.length, 0, 'no errors, only warnings');
  assert.ok(scriptWarning(result), 'script warning present');
  assert.ok(!scriptOk(result), 'no script ok entry');
  assert.ok(reflectionOk(result), 'reflection still ok');
  assert.ok(registrationOk(result), 'registration still ok');
  const w = result.warnings.find((x) => x.includes('usage-stats hook script missing'));
  assert.ok(
    w.includes('npx inner-dialogue@latest update --path'),
    'warning carries the one-line update fix'
  );
});

test('reflection guidance missing: warning with update fix, others still ok, doctor passes', async () => {
  const result = await runDoctor(makeInstall({ reflectionGuidance: false }));
  assert.equal(result.ok, true, 'warnings must not fail validation');
  assert.equal(result.errors.length, 0, 'no errors, only warnings');
  assert.ok(reflectionWarning(result), 'reflection warning present');
  assert.ok(!reflectionOk(result), 'no reflection ok entry');
  assert.ok(scriptOk(result), 'script still ok');
  assert.ok(registrationOk(result), 'registration still ok');
  const w = result.warnings.find((x) => x.includes('usage-reflection guidance missing'));
  assert.ok(
    w.includes('npx inner-dialogue@latest update --path'),
    'warning carries the one-line update fix'
  );
});

test('SessionStart registration missing: warning with update fix, others ok, doctor passes', async () => {
  const result = await runDoctor(
    makeInstall({ settings: settingsWith({ usageStats: false }) })
  );
  assert.equal(result.ok, true, 'warnings must not fail validation');
  assert.equal(result.errors.length, 0, 'no errors, only warnings');
  assert.ok(registrationWarning(result), 'registration warning present');
  assert.ok(!registrationOk(result), 'no registration ok entry');
  assert.ok(scriptOk(result), 'script still ok');
  assert.ok(reflectionOk(result), 'reflection still ok');
  const w = result.warnings.find((x) =>
    x.includes('usage-stats hook not registered in .claude/settings.json')
  );
  assert.ok(
    w.includes('npx inner-dialogue@latest update --path'),
    'warning carries the one-line update fix'
  );
});

test('all three missing (pre-feature install): three warnings, no errors, doctor passes', async () => {
  const result = await runDoctor(
    makeInstall({
      usageHookScript: false,
      reflectionGuidance: false,
      settings: settingsWith({ usageStats: false }),
    })
  );
  assert.equal(result.ok, true, 'pre-feature installs must not FAIL validation');
  assert.equal(result.errors.length, 0, 'no errors, only warnings');
  assert.ok(scriptWarning(result), 'script warning present');
  assert.ok(reflectionWarning(result), 'reflection warning present');
  assert.ok(registrationWarning(result), 'registration warning present');
});

test('hook hash matches version.json record: integrity ok, no tamper warning', async () => {
  const result = await runDoctor(
    makeInstall({ usageHookRecordHash: hashString(HOOK_FIXTURE_CONTENT) })
  );
  assert.equal(result.ok, true);
  assert.ok(integrityOk(result), 'integrity ok entry present');
  assert.ok(!tamperWarning(result), 'no tamper warning');
});

test('hook hash mismatch: warning (not error) that it was modified, with --force restore path', async () => {
  const result = await runDoctor(
    makeInstall({
      usageHookRecordHash: hashString(HOOK_FIXTURE_CONTENT),
      usageHookContent: HOOK_FIXTURE_CONTENT + '// user edit\n',
    })
  );
  assert.equal(result.ok, true, 'mismatch is a warning, not an error');
  assert.equal(result.errors.length, 0, 'no errors');
  const warning = tamperWarning(result);
  assert.ok(warning, 'tamper warning present');
  assert.ok(!integrityOk(result), 'no integrity ok entry');
  assert.ok(
    warning.includes('npx inner-dialogue@latest update --path') &&
      warning.includes('--force'),
    'warning gives the --force restore path'
  );
});

test('no version.json record for the hook: integrity check skipped gracefully', async () => {
  const result = await runDoctor(makeInstall({ usageHookRecordHash: null }));
  assert.equal(result.ok, true);
  assert.ok(!tamperWarning(result), 'no tamper warning without a record');
  assert.ok(!integrityOk(result), 'no integrity ok entry without a record');
  assert.ok(scriptOk(result), 'script presence still reported ok');
});

test('malformed settings: no usage-stats registration warning prescribing update', async () => {
  const result = await runDoctor(makeInstall({ settings: '{ this is not json' }));
  assert.equal(result.ok, true, 'warnings must not fail validation');
  assert.ok(
    !registrationWarning(result),
    'no stacked not-registered warning (registration unverifiable, its fix would prescribe update)'
  );
});
