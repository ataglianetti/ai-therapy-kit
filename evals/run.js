// Thin CLI entrypoint for the crisis eval suite. Orchestration only — every bit
// of real logic lives in evals/lib/*. This file resolves cases, preps one temp
// fixture per run, plays each case (single- or multi-turn) through the subject,
// grades mechanically, optionally runs the (stubbed-by-default) judge, and
// prints a per-case summary. Zero deps, node stdlib only, cross-platform.
//
// Exit codes:
//   0  — the run completed. A failing CASE is data, not a harness error.
//   2  — harness/usage error (bad flags, unreadable cases, prep failure).

import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseFile } from './lib/parse-cases.js';
import { prepFixture } from './lib/prep-fixture.js';
import { runSubject } from './lib/run-subject.js';
import { checkMechanical } from './lib/mechanical.js';
import { judge, loadRubric, stubCallModel } from './lib/judge.js';

const USAGE = `Usage: node evals/run.js --cases <glob-or-comma-list> [options]

Options:
  --cases <spec>     (required) comma-separated globs/paths, e.g.
                     'evals/cases/*.yaml' or 'a.yaml,b.yaml'
  --arm <fresh|degraded>   context arm (default: fresh)
  --hook <on|off>          safety-net hook state (default: on)
  --n <int>                runs per case (default: 1)
  --mock                   mock the subject (no real API/binary)
  --judge <on|off>         run the LLM judge (default: off)
  --judge-mock             allow the offline all-pass judge stub (labeled STUB)
`;

// A usage/harness error that should exit 2 with a clear message.
class UsageError extends Error {}

// --- glob expansion (stdlib only, cross-platform) --------------------------
// We expand simple globs ourselves rather than leaning on the shell (Windows
// cmd doesn't glob) or an unstable fs.glob API. Supported: `*` and `?` in the
// final path segment only, which covers 'evals/cases/*.yaml'. A spec with no
// glob chars is treated as a literal path.
function hasGlobChars(seg) {
  return seg.includes('*') || seg.includes('?');
}

function segmentToRegExp(seg) {
  // Escape regex metachars, then turn glob * / ? into their regex equivalents.
  const escaped = seg.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const pattern = '^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
  return new RegExp(pattern);
}

function expandOne(spec) {
  const dir = path.dirname(spec);
  const base = path.basename(spec);
  if (!hasGlobChars(base)) {
    // Literal path — must exist.
    if (!fs.existsSync(spec)) {
      throw new UsageError(`No such case file: ${spec}`);
    }
    return [spec];
  }
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    throw new UsageError(`Cannot list directory "${dir}" for "${spec}": ${err.message}`);
  }
  const re = segmentToRegExp(base);
  const matched = entries
    .filter((name) => re.test(name))
    .map((name) => path.join(dir, name))
    .sort();
  return matched;
}

function resolveCasePaths(spec) {
  const specs = spec.split(',').map((s) => s.trim()).filter(Boolean);
  if (specs.length === 0) {
    throw new UsageError('--cases resolved to an empty spec');
  }
  const seen = new Set();
  const paths = [];
  for (const one of specs) {
    for (const p of expandOne(one)) {
      if (!seen.has(p)) {
        seen.add(p);
        paths.push(p);
      }
    }
  }
  if (paths.length === 0) {
    throw new UsageError(`--cases matched no files: ${spec}`);
  }
  return paths;
}

// --- arg parsing -----------------------------------------------------------
function parseFlags(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        cases: { type: 'string' },
        arm: { type: 'string', default: 'fresh' },
        hook: { type: 'string', default: 'on' },
        n: { type: 'string', default: '1' },
        mock: { type: 'boolean', default: false },
        judge: { type: 'string', default: 'off' },
        'judge-mock': { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      allowPositionals: false,
    });
  } catch (err) {
    throw new UsageError(err.message);
  }
  const v = parsed.values;

  if (v.help) return { help: true };

  if (!v.cases) throw new UsageError('--cases is required');
  if (v.arm !== 'fresh' && v.arm !== 'degraded') {
    throw new UsageError(`--arm must be "fresh" or "degraded" (got "${v.arm}")`);
  }
  if (v.hook !== 'on' && v.hook !== 'off') {
    throw new UsageError(`--hook must be "on" or "off" (got "${v.hook}")`);
  }
  if (v.judge !== 'on' && v.judge !== 'off') {
    throw new UsageError(`--judge must be "on" or "off" (got "${v.judge}")`);
  }
  const n = Number(v.n);
  if (!Number.isInteger(n) || n < 1) {
    throw new UsageError(`--n must be a positive integer (got "${v.n}")`);
  }

  return {
    help: false,
    cases: v.cases,
    arm: v.arm,
    hook: v.hook,
    n,
    mock: v.mock,
    judge: v.judge === 'on',
    judgeMock: v['judge-mock'],
  };
}

// --- one case, one repetition ----------------------------------------------
// Plays a case's messages in sequence, threading sessionId for multi-turn.
// For the degraded arm, PREPEND the preamble to the FIRST message only.
// Returns the final subject result (last turn's response + any error).
function playCase(caseObj, { cwd, degradedPreamble, mock }) {
  const messages = Array.isArray(caseObj.messages) ? caseObj.messages : [];
  let resumeSessionId;
  let last = { response: '', sessionId: null };
  for (let t = 0; t < messages.length; t++) {
    let message = messages[t];
    if (t === 0 && degradedPreamble) {
      message = `${degradedPreamble}\n\n${message}`;
    }
    const res = runSubject({ cwd, message, resumeSessionId, mock });
    if (res.error) {
      // A subject-level error on any turn ends this repetition; surface it so
      // the case is scored against an empty response (mechanical will fail).
      return { response: res.response || '', sessionId: res.sessionId, error: res.error };
    }
    resumeSessionId = res.sessionId || resumeSessionId;
    last = res;
  }
  return { response: last.response || '', sessionId: last.sessionId };
}

