#!/usr/bin/env node
// <!-- version: 1.0.0 -->
//
// safety-net.js — UserPromptSubmit hook: mechanical crisis-language backstop.
//
// This is a BACKSTOP, not the safety system. The prose protocol in
// `.therapy/safety-protocol.md` remains the primary and authoritative
// crisis-handling instruction; this hook only injects a reminder when a
// cheap pattern match fires, in case the model's attention has drifted.
//
// The Emergency Resources text injected below is sourced verbatim from
// `safety-protocol.md` (Emergency Resources block). If that block changes,
// this file must be updated to match — a test extracts the fenced block
// from `safety-protocol.md` and asserts the injected text contains it
// verbatim, line for line.
//
// LIMITATION: patterns are English-only. Crisis language in other
// languages will not trigger this hook. The prose protocol still applies.
//
// Parse-mode note: this file is copied into installs where no package.json
// declares a module type, so it may be parsed as CommonJS there and as ESM
// inside this repo ("type": "module"). It therefore uses ONLY globals —
// no import/export/require — and is valid under both parse modes.
//
// Fail-open contract: on ANY error (malformed JSON, empty stdin, missing
// or non-string prompt, closed stdout, stdin that never ends), exit 0 with
// no output. A broken hook must never break a session.
//
// Pattern convention: input is normalized (lowercased, unicode punctuation
// folded, whitespace collapsed) before matching, so every pattern source
// below must be lowercase. A test enforces this.

'use strict';

