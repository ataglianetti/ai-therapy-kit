// Tests for the surgical .claude/settings.json merge in `update` (F7).
// Fixtures are built with the real CLI — install and update are spawned as
// child processes — so these tests exercise the actual entry point, flags,
// JSON output shape, and exit codes rather than an internal function in
// isolation (same black-box precedent as safety-net.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
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

const CANONICAL_ENTRY = {
  matcher: '',
  hooks: [
    {
      type: 'command',
      command: 'node',
      args: ['${CLAUDE_PROJECT_DIR}/.therapy/hooks/safety-net.js'],
    },
  ],
};

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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'id-settings-merge-'));
  const root = path.join(dir, 'Sage');
  const res = runJson(
    [
      'install',
      '--name', 'Sage',
      '--path', root,
      '--persona', 'warm-4o',
      '--structure', 'moderate',
      '--modalities', 'cbt',
    ],
    'install'
  );
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

test('merge appends exec-form entry, preserves existing content, snapshots first', () => {
  const { dir, root, settingsPath } = freshInstall();
  try {
    writeFileSync(
      settingsPath,
      JSON.stringify(TIME_HOOK_SETTINGS, null, 2) + '\n'
    );

    const res = runJson(['update', '--path', root], 'update merge');
    assert.equal(res.status, 0, `exit 0 (stderr: ${res.stderr})`);
    assert.equal(res.json.ok, true);

    const merges = res.json.plan.settings_merge;
    assert.ok(Array.isArray(merges), 'plan.settings_merge is an array');
    assert.equal(merges.length, 1);
    assert.equal(merges[0].path, '.claude/settings.json');
    assert.equal(merges[0].action, 'add_safety_net_hook');
    assert.ok(
      merges[0].backup.includes('settings.json.bak-'),
      'merge item reports its backup path'
    );

    const raw = readFileSync(settingsPath, 'utf8');
    assert.ok(raw.endsWith('\n'), 'trailing newline');
    const settings = JSON.parse(raw);
    assert.equal(
      raw,
      JSON.stringify(settings, null, 2) + '\n',
      '2-space-indented output'
    );
    assert.deepEqual(
      settings.customKey,
      { keep: 'me' },
      'unrelated custom key preserved'
    );
    const entries = settings.hooks.UserPromptSubmit;
    assert.equal(entries.length, 2, 'appended, not replaced');
    assert.equal(
      entries[0].hooks[0].command,
      'date "+%A %Y-%m-%d %H:%M"',
      'pre-existing time hook preserved in place'
    );
    assert.deepEqual(entries[1], CANONICAL_ENTRY, 'canonical exec-form entry appended');

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
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('second run is idempotent: no duplicate entry, no new backup', () => {
  const { dir, root, settingsPath } = freshInstall();
  try {
    writeFileSync(
      settingsPath,
      JSON.stringify(TIME_HOOK_SETTINGS, null, 2) + '\n'
    );
    const first = runJson(['update', '--path', root], 'first update');
    assert.equal(first.json.ok, true);

    const second = runJson(['update', '--path', root], 'second update');
    assert.equal(second.status, 0);
    assert.equal(second.json.ok, true);
    assert.deepEqual(
      second.json.plan.settings_merge,
      [],
      'second run plans no merge'
    );

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const safetyNetEntries = settings.hooks.UserPromptSubmit.filter((entry) =>
      (entry.hooks || []).some(
        (h) =>
          (typeof h.command === 'string' && h.command.includes('safety-net.js')) ||
          (Array.isArray(h.args) &&
            h.args.some((a) => a.includes('safety-net.js')))
      )
    );
    assert.equal(safetyNetEntries.length, 1, 'exactly one safety-net entry');
    assert.equal(settingsBackups(root).length, 1, 'no second backup created');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('malformed settings.json is reported, untouched, and does not change the exit code', () => {
  const { dir, root, settingsPath } = freshInstall();
  try {
    const garbage = '{ this is not json';
    writeFileSync(settingsPath, garbage);

    const res = runJson(['update', '--path', root], 'update malformed');
    assert.equal(res.status, 0, `exit code unchanged (stderr: ${res.stderr})`);
    assert.equal(res.json.ok, true);

    const merges = res.json.plan.settings_merge;
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

test('--dry-run reports the merge without writing', () => {
  const { dir, root, settingsPath } = freshInstall();
  try {
    const before = JSON.stringify(TIME_HOOK_SETTINGS, null, 2) + '\n';
    writeFileSync(settingsPath, before);

    const res = runJson(['update', '--path', root, '--dry-run'], 'dry run');
    assert.equal(res.status, 0);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.dry_run, true);

    const merges = res.json.plan.settings_merge;
    assert.equal(merges.length, 1);
    assert.equal(merges[0].action, 'add_safety_net_hook');

    assert.equal(
      readFileSync(settingsPath, 'utf8'),
      before,
      'file unchanged after dry run'
    );
    assert.equal(settingsBackups(root).length, 0, 'no backup created');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('already registered via shell-form command string is a no-op', () => {
  const { dir, root, settingsPath } = freshInstall();
  try {
    const shellForm = {
      hooks: {
        UserPromptSubmit: [
          {
            matcher: '',
            hooks: [
              {
                type: 'command',
                command:
                  'node "$CLAUDE_PROJECT_DIR/.therapy/hooks/safety-net.js"',
              },
            ],
          },
        ],
      },
    };
    const before = JSON.stringify(shellForm, null, 2) + '\n';
    writeFileSync(settingsPath, before);

    const res = runJson(['update', '--path', root], 'shell-form no-op');
    assert.equal(res.status, 0);
    assert.equal(res.json.ok, true);
    assert.deepEqual(res.json.plan.settings_merge, [], 'no merge planned');

    assert.equal(
      readFileSync(settingsPath, 'utf8'),
      before,
      'file unchanged'
    );
    assert.equal(settingsBackups(root).length, 0, 'no backup created');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