// --- judge wiring ----------------------------------------------------------
// Contract: the default judge callModel is an all-pass stub. We MUST NOT let a
// stubbed run masquerade as a real judgment. This harness wires no real model,
// so `--judge on` is only permitted alongside `--judge-mock`, and its output is
// clearly labeled STUB. Mechanical results are always real.
function buildJudgeConfig(flags) {
  if (!flags.judge) return { enabled: false };
  return {
    enabled: true,
    stub: true, // no real callModel is wired in this thin entrypoint
    callModel: stubCallModel,
  };
}

// --- main ------------------------------------------------------------------
function run(argv, out = process.stdout, err = process.stderr) {
  const flags = parseFlags(argv);
  if (flags.help) {
    out.write(USAGE);
    return 0;
  }

  const casePaths = resolveCasePaths(flags.cases);

  // Parse every case up front so an unreadable/invalid case is a harness error
  // before we prep any fixture.
  const cases = casePaths.map((p) => {
    try {
      return parseFile(p);
    } catch (e) {
      throw new UsageError(e.message);
    }
  });

  const judgeCfg = buildJudgeConfig(flags);
  if (judgeCfg.enabled && judgeCfg.stub && !flags.judgeMock) {
    throw new UsageError(
      '--judge on wires no real model in this harness (the default judge stub ' +
        'returns all-pass). Re-run with --judge-mock to use the offline stub; ' +
        'its verdicts are placeholders, not real judgments.'
    );
  }

  // Cache rubric text per category so we don't re-read for every case/rep.
  const rubricCache = new Map();
  function rubricFor(category) {
    if (!rubricCache.has(category)) {
      let text = '';
      try {
        text = loadRubric(category);
      } catch {
        text = ''; // rubric absent => judge runs without extra context
      }
      rubricCache.set(category, text);
    }
    return rubricCache.get(category);
  }

  // Prep exactly one temp fixture for this run (arm + hook) INSIDE the try so a
  // throw after prep (or during prep, after the temp dir exists) still cleans
  // up. fixture stays undefined until prep returns, so the finally guards on it.
  const rows = [];
  let fixture;
  try {
    try {
      fixture = prepFixture({ hook: flags.hook, arm: flags.arm });
    } catch (e) {
      throw new UsageError(`fixture prep failed: ${e.message}`);
    }

    for (const caseObj of cases) {
      let mechPass = 0;
      let judgePass = 0;
      const failureSamples = new Set();
      let subjectError;

      for (let rep = 0; rep < flags.n; rep++) {
        const played = playCase(caseObj, {
          cwd: fixture.cwd,
          degradedPreamble: fixture.degradedPreamble,
          mock: flags.mock,
        });
        if (played.error && !subjectError) subjectError = played.error;

        const mech = checkMechanical(caseObj, played.response);
        if (mech.pass) mechPass++;
        for (const f of mech.failures) failureSamples.add(f);

        if (judgeCfg.enabled) {
          const rubricText = rubricFor(caseObj.category);
          const j = judge({
            caseObj,
            responseText: played.response,
            rubricText,
            callModel: judgeCfg.callModel,
          });
          if (j.pass) judgePass++;
        }
      }

      rows.push({
        id: caseObj.id,
        category: caseObj.category,
        mechPass,
        judgePass,
        failures: [...failureSamples],
        subjectError,
      });
    }
  } finally {
    if (fixture) fixture.cleanup();
  }

  printSummary(out, { flags, judgeCfg, rows });
  return 0;
}

function printSummary(out, { flags, judgeCfg, rows }) {
  const N = flags.n;
  out.write('\nCrisis Eval — run summary\n');
  out.write(
    `  arm=${flags.arm}  hook=${flags.hook}  n=${N}  ` +
      `subject=${flags.mock ? 'MOCK' : 'live'}  ` +
      `judge=${judgeCfg.enabled ? (judgeCfg.stub ? 'STUB (not a real judgment)' : 'live') : 'off'}\n\n`
  );

  let allMechPass = 0;
  for (const r of rows) {
    const mechRate = `${r.mechPass}/${N}`;
    const mechOK = r.mechPass === N;
    if (mechOK) allMechPass++;
    let line = `  [${mechOK ? 'PASS' : 'FAIL'}] ${r.id} (cat ${r.category})  mech=${mechRate}`;
    if (judgeCfg.enabled) {
      line += `  judge=${r.judgePass}/${N} [STUB]`;
    }
    out.write(line + '\n');
    if (r.subjectError) {
      out.write(`         subject error: ${r.subjectError.code} — ${r.subjectError.message}\n`);
    }
    for (const f of r.failures) {
      out.write(`         - ${f}\n`);
    }
  }

  out.write(
    `\n  TOTALS: ${allMechPass}/${rows.length} cases mechanically clean` +
      (judgeCfg.enabled ? '  (judge column is STUB — placeholder, not a real judgment)' : '') +
      '\n'
  );
}

// Entry point (ESM-safe main check).
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    const code = run(process.argv.slice(2));
    process.exit(code);
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`error: ${e.message}\n\n`);
      process.stderr.write(USAGE);
      process.exit(2);
    }
    // Unexpected: surface as a harness error, still exit non-zero.
    process.stderr.write(`fatal: ${e && e.stack ? e.stack : e}\n`);
    process.exit(2);
  }
}

export { run, resolveCasePaths, parseFlags };
