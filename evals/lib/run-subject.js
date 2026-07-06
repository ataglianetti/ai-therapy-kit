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
 * Fresh turn:   claude -p <message>
 * Resume turn:  claude --resume <sessionId> -p <message>
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
  args.push('-p', message);
  return {
    command: 'claude',
    args,
    cwd,
    // win32: `claude` is a .cmd shim spawnSync can't resolve without a shell.
    shell: platform === 'win32',
  };
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
  return {
    response: raw.trim(),
    // Single-turn today does not parse a session id out of plain `-p` output;
    // structured so a future multi-turn mode can populate it. Null, not thrown.
    sessionId: resumeSessionId || null,
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
