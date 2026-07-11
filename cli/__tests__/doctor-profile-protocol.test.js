// Tests for the doctor profile-protocol presence check
// (.therapy/profile-protocol.md). WARNING severity by design — pre-feature
// installs that haven't run `update` yet must keep validating clean.
//
// Fixtures are minimal hand-built installs (mirroring doctor-safety-net.test.js)
// rather than real `install` runs so the suite stays independent of parallel
// install-path work and runs fast.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { doctor } from '../doctor.js';

// Exec-form registration (the shape update/install write), so the safety-net
// registration check passes and doesn't add unrelated warnings.
const EXEC_FORM_ENTRY = {
  type: 'command',
  command: 'node',
  args: ['${CLAUDE_PROJECT_DIR}/.therapy/hooks/safety-net.js'],
};

const TIME_HOOK_ENTRY = {
  type: 'command',
  command:
    'node -e "process.stdout.write(JSON.stringify({}))"',
};

function settings() {
  return {
    hooks: {
      UserPromptSubmit: [
        { matcher: '', hooks: [TIME_HOOK_ENTRY, EXEC_FORM_ENTRY] },
      ],
    },
  };
}

// Builds a minimal install that passes every other doctor check, so the only
// warning in play is the profile-protocol one (when the file is absent).
function makeInstall({ profileProtocol = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'doctor-profile-protocol-'));

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
  if (profileProtocol) {
    writeFileSync(
      path.join(therapy, 'profile-protocol.md'),
      '# profile-protocol.md\n'
    );
  }

  writeFileSync(
    path.join(root, 'profile.md'),
    '# Profile\n\n## Background\n\n## Current Focus\n\n## Notes\n'
  );

  mkdirSync(path.join(root, 'context'), { recursive: true });
  writeFileSync(path.join(root, 'context', 'index.md'), '# Index\n');

  const hooksDir = path.join(therapy, 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(
    path.join(hooksDir, 'safety-net.js'),
    '// fixture stand-in for the real hook\n'
  );

  mkdirSync(path.join(root, '.claude'), { recursive: true });
  writeFileSync(
    path.join(root, '.claude', 'settings.json'),
    JSON.stringify(settings(), null, 2)
  );

  return root;
}

async function runDoctor(root) {
  try {
    // claudeVersionOutput: null skips the real `claude --version` spawn so the
    // fixture stays independent of whatever CLI this machine has installed.
    return await doctor({ path: root, claudeVersionOutput: null });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const protocolOk = (r) =>
  r.checks.some((c) => c.includes('.therapy/profile-protocol.md present'));
const protocolWarning = (r) =>
  r.warnings.some((w) => w.includes('profile-protocol.md missing'));

test('profile-protocol present: ok entry, no warning, doctor passes', async () => {
  const result = await runDoctor(makeInstall({ profileProtocol: true }));
  assert.equal(result.ok, true);
  assert.ok(protocolOk(result), 'profile-protocol ok entry present');
  assert.ok(!protocolWarning(result), 'no profile-protocol warning');
});

test('profile-protocol absent: warning present, doctor STILL passes', async () => {
  const result = await runDoctor(makeInstall({ profileProtocol: false }));
  assert.equal(result.ok, true, 'warning must not fail validation');
  assert.equal(result.errors.length, 0, 'no errors, only a warning');
  assert.ok(protocolWarning(result), 'profile-protocol warning present');
  assert.ok(!protocolOk(result), 'no profile-protocol ok entry');
  assert.ok(
    result.warnings.some((w) => w.includes('inner-dialogue update')),
    'warning tells the user to run update'
  );
});
