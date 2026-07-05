// Tests for the doctor Claude Code version-floor check. Exec-form hook
// registration requires Claude Code >= 2.1.139 — on older CLIs the safety-net
// hook is silently inert while every file-level check passes (T-006 evidence,
// RUN_LOG Round 3). Doctor warns below the floor and skips silently when the
// CLI isn't visible.
//
// The parse/compare logic is tested directly via the exported
// checkClaudeCodeVersion; the doctor integration is tested through the
// injectable `claudeVersionOutput` seam — no real claude binary required.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  doctor,
  checkClaudeCodeVersion,
  MIN_CLAUDE_CODE_VERSION,
} from '../doctor.js';

// ---------------------------------------------------------------------------
// Pure parse/compare logic
// ---------------------------------------------------------------------------

test('floor constant matches the T-006 verified boundary', () => {
  assert.equal(MIN_CLAUDE_CODE_VERSION, '2.1.139');
});

test('below the floor: outdated, with the parsed version', () => {
  const result = checkClaudeCodeVersion('2.1.138 (Claude Code)');
  assert.equal(result.status, 'outdated');
  assert.equal(result.version, '2.1.138');
});

test('at the floor exactly: ok', () => {
  const result = checkClaudeCodeVersion('2.1.139 (Claude Code)');
  assert.equal(result.status, 'ok');
  assert.equal(result.version, '2.1.139');
});

test('above the floor: ok (patch, minor, and major bumps)', () => {
  for (const v of ['2.1.140', '2.2.0', '3.0.0']) {
    const result = checkClaudeCodeVersion(`${v} (Claude Code)`);
    assert.equal(result.status, 'ok', `${v} should be ok`);
    assert.equal(result.version, v);
  }
});

test('comparison is numeric, not lexicographic', () => {
  // '2.1.99' < '2.1.139' numerically, but '99' > '139' as strings.
  assert.equal(checkClaudeCodeVersion('2.1.99').status, 'outdated');
  // Higher minor outranks a lower patch position.
  assert.equal(checkClaudeCodeVersion('2.10.0').status, 'ok');
  // Lower major is outdated regardless of the rest.
  assert.equal(checkClaudeCodeVersion('1.99.999').status, 'outdated');
});

test('unparseable or missing output: unknown', () => {
  for (const output of [
    null,
    undefined,
    '',
    'command not found: claude',
    'Claude Code (no version here)',
  ]) {
    assert.equal(
      checkClaudeCodeVersion(output).status,
      'unknown',
      `expected unknown for ${JSON.stringify(output)}`
    );
  }
});

// ---------------------------------------------------------------------------
// Doctor integration (via the injectable claudeVersionOutput seam)
// ---------------------------------------------------------------------------

// Minimal install that passes every other doctor check, so only the version
// check is in play. Mirrors the fixture pattern in doctor-safety-net.test.js.
function makeInstall() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'doctor-claude-version-'));

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

  const hooksDir = path.join(therapy, 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(path.join(hooksDir, 'safety-net.js'), '// fixture\n');

  mkdirSync(path.join(root, '.claude'), { recursive: true });
  writeFileSync(
    path.join(root, '.claude', 'settings.json'),
    JSON.stringify(
      {
        hooks: {
          UserPromptSubmit: [
            {
              matcher: '',
              hooks: [
                {
                  type: 'command',
                  command: 'node',
                  args: ['${CLAUDE_PROJECT_DIR}/.therapy/hooks/safety-net.js'],
                },
              ],
            },
          ],
        },
      },
      null,
      2
    )
  );

  return root;
}

async function runDoctor(claudeVersionOutput) {
  const root = makeInstall();
  try {
    return await doctor({ path: root, claudeVersionOutput });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const versionWarning = (r) =>
  r.warnings.find((w) => w.includes(`older than ${MIN_CLAUDE_CODE_VERSION}`));
const versionOk = (r) =>
  r.checks.some((c) =>
    c.includes(`supports the safety-net hook (>= ${MIN_CLAUDE_CODE_VERSION})`)
  );

test('outdated CLI: warning (not error) naming the inert hook and the update fix', async () => {
  const result = await runDoctor('2.1.138 (Claude Code)');
  assert.equal(result.ok, true, 'warning must not fail validation');
  assert.equal(result.errors.length, 0, 'no errors');
  const warning = versionWarning(result);
  assert.ok(warning, 'version warning present');
  assert.ok(
    warning.includes('2.1.138'),
    'warning names the installed version'
  );
  assert.ok(
    /will not run on prompts/.test(warning),
    'warning explains the hook is inert'
  );
  assert.ok(
    warning.includes('claude update') &&
      warning.includes('npm i -g @anthropic-ai/claude-code@latest'),
    'warning carries the actionable fix'
  );
  assert.ok(!versionOk(result), 'no version ok entry');
});

test('CLI at/above the floor: ok entry, no warning', async () => {
  const result = await runDoctor('2.1.139 (Claude Code)');
  assert.equal(result.ok, true);
  assert.ok(versionOk(result), 'version ok entry present');
  assert.ok(!versionWarning(result), 'no version warning');
});

test('claude not visible (null seam): silent skip — no warning, no ok entry', async () => {
  const result = await runDoctor(null);
  assert.equal(result.ok, true);
  assert.ok(!versionWarning(result), 'no version warning');
  assert.ok(!versionOk(result), 'no version ok entry');
});

test('unparseable output: silent skip', async () => {
  const result = await runDoctor('zsh: command not found: claude');
  assert.equal(result.ok, true);
  assert.ok(!versionWarning(result), 'no version warning');
  assert.ok(!versionOk(result), 'no version ok entry');
});
