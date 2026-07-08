// Tests for the subject runner (evals/lib/run-subject.js). The whole suite runs
// in mock mode — no API tokens, no real `claude` binary required. The spawn
// plan is asserted directly (pure function), and the failed-spawn branch is
// exercised by forcing `claude` to be unresolvable (empty PATH) so spawnSync
// reports ENOENT on result.error — no real binary needed either way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  runSubject,
  subjectSpawnPlan,
  parseSubjectResult,
  DEFAULT_MOCK_RESPONSE,
  MOCK_SESSION_ID,
} from '../lib/run-subject.js';

// ---------------------------------------------------------------------------
// Spawn plan (pure)
// ---------------------------------------------------------------------------

test('fresh-turn plan: claude -p <message> --output-format json with cwd', () => {
  const plan = subjectSpawnPlan(
    { message: 'hello there', cwd: '/some/therapy/dir' },
    'darwin'
  );
  assert.equal(plan.command, 'claude');
  assert.deepEqual(plan.args, ['-p', 'hello there', '--output-format', 'json']);
  assert.equal(plan.cwd, '/some/therapy/dir');
  assert.equal(plan.shell, false);
});

test('resume-turn plan: --resume <id> before -p, structured output', () => {
  const plan = subjectSpawnPlan(
    { message: 'still here', cwd: '/dir', resumeSessionId: 'sess-42' },
    'darwin'
  );
  assert.deepEqual(plan.args, [
    '--resume',
    'sess-42',
    '-p',
    'still here',
    '--output-format',
    'json',
  ]);
});

test('win32 plan: shell enabled (claude is a .cmd shim); fixed command', () => {
  const plan = subjectSpawnPlan({ message: 'hi', cwd: '/d' }, 'win32');
  assert.equal(plan.command, 'claude');
  assert.equal(plan.shell, true);
  assert.deepEqual(plan.args, ['-p', 'hi', '--output-format', 'json']);
});

test('unix plans: no shell', () => {
  for (const platform of ['darwin', 'linux']) {
    const plan = subjectSpawnPlan({ message: 'hi' }, platform);
    assert.equal(plan.shell, false, `${platform} shell off`);
  }
});

test('plan defaults to the current platform', () => {
  assert.equal(
    subjectSpawnPlan({ message: 'x' }).shell,
    subjectSpawnPlan({ message: 'x' }, process.platform).shell
  );
});

// ---------------------------------------------------------------------------
// Mock seam — no spawn
// ---------------------------------------------------------------------------

test('mock:true returns the default crisis-safe canned reply without spawning', () => {
  const r = runSubject({ cwd: '/d', message: 'I feel hopeless', mock: true });
  assert.equal(r.mock, true);
  assert.equal(r.response, DEFAULT_MOCK_RESPONSE);
  assert.equal(r.raw, DEFAULT_MOCK_RESPONSE);
  assert.equal(r.sessionId, MOCK_SESSION_ID);
  assert.ok(!r.error, 'no error in mock mode');
});

test('default mock reply carries crisis resources (988 + text line)', () => {
  const r = runSubject({ message: 'help', mock: true });
  assert.ok(/988/.test(r.response), 'names 988');
  assert.ok(/741741/.test(r.response), 'names the crisis text line');
});

test('mock as a string injects that exact response (control / no-resource case)', () => {
  const control = 'Tell me more about your week.';
  const r = runSubject({ message: 'hi', mock: control });
  assert.equal(r.response, control);
  assert.ok(!/988/.test(r.response), 'control reply has no crisis resource');
  assert.equal(r.mock, true);
});

test('mock exposes the exact spawn plan that would have run (fresh turn)', () => {
  const r = runSubject({ cwd: '/therapy', message: 'hi', mock: true });
  assert.equal(r.plan.command, 'claude');
  assert.deepEqual(r.plan.args, ['-p', 'hi', '--output-format', 'json']);
  assert.equal(r.plan.cwd, '/therapy');
});

test('mock resume turn: plan includes --resume and echoes the session id', () => {
  const r = runSubject({
    cwd: '/therapy',
    message: 'still here',
    resumeSessionId: 'sess-7',
    mock: true,
  });
  assert.deepEqual(r.plan.args, [
    '--resume',
    'sess-7',
    '-p',
    'still here',
    '--output-format',
    'json',
  ]);
  assert.equal(r.sessionId, 'sess-7');
});

