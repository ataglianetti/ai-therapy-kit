// Invokes the therapist subject via the `claude` CLI (`claude -p <message>`)
// for the crisis eval suite. Stdlib only, cross-platform (Mac + Windows).
//
// Two design pillars:
//
//  1. Cross-platform spawn. On win32 `claude` is a `.cmd`/`.exe` shim that
//     spawnSync cannot resolve without a shell, so we spawn through the shell
//     there (`shell: true`) and directly everywhere else. Command and args stay
//     fixed literals — no injection surface. This mirrors
//     `cli/__tests__/doctor-claude-version.test.js` / doctor.js
//     `claudeVersionSpawnPlan`.
//
//  2. A mock seam. When `mock` is truthy (or env EVAL_MOCK=1) we never spawn:
//     we return a canned deterministic response. This lets the whole harness be
//     exercised in CI with zero API tokens and no `claude` binary present. The
//     spawn plan (command/args/cwd) is always returned so tests can assert what
//     *would* have been run without running it.

import { spawnSync } from 'node:child_process';

// A default canned reply for mock mode. Crisis-safe: names the US 988 line and
// a text line, so a crisis-suite assertion that "resources are present" passes
// against the default mock. Tests that need a control (no-resource) reply pass
// their own string as `mock`.
export const DEFAULT_MOCK_RESPONSE =
  "I'm really glad you reached out, and I want you to be safe. " +
  'If you are thinking about harming yourself, please reach out right ' +
  'now: call or text 988 (the Suicide & Crisis Lifeline in the US), or ' +
  'text HOME to 741741 to reach the Crisis Text Line. ' +
  'You can also find help at findahelpline.com. ' +
  "You don't have to go through this alone.";

// A stable session id handed back in mock mode so multi-turn resume flows can be
// threaded deterministically in tests.
export const MOCK_SESSION_ID = 'mock-session-0000';

/**
 * Build the spawn plan for a subject invocation. Pure — no side effects — so
 * tests can assert the exact command/args/cwd without spawning.
 *
 * We always request structured output (`--output-format json`) so we can parse
 * BOTH the assistant response text AND the session id from a single object.
 * The session id is what threads multi-turn cases: without it, turn 2 would
 * spawn a fresh, context-less session and the crisis signal that accumulates
 * across turns would be lost.
 *
 * Fresh turn:   claude -p <message> --output-format json
 * Resume turn:  claude --resume <sessionId> -p <message> --output-format json
 *
 * @param {object} opts
 * @param {string} opts.message           prompt to send
 * @param {string} [opts.cwd]             working directory for the subject
 * @param {string} [opts.resumeSessionId] resume an existing session (multi-turn)
 * @param {string} [platform=process.platform]
 * @returns {{command:string,args:string[],cwd:string|undefined,shell:boolean}}
 */
export function subjectSpawnPlan(
  { message, cwd, resumeSessionId } = {},
  platform = process.platform
) {
  const args = [];
  if (resumeSessionId) {
    args.push('--resume', resumeSessionId);
  }
  args.push('-p', message, '--output-format', 'json');
  return {
    command: 'claude',
    args,
    cwd,
    // win32: `claude` is a .cmd shim spawnSync can't resolve without a shell.
    shell: platform === 'win32',
  };
}

/**
 * Parse a `claude -p --output-format json` result payload.
 *
 * `claude` 2.1.x emits a single JSON object of shape:
 *   { type:"result", subtype:"success", is_error:false,
 *     result:"<assistant text>", session_id:"<uuid>", ... }
 * We read `result` (assistant text) and `session_id` (thread key). A payload
 * that doesn't parse, is flagged `is_error`, or is missing `session_id` yields
 * a null result — the caller fails closed rather than grading a decapitated
 * multi-turn case.
 *
 * Tolerance: real `claude` output can carry a stray non-JSON preamble or
 * trailer line (auto-update notice, deprecation warning). A strict
 * whole-buffer parse would fail-close the entire live suite on one such line.
 * So we first try the trimmed buffer, then fall back to locating the LAST
 * balanced top-level `{...}` object in the stream and parsing that. This only
 * makes locating the JSON robust — every fail-closed condition below
 * (unparseable, `is_error:true`, missing `session_id`) is preserved exactly.
 *
 * @param {string} raw stdout from the CLI
 * @returns {{response:string, sessionId:string}|null}
 */
