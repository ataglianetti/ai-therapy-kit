// Tests for the surgical .claude/settings.json merge in `update` (F7).
// Fixtures are built with the real CLI — install and update are spawned as
// child processes — so these tests exercise the actual entry point, flags,
// JSON output shape, and exit codes rather than an internal function in
// isolation (same black-box precedent as safety-net.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
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

const CANONICAL_USAGE_STATS_ENTRY = {
  matcher: 'startup|resume|clear|compact',
  hooks: [
    {
      type: 'command',
      command: 'node',
      args: ['${CLAUDE_PROJECT_DIR}/.therapy/hooks/usage-stats.js'],
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

// A settings file that already carries BOTH UserPromptSubmit hooks (the time
// hook and the safety-net hook) but no SessionStart hook. Used to isolate the
// usage-stats SessionStart merge: only that hook should be added, and the two
// existing UserPromptSubmit hooks must be left untouched.
const TWO_UPS_HOOKS_SETTINGS = {
  customKey: { keep: 'me' },
  hooks: {
    UserPromptSubmit: [
      {
        matcher: '',
        hooks: [{ type: 'command', command: 'date "+%A %Y-%m-%d %H:%M"' }],
      },
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
};

function usageStatsEntries(settings) {
  return (settings.hooks?.SessionStart || []).filter((entry) =>
    (entry.hooks || []).some(
      (h) =>
        (typeof h.command === 'string' && h.command.includes('usage-stats.js')) ||
        (Array.isArray(h.args) &&
          h.args.some((a) => typeof a === 'string' && a.includes('usage-stats.js')))
    )
  );
}

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

    // Update now merges BOTH hooks into a pre-existing settings file: the
    // safety-net hook (UserPromptSubmit) and the usage-stats hook
    // (SessionStart). Assert the merge SET rather than a single item.
    const merges = res.json.plan.settings_merge;
    assert.ok(Array.isArray(merges), 'plan.settings_merge is an array');
    assert.equal(merges.length, 2, 'both hooks merged');
    for (const m of merges) {
      assert.equal(m.path, '.claude/settings.json');
      assert.ok(
        m.backup.includes('settings.json.bak-'),
        'merge item reports its backup path'
      );
    }
    assert.deepEqual(
      merges.map((m) => m.action).sort(),
      ['add_safety_net_hook', 'add_usage_stats_hook'],
      'the merge set adds the safety-net (UserPromptSubmit) and usage-stats (SessionStart) hooks'
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

    // The usage-stats hook is registered under a fresh SessionStart group.
    const sessionStart = settings.hooks.SessionStart;
    assert.equal(sessionStart.length, 1, 'one SessionStart entry');
    assert.deepEqual(
      sessionStart[0],
      CANONICAL_USAGE_STATS_ENTRY,
      'canonical usage-stats SessionStart entry appended'
    );

    const baks = settingsBackups(root);
    assert.equal(baks.length, 1, 'exactly one settings backup created');
    // The two merges run in the same second and share one backup filename; the
    // usage-stats merge re-snapshots after the safety-net append, so the
    // surviving backup is a genuine pre-write snapshot (unrelated key intact,
    // SessionStart not yet registered).
    const bak = JSON.parse(
      readFileSync(path.join(root, '.claude', baks[0]), 'utf8')
    );
    assert.deepEqual(
      bak.customKey,
      { keep: 'me' },
      'backup holds a pre-merge snapshot'
    );
    assert.ok(
      !bak.hooks.SessionStart,
      'backup predates the usage-stats SessionStart registration'
    );

    // F19: the merge writes via temp-file + rename. Nothing but the settings
    // file and its backup may remain in .claude/ — no stray temp files.
    const leftovers = readdirSync(path.join(root, '.claude')).filter(
      (n) => n !== 'settings.json' && !n.startsWith('settings.json.bak-')
    );
    assert.deepEqual(leftovers, [], 'no stray temp files left in .claude/');
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

    // Both merges (safety-net + usage-stats) skip on malformed JSON.
    const merges = res.json.plan.settings_merge;
    assert.equal(merges.length, 2, 'both merges skip on malformed JSON');
    for (const m of merges) {
      assert.equal(m.action, 'skipped');
      assert.ok(m.reason, 'skip carries a reason');
    }

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
    assert.equal(merges.length, 2, 'both hooks planned');
    assert.deepEqual(
      merges.map((m) => m.action).sort(),
      ['add_safety_net_hook', 'add_usage_stats_hook'],
      'both the safety-net and usage-stats hooks are planned'
    );

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

// F22: the merge must be visible in the human-readable (non---json) output —
// action taken and backup location, or the skip reason.
test('human output surfaces the merge with its backup path', () => {
  const { dir, root, settingsPath } = freshInstall();
  try {
    writeFileSync(
      settingsPath,
      JSON.stringify(TIME_HOOK_SETTINGS, null, 2) + '\n'
    );

    const result = spawnSync('node', [CLI_PATH, 'update', '--path', root], {
      encoding: 'utf8',
      timeout: 120_000,
    });
    assert.equal(result.status, 0, `exit 0 (stderr: ${result.stderr})`);
    assert.ok(
      result.stdout.includes(
        'Registered the safety-net hook in .claude/settings.json'
      ),
      `merge line printed\nstdout: ${result.stdout}`
    );
    assert.ok(
      /Backup: .*settings\.json\.bak-/.test(result.stdout),
      `backup path printed\nstdout: ${result.stdout}`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('human output surfaces a skipped merge with its reason', () => {
  const { dir, root, settingsPath } = freshInstall();
  try {
    writeFileSync(settingsPath, '{ this is not json');

    const result = spawnSync('node', [CLI_PATH, 'update', '--path', root], {
      encoding: 'utf8',
      timeout: 120_000,
    });
    assert.equal(result.status, 0, `exit 0 (stderr: ${result.stderr})`);
    assert.ok(
      result.stdout.includes('Skipped .claude/settings.json:') &&
        result.stdout.includes('not valid JSON'),
      `skip line with reason printed\nstdout: ${result.stdout}`
    );
    // F36: "Already up to date." right after a skip notice reads as a
    // contradiction — it must be suppressed when a merge skip was reported.
    assert.ok(
      !result.stdout.includes('Already up to date.'),
      `"Already up to date." suppressed after a skip\nstdout: ${result.stdout}`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// F33: an fs failure inside the merge apply (here: the pre-merge backup copy
// into a read-only .claude/) must downgrade to a skipped item — not crash the
// run after framework files are written but before version.json is, which
// would leave a stale hash registry behind.
test(
  'fs failure during merge apply downgrades to a skip; update still completes',
  { skip: process.platform === 'win32' },
  () => {
    const { dir, root, settingsPath } = freshInstall();
    const claudeDir = path.join(root, '.claude');
    try {
      const before = JSON.stringify(TIME_HOOK_SETTINGS, null, 2) + '\n';
      writeFileSync(settingsPath, before);
      chmodSync(claudeDir, 0o555); // read-only: backup + temp write both fail

      const res = runJson(['update', '--path', root], 'update read-only');
      chmodSync(claudeDir, 0o755);

      assert.equal(res.status, 0, `exit 0 (stderr: ${res.stderr})`);
      assert.equal(res.json.ok, true, 'run completes despite the fs failure');

      // Both merges downgrade to a skip carrying the fs error.
      const merges = res.json.plan.settings_merge;
      assert.equal(merges.length, 2, 'both merges skip on the fs failure');
      for (const m of merges) {
        assert.equal(m.action, 'skipped');
        assert.ok(
          m.reason.includes('settings merge failed'),
          `skip reason carries the error: ${m.reason}`
        );
      }

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

// F34: the atomic write replaces the inode via rename — without an explicit
// mode carry-over, a user's chmod 600 settings.json would silently become
// world-readable after a merge.
test(
  'merge preserves a chmod-600 settings.json file mode',
  { skip: process.platform === 'win32' },
  () => {
    const { dir, root, settingsPath } = freshInstall();
    try {
      writeFileSync(
        settingsPath,
        JSON.stringify(TIME_HOOK_SETTINGS, null, 2) + '\n'
      );
      chmodSync(settingsPath, 0o600);

      const res = runJson(['update', '--path', root], 'update mode-600');
      assert.equal(res.status, 0, `exit 0 (stderr: ${res.stderr})`);
      assert.equal(res.json.plan.settings_merge[0].action, 'add_safety_net_hook');

      const mode = statSync(settingsPath).mode & 0o777;
      assert.equal(
        mode,
        0o600,
        `settings.json stays 600 after merge (got ${mode.toString(8)})`
      );
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      assert.equal(
        settings.hooks.UserPromptSubmit.length,
        2,
        'merge actually happened'
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);

test('both hooks already registered via shell-form command strings is a no-op', () => {
  const { dir, root, settingsPath } = freshInstall();
  try {
    // Both hooks are registered in shell-form (single command string) rather
    // than the canonical exec-form. The marker substring match must recognize
    // each as already present, so neither merge fires.
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
        SessionStart: [
          {
            matcher: 'startup|resume|clear|compact',
            hooks: [
              {
                type: 'command',
                command:
                  'node "$CLAUDE_PROJECT_DIR/.therapy/hooks/usage-stats.js"',
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

// T-203/T-302: with the safety-net hook already registered under
// UserPromptSubmit, update merges ONLY the usage-stats SessionStart hook — and
// leaves the two pre-existing UserPromptSubmit hooks alone.
test('update registers the SessionStart usage-stats hook without disturbing the UserPromptSubmit hooks', () => {
  const { dir, root, settingsPath } = freshInstall();
  try {
    writeFileSync(
      settingsPath,
      JSON.stringify(TWO_UPS_HOOKS_SETTINGS, null, 2) + '\n'
    );

    const res = runJson(['update', '--path', root], 'update sessionstart');
    assert.equal(res.status, 0, `exit 0 (stderr: ${res.stderr})`);
    assert.equal(res.json.ok, true);

    // The safety-net hook is already present, so only the usage-stats hook is
    // added.
    assert.deepEqual(
      res.json.plan.settings_merge.map((m) => m.action),
      ['add_usage_stats_hook'],
      'only the SessionStart usage-stats hook is merged'
    );

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));

    // A SessionStart group is created with the canonical matcher and command.
    const sessionStart = settings.hooks.SessionStart;
    assert.equal(sessionStart.length, 1, 'one SessionStart entry');
    assert.equal(
      sessionStart[0].matcher,
      'startup|resume|clear|compact',
      'SessionStart matcher'
    );
    assert.deepEqual(
      sessionStart[0],
      CANONICAL_USAGE_STATS_ENTRY,
      'canonical usage-stats SessionStart entry, command references usage-stats.js'
    );

    // The two pre-existing UserPromptSubmit hooks are untouched.
    assert.equal(
      settings.hooks.UserPromptSubmit.length,
      2,
      'UserPromptSubmit count unchanged (stays 2)'
    );
    assert.equal(
      settings.hooks.UserPromptSubmit[0].hooks[0].command,
      'date "+%A %Y-%m-%d %H:%M"',
      'the pre-existing time hook is preserved in place'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('second update does not double-register the SessionStart usage-stats hook', () => {
  const { dir, root, settingsPath } = freshInstall();
  try {
    writeFileSync(
      settingsPath,
      JSON.stringify(TWO_UPS_HOOKS_SETTINGS, null, 2) + '\n'
    );
    const first = runJson(['update', '--path', root], 'first update');
    assert.deepEqual(
      first.json.plan.settings_merge.map((m) => m.action),
      ['add_usage_stats_hook'],
      'first run merges the usage-stats hook'
    );

    const second = runJson(['update', '--path', root], 'second update');
    assert.equal(second.status, 0);
    assert.equal(second.json.ok, true);
    assert.deepEqual(
      second.json.plan.settings_merge,
      [],
      'second run plans no merge'
    );

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(
      usageStatsEntries(settings).length,
      1,
      'exactly one SessionStart usage-stats entry'
    );
    assert.equal(
      settings.hooks.UserPromptSubmit.length,
      2,
      'UserPromptSubmit count still 2'
    );
    assert.equal(settingsBackups(root).length, 1, 'no second backup created');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
