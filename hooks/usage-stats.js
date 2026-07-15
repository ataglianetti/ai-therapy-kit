#!/usr/bin/env node
// <!-- version: 1.0.0 -->
//
// usage-stats.js — SessionStart hook: mechanical usage-cadence context.
//
// This hook does two INDEPENDENT things on every SessionStart:
//   1. Appends one line to `<root>/.therapy/usage-log.txt` recording that a
//      session started (ISO-timestamp<TAB>session-marker), deduped by marker
//      so a `compact` re-fire of the same session does not double-log.
//   2. Computes deterministic usage facts (counts, gaps, time-of-day
//      clusters, trend vs. the client's own baseline) from the session
//      filenames plus the log timestamps, and injects them as
//      `additionalContext` for the therapist's JUDGMENT ONLY.
//
// FACTS ONLY. This hook never diagnoses, moralizes, labels a pattern
// "concerning", or emits advice. It reports numbers and points the model at
// `.therapy/usage-reflection.md` for how to hold them. The prose guidance,
// not this hook, decides what (if anything) to do with the context.
//
// Parse-mode note: this file is copied into installs where no package.json
// declares a module type, so it may be parsed as CommonJS there and as ESM
// inside this repo ("type": "module"). It therefore uses ONLY globals —
// no import/export/require — and is valid under both parse modes.
//
// Fail-open contract: on ANY error (malformed JSON, empty stdin, missing or
// non-string fields, unreadable install root, closed stdout, stdin that
// never ends, a sync throw during stdio setup), exit 0 with no output. The
// log-append and the fact-injection run in SEPARATE try/catch blocks: a
// failure in one must never prevent the other, and neither may crash the
// session. Oversized stdin is bounded (first ~4MB retained), not fatal.
//
// Zero runtime deps: stdlib only (fs, path, process). Cross-platform — no
// shell, no exec-bit reliance.

'use strict';

// import/require are forbidden by the dual-parse contract (the file must be
// valid as BOTH ESM and CJS). `process.getBuiltinModule` (Node >=20.16 /
// >=22.3) returns a core module WITHOUT import or require, so it is the one
// globals-only way to reach fs/path under both parse modes. A `typeof` guard
// on the CJS `require` fallback keeps ESM from throwing a ReferenceError on
// older runtimes; any throw here is still caught by the fail-open wrapper.
function coreModule(name) {
  if (
    typeof process !== 'undefined' &&
    typeof process.getBuiltinModule === 'function'
  ) {
    return process.getBuiltinModule(name);
  }
  if (typeof require === 'function') return require(name);
  throw new Error('no module loader available');
}

var FS = coreModule('fs');
var PATH = coreModule('path');

// --- Tunables --------------------------------------------------------------
var WINDOW_DAYS = 14; // trailing window for the recent session count
var MIN_TOTAL_SESSIONS = 10; // silence gate: < this many sessions => no output
var MIN_GAP_DAYS = 3; // only report a gap this large or larger
var GAP_LOOKBACK_DAYS = 56; // "recent" gap search horizon (~8 weeks)
var CLUSTER_MIN_ENTRIES = 7; // need at least this many timestamped log lines
var CLUSTER_SPAN_HOURS = 3; // band width: 01:00–04:00 spans hours 1..3
var CLUSTER_MIN_IN_BAND = 5; // e.g. 5 of the last 7
var MS_PER_DAY = 24 * 60 * 60 * 1000;

// Test override for the self-timeout (kept fast in the suite).
var TIMEOUT_MS = 5000;
var envTimeout = Number(process.env.USAGE_STATS_STDIN_TIMEOUT_MS);
if (envTimeout > 0) {
  TIMEOUT_MS = envTimeout;
}

// Test override for "now" so fixtures are deterministic (no midnight-boundary
// flake). Defaults to the real clock. Mirrors safety-net's timeout override.
function nowMs() {
  var override = Number(process.env.USAGE_STATS_NOW_MS);
  if (override > 0) return override;
  return Date.now();
}

