// Black-box tests for hooks/usage-stats.js.
// The hook is spawned as a real child process (like safety-net.test.js) so
// tests exercise the actual dual-parse mode and the stdin/stdout contract,
// not an imported function. All fixtures are synthetic files in temp dirs.
//
// Determinism: the hook reads "now" from USAGE_STATS_NOW_MS when set, so
// every fixture below is dated relative to a fixed reference instant — no
// dependence on the wall clock, no midnight-boundary flake. Day math in the
// hook is UTC-based (matching YYYY-MM-DD filenames); only the time-of-day
// cluster uses local hours, so those fixtures build local-time timestamps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = path.resolve(__dirname, '..', '..', 'hooks', 'usage-stats.js');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Fixed reference "now": 2026-07-15 12:00 UTC.
const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);
const NOW_DAY = Math.floor(NOW / MS_PER_DAY);

function makeRoot() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'usage-stats-'));
  mkdirSync(path.join(dir, 'sessions'), { recursive: true });
  mkdirSync(path.join(dir, '.therapy'), { recursive: true });
  return dir;
}

// Write one session .md file per age-in-days-before-NOW (UTC date filename).
function writeSessions(root, ages) {
  ages.forEach((age, idx) => {
    const dateStr = new Date((NOW_DAY - age) * MS_PER_DAY).toISOString().slice(0, 10);
    // suffix keeps same-day entries from colliding on disk
    writeFileSync(path.join(root, 'sessions', `${dateStr}-${idx}.md`), '# session\n');
  });
}

// Seed usage-log.txt with explicit "ISO<TAB>marker" lines.
function seedLog(root, lines) {
  writeFileSync(path.join(root, '.therapy', 'usage-log.txt'), lines.join('\n') + '\n');
}

// A local-time timestamp at 02:xx on the day `dayOffset` days before NOW.
function lateNight(dayOffset, minute) {
  const d = new Date(NOW - dayOffset * MS_PER_DAY);
  d.setHours(2, minute, 0, 0);
  return d.toISOString();
}

// A local-time timestamp at HH:MM (local) `dayOffset` days before NOW. The
// hook reads local hours for clustering, so only the local hour is load-bearing.
function atLocalHour(dayOffset, hour, minute) {
  const d = new Date(NOW - dayOffset * MS_PER_DAY);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function runHook(root, { sessionId, now = NOW, cwd } = {}) {
  const input = JSON.stringify(sessionId ? { session_id: sessionId } : {});
  const env = { ...process.env, USAGE_STATS_NOW_MS: String(now) };
  if (root) env.CLAUDE_PROJECT_DIR = root;
  else delete env.CLAUDE_PROJECT_DIR;
  return spawnSync('node', [HOOK_PATH], {
    input,
    encoding: 'utf8',
    timeout: 10_000,
    env,
    cwd: cwd || root || os.tmpdir()
  });
}

function parseEnvelope(stdout, label) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    assert.fail(`stdout is not a JSON envelope for: ${label}\n${stdout}`);
  }
  assert.equal(
    parsed.hookSpecificOutput.hookEventName,
    'SessionStart',
    `hookEventName for: ${label}`
  );
  const ctx = parsed.hookSpecificOutput.additionalContext;
  assert.equal(typeof ctx, 'string', `additionalContext is a string for: ${label}`);
  return ctx;
}

function logLineCount(root) {
  let raw = '';
  try {
    raw = readFileSync(path.join(root, '.therapy', 'usage-log.txt'), 'utf8');
  } catch {
    return 0;
  }
  return raw.split('\n').filter(Boolean).length;
}

// --- Scenarios -------------------------------------------------------------

