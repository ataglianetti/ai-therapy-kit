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
// this file must be updated to match — a test enforces that both files
// carry the same core resources (988, 741741, 911, findahelpline.com).
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
// or non-string prompt), exit 0 with no output. A broken hook must never
// break a session.

'use strict';

// Tier 1: explicit suicidal-ideation / self-harm / method language.
var TIER1_PATTERNS = [
  /\bwant(?:s|ed)?\s+to\s+die\b/,
  /\bwanna\s+die\b/,
  /\bwish\s+i\s+(?:was|were)\s+dead\b/,
  /\bkill(?:ing|ed)?\s+myself\b/,
  /\bend\s+(?:it\s+all|my\s+life)\b/,
  /\bwant(?:s|ed)?\s+to\s+end\s+it\b/,
  /\b(?:don'?t|do\s+not)\s+want\s+to\s+be\s+here\b/,
  /\bbetter\s+off\s+without\s+me\b/,
  /\b(?:cut|cutting|hurt|hurting|harm|harming)\s+myself\b/,
  /\bself[-\s]?harm/,
  /\bsuicid(?:e|al)\b/,
  /\btak(?:e|ing)\s+my\s+(?:own\s+)?life\b/,
  /\bplan\s+to\s+(?:die|kill|end\s+my\s+life)\b/,
  /\boverdos(?:e|ed|ing)\b/
];

// Tier 2: conservative warning-sign phrasings (kept minimal on purpose;
// tuning happens later with evals).
var TIER2_PATTERNS = [
  /\bgiv(?:e|ing|en)\s+(?:away\s+)?(?:all\s+(?:of\s+)?)?my\s+(?:things|stuff|belongings|possessions)(?:\s+away)?\b/,
  /\bsaying\s+my\s+goodbyes\b/,
  /\bfinal\s+goodbyes?\b/,
  /\bwon'?t\s+matter\s+soon\b/,
  /\b(?:can'?t|cannot)\s+(?:do\s+this|go\s+on|take\s+(?:it|this))\s+anymore\b/,
  /\bno\s+reason\s+to\s+(?:live|go\s+on|keep\s+going)\b/,
  /\bnothing\s+(?:left\s+)?to\s+live\s+for\b/,
  /\bno\s+point\s+in\s+(?:living|going\s+on)\b/,
  /\bno\s+way\s+out\b/
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
    .replace(/[‘’]/g, "'")
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
    process.exit(0);
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
  process.exit(0);
}

try {
  var chunks = [];
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (chunk) {
    chunks.push(chunk);
  });
  process.stdin.on('end', function () {
    try {
      main(chunks.join(''));
    } catch (err) {
      process.exit(0);
    }
  });
  process.stdin.on('error', function () {
    process.exit(0);
  });
} catch (err) {
  process.exit(0);
}