// Bound stdin exactly like safety-net: retain the first ~4MB, treat the rest
// as absent. A SessionStart payload is tiny; this only guards pathologies.
var MAX_STDIN_CHARS = 4 * 1024 * 1024;

// --- Root resolution -------------------------------------------------------
// Resolve the install root at runtime: CLAUDE_PROJECT_DIR, then the input
// JSON's cwd, then process.cwd(). Return the first that is an existing,
// readable directory; else null (=> fail open, silent).
function resolveRoot(payload) {
  var candidates = [
    process.env.CLAUDE_PROJECT_DIR,
    payload && typeof payload.cwd === 'string' ? payload.cwd : null,
    process.cwd()
  ];
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    if (!c) continue;
    try {
      if (FS.statSync(c).isDirectory()) return c;
    } catch (err) {
      // not readable / does not exist — try the next candidate
    }
  }
  return null;
}

// --- Session marker --------------------------------------------------------
// Prefer the SessionStart input's `session_id` (stable within a single
// session across a compact re-fire). If absent, fall back to a per-DAY marker
// (the UTC date), so two starts on the same day still dedupe to one log line
// even without an id. The fallback is deliberately coarse: a missing id most
// likely means an older/edge harness, and per-day dedup is the safe default
// (it under-logs rather than double-logs).
function sessionMarker(payload, refMs) {
  if (payload && typeof payload.session_id === 'string' && payload.session_id) {
    return payload.session_id;
  }
  return isoDate(refMs); // YYYY-MM-DD
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// --- Log append (behavior #1) ----------------------------------------------
// Append "ISO<TAB>marker" to .therapy/usage-log.txt, creating the dir/file if
// missing. Dedup: skip if the last line's marker equals this marker. Fully
// self-contained try/catch by the caller — never throws out.
function appendLog(root, marker, refMs) {
  var therapyDir = PATH.join(root, '.therapy');
  var logPath = PATH.join(therapyDir, 'usage-log.txt');

  var existing = '';
  try {
    existing = FS.readFileSync(logPath, 'utf8');
  } catch (err) {
    existing = '';
  }

  // Dedup against the last non-empty line's marker (field after the tab).
  var lines = existing.split('\n');
  var lastMarker = null;
  for (var i = lines.length - 1; i >= 0; i--) {
    var ln = lines[i];
    if (!ln) continue;
    var tab = ln.indexOf('\t');
    lastMarker = tab === -1 ? null : ln.slice(tab + 1);
    break;
  }
  if (lastMarker !== null && lastMarker === marker) {
    return; // compact re-fire (or same-day fallback) — do not append
  }

  try {
    FS.mkdirSync(therapyDir, { recursive: true });
  } catch (err) {
    // dir may already exist or be uncreatable; the write below will decide
  }
  var line = new Date(refMs).toISOString() + '\t' + marker + '\n';
  FS.appendFileSync(logPath, line);
}

// --- Fact computation (behavior #2) ----------------------------------------
// Parse leading YYYY-MM-DD from every *.md filename in <root>/sessions.
function readSessionDays(root) {
  var dir = PATH.join(root, 'sessions');
  var files = FS.readdirSync(dir); // throws if missing => caller fails open
  var days = [];
  for (var i = 0; i < files.length; i++) {
    var name = files[i];
    if (!/\.md$/i.test(name)) continue;
    var m = name.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) continue;
    var dayMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (isNaN(dayMs)) continue;
    days.push(Math.floor(dayMs / MS_PER_DAY));
  }
  return days;
}

// Parse ISO timestamps (first tab-delimited field) from the log.
function readLogTimestamps(root) {
  var logPath = PATH.join(root, '.therapy', 'usage-log.txt');
  var raw;
  try {
    raw = FS.readFileSync(logPath, 'utf8');
  } catch (err) {
    return [];
  }
  var out = [];
  var lines = raw.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i];
    if (!ln) continue;
    var tab = ln.indexOf('\t');
    var stamp = tab === -1 ? ln : ln.slice(0, tab);
    var t = Date.parse(stamp);
    if (!isNaN(t)) out.push(t);
  }
  return out;
}

