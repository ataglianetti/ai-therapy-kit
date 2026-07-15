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
  // Generalized machinery + descriptors (T-103)
  SAFETY_NET_DESC,
  USAGE_STATS_DESC,
  hookEntry,
  hasHook,
  planHookMerge,
  applyHookMerge,
  safetyNetHookEntry,
  hasSafetyNetHook,
  planSafetyNetMerge,
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

// ---------------------------------------------------------------------------
// T-103: generalized hook-descriptor machinery. The safety-net wrappers must
// stay byte-identical in behavior; the usage-stats descriptor must register a
// SessionStart hook without disturbing the UserPromptSubmit path.
// ---------------------------------------------------------------------------

const SAFETY_NET_ENTRY = {
  matcher: '',
  hooks: [
    {
      type: 'command',
      command: 'node',
      args: ['${CLAUDE_PROJECT_DIR}/.therapy/hooks/safety-net.js'],
    },
  ],
};

const USAGE_STATS_ENTRY = {
  matcher: 'startup|resume|clear|compact',
  hooks: [
    {
      type: 'command',
      command: 'node',
      args: ['${CLAUDE_PROJECT_DIR}/.therapy/hooks/usage-stats.js'],
    },
  ],
};

// A pre-existing settings file: shipped time hook + an unrelated user key.
function timeHookSettings() {
  return {
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
}

function settingsDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'id-settings-desc-'));
}

// --- safety-net wrappers: unchanged behavior --------------------------------

test('safetyNetHookEntry returns the canonical exec-form entry (fresh object)', () => {
  const a = safetyNetHookEntry();
  assert.deepEqual(a, SAFETY_NET_ENTRY);
  assert.deepEqual(a, hookEntry(SAFETY_NET_DESC));
  const b = safetyNetHookEntry();
  assert.notEqual(a, b, 'fresh object each call');
  assert.notEqual(a.hooks[0].args, b.hooks[0].args, 'nested args not shared');
});

test('hasSafetyNetHook true/false cases (exec form, shell form, absent)', () => {
  // exec form (args-based)
  assert.equal(
    hasSafetyNetHook({ hooks: { UserPromptSubmit: [SAFETY_NET_ENTRY] } }),
    true
  );
  // shell form (command-string based)
  assert.equal(
    hasSafetyNetHook({
      hooks: {
        UserPromptSubmit: [
          {
            matcher: '',
            hooks: [
              {
                type: 'command',
                command: 'node "$CLAUDE_PROJECT_DIR/.therapy/hooks/safety-net.js"',
              },
            ],
          },
        ],
      },
    }),
    true
  );
  // absent — only the time hook
  assert.equal(hasSafetyNetHook(timeHookSettings()), false);
  // malformed / missing shapes
  assert.equal(hasSafetyNetHook(null), false);
  assert.equal(hasSafetyNetHook({}), false);
  assert.equal(hasSafetyNetHook({ hooks: { UserPromptSubmit: 'nope' } }), false);
});

