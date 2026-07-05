// Black-box tests for hooks/safety-net.js.
// The hook is spawned as a real child process so tests exercise the actual
// parse mode and stdin/stdout contract, not an imported function.
// Fixture strings are synthetic and minimal by design (repo guardrail:
// no gratuitous crisis detail).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = path.resolve(__dirname, '..', '..', 'hooks', 'safety-net.js');
const PROTOCOL_PATH = path.resolve(__dirname, '..', '..', 'safety-protocol.md');

function runHook(stdinText, hookPath = HOOK_PATH) {
  const result = spawnSync('node', [hookPath], {
    input: stdinText,
    encoding: 'utf8',
    timeout: 10_000
  });
  return result;
}

function runPrompt(prompt) {
  return runHook(JSON.stringify({ prompt }));
}

function parseEnvelope(stdout, label) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    assert.fail(`stdout is not a JSON envelope for: ${label}`);
  }
  assert.equal(
    parsed.hookSpecificOutput.hookEventName,
    'UserPromptSubmit',
    `hookEventName for: ${label}`
  );
  const ctx = parsed.hookSpecificOutput.additionalContext;
  assert.equal(typeof ctx, 'string', `additionalContext is a string for: ${label}`);
  return parsed;
}

function assertFires(prompt) {
  const { status, stdout } = runPrompt(prompt);
  assert.equal(status, 0, `exit 0 for: ${prompt}`);
  const parsed = parseEnvelope(stdout, prompt);
  assert.ok(
    parsed.hookSpecificOutput.additionalContext.includes('988'),
    `additionalContext contains 988 for: ${prompt}`
  );
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

test('tier-1: recall additions fire (round-1 F1)', () => {
  assertFires("I've been thinking about ending my life");
  assertFires('I keep thinking about ending it');
  assertFires("I don't want to live anymore");
  assertFires("I don't want to live");
  assertFires('I want to be dead');
  assertFires("I'd be better off dead");
  assertFires('I want to end my own life');
  assertFires('I thought about hanging myself');
  assertFires('I could shoot myself');
  assertFires('I might just off myself');
  assertFires('I almost took my own life last year');
  assertFires('i dont wanna be here');
  assertFires("I wish I wasn't alive");
  assertFires('no one would miss me if I was gone');
  assertFires('nobody would miss me');
});

test('tier-1: euphemism lexicon fires (round-1 F2)', () => {
  assertFires('I want to unalive myself');
  assertFires('kms');
  assertFires('honestly kms');
  assertFires('I want to k1ll myself');
  assertFires('k!ll myself');
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
});

test('tier-1: first-person suicide phrasings fire (round-1 F12)', () => {
  assertFires("I'm suicidal");
  assertFires('I am suicidal');
  assertFires('I feel suicidal today');
  assertFires("I've been having suicidal thoughts");
  assertFires('the suicidal ideation is back');
  assertFires("I've been thinking about suicide");
  assertFires('I keep thinking of committing suicide');
  assertFires('I started writing my suicide note');
  assertFires('I never told anyone about my suicide attempt');
});

test('negatives: third-person and topical suicide mentions stay silent (round-1 F12)', () => {
  assertSilent('my grandmother died by suicide years ago');
  assertSilent('his suicide devastated the family');
  assertSilent('their suicide was never discussed at home');
  assertSilent('I signed up for suicide prevention training at work');
  assertSilent('we watched Suicide Squad last night');
  assertSilent('the article was about rising suicide rates');
  assertSilent('my grandmother committed suicide when I was young');
});

test('tier-1: case and punctuation tolerant', () => {
  assertFires('I WANT TO DIE.');
  assertFires('...kill myself?');
  assertFires('I don’t want to be here'); // curly apostrophe
});

test('unicode folding: exotic hyphens and apostrophes fold before matching (round-1 F13)', () => {
  assertFires('I looked up self‑harm last night'); // U+2011 non-breaking hyphen
  assertFires('I donʼt want to be here'); // U+02BC modifier letter apostrophe
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

test('tier-2: broadened phrasings fire (round-1 F3)', () => {
  assertFires('I cannot go on');
  assertFires("I can't go on");
  assertFires('I gave away my possessions');
  assertFires("I've been saying goodbye to everyone");
  assertFires('everyone would be better off if I was gone');
  assertFires("they'd be better off if I were gone");
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
  assertSilent('we drove 20 kms to the trailhead');
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

test('fail-open: null prompt exits 0 silently', () => {
  const { status, stdout } = runHook(JSON.stringify({ prompt: null }));
  assert.equal(status, 0);
  assert.equal(stdout, '');
});

test('fail-open: ~2MB benign prompt exits 0 silently', () => {
  const { status, stdout } = runHook(
    JSON.stringify({ prompt: 'a'.repeat(2 * 1024 * 1024) })
  );
  assert.equal(status, 0);
  assert.equal(stdout, '');
});

test('fail-open: closed stdout on a match still exits 0 (round-1 F8)', async () => {
  const child = spawn(process.execPath, [HOOK_PATH], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  child.stdin.on('error', () => {});
  // Close our read end of the child's stdout so the child's write hits a
  // broken pipe (EPIPE). Fail-open requires it still exits 0.
  child.stdout.destroy();
  child.stdin.end(JSON.stringify({ prompt: 'I want to die' }));
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
});

test('fail-open: stdin never closing exits 0 via self-timeout (round-1 F11)', async () => {
  // SAFETY_NET_STDIN_TIMEOUT_MS is the hook's documented test override for
  // its 5s default self-timeout, keeping this test fast.
  const child = spawn(process.execPath, [HOOK_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, SAFETY_NET_STDIN_TIMEOUT_MS: '300' }
  });
  child.stdin.on('error', () => {});
  child.stdin.write('{'); // partial input; never end the stream
  const start = Date.now();
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
  assert.ok(Date.now() - start < 5000, 'exited via self-timeout promptly');
  child.stdin.destroy();
});

test('CJS parse mode: hook copied outside the repo still works (round-1 F9)', () => {
  // Installed copies live under directories with no package.json, so Node
  // parses them as CommonJS (the repo copy parses as ESM via "type":
  // "module"). This is the regression tripwire for the globals-only,
  // dual-parse contract: an `import`/`export` slipping into the hook keeps
  // the repo suite green but kills every installed copy.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'safety-net-cjs-'));
  try {
    const copy = path.join(dir, 'safety-net.js');
    copyFileSync(HOOK_PATH, copy);

    const fires = runHook(JSON.stringify({ prompt: 'I want to die' }), copy);
    assert.equal(fires.status, 0, `exit 0 (stderr: ${fires.stderr})`);
    const parsed = parseEnvelope(fires.stdout, 'CJS-mode tier-1 positive');
    assert.ok(parsed.hookSpecificOutput.additionalContext.includes('988'));

    const failOpen = runHook('this is not json {{{', copy);
    assert.equal(failOpen.status, 0);
    assert.equal(failOpen.stdout, '');
    assert.equal(failOpen.stderr, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('output shape: single-line JSON with correct hook envelope', () => {
  const { status, stdout } = runPrompt('I want to die');
  assert.equal(status, 0);
  assert.equal(stdout.trimEnd().split('\n').length, 1, 'single line');
  const parsed = parseEnvelope(stdout, 'output shape');
  const ctx = parsed.hookSpecificOutput.additionalContext;
  for (const resource of ['988', '741741', '911', 'findahelpline.com']) {
    assert.ok(ctx.includes(resource), `additionalContext contains ${resource}`);
  }
  assert.ok(
    ctx.includes('safety-protocol.md'),
    'points the model back to the prose protocol'
  );
});

test('resources sync: injected block matches safety-protocol.md verbatim (round-1 F10)', () => {
  const protocol = readFileSync(PROTOCOL_PATH, 'utf8');
  const m = protocol.match(
    /## Emergency Resources[\s\S]*?```\n([\s\S]*?)\n```/
  );
  assert.ok(m, 'Emergency Resources fenced block found in safety-protocol.md');
  const block = m[1];
  assert.ok(block.includes('988'), 'extracted block looks like the resources');

  const { stdout } = runPrompt('I want to die');
  const ctx = parseEnvelope(stdout, 'resources sync').hookSpecificOutput
    .additionalContext;
  assert.ok(
    ctx.includes(block),
    'injected additionalContext contains the protocol resources block verbatim'
  );
});

test('pattern hygiene: every pattern source is lowercase (round-1 F14)', () => {
  // The hook lowercases input before matching (normalize-then-match), so an
  // uppercase character in any pattern can never match. Guard the convention.
  const hookSource = readFileSync(HOOK_PATH, 'utf8');
  const m = hookSource.match(
    /var TIER1_PATTERNS = \[[\s\S]*?\];[\s\S]*?var TIER2_PATTERNS = \[[\s\S]*?\];/
  );
  assert.ok(m, 'pattern arrays found in hook source');
  const literals = m[0].match(/\/(?:[^/\\\n]|\\.)+\//g);
  assert.ok(
    literals && literals.length >= 30,
    `expected to extract pattern literals, got ${literals ? literals.length : 0}`
  );
  for (const lit of literals) {
    assert.equal(lit, lit.toLowerCase(), `pattern is not lowercase: ${lit}`);
  }
});

test('version marker: hook carries a parseable version comment', () => {
  const hookSource = readFileSync(HOOK_PATH, 'utf8');
  const m = hookSource.match(/<!--\s*version:\s*([^\s>-]+)\s*-->/);
  assert.ok(m, 'version marker present');
  assert.equal(m[1], '1.0.0');
});