function uniqueSorted(nums) {
  var seen = {};
  var out = [];
  for (var i = 0; i < nums.length; i++) {
    if (!seen[nums[i]]) {
      seen[nums[i]] = true;
      out.push(nums[i]);
    }
  }
  out.sort(function (a, b) {
    return a - b;
  });
  return out;
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

// Find the tightest CLUSTER_SPAN_HOURS band holding the most of the last
// CLUSTER_MIN_ENTRIES timestamps. Returns a fact string or null.
function timeOfDayCluster(timestamps) {
  if (timestamps.length < CLUSTER_MIN_ENTRIES) return null;
  var recent = timestamps.slice(-CLUSTER_MIN_ENTRIES);
  var hours = [];
  for (var i = 0; i < recent.length; i++) {
    hours.push(new Date(recent[i]).getHours());
  }
  var best = { count: 0, lo: 0, hi: 0 };
  for (var a = 0; a < hours.length; a++) {
    var lo = hours[a];
    var count = 0;
    var maxHour = lo;
    for (var b = 0; b < hours.length; b++) {
      if (hours[b] >= lo && hours[b] <= lo + CLUSTER_SPAN_HOURS) {
        count++;
        if (hours[b] > maxHour) maxHour = hours[b];
      }
    }
    if (count > best.count) best = { count: count, lo: lo, hi: maxHour };
  }
  if (best.count < CLUSTER_MIN_IN_BAND) return null;
  var bandStart = pad2(best.lo) + ':00';
  var bandEnd = pad2(best.hi + 1) + ':00';
  return (
    best.count +
    ' of the last ' +
    CLUSTER_MIN_ENTRIES +
    ' sessions started ' +
    bandStart +
    '–' +
    bandEnd
  );
}

// Largest gap (days) between consecutive session days within the lookback
// horizon. Returns { gap, endDay } or null when nothing >= MIN_GAP_DAYS.
function largestRecentGap(days, nowDay) {
  var recent = [];
  for (var i = 0; i < days.length; i++) {
    if (nowDay - days[i] <= GAP_LOOKBACK_DAYS && nowDay - days[i] >= 0) {
      recent.push(days[i]);
    }
  }
  recent = uniqueSorted(recent);
  var best = null;
  for (var j = 1; j < recent.length; j++) {
    var gap = recent[j] - recent[j - 1];
    if (gap >= MIN_GAP_DAYS && (best === null || gap > best.gap)) {
      best = { gap: gap, endDay: recent[j] };
    }
  }
  return best;
}

// Build the fact list. Returns [] when there is nothing meaningful to say
// (which, combined with the < MIN_TOTAL_SESSIONS gate, keeps the hook silent).
function computeFacts(root, refMs) {
  var days = readSessionDays(root); // may throw => caller fails open
  var totalSessions = days.length;
  if (totalSessions < MIN_TOTAL_SESSIONS) return []; // silence gate

  var nowDay = Math.floor(refMs / MS_PER_DAY);
  var windowStart = nowDay - WINDOW_DAYS;

  var recentCount = 0;
  var priorDays = [];
  for (var i = 0; i < days.length; i++) {
    var age = nowDay - days[i];
    if (age >= 0 && age <= WINDOW_DAYS) {
      recentCount++;
    } else if (days[i] < windowStart) {
      priorDays.push(days[i]);
    }
  }

  var facts = [];
  facts.push(
    recentCount +
      ' session' +
      (recentCount === 1 ? '' : 's') +
      ' in the last ' +
      WINDOW_DAYS +
      ' days'
  );

  var recentPerWeek = recentCount / (WINDOW_DAYS / 7);
  var baselinePerWeek = null;
  if (priorDays.length > 0) {
    var uPrior = uniqueSorted(priorDays);
    var earliest = uPrior[0];
    var spanDays = Math.max(windowStart - earliest, 1);
    baselinePerWeek = (uPrior.length / spanDays) * 7;
    facts.push('prior baseline ~' + baselinePerWeek.toFixed(1) + '/week');
  }

  var gap = largestRecentGap(days, nowDay);
  if (gap) {
    facts.push(
      'largest recent gap ' +
        gap.gap +
        ' days (ending ' +
        isoDate(gap.endDay * MS_PER_DAY) +
        ')'
    );
  }

  var cluster = timeOfDayCluster(readLogTimestamps(root));
  if (cluster) facts.push(cluster);

  // Trend vs the client's OWN baseline (mechanical ratio, no value judgment).
  if (baselinePerWeek !== null) {
    var trend;
    if (baselinePerWeek === 0) {
      trend = recentCount > 0 ? 'up' : 'steady';
    } else {
      var ratio = recentPerWeek / baselinePerWeek;
      if (ratio >= 1.5) trend = 'up';
      else if (ratio <= 0.67) trend = 'down';
      else trend = 'steady';
    }
    facts.push('recent cadence is ' + trend + ' vs baseline');
  }

  return facts;
}

// --- Output ----------------------------------------------------------------
function emit(facts) {
  var context =
    'Usage context (mechanical, for your judgment only — see ' +
    '.therapy/usage-reflection.md on how to hold this): ' +
    facts.join('; ') +
    '.';
  var out =
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: context
      }
    }) + '\n';
  // Same flush guard as safety-net: keep a live timer until the write
  // callback fires, so a never-draining stdout can't hang the process.
  var flushTimer = setTimeout(function () {
    process.exit(0);
  }, TIMEOUT_MS);
  try {
    process.stdout.write(out, function () {
      clearTimeout(flushTimer);
    });
  } catch (err) {
    clearTimeout(flushTimer);
  }
}