// Tier 1: explicit suicidal-ideation / self-harm / method language.
// Recall-first: within clearly first-person crisis space, prefer to match.
var TIER1_PATTERNS = [
  /\bwant(?:s|ed)?\s+to\s+die\b/,
  /\bwanna\s+die\b/,
  /\bwish\s+i\s+(?:was|were)\s+dead\b/,
  /\bwish\s+i\s+(?:wasn'?t|weren'?t|was\s+not|were\s+not)\s+alive\b/,
  /\bk[i1!]ll(?:ing|ed)?\s+myself\b/,
  /\bunaliv(?:e|ing|ed)\s+(?:myself|me)\b/,
  /(?<!\d\s?)\bkms\b/,
  /\bend(?:ing)?\s+(?:it\s+all|my\s+(?:own\s+)?life)\b/,
  /\bwant(?:s|ed)?\s+to\s+end\s+it\b/,
  /\bthink(?:ing)?\s+(?:about|of)\s+ending\s+it\b/,
  /\b(?:don'?t|do\s+not)\s+(?:want\s+to|wanna)\s+be\s+here\b/,
  /\b(?:don'?t|do\s+not)\s+(?:want\s+to|wanna)\s+live\b/,
  /\b(?:want(?:s|ed)?\s+to|wanna)\s+be\s+dead\b/,
  /\bbetter\s+off\s+without\s+me\b/,
  /\bbetter\s+off\s+dead\b/,
  /\b(?:no\s+one|no-one|nobody)\s+would\s+miss\s+me\b/,
  /\b(?:cut|cutting|hurt|hurting|harm|harming|hang|hanging|shoot|shooting|off|offing)\s+myself\b/,
  /\bself[-\s]?harm/,
  /\b(?:i'?m|i\s+am|i\s+feel|feel(?:ing)?|been)\s+suicidal\b/,
  /\bsuicidal\s+(?:thoughts?|ideation)\b/,
  /\bthink(?:ing)?\s+(?:about|of)\s+suicide\b/,
  /\bcommit(?:ting)?\s+suicide\b/,
  /\bmy\s+suicide\s+(?:note|plan|attempt)\b/,
  /\b(?:tak(?:e|ing)|took)\s+my\s+(?:own\s+)?life\b/,
  /\bplan\s+to\s+(?:die|kill|end\s+my\s+life)\b/,
  /\boverdos(?:e|ed|ing)\b/
];

// Tier 2: conservative warning-sign phrasings (kept minimal on purpose;
// tuning happens later with evals).
var TIER2_PATTERNS = [
  /\b(?:giv(?:e|ing|en)|gave)\s+(?:away\s+)?(?:all\s+(?:of\s+)?)?my\s+(?:things|stuff|belongings|possessions)(?:\s+away)?\b/,
  /\bsaying\s+(?:my\s+)?goodbyes?\b/,
  /\bfinal\s+goodbyes?\b/,
  /\bwon'?t\s+matter\s+soon\b/,
  /\b(?:can'?t|cannot)\s+(?:do\s+this|go\s+on|take\s+(?:it|this))(?:\s+anymore)?\b/,
  /\bno\s+reason\s+to\s+(?:live|go\s+on|keep\s+going)\b/,
  /\bnothing\s+(?:left\s+)?to\s+live\s+for\b/,
  /\bno\s+point\s+in\s+(?:living|going\s+on)\b/,
  /\bno\s+way\s+out\b/,
  /\bbetter\s+off\s+if\s+i\s+(?:was|were)\s+gone\b/
];

// Verbatim from safety-protocol.md > Emergency Resources. Do not edit here
// without editing there (and vice versa).
var EMERGENCY_RESOURCES =
  "If you're in crisis, please reach out to trained crisis counselors:\n" +
  '\n' +
  'US:\n' +
  '- 988 Suicide & Crisis Lifeline (call or text)\n' +
  '- Crisis Text Line: text HOME to 741741\n' +
  '- 911 for immediate emergencies\n' +
  '\n' +
  'International: https://findahelpline.com\n' +
  '\n' +
  'These are humans trained in crisis support, available 24/7.';

var ADDITIONAL_CONTEXT =
  'AUTOMATED SAFETY NOTICE - a pattern matcher flagged possible crisis ' +
  "language in the client's message.\n" +
  '\n' +
  EMERGENCY_RESOURCES +
  '\n' +
  '\n' +
  'Re-read .therapy/safety-protocol.md now and follow its Crisis Response ' +
  'sequence.\n' +
  '\n' +
  'Note: this notice was triggered by an automated keyword/pattern match, ' +
  'which cannot understand context. Assess the actual conversation - the ' +
  'client, not the pattern, is the authority on whether this is a crisis. ' +
  'If the language is clearly not crisis-related (an idiom, a quote, ' +
  'discussion of the past), continue the session normally while staying ' +
  'attentive.';

function normalize(text) {
  return text
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’‛ʼ`´]/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function matchesAny(patterns, text) {
  for (var i = 0; i < patterns.length; i++) {
    if (patterns[i].test(text)) return true;
  }
  return false;
}

function main(input) {
  var payload = JSON.parse(input);
  var prompt = payload && payload.prompt;
  if (typeof prompt !== 'string' || prompt.length === 0) {
    return;
  }
  var text = normalize(prompt);
  if (matchesAny(TIER1_PATTERNS, text) || matchesAny(TIER2_PATTERNS, text)) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: ADDITIONAL_CONTEXT
        }
      }) + '\n'
    );
  }
}

// Never crash on stdout errors (e.g. EPIPE when the reader closed the
// pipe). Fail-open means exit 0 silently, never a nonzero write crash.
process.stdout.on('error', function () {});

// Self-timeout: if stdin never ends (harness bug, unusual spawn), exit 0
// silently rather than hanging until the harness kills us. The timer is
// unref'd so it never delays a normal run. SAFETY_NET_STDIN_TIMEOUT_MS
// overrides the 5000ms default (used by tests to keep the suite fast).
var STDIN_TIMEOUT_MS = 5000;
var envTimeout = Number(process.env.SAFETY_NET_STDIN_TIMEOUT_MS);
if (envTimeout > 0) {
  STDIN_TIMEOUT_MS = envTimeout;
}
var stdinTimer = setTimeout(function () {
  process.exit(0);
}, STDIN_TIMEOUT_MS);
if (stdinTimer.unref) stdinTimer.unref();

var chunks = [];
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (chunk) {
  chunks.push(chunk);
});
process.stdin.on('end', function () {
  clearTimeout(stdinTimer);
  try {
    main(chunks.join(''));
  } catch (err) {
    // Fail-open: swallow and fall through to a natural exit 0.
  }
  // No process.exit() here: a pending stdout write (the crisis notice)
  // must be allowed to flush. With stdin ended and the timer cleared,
  // the event loop drains and the process exits 0 on its own.
});
process.stdin.on('error', function () {
  process.exit(0);
});
