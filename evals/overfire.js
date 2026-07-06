// Over-fire metric + regression gate data source (zero-API, stdlib only).
//
// Runs every case that carries `expect.fires` through the LIVE fire-check
// (`evals/lib/fire-check.js`, which spawns the real hooks/safety-net.js) and
// reports fire-rate per boundary class plus the aggregate venting-flow number.
// This is the free half of the eval: the hook is a deterministic pattern
// matcher, so no `claude -p` / API call is involved.
//
// Case metadata:
//   - `expect.fires` (yes/no) is the SNAPSHOT: the recorded live behavior of
//     the hook at the time the case was authored. Divergence from it is a gate
//     failure (re-snapshot deliberately, in a PM-ruled commit).
//   - `# intent: <slug>` as the FIRST line of the case file is the RULING:
//       silent-expected   — boundary case that must stay silent (any fire is
//                           an over-fire beyond the accepted set)
//       accepted-overfire — fires today; the cost is accepted and recorded
//       must-fire         — explicit first-person crisis; silence = hard fail
//       known-silence-F65 — quarantined first-person false-silence awaiting a
//                           non-regex fix (PM ruling required to promote)
//   - Class = the id segment after the numeric prefix:
//       06-family-mom-thoughts -> family; 05-venting-job -> venting.
//
// Exit semantics (CLI):
//   non-zero if (a) any must-fire case is silent, (b) any case's live
//   result diverges from its `expect.fires` snapshot, or (c) the fire-check
//   reported an error for any gated case (spawn failure, timeout, bad hook
//   output) — an errored result is unusable evidence, so it fails the gate
//   even when it happens to agree with the snapshot. Accepted over-fires
//   firing is the recorded state, not an error. Exit 0 otherwise.
//
// Usage:
//   node evals/overfire.js          # human-readable table
//   node evals/overfire.js --json   # machine-readable (used by the test gate)

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseFile } from './lib/parse-cases.js';
import { fires } from './lib/fire-check.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CASES_DIR = path.join(__dirname, 'cases');

const VALID_INTENTS = [
  'silent-expected',
  'accepted-overfire',
  'must-fire',
  'known-silence-F65',
];

