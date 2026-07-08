import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { prepFixture } from '../lib/prep-fixture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, '..', 'fixture');
const SOURCE_SETTINGS = path.join(FIXTURE_DIR, '.claude', 'settings.json');

function readSettings(cwd) {
  return JSON.parse(
    fs.readFileSync(path.join(cwd, '.claude', 'settings.json'), 'utf8')
  );
}

function settingsHasSafetyNet(raw) {
  return raw.includes('safety-net.js');
}

test('hook: "off" removes the safety-net reference and leaves valid JSON', () => {
  const prep = prepFixture({ hook: 'off', arm: 'fresh' });
  try {
    const settingsPath = path.join(prep.cwd, '.claude', 'settings.json');
    const raw = fs.readFileSync(settingsPath, 'utf8');
    assert.equal(
      settingsHasSafetyNet(raw),
      false,
      'no safety-net.js reference should remain'
    );
    // Still valid JSON.
    const parsed = JSON.parse(raw);
    assert.ok(parsed && typeof parsed === 'object');
    // The unrelated datetime hook group must survive.
    const groups = parsed?.hooks?.UserPromptSubmit;
    assert.ok(Array.isArray(groups) && groups.length === 1, 'datetime hook group retained');
  } finally {
    prep.cleanup();
  }
});

test('hook: "on" retains the safety-net entry', () => {
  const prep = prepFixture({ hook: 'on', arm: 'fresh' });
  try {
    const settingsPath = path.join(prep.cwd, '.claude', 'settings.json');
    const raw = fs.readFileSync(settingsPath, 'utf8');
    assert.equal(settingsHasSafetyNet(raw), true, 'safety-net.js reference retained');
    // Both groups present.
    const parsed = JSON.parse(raw);
    assert.equal(parsed.hooks.UserPromptSubmit.length, 2);
  } finally {
    prep.cleanup();
  }
});

test('source fixture settings.json is unchanged after hook: "off"', () => {
  const before = fs.readFileSync(SOURCE_SETTINGS, 'utf8');
  const prep = prepFixture({ hook: 'off', arm: 'fresh' });
  prep.cleanup();
  const after = fs.readFileSync(SOURCE_SETTINGS, 'utf8');
  assert.equal(after, before, 'source fixture must not be mutated');
});

test('source fixture settings.json is unchanged after hook: "on"', () => {
  const before = fs.readFileSync(SOURCE_SETTINGS, 'utf8');
  const prep = prepFixture({ hook: 'on', arm: 'degraded' });
  prep.cleanup();
  const after = fs.readFileSync(SOURCE_SETTINGS, 'utf8');
  assert.equal(after, before, 'source fixture must not be mutated');
});

test('arm: "degraded" returns a non-empty preamble with the no-re-read instruction', () => {
  const prep = prepFixture({ hook: 'on', arm: 'degraded' });
  try {
    assert.equal(typeof prep.degradedPreamble, 'string');
    assert.ok(prep.degradedPreamble.length > 0, 'preamble non-empty');
    assert.match(
      prep.degradedPreamble,
      /do not re-read startup files/i,
      'preamble instructs not to re-read startup files'
    );
    // Benign: no crisis content.
    assert.doesNotMatch(prep.degradedPreamble, /suicide|self-harm|kill myself/i);
  } finally {
    prep.cleanup();
  }
});

test('arm: "fresh" returns no degradedPreamble', () => {
  const prep = prepFixture({ hook: 'on', arm: 'fresh' });
  try {
    assert.equal(prep.degradedPreamble, undefined);
  } finally {
    prep.cleanup();
  }
});

test('cleanup() removes the temp dir', () => {
  const prep = prepFixture({ hook: 'on', arm: 'fresh' });
  assert.ok(fs.existsSync(prep.cwd), 'temp dir exists before cleanup');
  prep.cleanup();
  assert.equal(fs.existsSync(prep.cwd), false, 'temp dir removed after cleanup');
});

test('return shape: cwd/arm/hook are set correctly', () => {
  const prep = prepFixture({ hook: 'off', arm: 'degraded' });
  try {
    assert.equal(prep.hook, 'off');
    assert.equal(prep.arm, 'degraded');
    assert.ok(typeof prep.cwd === 'string' && fs.existsSync(prep.cwd));
    assert.equal(typeof prep.cleanup, 'function');
  } finally {
    prep.cleanup();
  }
});

test('the full fixture tree is copied (not just settings)', () => {
  const prep = prepFixture({ hook: 'on', arm: 'fresh' });
  try {
    assert.ok(fs.existsSync(path.join(prep.cwd, 'CLAUDE.md')));
    assert.ok(fs.existsSync(path.join(prep.cwd, '.therapy', 'safety-protocol.md')));
    assert.ok(fs.existsSync(path.join(prep.cwd, '.therapy', 'hooks', 'safety-net.js')));
  } finally {
    prep.cleanup();
  }
});

test('bad hook value throws', () => {
  assert.throws(() => prepFixture({ hook: 'maybe', arm: 'fresh' }), /invalid hook/);
});

test('bad arm value throws', () => {
  assert.throws(() => prepFixture({ hook: 'on', arm: 'stale' }), /invalid arm/);
});

test('a prep failure after mkdtemp leaves no leaked temp dir', () => {
  // Force the copy step to fail by pointing at a non-existent source fixture.
  // mkdtempSync will already have created the temp dir; prepFixture must remove
  // it before rethrowing so no ceval-* dir leaks.
  const missingSrc = path.join(os.tmpdir(), 'ceval-does-not-exist-src-xyz');
  assert.equal(fs.existsSync(missingSrc), false, 'precondition: source is absent');

  const before = new Set(
    fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('ceval-'))
  );

  assert.throws(
    () => prepFixture({ hook: 'on', arm: 'fresh', fixtureDir: missingSrc }),
    /ENOENT|no such file/i
  );

  const after = fs
    .readdirSync(os.tmpdir())
    .filter((n) => n.startsWith('ceval-') && !before.has(n));
  assert.deepEqual(after, [], `no new ceval-* temp dir should leak, saw: ${after}`);
});
