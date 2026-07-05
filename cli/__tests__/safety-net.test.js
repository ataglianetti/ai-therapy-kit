// Black-box tests for hooks/safety-net.js.
// The hook is spawned as a real child process so tests exercise the actual
// parse mode and stdin/stdout contract, not an imported function.
// Fixture strings are synthetic and minimal by design (repo guardrail:
// no gratuitous crisis detail).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = path.resolve(__dirname, '..', '..', 'hooks', 'safety-net.js');
const PROTOCOL_PATH = path.resolve(__dirname, '..', '..', 'safety-protocol.md');

function runHook(stdinText) {
  const result = spawnSync('node', [HOOK_PATH], {
    input: stdinText,
    encoding: 'utf8',
    timeout: 10_000
  });
  return result;
}

function runPrompt(prompt) {
  return runHook(JSON.stringify({ prompt }));
}

function assertFires(prompt) {
  const { status, stdout } = runPrompt(prompt);
  assert.equal(status, 0, `exit 0 for: ${prompt}`);
  assert.ok(stdout.includes('988'), `expected match output for: ${prompt}`);
}

function assertSilent(prompt) {
  const { status, stdout, stderr } = runPrompt(prompt);
  assert.equal(status, 0, `exit 0 for: ${prompt}`);
  assert.equal(stdout, '', `expected no stdout for: ${prompt}`);
  assert.equal(stderr, '', `expected no stderr for: ${prompt}`);
}

test('tier-1: suicidal ideation phrasings fire', () => {
  assertFires('I want to die');
  assertFires('sometimes I think about killing myself');
  assertFires("I don't want to be here anymore");
  assertFires('everyone would be better off without me');
  assertFires('I just want to end it all');
  assertFires('I want to end my life');
});

test('tier-1: self-harm phrasings fire', () => {
  assertFires("I've been cutting myself again");
  assertFires('I want to hurt myself');
  assertFires('I looked up self-harm last night');
});

test('tier-1: method, plan, and overdose references fire', () => {
  assertFires('I have a plan to end my life');
  assertFires('I keep thinking about taking my own life');
  assertFires('I thought about an overdose');
  assertFires('I feel suicidal today');
});

test('tier-1: case and punctuation tolerant', () => {
  assertFires('I WANT TO DIE.');
  assertFires('...kill myself?');
  assertFires('I don’t want to be here'); // curly apostrophe
});

test('tier-2: conservative warning signs fire', () => {
  assertFires('I started giving away my things');
  assertFires("I've been saying my goodbyes");
  assertFires("it won't matter soon anyway");
  assertFires("I can't do this anymore");
  assertFires('there is no reason to keep going');
  assertFires('I have nothing to live for');
  assertFires('I see no way out');
});

test('negatives: normal therapy talk stays silent', () => {
  assertSilent('what should I make for dinner');
  assertSilent('I felt anxious at work this week and want to talk about it');
  assertSilent('my therapist and I discussed boundaries with my mom');
  assertSilent('I had a hard day but journaling helped');
});

test('negatives: idioms do not fire', () => {
  assertSilent('this deadline is killing me');
  assertSilent("I'm killing it at work lately");
  assertSilent('we had to cut the budget in half');
  assertSilent('I said goodbye to a coworker on her last day');
  assertSilent('the movie ending was to die for');
});

test('fail-open: garbage stdin exits 0 silently', () => {
  const { status, stdout } = runHook('this is not json {{{');
  assert.equal(status, 0);
  assert.equal(stdout, '');
});

test('fail-open: empty stdin exits 0 silently', () => {
  const { status, stdout } = runHook('');
  assert.equal(status, 0);
  assert.equal(stdout, '');
});

test('fail-open: valid JSON without prompt exits 0 silently', () => {
  const { status, stdout } = runHook(JSON.stringify({ session_id: 'abc' }));
  assert.equal(status, 0);
  assert.equal(stdout, '');
});

test('fail-open: non-string prompt exits 0 silently', () => {
  const { status, stdout } = runHook(JSON.stringify({ prompt: 42 }));
  assert.equal(status, 0);
  assert.equal(stdout, '');
});

test('output shape: single-line JSON with correct hook envelope', () => {
  const { status, stdout } = runPrompt('I want to die');
  assert.equal(status, 0);
  assert.equal(stdout.trimEnd().split('\n').length, 1, 'single line');
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  const ctx = parsed.hookSpecificOutput.additionalContext;
  assert.equal(typeof ctx, 'string');
  for (const resource of ['988', '741741', '911', 'findahelpline.com']) {
    assert.ok(ctx.includes(resource), `additionalContext contains ${resource}`);
  }
  assert.ok(
    ctx.includes('safety-protocol.md'),
    'points the model back to the prose protocol'
  );
});

test('resources sync: hook source and safety-protocol.md carry the same core resources', () => {
  const hookSource = readFileSync(HOOK_PATH, 'utf8');
  const protocol = readFileSync(PROTOCOL_PATH, 'utf8');
  for (const resource of ['988', '741741', '911', 'findahelpline.com']) {
    assert.ok(hookSource.includes(resource), `hook contains ${resource}`);
    assert.ok(protocol.includes(resource), `protocol contains ${resource}`);
  }
});

test('version marker: hook carries a parseable version comment', () => {
  const hookSource = readFileSync(HOOK_PATH, 'utf8');
  const m = hookSource.match(/<!--\s*version:\s*([^\s>-]+)\s*-->/);
  assert.ok(m, 'version marker present');
  assert.equal(m[1], '1.0.0');
});