// Read the `# intent: <slug>` full-line comment from line 1 of the raw file.
// The YAML-subset parser drops comments, so this is a plain text read.
function readIntent(filePath) {
  const firstLine = readFileSync(filePath, 'utf8').split(/\r?\n/, 1)[0];
  const m = firstLine.match(/^# intent:\s*(\S+)/);
  return m ? m[1] : null;
}

// Class = the id segment after the numeric prefix:
// `06-mustfire-want-to-die` -> `mustfire`; `05-venting-job` -> `venting`.
function classOf(id) {
  const parts = id.split('-');
  return parts.length > 1 ? parts[1] : id;
}

/**
 * Load every case under `casesDir` that carries an `expect.fires` snapshot.
 * Cases without `expect.fires` (the legacy 01/02/05-control corpus) are not
 * part of the over-fire gate and are skipped.
 * @returns {Array<{id: string, class: string, intent: string, snapshot: boolean, message: string, file: string}>}
 */
export function loadGatedCases(casesDir = CASES_DIR) {
  const files = readdirSync(casesDir)
    .filter((f) => f.endsWith('.yaml'))
    .sort();
  const out = [];
  for (const f of files) {
    const filePath = path.join(casesDir, f);
    const parsed = parseFile(filePath);
    if (parsed.expect.fires === undefined) continue;
    const intent = readIntent(filePath);
    if (intent === null) {
      throw new Error(
        `${filePath}: has expect.fires but no "# intent: <slug>" first line`,
      );
    }
    if (!VALID_INTENTS.includes(intent)) {
      throw new Error(
        `${filePath}: unknown intent "${intent}" (allowed: ${VALID_INTENTS.join(', ')})`,
      );
    }
    // Gated cases are single-message by contract: the gate runs exactly one
    // message through the hook, so a multi-message gated case would silently
    // drop turns. Loader error (exit 2), same path as a missing intent.
    if (parsed.messages.length > 1) {
      throw new Error(
        `${filePath}: gated case has ${parsed.messages.length} messages — cases with expect.fires must be single-message (the gate runs only messages[0])`,
      );
    }
    out.push({
      id: parsed.id,
      class: classOf(parsed.id),
      intent,
      snapshot: parsed.expect.fires,
      message: parsed.messages[0],
      file: f,
    });
  }
  return out;
}

/**
 * Run each gated case's first message through the live fire-check.
 * Returns the same objects with a `live` result attached.
 */
export function runLive(cases) {
  return cases.map((c) => ({ ...c, live: fires(c.message) }));
}

/**
 * Pure gate/metric computation over live results. No I/O — unit-testable
 * against stubbed results (this is how the regression test proves the gate
 * hard-fails on a simulated must-fire silence without editing the hook).
 * @param {Array<{id, class, intent, snapshot, message, live: {fired: boolean, error?: string}}>} results
 */
export function computeReport(results) {
  const byClass = new Map();
  for (const r of results) {
    if (!byClass.has(r.class)) {
      byClass.set(r.class, { class: r.class, cases: 0, fired: 0, diverged: 0 });
    }
    const row = byClass.get(r.class);
    row.cases++;
    if (r.live.fired) row.fired++;
    if (r.live.fired !== r.snapshot) row.diverged++;
  }
  const classes = [...byClass.values()]
    .sort((a, b) => a.class.localeCompare(b.class))
    .map((row) => ({ ...row, fireRate: row.cases ? row.fired / row.cases : 0 }));

  const of_ = (pred) => results.filter(pred);

  const venting = of_((r) => r.class === 'venting');
  const ventingFired = venting.filter((r) => r.live.fired).length;
  const ventingFlow = {
    fired: ventingFired,
    total: venting.length,
    rate: venting.length ? ventingFired / venting.length : 0,
    display: `${ventingFired}/${venting.length} = ${pct(ventingFired, venting.length)}`,
  };

  const silentExp = of_((r) => r.intent === 'silent-expected');
  const silentExpected = {
    total: silentExp.length,
    fired: silentExp.filter((r) => r.live.fired).length,
    firingIds: silentExp.filter((r) => r.live.fired).map((r) => r.id),
  };

  const accepted = of_((r) => r.intent === 'accepted-overfire');
  const acceptedOverfire = {
    total: accepted.length,
    stillFiring: accepted.filter((r) => r.live.fired).length,
    silentIds: accepted.filter((r) => !r.live.fired).map((r) => r.id),
  };

  const must = of_((r) => r.intent === 'must-fire');
  const mustFire = {
    total: must.length,
    fired: must.filter((r) => r.live.fired).length,
    silentIds: must.filter((r) => !r.live.fired).map((r) => r.id),
  };

  // Quarantined first-person false-silences: flagged, not failed. If a future
  // matcher fix makes one fire, it shows up as a snapshot divergence (and the
  // regression test promotes it to must-fire, visibly and deliberately).
  const knownSilences = of_((r) => r.intent === 'known-silence-F65').map(
    (r) => ({ id: r.id, fired: r.live.fired }),
  );

  // An errored case is reported ONLY as a FIRE-CHECK ERROR (round-2 F22):
  // its defaulted fired=false is not evidence, so counting it as a snapshot
  // divergence too would double-report one cause. The error path already
  // fails the gate on its own.
  const divergences = of_(
    (r) => r.live.error === undefined && r.live.fired !== r.snapshot,
  ).map((r) => ({
    id: r.id,
    intent: r.intent,
    expected: r.snapshot,
    actual: r.live.fired,
  }));

  // Fire-check errors (spawn failure, timeout, malformed hook output) make the
  // live result unusable evidence — a FAILURE regardless of snapshot agreement,
  // so an errored "silent" can never quietly pass as a real silence.
  const errors = of_((r) => r.live.error !== undefined).map((r) => ({
    id: r.id,
    error: r.live.error,
  }));

  const failures = [];
  for (const id of mustFire.silentIds) {
    failures.push(`MUST-FIRE SILENT: ${id} — first-person crisis phrase did not fire`);
  }
  for (const d of divergences) {
    failures.push(
      `SNAPSHOT DIVERGENCE: ${d.id} — expect.fires=${d.expected ? 'yes' : 'no'}, live=${d.actual ? 'fired' : 'silent'}${d.error ? ` (error: ${d.error})` : ''}`,
    );
  }
  for (const e of errors) {
    failures.push(
      `FIRE-CHECK ERROR: ${e.id} — ${e.error} (live result is unusable; fails regardless of snapshot agreement)`,
    );
  }

  return {
    totalGatedCases: results.length,
    classes,
    ventingFlow,
    silentExpected,
    acceptedOverfire,
    mustFire,
    knownSilences,
    divergences,
    errors,
    failures,
    exitCode:
      mustFire.silentIds.length > 0 || divergences.length > 0 || errors.length > 0
        ? 1
        : 0,
    cases: results.map((r) => ({
      id: r.id,
      class: r.class,
      intent: r.intent,
      snapshot: r.snapshot,
      fired: r.live.fired,
      ...(r.live.error ? { error: r.live.error } : {}),
    })),
  };
}

function pct(fired, total) {
  if (total === 0) return 'n/a';
  return `${((100 * fired) / total).toFixed(1)}%`;
}

function pad(s, w) {
  s = String(s);
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}

function padL(s, w) {
  s = String(s);
  return s.length >= w ? s : ' '.repeat(w - s.length) + s;
}

function printHuman(report) {
  const out = [];
  out.push(
    `Over-fire metric — live hooks/safety-net.js vs snapshots (${report.totalGatedCases} gated cases)`,
  );
  out.push('');
  out.push(
    `${pad('class', 12)}${padL('cases', 7)}${padL('fired', 7)}${padL('fire-rate', 11)}${padL('diverged', 10)}`,
  );
  for (const row of report.classes) {
    out.push(
      `${pad(row.class, 12)}${padL(row.cases, 7)}${padL(row.fired, 7)}${padL(pct(row.fired, row.cases), 11)}${padL(row.diverged, 10)}`,
    );
  }
  out.push('');
  out.push(`Venting-flow: ${report.ventingFlow.display} fired (the accepted venting cost, as a number)`);
  out.push(
    `Boundary over-fire (silent-expected): ${report.silentExpected.fired}/${report.silentExpected.total} fired` +
      (report.silentExpected.fired === 0
        ? ' — no over-fires beyond the accepted set'
        : ` — OVER-FIRES: ${report.silentExpected.firingIds.join(', ')}`),
  );
  out.push(
    `Accepted over-fires still firing: ${report.acceptedOverfire.stillFiring}/${report.acceptedOverfire.total}` +
      (report.acceptedOverfire.silentIds.length
        ? ` — went silent: ${report.acceptedOverfire.silentIds.join(', ')}`
        : ''),
  );
  const f65 = report.knownSilences
    .map((k) => `${k.id} ${k.fired ? 'NOW FIRES (promote to must-fire)' : 'still silent (quarantined)'}`)
    .join('; ');
  out.push(
    `First-person integrity: must-fire ${report.mustFire.fired}/${report.mustFire.total} fired` +
      (report.mustFire.silentIds.length
        ? ` — SILENT: ${report.mustFire.silentIds.join(', ')}`
        : '') +
      `; known-silence-F65: ${report.knownSilences.length ? f65 : 'none'}`,
  );
  out.push(`Snapshot divergences: ${report.divergences.length}`);
  out.push(`Fire-check errors: ${report.errors.length}`);
  if (report.failures.length) {
    out.push('');
    for (const f of report.failures) out.push(`FAIL ${f}`);
  }
  out.push('');
  out.push(report.exitCode === 0 ? 'PASS (exit 0)' : `FAIL (exit ${report.exitCode})`);
  process.stdout.write(out.join('\n') + '\n');
}

function main(argv) {
  let json = false;
  for (const arg of argv) {
    if (arg === '--json') json = true;
    else {
      process.stderr.write(`unknown argument: ${arg}\nusage: node evals/overfire.js [--json]\n`);
      process.exitCode = 2;
      return;
    }
  }
  let report;
  try {
    report = computeReport(runLive(loadGatedCases()));
  } catch (err) {
    process.stderr.write(`overfire: ${err.message}\n`);
    process.exitCode = 2;
    return;
  }
  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    printHuman(report);
  }
  // Set exitCode rather than calling process.exit() so stdout/stderr writes
  // flush before the process ends (exit() can truncate piped output).
  process.exitCode = report.exitCode;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main(process.argv.slice(2));
}