function main(input) {
  var payload;
  try {
    payload = JSON.parse(input);
  } catch (err) {
    payload = {}; // malformed JSON: still allow root=cwd + day-marker logging
  }
  if (payload === null || typeof payload !== 'object') payload = {};

  var refMs = nowMs();
  var root = resolveRoot(payload);
  if (!root) return; // no readable install folder => fail open, silent

  // (1) Log append — isolated so a failure here never blocks injection.
  try {
    appendLog(root, sessionMarker(payload, refMs), refMs);
  } catch (err) {
    // fail open
  }

  // (2) Fact injection — isolated so a failure here never blocks logging.
  try {
    var facts = computeFacts(root, refMs);
    if (facts.length > 0) emit(facts);
  } catch (err) {
    // fail open (e.g. missing sessions/ dir)
  }
}

// --- Runtime wiring (mirrors safety-net's fail-open stdio setup) ------------
try {
  process.stdout.on('error', function () {});

  var stdinTimer = setTimeout(function () {
    process.exit(0);
  }, TIMEOUT_MS);
  if (stdinTimer.unref) stdinTimer.unref();

  var chunks = [];
  var received = 0;
  var overflowed = false;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (chunk) {
    if (overflowed) return;
    received += chunk.length;
    if (received > MAX_STDIN_CHARS) {
      overflowed = true;
      chunks.push(chunk.slice(0, chunk.length - (received - MAX_STDIN_CHARS)));
      return;
    }
    chunks.push(chunk);
  });
  process.stdin.on('end', function () {
    clearTimeout(stdinTimer);
    try {
      main(chunks.join(''));
    } catch (err) {
      // Fail-open: swallow and fall through to a natural exit 0.
    }
    // No process.exit(): a pending stdout write must be allowed to flush.
  });
  process.stdin.on('error', function () {
    process.exit(0);
  });
} catch (err) {
  process.exit(0);
}