test('planSafetyNetMerge returns add_safety_net_hook when absent; null when present/missing', async () => {
  const dir = settingsDir();
  const target = path.join(dir, 'settings.json');
  try {
    // Absent file → null (scaffold path owns creation)
    assert.equal(await planSafetyNetMerge(target), null);

    // Present, hook absent → plan add_safety_net_hook
    writeFileSync(target, JSON.stringify(timeHookSettings(), null, 2) + '\n');
    assert.deepEqual(await planSafetyNetMerge(target), {
      path: '.claude/settings.json',
      action: 'add_safety_net_hook',
    });

    // Already registered → null
    const withHook = timeHookSettings();
    withHook.hooks.UserPromptSubmit.push(SAFETY_NET_ENTRY);
    writeFileSync(target, JSON.stringify(withHook, null, 2) + '\n');
    assert.equal(await planSafetyNetMerge(target), null);

    // Malformed → skip object
    writeFileSync(target, '{ this is not json');
    const skip = await planSafetyNetMerge(target);
    assert.equal(skip.action, 'skipped');
    assert.match(skip.reason, /not valid JSON/);
    assert.match(skip.reason, /register the safety-net hook/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applySafetyNetMerge appends into UserPromptSubmit, preserving existing content', async () => {
  const dir = settingsDir();
  const target = path.join(dir, 'settings.json');
  try {
    writeFileSync(target, JSON.stringify(timeHookSettings(), null, 2) + '\n');
    const result = await applySafetyNetMerge(target);
    assert.equal(result.merged, true);
    assert.match(result.backup, /settings\.json\.bak-/);

    const settings = JSON.parse(readFileSync(target, 'utf8'));
    assert.deepEqual(settings.customKey, { keep: 'me' });
    assert.equal(settings.hooks.UserPromptSubmit.length, 2, 'appended, not replaced');
    assert.deepEqual(settings.hooks.UserPromptSubmit[1], SAFETY_NET_ENTRY);
    assert.equal(settings.hooks.SessionStart, undefined, 'no SessionStart added');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- usage-stats descriptor -------------------------------------------------

test('hookEntry(USAGE_STATS_DESC) is a SessionStart-shaped exec entry', () => {
  assert.deepEqual(hookEntry(USAGE_STATS_DESC), USAGE_STATS_ENTRY);
});

test('hasHook(usage-stats) is false on a fresh safety-net-only settings object', () => {
  const settings = { hooks: { UserPromptSubmit: [SAFETY_NET_ENTRY] } };
  assert.equal(hasHook(settings, USAGE_STATS_DESC), false);
  // ...and true once its own entry is present
  assert.equal(
    hasHook(
      { hooks: { SessionStart: [USAGE_STATS_ENTRY] } },
      USAGE_STATS_DESC
    ),
    true
  );
});

test('planHookMerge(usage-stats) returns add_usage_stats_hook when absent', async () => {
  const dir = settingsDir();
  const target = path.join(dir, 'settings.json');
  try {
    writeFileSync(target, JSON.stringify(timeHookSettings(), null, 2) + '\n');
    assert.deepEqual(await planHookMerge(target, USAGE_STATS_DESC), {
      path: '.claude/settings.json',
      action: 'add_usage_stats_hook',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applyHookMerge(usage-stats) appends a SessionStart group without touching UserPromptSubmit', async () => {
  const dir = settingsDir();
  const target = path.join(dir, 'settings.json');
  try {
    // Start from a file that already has the safety-net hook registered.
    const start = timeHookSettings();
    start.hooks.UserPromptSubmit.push(SAFETY_NET_ENTRY);
    writeFileSync(target, JSON.stringify(start, null, 2) + '\n');

    const result = await applyHookMerge(target, USAGE_STATS_DESC);
    assert.equal(result.merged, true);
    assert.match(result.backup, /settings\.json\.bak-/);

    const settings = JSON.parse(readFileSync(target, 'utf8'));
    // UserPromptSubmit untouched (time hook + safety-net still there)
    assert.equal(settings.hooks.UserPromptSubmit.length, 2);
    assert.deepEqual(settings.hooks.UserPromptSubmit[1], SAFETY_NET_ENTRY);
    assert.deepEqual(settings.customKey, { keep: 'me' });
    // SessionStart group added with the right matcher + args
    assert.ok(Array.isArray(settings.hooks.SessionStart));
    assert.equal(settings.hooks.SessionStart.length, 1);
    assert.deepEqual(settings.hooks.SessionStart[0], USAGE_STATS_ENTRY);
    assert.equal(
      settings.hooks.SessionStart[0].matcher,
      'startup|resume|clear|compact'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applyHookMerge(usage-stats) is idempotent — no double register', async () => {
  const dir = settingsDir();
  const target = path.join(dir, 'settings.json');
  try {
    writeFileSync(target, JSON.stringify(timeHookSettings(), null, 2) + '\n');
    const first = await applyHookMerge(target, USAGE_STATS_DESC);
    assert.equal(first.merged, true);

    const second = await applyHookMerge(target, USAGE_STATS_DESC);
    assert.equal(second.merged, false);
    assert.equal(second.code, 'already_registered');
    assert.match(second.reason, /usage-stats hook already registered/);

    const settings = JSON.parse(readFileSync(target, 'utf8'));
    assert.equal(settings.hooks.SessionStart.length, 1, 'exactly one entry');
    // planHookMerge agrees the second pass is a no-op
    assert.equal(await planHookMerge(target, USAGE_STATS_DESC), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('planHookMerge(usage-stats) on malformed JSON returns a skip object naming the hook', async () => {
  const dir = settingsDir();
  const target = path.join(dir, 'settings.json');
  try {
    writeFileSync(target, '{ this is not json');
    const skip = await planHookMerge(target, USAGE_STATS_DESC);
    assert.equal(skip.action, 'skipped');
    assert.match(skip.reason, /not valid JSON/);
    assert.match(skip.reason, /register the usage-stats hook/);

    // applyHookMerge surfaces the same malformed skip without throwing
    const applySkip = await applyHookMerge(target, USAGE_STATS_DESC);
    assert.equal(applySkip.merged, false);
    assert.equal(applySkip.code, 'malformed');
    assert.equal(
      readFileSync(target, 'utf8'),
      '{ this is not json',
      'malformed file untouched'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseSettingsForMerge(usage-stats) bad_shape names the SessionStart key', () => {
  const result = parseSettingsForMerge(
    JSON.stringify({ hooks: { SessionStart: 'nope' } }),
    USAGE_STATS_DESC
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'bad_shape');
  assert.match(result.reason, /"hooks\.SessionStart" is not an array/);
  assert.match(result.reason, /register the usage-stats hook/);
  // A malformed UserPromptSubmit is NOT the usage-stats descriptor's concern.
  const upsBad = parseSettingsForMerge(
    JSON.stringify({ hooks: { UserPromptSubmit: 'nope' } }),
    USAGE_STATS_DESC
  );
  assert.equal(upsBad.ok, true, 'usage-stats parse ignores UserPromptSubmit shape');
});