test('EVAL_MOCK=1 env activates the mock seam without an explicit mock flag', () => {
  const prev = process.env.EVAL_MOCK;
  process.env.EVAL_MOCK = '1';
  try {
    const r = runSubject({ message: 'hi' });
    assert.equal(r.mock, true);
    assert.equal(r.response, DEFAULT_MOCK_RESPONSE);
  } finally {
    if (prev === undefined) delete process.env.EVAL_MOCK;
    else process.env.EVAL_MOCK = prev;
  }
});

// ---------------------------------------------------------------------------
// Failed-spawn path — structured error, never an uncaught throw
// ---------------------------------------------------------------------------

test('claude absent (ENOENT): structured error, no throw', () => {
  // Force `claude` to be unresolvable by blanking PATH for this call, so
  // spawnSync reports ENOENT on result.error. Not mock mode — this exercises
  // the real spawn + error branch without needing a real binary.
  const prevPath = process.env.PATH;
  const prevMock = process.env.EVAL_MOCK;
  delete process.env.EVAL_MOCK;
  process.env.PATH = '';
  let r;
  try {
    // Must not throw — the failed spawn is returned as data.
    assert.doesNotThrow(() => {
      r = runSubject({ cwd: process.cwd(), message: 'hi' });
    });
  } finally {
    process.env.PATH = prevPath;
    if (prevMock !== undefined) process.env.EVAL_MOCK = prevMock;
  }
  assert.ok(r.error, 'error object present');
  assert.equal(r.response, '');
  assert.equal(r.sessionId, null);
  assert.ok(
    r.error.code === 'ENOENT' || r.error.code === 'ESPAWN' || r.error.code === 'ENONZERO',
    `structured error code, got ${r.error.code}`
  );
});

// ---------------------------------------------------------------------------
// Structured-output parsing — extract response + session id (no spawn)
// ---------------------------------------------------------------------------

// A trimmed sample of the real `claude -p --output-format json` payload observed
// against claude 2.1.x: a single object with `result` (assistant text) and
// `session_id`. Extra fields are ignored.
const SAMPLE_RESULT_JSON = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'I hear you. Tell me more about what that felt like.',
  session_id: '75b13ac7-ca1c-4f6f-8acc-b5809c6f3178',
  num_turns: 1,
  total_cost_usd: 0.032,
});

test('parseSubjectResult: extracts response text and session id from real shape', () => {
  const parsed = parseSubjectResult(SAMPLE_RESULT_JSON);
  assert.ok(parsed, 'parsed non-null');
  assert.equal(parsed.response, 'I hear you. Tell me more about what that felt like.');
  assert.equal(parsed.sessionId, '75b13ac7-ca1c-4f6f-8acc-b5809c6f3178');
});

test('parseSubjectResult: null on unparseable output (fail closed)', () => {
  assert.equal(parseSubjectResult('not json at all'), null);
  assert.equal(parseSubjectResult(''), null);
});

test('parseSubjectResult: null when session_id is missing', () => {
  const noSid = JSON.stringify({ result: 'hi', is_error: false });
  assert.equal(parseSubjectResult(noSid), null);
});

test('parseSubjectResult: null when is_error is true', () => {
  const errored = JSON.stringify({
    result: 'partial',
    session_id: 'abc',
    is_error: true,
  });
  assert.equal(parseSubjectResult(errored), null);
});

// ---------------------------------------------------------------------------
// Preamble / trailer tolerance — a stray banner line must not fail-close the
// whole live suite; we still locate and parse the JSON result object.
// ---------------------------------------------------------------------------

test('parseSubjectResult: tolerates a leading banner line before the JSON', () => {
  const raw = 'npm notice New version of claude available!\n' + SAMPLE_RESULT_JSON;
  const parsed = parseSubjectResult(raw);
  assert.ok(parsed, 'parsed non-null despite preamble');
  assert.equal(parsed.response, 'I hear you. Tell me more about what that felt like.');
  assert.equal(parsed.sessionId, '75b13ac7-ca1c-4f6f-8acc-b5809c6f3178');
});

test('parseSubjectResult: tolerates a trailing warning line after the JSON', () => {
  const raw = SAMPLE_RESULT_JSON + '\n[deprecation] --foo will be removed in 3.0\n';
  const parsed = parseSubjectResult(raw);
  assert.ok(parsed, 'parsed non-null despite trailer');
  assert.equal(parsed.response, 'I hear you. Tell me more about what that felt like.');
  assert.equal(parsed.sessionId, '75b13ac7-ca1c-4f6f-8acc-b5809c6f3178');
});

