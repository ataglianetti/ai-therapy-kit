// Tests for the subject runner (evals/lib/run-subject.js). The whole suite runs
// in mock mode — no API tokens, no real `claude` binary required. The spawn
// plan is asserted directly (pure function), and the failed-spawn branch is
// exercised by forcing `claude` to be unresolvable (empty PATH) so spawnSync
// reports ENOENT on result.error — no real binary needed either way.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  runSubject,
  subjectSpawnPlan,
  DEFAULT_MOCK_RESPONSE,
  MOCK_SESSION_ID,
} from '../lib/run-subject.js';

// ---------------------------------------------------------------------------
// Spawn plan (pure)
// ---------------------------------------------------------------------------

test('fresh-turn plan: claude -p <message> with the given cwd', () => {
  const plan = subjectSpawnPlan(
    { message: 'hello there', cwd: '/some/therapy/dir' },
    'darwin'
  );
  assert.equal(plan.command, 'claude');
  assert.deepEqual(plan.args, ['-p', 'hello there']);
  assert.equal(plan.cwd, '/some/therapy/dir');
  assert.equal(plan.shell, false);
});

test('resume-turn plan: includes --resume <id> before -p <message>', () => {
  const plan = subjectSpawnPlan(
    { message: 'still here', cwd: '/dir', resumeSessionId: 'sess-42' },
    'darwin'
  );
  assert.deepEqual(plan.args, ['--resume', 'sess-42', '-p', 'still here']);
});

test('win32 plan: shell enabled (claude is a .cmd shim); fixed command', () => {
  const plan = subjectSpawnPlan({ message: 'hi', cwd: '/d' }, 'win32');
  assert.equal(plan.command, 'claude');
  assert.equal(plan.shell, true);
  assert.deepEqual(plan.args, ['-p', 'hi']);
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
  assert.deepEqual(r.plan.args, ['-p', 'hi']);
  assert.equal(r.plan.cwd, '/therapy');
});

test('mock resume turn: plan includes --resume and echoes the session id', () => {
  const r = runSubject({
    cwd: '/therapy',
    message: 'still here',
    resumeSessionId: 'sess-7',
    mock: true,
  });
  assert.deepEqual(r.plan.args, ['--resume', 'sess-7', '-p', 'still here']);
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
