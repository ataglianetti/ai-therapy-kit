// Unit tests for cli/lib/settings.js internals that the black-box CLI suites
// can't reach cheaply: bad_shape reason attribution (F36) and writeFileAtomic
// temp-file cleanup + mode preservation (F34/F36). The end-to-end merge
// behavior is covered by update-settings-merge.test.js and
// install-settings-merge.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { execSync } from 'node:child_process';

import {
  applySafetyNetMerge,
  parseSettingsForMerge,
  writeFileAtomic,
} from '../lib/settings.js';

// ---------------------------------------------------------------------------
// parseSettingsForMerge: bad_shape reasons name the actually-bad key
// ---------------------------------------------------------------------------

test('bad_shape when "hooks" is not an object names "hooks"', () => {
  for (const hooks of [[], 'nope', 42]) {
    const result = parseSettingsForMerge(JSON.stringify({ hooks }));
    assert.equal(result.ok, false, `not ok for hooks=${JSON.stringify(hooks)}`);
    assert.equal(result.code, 'bad_shape');
    assert.ok(
      result.reason.includes('"hooks" is not an object'),
      `reason names hooks: ${result.reason}`
    );
    assert.ok(
      !result.reason.includes('UserPromptSubmit'),
      `reason does not misattribute to UserPromptSubmit: ${result.reason}`
    );
  }
});

test('bad_shape when UserPromptSubmit is not an array names "hooks.UserPromptSubmit"', () => {
  for (const ups of [{}, 'nope', 42]) {
    const result = parseSettingsForMerge(
      JSON.stringify({ hooks: { UserPromptSubmit: ups } })
    );
    assert.equal(result.ok, false, `not ok for ups=${JSON.stringify(ups)}`);
    assert.equal(result.code, 'bad_shape');
    assert.ok(
      result.reason.includes('"hooks.UserPromptSubmit" is not an array'),
      `reason names the key: ${result.reason}`
    );
  }
});

test('well-shaped settings parse ok (sanity)', () => {
  for (const raw of [
    '{}',
    JSON.stringify({ hooks: {} }),
    JSON.stringify({ hooks: { UserPromptSubmit: [] } }),
  ]) {
    const result = parseSettingsForMerge(raw);
    assert.equal(result.ok, true, `ok for ${raw}`);
  }
});

// ---------------------------------------------------------------------------
// writeFileAtomic: temp-file hygiene and mode preservation
// ---------------------------------------------------------------------------

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'id-settings-lib-'));
}

test('no stray temp file when the temp write itself fails', {
  skip: process.platform === 'win32',
}, async () => {
  const dir = tempDir();
  const target = path.join(dir, 'settings.json');
  try {
    writeFileSync(target, '{"before": true}\n');
    chmodSync(dir, 0o555); // read-only dir: temp-file open fails

    await assert.rejects(() => writeFileAtomic(target, '{"after": true}\n'));

    chmodSync(dir, 0o755);
    assert.deepEqual(
      readdirSync(dir),
      ['settings.json'],
      'no temp files left behind'
    );
    assert.equal(
      readFileSync(target, 'utf8'),
      '{"before": true}\n',
      'target untouched'
    );
  } finally {
    chmodSync(dir, 0o755);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no stray temp file when the rename fails (temp write succeeded)', async () => {
  const dir = tempDir();
  // A directory at the target path: writeFile(tmp) succeeds, rename fails.
  const target = path.join(dir, 'settings.json');
  mkdirSync(target);
  try {
    await assert.rejects(() => writeFileAtomic(target, '{"after": true}\n'));
    assert.deepEqual(
      readdirSync(dir),
      ['settings.json'],
      'the partial temp file was unlinked'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preserves an existing 600 file mode across the atomic replace', {
  skip: process.platform === 'win32',
}, async () => {
  const dir = tempDir();
  const target = path.join(dir, 'settings.json');
  try {
    writeFileSync(target, '{"before": true}\n');
    chmodSync(target, 0o600);

    await writeFileAtomic(target, '{"after": true}\n');

    assert.equal(readFileSync(target, 'utf8'), '{"after": true}\n');
    const mode = statSync(target).mode & 0o777;
    assert.equal(mode, 0o600, `mode preserved (got ${mode.toString(8)})`);
    assert.deepEqual(readdirSync(dir), ['settings.json'], 'no temp leftovers');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('creates a new file with default mode when the target does not exist', async () => {
  const dir = tempDir();
  const target = path.join(dir, 'settings.json');
  try {
    await writeFileAtomic(target, '{"fresh": true}\n');
    assert.equal(readFileSync(target, 'utf8'), '{"fresh": true}\n');
    assert.deepEqual(readdirSync(dir), ['settings.json'], 'no temp leftovers');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// applySafetyNetMerge: fail-soft contract (round-4 F45)
// ---------------------------------------------------------------------------

test('merge fail-soft: fs failure returns code "error" instead of throwing', {
  skip: process.platform === 'win32',
}, async () => {
  // Read-only directory: the pre-merge backup copy fails. The merge must
  // come back as { merged: false, code: 'error' } — never a rejection — and
  // leave settings.json untouched.
  const dir = tempDir();
  const target = path.join(dir, 'settings.json');
  try {
    writeFileSync(target, '{}\n');
    chmodSync(dir, 0o555);

    const result = await applySafetyNetMerge(target);

    chmodSync(dir, 0o755);
    assert.equal(result.merged, false);
    assert.equal(result.code, 'error');
    assert.match(result.reason, /settings merge failed/);
    assert.doesNotMatch(
      result.reason,
      /backup was saved/,
      'no backup path claimed when the backup itself failed'
    );
    assert.equal(readFileSync(target, 'utf8'), '{}\n', 'target untouched');
  } finally {
    chmodSync(dir, 0o755);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('merge fail-soft: reason names the backup when the write fails after it', {
  skip: process.platform !== 'darwin',
}, async () => {
  // darwin-only: chflags uchg makes the target immutable, so the backup
  // copy succeeds but the atomic rename fails — the orphaned snapshot must
  // be named in the skip reason rather than left behind silently.
  const dir = tempDir();
  const target = path.join(dir, 'settings.json');
  try {
    writeFileSync(target, '{}\n');
    execSync(`chflags uchg ${JSON.stringify(target)}`);

    const result = await applySafetyNetMerge(target);

    execSync(`chflags nouchg ${JSON.stringify(target)}`);
    assert.equal(result.merged, false);
    assert.equal(result.code, 'error');
    assert.match(result.reason, /settings merge failed/);
    assert.match(
      result.reason,
      /A pre-merge backup was saved at .*settings\.json\.bak-/,
      'orphaned backup path surfaced in the reason'
    );
    assert.equal(readFileSync(target, 'utf8'), '{}\n', 'target untouched');
    assert.ok(
      !readdirSync(dir).some((f) => f.startsWith('.settings.json.tmp-')),
      'no temp leftovers'
    );
  } finally {
    try {
      execSync(`chflags nouchg ${JSON.stringify(target)}`);
    } catch {
      // already cleared
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