export function parseSubjectResult(raw) {
  const obj = extractResultObject(raw);
  if (!obj || typeof obj !== 'object' || obj.is_error === true) {
    return null;
  }
  const sessionId = typeof obj.session_id === 'string' ? obj.session_id : '';
  const response = typeof obj.result === 'string' ? obj.result : '';
  if (!sessionId) {
    return null;
  }
  return { response, sessionId };
}

/**
 * Locate and parse the result JSON object out of raw stdout, tolerant of a
 * leading/trailing non-JSON line. Returns the parsed object, or null if none
 * is found. Stdlib only, no regex, no deps.
 *
 * Strategy:
 *   1. Try `JSON.parse` on the trimmed whole buffer (the clean common case).
 *   2. On failure, scan from the end for the last balanced top-level `{...}`
 *      run (brace-depth counting, quote/escape aware) and parse that.
 */
function extractResultObject(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to the balanced-brace scan
  }
  const end = trimmed.lastIndexOf('}');
  if (end === -1) {
    return null;
  }
  // Walk backwards from the last '}', tracking brace depth while ignoring
  // braces inside JSON strings, until depth returns to zero at the matching
  // top-level '{'.
  let depth = 0;
  let inString = false;
  for (let i = end; i >= 0; i--) {
    const ch = trimmed[i];
    if (inString) {
      // A quote closes the string only if it isn't escaped. Count preceding
      // backslashes: an even count means the quote is unescaped.
      if (ch === '"') {
        let backslashes = 0;
        for (let j = i - 1; j >= 0 && trimmed[j] === '\\'; j--) {
          backslashes++;
        }
        if (backslashes % 2 === 0) {
          inString = false;
        }
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '}') {
      depth++;
    } else if (ch === '{') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(i, end + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Invoke the therapist subject.
 *
 * @param {object} opts
 * @param {string} [opts.cwd]              working directory (the therapy folder)
 * @param {string} opts.message            prompt to send the subject
 * @param {string} [opts.resumeSessionId]  resume an existing session (multi-turn)
 * @param {boolean|string} [opts.mock]     mock seam: true => default canned
 *                                          reply; string => that exact reply.
 *                                          Falls back to env EVAL_MOCK=1.
 * @returns {{response:string, sessionId:string|null, raw:string,
 *            plan:object, mock:boolean, error?:{code:string,message:string}}}
 */
export function runSubject({ cwd, message, resumeSessionId, mock } = {}) {
  const plan = subjectSpawnPlan({ message, cwd, resumeSessionId });

  const useMock = mock === true || typeof mock === 'string' || process.env.EVAL_MOCK === '1';

  if (useMock) {
    const response = typeof mock === 'string' ? mock : DEFAULT_MOCK_RESPONSE;
    return {
      response,
      // A resume request threads its own id back; a fresh mock turn mints one.
      sessionId: resumeSessionId || MOCK_SESSION_ID,
      raw: response,
      plan,
      mock: true,
    };
  }

  let result;
  try {
    result = spawnSync(plan.command, plan.args, {
      cwd: plan.cwd,
      encoding: 'utf8',
      shell: plan.shell,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err) {
    return spawnError(plan, err.code || 'ESPAWN', err.message);
  }

  // spawnSync surfaces ENOENT (binary absent) on result.error rather than
  // throwing — handle it as a structured error, never an uncaught throw.
  if (result.error) {
    return spawnError(plan, result.error.code || 'ESPAWN', result.error.message);
  }

  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    return spawnError(
      plan,
      'ENONZERO',
      `claude exited with status ${result.status}${stderr ? `: ${stderr}` : ''}`
    );
  }

  const raw = result.stdout || '';
  const parsed = parseSubjectResult(raw);

  // Fail closed: if we can't recover a session id from the structured output
  // (older CLI, unexpected shape, parse failure), we must NOT hand back a
  // context-less turn. A multi-turn case would then thread nothing and be
  // graded on a decapitated turn-2. Surface a structured error instead so the
  // case is skipped/failed with a clear message rather than silently mis-scored.
  if (!parsed) {
    return spawnError(
      plan,
      'ENOSESSION',
      'could not parse a session id from `claude -p --output-format json` ' +
        'output — refusing to grade a multi-turn case on an unthreaded turn ' +
        `(raw prefix: ${JSON.stringify(raw.slice(0, 200))})`
    );
  }

  return {
    response: parsed.response.trim(),
    sessionId: parsed.sessionId,
    raw,
    plan,
    mock: false,
  };
}

function spawnError(plan, code, message) {
  return {
    response: '',
    sessionId: null,
    raw: '',
    plan,
    mock: false,
    error: { code, message },
  };
}
