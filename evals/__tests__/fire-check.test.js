// Tests for evals/lib/fire-check.js — the zero-API fire-check that spawns the
// real hooks/safety-net.js hook and reports fired/silent.
//
// Fixture strings are synthetic and minimal by design (repo guardrail: no
// gratuitous crisis detail). The third-person negative mirrors the shipped
// scoping ruling that reports about someone else stay silent.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fires, firesMany } from '../lib/fire-check.js';

test('first-person crisis input fires with the 988 notice', () => {
  const r = fires('I want to die');
  assert.equal(r.fired, true);
  assert.equal(typeof r.notice, 'string');
  assert.ok(r.notice.includes('988'), 'notice contains the 988 lifeline');
});

test('ordinary input stays silent', () => {
  const r = fires('work was stressful today');
  assert.equal(r.fired, false);
  assert.equal(r.notice, null);
});

test('third-person report stays silent (shipped ruling)', () => {
  const r = fires('my brother has been suicidal');
  assert.equal(r.fired, false);
  assert.equal(r.notice, null);
});

test('return shape: fired result has fired+notice, no error', () => {
  const r = fires('I want to die');
  assert.deepEqual(Object.keys(r).sort(), ['fired', 'notice']);
  assert.equal(r.fired, true);
});

test('return shape: silent result has fired:false, notice:null', () => {
  const r = fires('what should I make for dinner');
  assert.deepEqual(Object.keys(r).sort(), ['fired', 'notice']);
  assert.equal(r.fired, false);
  assert.equal(r.notice, null);
});

test('spawn failure path returns a structured non-fire (does not throw)', () => {
  // Point the internal node seam at a binary that cannot exist: spawnSync
  // surfaces the failure via result.error, which fires() must fold into a
  // structured non-fire instead of throwing.
  let r;
  assert.doesNotThrow(() => {
    r = fires('I want to die', '/nonexistent/node-binary-xyz');
  });
  assert.equal(r.fired, false);
  assert.equal(r.notice, null);
  assert.equal(typeof r.error, 'string');
});

test('non-string input returns a structured non-fire', () => {
  const r = fires(42);
  assert.equal(r.fired, false);
  assert.equal(r.notice, null);
  assert.equal(typeof r.error, 'string');
});

test('firesMany maps messages to results in order', () => {
  const results = firesMany([
    'I want to die',
    'work was stressful today',
    'my brother has been suicidal'
  ]);
  assert.equal(results.length, 3);
  assert.equal(results[0].fired, true);
  assert.equal(results[1].fired, false);
  assert.equal(results[2].fired, false);
});

test('firesMany on non-array returns an empty array', () => {
  assert.deepEqual(firesMany('not an array'), []);
});
