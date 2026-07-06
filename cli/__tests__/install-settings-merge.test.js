// Tests for the settings merge in `install` (F21). When install runs over a
// folder that already has .claude/settings.json (the documented --force
// migration path, or a pre-created project folder), it must apply the same
// append-if-absent merge `update` uses — backup first, never clobber —
// instead of leaving the hook script installed but unregistered.
//
// Same black-box precedent as update-settings-merge.test.js: fixtures are
// built by spawning the real CLI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, '..', '..', 'bin', 'inner-dialogue.js');

const INSTALL_ARGS = (root) => [
  'install',
  '--name', 'Sage',
  '--path', root,
  '--persona', 'warm-4o',
  '--structure', 'moderate',
  '--modalities', 'cbt',
];

// A pre-safety-net settings file: the shipped time hook plus an unrelated
// user customization. Both must survive the merge untouched.
const TIME_HOOK_SETTINGS = {
  customKey: { keep: 'me' },
  hooks: {
    UserPromptSubmit: [
      {
        matcher: '',
        hooks: [{ type: 'command', command: 'date "+%A %Y-%m-%d %H:%M"' }],
      },
    ],
  },
};

function runJson(args, label) {
  const result = spawnSync('node', [CLI_PATH, ...args, '--json'], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    assert.fail(
      `stdout is not JSON for ${label}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    );
  }
  return { status: result.status, stderr: result.stderr, json };
}

function freshInstall() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'id-install-merge-'));
  const root = path.join(dir, 'Sage');
  const res = runJson(INSTALL_ARGS(root), 'install');
  assert.equal(res.json.ok, true, `install ok (stderr: ${res.stderr})`);
  return {
    dir,
    root,
    settingsPath: path.join(root, '.claude', 'settings.json'),
  };
}

function settingsBackups(root) {
  return readdirSync(path.join(root, '.claude')).filter((n) =>
    n.startsWith('settings.json.bak-')
  );
}

function safetyNetEntries(settings) {
  return (settings.hooks?.UserPromptSubmit || []).filter((entry) =>
    (entry.hooks || []).some(
      (h) =>
        (typeof h.command === 'string' && h.command.includes('safety-net.js')) ||
        (Array.isArray(h.args) &&
          h.args.some((a) => typeof a === 'string' && a.includes('safety-net.js')))
    )
  );
}

test('install --force over existing settings appends the hook entry, backup first', () => {
  const { dir, root, settingsPath } = freshInstall();
  try {
    writeFileSync(
      settingsPath,
      JSON.stringify(TIME_HOOK_SETTINGS, null, 2) + '\n'
    );

    const res = runJson(
      [...INSTALL_ARGS(root), '--force'],
      'install --force merge'
    );
    assert.equal(res.status, 0, `exit 0 (stderr: ${res.stderr})`);
    assert.equal(res.json.ok, true);

    const merges = res.json.settings_merge;
    assert.ok(Array.isArray(merges), 'result.settings_merge is an array');
    assert.equal(merges.length, 1);
    assert.equal(merges[0].path, '.claude/settings.json');
    assert.equal(merges[0].action, 'add_safety_net_hook');
    assert.ok(
      merges[0].backup.includes('settings.json.bak-'),
      'merge item reports its backup path'
    );

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.deepEqual(
      settings.customKey,
      { keep: 'me' },
      'unrelated custom key preserved'
    );
    assert.equal(
      settings.hooks.UserPromptSubmit.length,
      2,
      'appended, not replaced'
    );
    assert.equal(safetyNetEntries(settings).length, 1, 'one safety-net entry');

    const baks = settingsBackups(root);
    assert.equal(baks.length, 1, 'exactly one settings backup created');
    const bak = JSON.parse(
      readFileSync(path.join(root, '.claude', baks[0]), 'utf8')
    );
    assert.equal(
      bak.hooks.UserPromptSubmit.length,
      1,
      'backup holds pre-merge content'
    );

    // No stray temp files from the atomic write
    const leftovers = readdirSync(path.join(root, '.claude')).filter(
      (n) => n !== 'settings.json' && !n.startsWith('settings.json.bak-')
    );
    assert.deepEqual(leftovers, [], 'no stray temp files left in .claude/');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('second install --force is idempotent: no duplicate entry, no new backup', () => {
  const { dir, root, settingsPath } = freshInstall();
  try {
    writeFileSync(
      settingsPath,
      JSON.stringify(TIME_HOOK_SETTINGS, null, 2) + '\n'
    );
    const first = runJson([...INSTALL_ARGS(root), '--force'], 'first force');
    assert.equal(first.json.ok, true);
    assert.equal(first.json.settings_merge.length, 1);

    const second = runJson([...INSTALL_ARGS(root), '--force'], 'second force');
    assert.equal(second.status, 0);
    assert.equal(second.json.ok, true);
    assert.deepEqual(
      second.json.settings_merge,
      [],
      'second run reports no merge'
    );

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(
      safetyNetEntries(settings).length,
      1,
      'exactly one safety-net entry'
    );
    assert.equal(settingsBackups(root).length, 1, 'no second backup created');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install --force with malformed settings skips with a reason, file untouched', () => {
  const { dir, root, settingsPath } = freshInstall();
  try {
    const garbage = '{ this is not json';
    writeFileSync(settingsPath, garbage);

    const res = runJson(
      [...INSTALL_ARGS(root), '--force'],
      'install --force malformed'
    );
    assert.equal(res.status, 0, `exit code unchanged (stderr: ${res.stderr})`);
    assert.equal(res.json.ok, true);

    const merges = res.json.settings_merge;
    assert.equal(merges.length, 1);
    assert.equal(merges[0].action, 'skipped');
    assert.ok(merges[0].reason, 'skip carries a reason');

    assert.equal(
      readFileSync(settingsPath, 'utf8'),
      garbage,
      'malformed file left byte-for-byte untouched'
    );
    assert.equal(settingsBackups(root).length, 0, 'no backup created');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// F33: an fs failure inside the merge apply (read-only .claude/ makes the
// pre-merge backup copy fail) must downgrade to a skipped item — the rest of
// the install, including version.json, still completes.
test(
  'install --force with fs failure during merge skips with the error, install completes',
  { skip: process.platform === 'win32' },
  () => {
    const { dir, root, settingsPath } = freshInstall();
    const claudeDir = path.join(root, '.claude');
    try {
      const before = JSON.stringify(TIME_HOOK_SETTINGS, null, 2) + '\n';
      writeFileSync(settingsPath, before);
      chmodSync(claudeDir, 0o555); // read-only: backup + temp write both fail

      const res = runJson(
        [...INSTALL_ARGS(root), '--force'],
        'install --force read-only'
      );
      chmodSync(claudeDir, 0o755);

      assert.equal(res.status, 0, `exit 0 (stderr: ${res.stderr})`);
      assert.equal(res.json.ok, true, 'install completes despite the fs failure');

      const merges = res.json.settings_merge;
      assert.equal(merges.length, 1);
      assert.equal(merges[0].action, 'skipped');
      assert.ok(
        merges[0].reason.includes('settings merge failed'),
        `skip reason carries the error: ${merges[0].reason}`
      );

      assert.equal(
        readFileSync(settingsPath, 'utf8'),
        before,
        'settings.json left untouched'
      );
      assert.equal(settingsBackups(root).length, 0, 'no backup created');
    } finally {
      chmodSync(claudeDir, 0o755);
      rmSync(dir, { recursive: true, force: true });
    }
  }
);

test('fresh install scaffolds the template with the hook already registered (no merge)', () => {
  const { dir, root, settingsPath } = freshInstall();
  try {
    // freshInstall already ran plain install into an empty folder
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(
      safetyNetEntries(settings).length,
      1,
      'template scaffold carries the safety-net entry'
    );
    assert.equal(settingsBackups(root).length, 0, 'no backup on scaffold');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
