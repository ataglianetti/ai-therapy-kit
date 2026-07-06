// Zero-API fire-check for the crisis-eval suite.
//
// Given a client message, run the REAL `hooks/safety-net.js` hook as a child
// process and report whether it fired (emitted the crisis notice). This is the
// free, deterministic half of the eval: the hook is a pure pattern matcher, so
// the same input always yields the same fire/silent result, and no `claude -p`
// / API call is involved.
//
// Spawn contract is reused verbatim from `cli/__tests__/safety-net.test.js`
// (`runHook`/`runPrompt`):
//   spawnSync('node', [HOOK_PATH], {
//     input: JSON.stringify({ prompt: message }),
//     encoding: 'utf8', timeout: 10000
//   })
// Fired  = non-empty stdout that is a JSON envelope whose
//          hookSpecificOutput.hookEventName === 'UserPromptSubmit' and whose
//          additionalContext is a string. `notice` is that additionalContext.
// Silent = empty stdout (exit 0). Returns { fired: false, notice: null }.
//
// Fail-open: this function NEVER throws. Any spawn error, timeout, or
// unparseable-but-nonempty stdout is reported as a structured non-fire with an
// `error` field, so one bad case cannot abort a batch run.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// evals/lib/fire-check.js -> <repo>/hooks/safety-net.js
const HOOK_PATH = path.resolve(__dirname, '..', '..', 'hooks', 'safety-net.js');

// Keep the hook's stdin self-timeout short so a batch run stays fast; the hook
// documents SAFETY_NET_STDIN_TIMEOUT_MS as its test override.
const STDIN_TIMEOUT_MS = '2000';
// Outer spawn ceiling (matches the Plan-1 test contract).
const SPAWN_TIMEOUT_MS = 10_000;

// Run the hook for one message. Always returns a plain result object; never
// throws. `nodeBin` is an internal seam (defaults to the running Node binary,
// `process.execPath`, so the hook runs even when `node` is not on PATH) — a
// test can force a spawn failure by pointing at a bogus executable; production
// callers pass one argument.
export function fires(message, nodeBin = process.execPath) {
  if (typeof message !== 'string') {
    return { fired: false, notice: null, error: 'message is not a string' };
  }

  let result;
  try {
    result = spawnSync(nodeBin, [HOOK_PATH], {
      input: JSON.stringify({ prompt: message }),
      encoding: 'utf8',
      timeout: SPAWN_TIMEOUT_MS,
      env: { ...process.env, SAFETY_NET_STDIN_TIMEOUT_MS: STDIN_TIMEOUT_MS }
    });
  } catch (err) {
    return { fired: false, notice: null, error: String(err && err.message ? err.message : err) };
  }

  // spawnSync surfaces spawn failures / timeouts via `error` (or a null status)
  // rather than throwing. Treat any of those as a structured non-fire.
  if (result.error) {
    return { fired: false, notice: null, error: String(result.error.message || result.error) };
  }
  if (result.status !== 0) {
    return {
      fired: false,
      notice: null,
      error: `hook exited with status ${result.status}`
    };
  }

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';

  // Silent: the hook writes nothing on a no-match.
  if (stdout.trim() === '') {
    return { fired: false, notice: null };
  }

  // Non-empty stdout: must be the JSON envelope. Anything else is a structured
  // non-fire (fail-open — never throw).
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { fired: false, notice: null, error: 'stdout is not a JSON envelope' };
  }

  const hso = parsed && parsed.hookSpecificOutput;
  const isEnvelope =
    hso &&
    hso.hookEventName === 'UserPromptSubmit' &&
    typeof hso.additionalContext === 'string';

  if (!isEnvelope) {
    return { fired: false, notice: null, error: 'unexpected hook output shape' };
  }

  return { fired: true, notice: hso.additionalContext };
}

// Convenience: run the hook for many messages, returning an array of results in
// the same order. Stdlib-only, sequential (the hook is cheap and deterministic).
export function firesMany(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages.map((m) => fires(m));
}

export { HOOK_PATH };
