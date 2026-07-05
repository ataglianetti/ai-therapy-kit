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

import { parseSettingsForMerge, writeFileAtomic } from '../lib/settings.js';

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