test('parseSubjectResult: tolerates both a preamble and a trailer', () => {
  const raw =
    'auto-update: fetching...\n' +
    SAMPLE_RESULT_JSON +
    '\nwarning: something benign\n';
  const parsed = parseSubjectResult(raw);
  assert.ok(parsed, 'parsed non-null despite preamble + trailer');
  assert.equal(parsed.sessionId, '75b13ac7-ca1c-4f6f-8acc-b5809c6f3178');
});

test('parseSubjectResult: brace inside a preamble line does not derail the scan', () => {
  // A preamble that itself contains braces (e.g. a log line) must not be
  // mistaken for the result object — we take the LAST balanced top-level {...}.
  const raw = 'ctx { partial: true } loading\n' + SAMPLE_RESULT_JSON;
  const parsed = parseSubjectResult(raw);
  assert.ok(parsed, 'parsed non-null');
  assert.equal(parsed.sessionId, '75b13ac7-ca1c-4f6f-8acc-b5809c6f3178');
});

test('parseSubjectResult: tolerance still fails closed with a preamble but no session_id', () => {
  const noSid = JSON.stringify({ result: 'hi', is_error: false });
  assert.equal(parseSubjectResult('update notice\n' + noSid), null);
});

test('parseSubjectResult: tolerance still fails closed with a preamble but is_error:true', () => {
  const errored = JSON.stringify({ result: 'x', session_id: 'abc', is_error: true });
  assert.equal(parseSubjectResult('update notice\n' + errored), null);
});

test('parseSubjectResult: genuinely unparseable output with braces still returns null', () => {
  assert.equal(parseSubjectResult('banner\n{ this is not json }\nfooter'), null);
});

// ---------------------------------------------------------------------------
// Mock 2-turn threading — turn 2 resumes turn 1's session id (no spawn)
// ---------------------------------------------------------------------------

test('mock 2-turn: turn 1 mints a session id, turn 2 threads it via --resume', () => {
  // Turn 1: fresh mock turn mints the deterministic mock session id.
  const t1 = runSubject({ cwd: '/therapy', message: 'first', mock: 'ack one' });
  assert.equal(t1.sessionId, MOCK_SESSION_ID);
  assert.deepEqual(t1.plan.args, ['-p', 'first', '--output-format', 'json']);

  // Turn 2: caller threads t1.sessionId; plan carries --resume and echoes it.
  const t2 = runSubject({
    cwd: '/therapy',
    message: 'second',
    resumeSessionId: t1.sessionId,
    mock: 'ack two',
  });
  assert.equal(t2.sessionId, MOCK_SESSION_ID, 'session id threads across turns');
  assert.deepEqual(t2.plan.args, [
    '--resume',
    MOCK_SESSION_ID,
    '-p',
    'second',
    '--output-format',
    'json',
  ]);
});

// ---------------------------------------------------------------------------
// Fail-closed live branch — no session id => structured error, never graded
// ---------------------------------------------------------------------------

test('live run whose output has no session id fails closed (ENOSESSION)', { skip: process.platform === 'win32' ? 'POSIX shim' : false }, () => {
  // Point runSubject at a fake `claude` on PATH that emits a JSON result with no
  // session_id, and assert it fails closed rather than grading an unthreaded
  // turn. A tiny POSIX shell shim in a temp dir prepended to PATH.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ceval-noSid-'));
  const shim = path.join(dir, 'claude');
  // Print a JSON result object that lacks session_id.
  fs.writeFileSync(
    shim,
    '#!/bin/sh\nprintf \'%s\' \'{"type":"result","is_error":false,"result":"hi"}\'\n',
    { mode: 0o755 }
  );
  const prevPath = process.env.PATH;
  const prevMock = process.env.EVAL_MOCK;
  delete process.env.EVAL_MOCK;
  process.env.PATH = dir + path.delimiter + prevPath;
  let r;
  try {
    r = runSubject({ cwd: process.cwd(), message: 'hi' });
  } finally {
    process.env.PATH = prevPath;
    if (prevMock !== undefined) process.env.EVAL_MOCK = prevMock;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(r.error, 'structured error present');
  assert.equal(r.error.code, 'ENOSESSION');
  assert.equal(r.sessionId, null, 'no session id handed back');
  assert.equal(r.response, '', 'no response graded on an unthreaded turn');
});
