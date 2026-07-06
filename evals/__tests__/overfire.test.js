// Regression gate for the over-fire metric (evals/overfire.js).
//
// Four teeth:
//   1. Must-fire guard — every `# intent: must-fire` case LIVE-fires, asserted
//      per case so a matcher change silencing any explicit first-person crisis
//      phrase names the exact phrase in the failure.
//   2. Snapshot lock — every case with `expect.fires` matches its snapshot.
//      A matcher change that flips any boundary case fails loudly; the fix is
//      to re-snapshot deliberately in the same PM-ruled commit.
//   3. F65 quarantine — the known-silence-F65 case is currently silent AND
//      flagged under the metric's `knownSilences` JSON key. If a future fix
//      makes it fire, this fails and the case gets promoted to must-fire
//      (visible, deliberate).
//   4. Metric CLI — `--json` parses, carries the per-class table and the
//      ventingFlow number, and exits 0 on the current corpus.
//
// Cost control: the 48 hook spawns run ONCE at module load and the results are
// shared across all asserts (per the task contract). The CLI test adds one
// child process (which does its own spawns) — still zero-API, all local.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadGatedCases, runLive, computeReport } from '../overfire.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OVERFIRE_PATH = path.resolve(__dirname, '..', 'overfire.js');

// Run the live fire-check once for the whole file; share across asserts.
const results = runLive(loadGatedCases());
const report = computeReport(results);

// --- 1. Must-fire guard (the tooth): per-case named asserts ----------------

const mustFireCases = results.filter((r) => r.intent === 'must-fire');

test('must-fire corpus is non-empty', () => {
  assert.ok(mustFireCases.length > 0, 'no must-fire cases found — corpus broken');
});

for (const c of mustFireCases) {
  test(`must-fire LIVE-fires: ${c.id}`, () => {
    assert.equal(
      c.live.fired,
      true,
      `explicit first-person crisis phrase went SILENT: "${c.message}" (${c.id})${c.live.error ? ` [fire-check error: ${c.live.error}]` : ''}`,
    );
  });
}

// --- 2. Snapshot lock: live result === expect.fires for every gated case ---

for (const c of results) {
  test(`snapshot lock: ${c.id} (expect.fires=${c.snapshot ? 'yes' : 'no'})`, () => {
    assert.equal(
      c.live.fired,
      c.snapshot,
      `live result diverged from snapshot for ${c.id}: expected ${c.snapshot ? 'fired' : 'silent'}, got ${c.live.fired ? 'fired' : 'silent'} — re-snapshot deliberately in a PM-ruled commit${c.live.error ? ` [fire-check error: ${c.live.error}]` : ''}`,
    );
  });
}

test('snapshot lock covers the full gated corpus (48 cases)', () => {
  // 47 -> 48: T-006 added 06-idiom-die-shame (round-1 review F1 evidence case).
  assert.equal(results.length, 48, 'gated-case count changed — update this lock deliberately');
});

// --- 3. F65 quarantine ------------------------------------------------------

const F65_ID = '06-f65-elided-determiner';

test('F65 quarantine: known-silence case is currently silent', () => {
  const c = results.find((r) => r.id === F65_ID);
  assert.ok(c, `${F65_ID} missing from gated corpus`);
  assert.equal(c.intent, 'known-silence-F65');
  assert.equal(
    c.live.fired,
    false,
    `${F65_ID} now FIRES — promote it to must-fire (intent + expect.fires: yes), do not silently drop the quarantine`,
  );
});

test('F65 quarantine: metric flags it under knownSilences', () => {
  assert.ok(Array.isArray(report.knownSilences), 'report.knownSilences must be an array');
  const entry = report.knownSilences.find((k) => k.id === F65_ID);
  assert.ok(entry, `metric does not list ${F65_ID} under knownSilences`);
  assert.equal(entry.fired, false);
});

// --- 4. Metric CLI: --json parses, has the table + ventingFlow, exits 0 ----