test('spike: recent burst over a low baseline injects facts', () => {
  const root = makeRoot();
  try {
    writeSessions(root, [1, 2, 4, 6, 8, 10, 12, 13]); // 8 in the last 14 days
    writeSessions(root, [20, 30, 40, 50, 60, 70]); // 6 older => 14 total
    const { status, stdout } = runHook(root, { sessionId: 'sess-spike' });
    assert.equal(status, 0);
    const ctx = parseEnvelope(stdout, 'spike');
    assert.ok(ctx.includes('8 sessions in the last 14 days'), 'recent count');
    assert.ok(ctx.includes('prior baseline'), 'baseline present');
    // F8: assert the gap fact string AND its rendered end date. The largest
    // gap within the lookback is 10 days, ending on the age-40 session date.
    assert.ok(
      ctx.includes('largest recent gap 10 days (ending 2026-06-05)'),
      `gap fact + rendered end date, got: ${ctx}`
    );
    assert.ok(ctx.includes('recent cadence is up vs baseline'), 'trend up');
    assert.ok(
      ctx.startsWith('Usage context (mechanical, for your judgment only'),
      'opens with the mechanical framing'
    );
    assert.ok(ctx.includes('.therapy/usage-reflection.md'), 'points at guidance file');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('steady: stable cadence with >=10 sessions injects a neutral trend', () => {
  // Choice for the "decide: inject or stay silent" fork: INJECT. Once the
  // >=10-session gate is met the counts and baseline are deterministic facts
  // worth surfacing; the trend simply reads "steady".
  const root = makeRoot();
  try {
    writeSessions(root, [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35]);
    const { status, stdout } = runHook(root, { sessionId: 'sess-steady' });
    assert.equal(status, 0);
    const ctx = parseEnvelope(stdout, 'steady');
    assert.ok(ctx.includes('in the last 14 days'), 'recent count present');
    assert.ok(ctx.includes('vs baseline'), 'trend present');
    assert.ok(ctx.includes('recent cadence is steady vs baseline'), 'trend is steady');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sparse: fewer than 10 sessions stays silent', () => {
  const root = makeRoot();
  try {
    writeSessions(root, [1, 3, 6, 9, 12]); // 5 < threshold
    const { status, stdout, stderr } = runHook(root, { sessionId: 'sess-sparse' });
    assert.equal(status, 0);
    assert.equal(stdout, '', 'no injection under the silence gate');
    assert.equal(stderr, '', 'no stderr');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('late-night cluster: time-of-day fact appears from prior log timestamps', () => {
  const root = makeRoot();
  try {
    writeSessions(root, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]); // >=10 gate met
    // 7 PRIOR late-night (02:xx local) log lines, none matching the current
    // session id. The hook appends its own (excluded) entry, then clusters the
    // 7 priors. Every entry is hour 02, so the observed reach is 0 hours and the
    // band displays the TIGHT end (F13): 02:00–03:00, not the nominal 02:00–05:00.
    const lines = [];
    for (let i = 7; i >= 1; i--) lines.push(`${lateNight(i, i)}\tnight-${i}`);
    seedLog(root, lines);
    const { status, stdout } = runHook(root, { sessionId: 'night-current' });
    assert.equal(status, 0);
    const ctx = parseEnvelope(stdout, 'late-night cluster');
    assert.ok(
      ctx.includes('7 of the last 7 sessions started 02:00–03:00'),
      `cluster fact present, got: ${ctx}`
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('F1 midnight-wrap cluster: a band spanning 23->0 clusters and wraps', () => {
  const root = makeRoot();
  try {
    writeSessions(root, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]); // gate met
    // 7 prior entries straddling midnight: hours 22, 22, 23, 23, 0, 0, 1.
    // The band starts at 22; the last observed in-band hour is 01, so the tight
    // end (F13) is the hour after that — 02:00 — wrapped across midnight.
    const hoursSeq = [22, 22, 23, 23, 0, 0, 1];
    const lines = hoursSeq.map((h, i) => `${atLocalHour(i + 1, h, 0)}\twrap-${i}`);
    seedLog(root, lines);
    const { status, stdout } = runHook(root, { sessionId: 'wrap-current' });
    assert.equal(status, 0);
    const ctx = parseEnvelope(stdout, 'midnight wrap');
    assert.ok(
      ctx.includes('7 of the last 7 sessions started 22:00–02:00'),
      `wrapped cluster expected, got: ${ctx}`
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('F13 full-width cluster: a band that truly spans 3 hours displays the full width', () => {
  const root = makeRoot();
  try {
    writeSessions(root, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]); // gate met
    // 7 prior entries reaching the full span: hours 1,1,2,2,3,3,4. Band starts
    // at 01; last in-band hour is 04 (offset 3), so the tight end equals the
    // nominal full width — 05:00. This is the regression guard that a tight
    // band-end does not UNDER-report a genuinely wide cluster.
    const hoursSeq = [1, 1, 2, 2, 3, 3, 4];
    const lines = hoursSeq.map((h, i) => `${atLocalHour(i + 1, h, 0)}\twide-${i}`);
    seedLog(root, lines);
    const { status, stdout } = runHook(root, { sessionId: 'wide-current' });
    assert.equal(status, 0);
    const ctx = parseEnvelope(stdout, 'full-width cluster');
    assert.ok(
      ctx.includes('7 of the last 7 sessions started 01:00–05:00'),
      `full-width cluster expected, got: ${ctx}`
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('F2 no self-inflation: the current session entry is excluded from the cluster', () => {
  const root = makeRoot();
  try {
    writeSessions(root, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]); // gate met
    // 7 in-band late-night entries where the LAST is THIS session's marker
    // (a compact re-fire: entry already present). Counting it would give
    // "7 of the last 7"; excluding it leaves only 6 timestamps, below the
    // CLUSTER_MIN_ENTRIES gate => no cluster fires.
    const lines = [];
    for (let i = 7; i >= 2; i--) lines.push(`${lateNight(i, i)}\tprior-${i}`); // 6 prior
    lines.push(`${lateNight(1, 1)}\tthis-session`); // 7th = current session
    seedLog(root, lines);
    const { status, stdout } = runHook(root, { sessionId: 'this-session' });
    assert.equal(status, 0);
    const ctx = parseEnvelope(stdout, 'no self-inflation');
    assert.ok(
      !ctx.includes('of the last 7 sessions started'),
      `current session must not inflate the cluster, got: ${ctx}`
    );
    assert.ok(ctx.includes('in the last 14 days'), 'other facts still inject');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('F3 unique-day counting: same-date files count once (no trend inflation)', () => {
  const root = makeRoot();
  try {
    // Recent window: 7 unique days (ages 1,3,5,7,9,11,13) plus ONE duplicate
    // file on age 1 => 8 files but 7 distinct days. Prior baseline is tuned so
    // 7 recent days read "steady" while 8 files would flip the trend to "up".
    writeSessions(root, [1, 1, 3, 5, 7, 9, 11, 13]); // 8 files, 7 unique recent days
    writeSessions(root, [15, 18, 22, 25, 28]); // 5 prior unique days (baseline ~2.5/wk)
    const { status, stdout } = runHook(root, { sessionId: 'sess-dupdate' });
    assert.equal(status, 0);
    const ctx = parseEnvelope(stdout, 'unique-day counting');
    assert.ok(
      ctx.includes('7 sessions in the last 14 days'),
      `duplicate date must count once, got: ${ctx}`
    );
    assert.ok(
      ctx.includes('recent cadence is steady vs baseline'),
      `trend must not flip to up on a duplicate-date file, got: ${ctx}`
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('F11 lax-date guard: an impossible date (2025-13-45) is not a session day', () => {
  const root = makeRoot();
  try {
    writeSessions(root, [1, 2, 3, 4, 5, 6, 7, 8, 9]); // 9 valid days — one below the gate
    // Date.UTC would roll 2025-13-45 over into a real day; if counted it would
    // push the total to 10 and open the silence gate. It must be rejected.
    writeFileSync(path.join(root, 'sessions', '2025-13-45.md'), '# bad\n');
    const { status, stdout } = runHook(root, { sessionId: 'sess-baddate' });
    assert.equal(status, 0);
    assert.equal(stdout, '', 'phantom day must not push the count over the gate');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('F12 window boundary: a session exactly 14 days old is outside the 14-day window', () => {
  const root = makeRoot();
  try {
    // 9 days inside the window (ages 0..8) + one at exactly age 14. "last 14
    // days" == ages 0..13, so the age-14 session must NOT be in the count.
    writeSessions(root, [0, 1, 2, 3, 4, 5, 6, 7, 8, 14]);
    writeSessions(root, [30, 40, 50]); // older days: baseline + gate headroom
    const { status, stdout } = runHook(root, { sessionId: 'sess-boundary' });
    assert.equal(status, 0);
    const ctx = parseEnvelope(stdout, 'window boundary');
    assert.ok(
      ctx.includes('9 sessions in the last 14 days'),
      `age-14 session must be excluded from the window, got: ${ctx}`
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cluster silence: too few timestamped log entries => no cluster fact', () => {
  const root = makeRoot();
  try {
    writeSessions(root, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // Only 3 log entries — below CLUSTER_MIN_ENTRIES(7): no cluster, but the
    // count/baseline facts still inject.
    seedLog(root, [`${lateNight(1, 1)}\ta`, `${lateNight(2, 2)}\tb`, `${lateNight(3, 3)}\tc`]);
    const { status, stdout } = runHook(root, { sessionId: 'sess-fewlog' });
    assert.equal(status, 0);
    const ctx = parseEnvelope(stdout, 'cluster silence');
    assert.ok(!ctx.includes('of the last 7 sessions started'), 'no cluster fact');
    assert.ok(ctx.includes('in the last 14 days'), 'other facts still present');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('empty: no sessions and no log stays silent, exit 0', () => {
  const root = makeRoot(); // sessions/ exists but empty; no log
  try {
    const { status, stdout } = runHook(root, { sessionId: 'sess-empty' });
    assert.equal(status, 0);
    assert.equal(stdout, '', 'nothing to say => no output');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('compact re-fire: same session marker logs exactly one line, still injects', () => {
  const root = makeRoot();
  try {
    writeSessions(root, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]); // gate met
    seedLog(root, [`${lateNight(9, 0)}\told-1`, `${lateNight(8, 0)}\told-2`]);
    const before = logLineCount(root); // 2

    const first = runHook(root, { sessionId: 'same-session' });
    assert.equal(first.status, 0);
    assert.notEqual(first.stdout, '', 'first run injects');

    const second = runHook(root, { sessionId: 'same-session' });
    assert.equal(second.status, 0);
    assert.notEqual(second.stdout, '', 'second (compact) run still injects');

    const after = logLineCount(root);
    assert.equal(after, before + 1, 'exactly one new log line across both runs');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fail-open: malformed usage-log.txt does not crash; stats still inject', () => {
  const root = makeRoot();
  try {
    writeSessions(root, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // Garbage bytes, no tabs, no parseable timestamps.
    writeFileSync(path.join(root, '.therapy', 'usage-log.txt'), ' not a log{{{\n???\n');
    const { status, stdout } = runHook(root, { sessionId: 'sess-badlog' });
    assert.equal(status, 0, 'exit 0 despite malformed log');
    const ctx = parseEnvelope(stdout, 'malformed log');
    assert.ok(ctx.includes('in the last 14 days'), 'count facts survive a bad log');
    assert.ok(!ctx.includes('of the last 7 sessions started'), 'unparseable log => no cluster');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fail-open: missing sessions folder exits 0 silently', () => {
  // Root resolves (an empty temp dir via cwd) but has no sessions/ dir:
  // fact computation throws internally and is swallowed -> no output.
  const emptyCwd = mkdtempSync(path.join(os.tmpdir(), 'usage-stats-nofolder-'));
  try {
    const { status, stdout } = runHook(null, { sessionId: 'sess-nofolder', cwd: emptyCwd });
    assert.equal(status, 0);
    assert.equal(stdout, '', 'no crash, no output when the folder is missing');
  } finally {
    rmSync(emptyCwd, { recursive: true, force: true });
  }
});

test('fail-open: garbage stdin exits 0 silently', () => {
  const emptyCwd = mkdtempSync(path.join(os.tmpdir(), 'usage-stats-garbage-'));
  try {
    const env = { ...process.env, USAGE_STATS_NOW_MS: String(NOW) };
    delete env.CLAUDE_PROJECT_DIR;
    const { status, stdout } = spawnSync('node', [HOOK_PATH], {
      input: 'this is not json {{{',
      encoding: 'utf8',
      timeout: 10_000,
      env,
      cwd: emptyCwd
    });
    assert.equal(status, 0);
    assert.equal(stdout, '', 'malformed stdin never injects on an empty root');
  } finally {
    rmSync(emptyCwd, { recursive: true, force: true });
  }
});

test('fail-open: empty stdin exits 0 silently', () => {
  const emptyCwd = mkdtempSync(path.join(os.tmpdir(), 'usage-stats-emptyin-'));
  try {
    const env = { ...process.env, USAGE_STATS_NOW_MS: String(NOW) };
    delete env.CLAUDE_PROJECT_DIR;
    const { status, stdout } = spawnSync('node', [HOOK_PATH], {
      input: '',
      encoding: 'utf8',
      timeout: 10_000,
      env,
      cwd: emptyCwd
    });
    assert.equal(status, 0);
    assert.equal(stdout, '');
  } finally {
    rmSync(emptyCwd, { recursive: true, force: true });
  }
});

test('session marker: falls back to per-day dedup when session_id is absent', () => {
  // No session_id in the input -> marker is the UTC date. Two runs on the
  // same reference day must dedupe to a single log line.
  const root = makeRoot();
  try {
    writeSessions(root, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const before = logLineCount(root); // 0
    runHook(root, {}); // no session_id
    runHook(root, {}); // same day => same marker => deduped
    assert.equal(logLineCount(root), before + 1, 'per-day marker dedupes same-day runs');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CJS parse mode: hook runs from a dir with no package.json', () => {
  // Installed copies live under directories Node parses as CommonJS. This is
  // the dual-parse tripwire (mirrors safety-net.test.js): an import/export
  // slipping in keeps the repo (ESM) suite green but kills installed copies.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'usage-stats-cjs-'));
  try {
    const copy = path.join(dir, 'usage-stats.js');
    writeFileSync(copy, readFileSync(HOOK_PATH, 'utf8'));
    const root = makeRoot();
    try {
      writeSessions(root, [1, 2, 4, 6, 8, 10, 12, 13, 20, 30, 40, 50]);
      const env = { ...process.env, USAGE_STATS_NOW_MS: String(NOW), CLAUDE_PROJECT_DIR: root };
      const res = spawnSync('node', [copy], {
        input: JSON.stringify({ session_id: 'sess-cjs' }),
        encoding: 'utf8',
        timeout: 10_000,
        env,
        cwd: root
      });
      assert.equal(res.status, 0, `exit 0 (stderr: ${res.stderr})`);
      const ctx = parseEnvelope(res.stdout, 'CJS parse mode');
      assert.ok(ctx.includes('in the last 14 days'), 'facts inject under CJS parse');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('version marker: hook carries a parseable version comment', () => {
  const src = readFileSync(HOOK_PATH, 'utf8');
  const m = src.match(/<!--\s*version:\s*([^\s>-]+)\s*-->/);
  assert.ok(m, 'version marker present');
  assert.equal(m[1], '1.0.0');
});