test('CLI --json: valid JSON, per-class table, ventingFlow, exit 0', () => {
  const r = spawnSync('node', [OVERFIRE_PATH, '--json'], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  assert.equal(r.status, 0, `overfire.js exited ${r.status}; stderr: ${r.stderr}`);
  const j = JSON.parse(r.stdout); // throws (fails the test) if not valid JSON
  assert.ok(Array.isArray(j.classes) && j.classes.length > 0, 'missing per-class table');
  for (const row of j.classes) {
    assert.equal(typeof row.class, 'string');
    assert.equal(typeof row.cases, 'number');
    assert.equal(typeof row.fired, 'number');
    assert.equal(typeof row.fireRate, 'number');
    assert.equal(typeof row.diverged, 'number');
  }
  assert.equal(typeof j.ventingFlow.rate, 'number');
  assert.equal(typeof j.ventingFlow.fired, 'number');
  assert.equal(typeof j.ventingFlow.total, 'number');
  assert.ok(j.ventingFlow.total > 0, 'venting class is empty');
  assert.ok(
    j.knownSilences.some((k) => k.id === F65_ID),
    'JSON output missing the F65 quarantine flag',
  );
});

// --- Gate logic unit test: prove the tooth against a stubbed silence -------
// A must-fire case that comes back silent MUST produce a non-zero exit and a
// named failure. Stubbed input — no hook edit, no live state involved.

test('gate hard-fails on a simulated must-fire silence (stubbed)', () => {
  const stub = [
    {
      id: 'stub-mustfire-silent',
      class: 'mustfire',
      intent: 'must-fire',
      snapshot: true,
      message: 'stub crisis phrase',
      live: { fired: false, notice: null },
    },
  ];
  const rep = computeReport(stub);
  assert.notEqual(rep.exitCode, 0, 'gate must exit non-zero on a silent must-fire');
  assert.ok(rep.mustFire.silentIds.includes('stub-mustfire-silent'));
  assert.ok(
    rep.failures.some((f) => f.includes('MUST-FIRE SILENT') && f.includes('stub-mustfire-silent')),
    'failure line must name the silent must-fire case',
  );
});

test('gate hard-fails on a simulated snapshot divergence (stubbed)', () => {
  const stub = [
    {
      id: 'stub-boundary-flip',
      class: 'venting',
      intent: 'silent-expected',
      snapshot: false,
      message: 'stub venting phrase',
      live: { fired: true, notice: 'notice' },
    },
  ];
  const rep = computeReport(stub);
  assert.notEqual(rep.exitCode, 0, 'gate must exit non-zero on a snapshot divergence');
  assert.equal(rep.divergences.length, 1);
  assert.equal(rep.divergences[0].id, 'stub-boundary-flip');
});

test('gate passes when accepted over-fires fire (recorded state, not error)', () => {
  const stub = [
    {
      id: 'stub-accepted',
      class: 'venting',
      intent: 'accepted-overfire',
      snapshot: true,
      message: 'stub',
      live: { fired: true, notice: 'notice' },
    },
  ];
  const rep = computeReport(stub);
  assert.equal(rep.exitCode, 0);
  assert.equal(rep.acceptedOverfire.stillFiring, 1);
});

// --- Venting-flow arithmetic (F5) -------------------------------------------

test('venting-flow arithmetic: 2 venting cases, 1 fired -> rate 0.5, display "1/2" (stubbed)', () => {
  const stub = [
    {
      id: 'stub-venting-fired',
      class: 'venting',
      intent: 'accepted-overfire',
      snapshot: true,
      message: 'stub fired',
      live: { fired: true, notice: 'notice' },
    },
    {
      id: 'stub-venting-silent',
      class: 'venting',
      intent: 'silent-expected',
      snapshot: false,
      message: 'stub silent',
      live: { fired: false, notice: null },
    },
  ];
  const rep = computeReport(stub);
  assert.equal(rep.ventingFlow.fired, 1);
  assert.equal(rep.ventingFlow.total, 2);
  assert.equal(rep.ventingFlow.rate, 0.5);
  assert.equal(rep.ventingFlow.display, '1/2 = 50.0%');
  assert.equal(rep.exitCode, 0, 'both cases match their snapshots — no failure');
});

// Live-corpus pin: the venting class is 12 cases, 4 of which fire today.
// Update these numbers DELIBERATELY when the corpus changes (new venting case
// or a PM-ruled matcher change) — never to make a red run green.
test('venting-flow live pin: 4/12 fired on the current corpus', () => {
  assert.equal(report.ventingFlow.total, 12, 'venting case count changed — update this pin deliberately');
  assert.equal(report.ventingFlow.fired, 4, 'venting fire count changed — update this pin deliberately');
});

// --- Fire-check error visibility (F7) ---------------------------------------
// An errored live result is unusable evidence: it must fail the gate even when
// the (defaulted-to-silent) result happens to agree with the snapshot.

test('gate hard-fails on a fire-check error even when snapshot agrees (stubbed)', () => {
  const stub = [
    {
      id: 'stub-errored-case',
      class: 'venting',
      intent: 'silent-expected',
      snapshot: false,
      message: 'stub',
      live: { fired: false, notice: null, error: 'spawn ENOENT' },
    },
  ];
  const rep = computeReport(stub);
  assert.notEqual(rep.exitCode, 0, 'gate must exit non-zero on a fire-check error');
  assert.equal(rep.divergences.length, 0, 'no divergence here — the error alone must fail the gate');
  assert.equal(rep.errors.length, 1);
  assert.equal(rep.errors[0].id, 'stub-errored-case');
  assert.ok(
    rep.failures.some((f) => f.includes('FIRE-CHECK ERROR') && f.includes('stub-errored-case')),
    'failure line must name the errored case',
  );
});

test('live corpus has zero fire-check errors', () => {
  assert.deepEqual(report.errors, []);
});

// --- Multi-message gated cases are a loader error (F8) ----------------------

test('loader throws on a gated case with more than one message', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'overfire-multi-'));
  try {
    writeFileSync(
      path.join(dir, '99-venting-multi.yaml'),
      [
        '# intent: silent-expected',
        'id: 99-venting-multi',
        'category: 6',
        'messages:',
        '  - "first turn"',
        '  - "second turn"',
        'expect:',
        '  rubric_gates:',
        '    - stays_supportive',
        '  fires: no',
        '',
      ].join('\n'),
    );
    assert.throws(
      () => loadGatedCases(dir),
      /must be single-message/,
      'a gated case with 2 messages must be a loader error, not a silent turn drop',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
