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
// SCOPING (per the recorded product ruling, 2026-07-05): first-person
// crisis language FIRES, recall-first within first-person space.
// Third-person reports ("my brother has been suicidal"), grief, media,
// topical, and professional mentions stay SILENT — the mechanical notice
// is for the client's own crisis, not reports about someone else's.
// The prose protocol still governs both cases at the model level.
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
// or non-string prompt, closed stdout, stdin that never ends, a sync throw
// during stdio setup), exit 0 with no output. Oversized payloads are
// bounded, not fatal: the first 4MB is retained and scanned raw, the rest
// is treated as no-match. A broken hook must never break a session.
//
// Pattern convention: input is normalized (lowercased, unicode punctuation
// folded, whitespace collapsed) before matching, so every pattern source
// below must be lowercase. A test enforces this.

'use strict';

// --- Shared word classes (round-4 F45 structural) -------------------------
// One adverb/intensifier class is consumed by BOTH the first-person gap
// (FP_GAP) and the third-person chain (TP_CHAIN). The two grammars kept
// drifting apart when maintained as separate inline lists ("i'm honestly
// suicidal" fired while "my brother has honestly been suicidal" also fired
// because only one list knew "honestly"). A drift-guard test asserts both
// composites reference this constant and that SL_HEAD stays a subset of the
// FP_GAP filler class.
var ADVERBS =
  'so|very|really|extremely|incredibly|pretty|honestly|genuinely' +
  '|seriously|truly|literally|actually|basically|apparently|just|still' +
  '|also|too|often|always|constantly|sometimes|occasionally|usually' +
  '|never|ever|kinda|lately|recently|again|now|almost|even|fucking' +
  '|freaking|goddamn|damn|completely|totally|deeply|dangerously|quite' +
  '|super|real|lowkey|low-key|hella';

// First-person anchor + bounded filler gap. Crisis keywords composed with
// fp() fire only when an explicit first-person subject precedes them,
// separated by at most six words from a closed class of auxiliaries,
// modals, volitional verbs, and the shared adverbs. Any other intervening
// word (a name, "my brother", "she", "people who") breaks the anchor and
// the pattern stays silent. The enumeration lookbehind keeps true
// enumeration heads ("chapter i", "act i") from reading the roman numeral
// as a first-person subject — it applies ONLY to bare "i": contractions
// ("i'm", "i've") can never be roman numerals, and everyday nouns that
// merely can take numbering (class, war, stage, level, season) are not in
// the list, so "after class i was so suicidal" fires (round-4 F40).
var FP_HEAD =
  "\\b(?:i(?:'m|'ve|'d|'ll|m|ve)|(?<!\\b(?:chapter|act|section|appendix" +
  '|exhibit|figure|table|volume|phase)\\s)i)';
var FP_GAP_FILLERS =
  'am|are|was|be|been|being|has|have|having|had|feel|feels|felt' +
  '|feeling|keep|keeps|kept|get|gets|got|getting|gotten|start|started' +
  "|starting|stop|stopped|can't|cant|cannot|couldn't|couldnt|won't|wont" +
  "|will|would|wouldn't|wouldnt|might|may|could|should|must|want|wanted" +
  '|wanting|wanna|need|needed|gonna|going|about|of|to|think|thinking' +
  '|thought|like|this|that|a|an|tried|try|trying|plan|plans|planned' +
  '|planning|decided|decide|intend|hoping|hope|take|took|taking|taken';
var FP_GAP = '(?:\\s+(?:' + FP_GAP_FILLERS + '|' + ADVERBS + ')){0,6}';

function fp(tail) {
  return new RegExp(FP_HEAD + FP_GAP + '\\s+' + tail);
}

// Third-person anti-anchor for subjectless and bare-gerund patterns: a
// negative lookbehind that goes silent when a third-person subject plus a
// closed chain of verbs, modals, and the shared adverbs immediately
// precedes the match ("my friend is attempting suicide", "she said she
// would be better off dead"). The chain class deliberately excludes
// first-person tokens ("i", "i've") and conjunctions, so "my mom died and
// i want to die" and "she knows i want to die" keep firing — the chain
// breaks and the anchor survives.
//
// Two branches:
//  - pronoun subjects (he/she/they/you/it...). First-person plural "we"
//    forms are NOT here: per the recorded PM ruling (F41, 2026-07-05),
//    "we want to die" fires; generic-you stays silent.
//  - determiner + noun subjects ("my brother", "the article"). This branch
//    only blocks when NO first-person token appears earlier in the same
//    clause (round-4 F38/F39): a det+noun inside a first-person clause is
//    an object, not a subject — "i have the pills to end it all", "i told
//    my mom that i want to die" fire, while "my brother wants to end it
//    all" stays silent. The noun slot additionally excludes bare
//    first-person tokens ("that i want to die") and self-reference nouns
//    (plan/mind/part/voices/urge...), which are the speaker's own state,
//    not a third person ("my plan is to end it all", IFS parts language).
//    The clause scan is bounded (80 chars back to a clause boundary) so
//    matching stays linear on adversarial input.
var TP_PRON =
  "(?:he|she|they|you|it|who|he's|she's|it's|they're|you're" +
  "|he'd|she'd|they'd|you'd|they've|you've|he'll|she'll|they'll|you'll" +
  "|it'll)";
var TP_CHAIN_LINKS =
  'is|are|was|were|be|been|being|has|have|having|had|says|said|say' +
  '|saying|keeps|keep|kept|wants|want|wanted|wanting|feels|feel|felt' +
  '|feeling|thinks|think|thought|thinking|talks|talk|talked|talking' +
  '|seems|seem|seemed|described|discussed|mentioned|admitted|would|will' +
  "|might|may|could|should|must|can't|cant|won't|wont|wouldn't|wouldnt" +
  '|to|about|of|that|he|she|they|it|you|her|him|them|his|their';
var TP_CHAIN = '(?:\\s+(?:' + TP_CHAIN_LINKS + '|' + ADVERBS + ')){0,5}';
var TP_DET = '(?:my|his|her|their|your|our|the|this|that|a|an)';
var SELF_NOUNS =
  'plan|plans|goal|goals|decision|decisions|mind|brain|head|heart|body' +
  '|soul|gut|part|parts|voice|voices|urge|urges';
var TP_NOUN = "(?!(?:i|i'[a-z]+|" + SELF_NOUNS + ")\\b)[a-z']+";
var TP_BLOCK =
  '(?<!\\b' +
  TP_PRON +
  TP_CHAIN +
  '\\s)' +
  '(?<!(?:^|[.!?\\n;])(?:(?!\\bi\\b)[^.!?\\n;]){0,80}?\\b' +
  TP_DET +
  '\\s+' +
  TP_NOUN +
  '(?:\\s+' +
  TP_NOUN +
  ')?' +
  TP_CHAIN +
  '\\s)';

// Subjectless first-person forms ("feeling suicidal again", "planning to
// commit suicide"): a closed class of dropped-subject heads (progressive /
// perfect / volitional), anti-anchored so third-person subject chains
// ("she has been feeling suicidal") stay silent. Per the recorded ruling's
// fire-list, these are treated as elided first person.
var SL_HEAD =
  '\\b(?:feeling|feel|felt|been|being|having|planning|planned|plan' +
  '|wanting|wanted|want|hoping|trying|tried|thinking|decided|going|gonna)';

function sl(tail) {
  return new RegExp(TP_BLOCK + SL_HEAD + FP_GAP + '\\s+' + tail);
}

function tp(source) {
  return new RegExp(TP_BLOCK + source);
}

// Tier 1: explicit suicidal-ideation / self-harm / method language.
// Recall-first: within clearly first-person crisis space, prefer to match.
var TIER1_PATTERNS = [
  tp('\\bwant(?:ed)?\\s+to\\s+die\\b'),
  tp('\\bwanna\\s+die\\b'),
  /\bwish\s+i\s+(?:was|were)\s+dead\b/,
  /\bwish\s+i\s+(?:wasn'?t|weren'?t|was\s+not|were\s+not)\s+alive\b/,
  /\bk[i1!]ll(?:ing|ed)?\s+myself\b/,
  /\bunaliv(?:e|ing|ed)\s+(?:myself|me)\b/,
  /^[^a-z0-9]*(?:[a-z']+\s+){0,2}kms(?:\s+[a-z']+){0,2}[^a-z0-9]*$/,
  // First-person kms grammar, composed from the shared anchor/gap: the
  // gap absorbs auxiliaries ("i've been wanting to kms") and a volitional
  // verb is still required right before "kms", so "i think kms is the
  // right aws service" stays silent.
  fp(
    "(?:want(?:ed|ing)?\\s+to|wanna|gonna|going\\s+to|about\\s+to" +
      '|th(?:ink(?:ing)?|ought)\\s+(?:about|of)|might|could|should|will' +
      '|would|need(?:ed)?\\s+to|have\\s+to|hoping\\s+to|tr(?:ying|ied)' +
      '\\s+to|to)\\s+(?:just\\s+)?kms\\b'
  ),
  // Trailing vent: ", kms" / newline + "kms" at the very end of the
  // message. Distance/technical uses never sit alone after a clause break
  // at end of message.
  /(?:[.!?,;:…]|\n)\s*kms\b[^a-z0-9]*$/,
  /\bend(?:ing)?\s+my\s+(?:own\s+)?life\b/,
  tp('\\bend(?:ing)?\\s+it\\s+all\\b'),
  /\bwant(?:ed)?\s+to\s+end\s+it\b/,
  /\bthink(?:ing)?\s+(?:about|of)\s+ending\s+it\b/,
  /\b(?:don'?t|do\s+not)\s+(?:want\s+to|wanna)\s+be\s+here\b/,
  /\b(?:don'?t|do\s+not)\s+(?:want\s+to|wanna)\s+live\b/,
  /\b(?:want(?:ed)?\s+to|wanna)\s+be\s+dead\b/,
  /\bbetter\s+off\s+without\s+me\b/,
  tp('\\bbetter\\s+off\\s+dead\\b'),
  /\b(?:no\s+one|no-one|nobody)\s+would\s+miss\s+me\b/,
  /\b(?:cut|cutting|hurt|hurting|harm|harming|harmed|hang|hanging|hanged)\s+myself\b/,
  /\bsh(?:oot|ooting|ot)\s+myself\b(?!\s+in\s+the\s+foot)/,
  /\b(?:to|gonna|might|could|should|would|wanna|will|i'?ll|i)\s+(?:just\s+)?off\s+myself\b/,
  /\boffing\s+myself\b/,
  // The separator width tracks normalize(): newlines survive as clause
  // boundaries, so "self \nharm" / "self\n harm" leave up to three
  // whitespace chars between the halves (round-4 F46).
  /\bself[-\s]{1,3}harm(?!\s+(?:awareness|prevention)\b)/,
  fp('suicidal\\b'),
  sl('suicidal\\b'),
  // Anti-anchored, not allowlisted (round-4 F37): elided-first-person
  // determiners ("these/those/constant suicidal thoughts", bare "suicidal
  // thoughts wont stop") fire; explicit third-person possessives and
  // subject chains ("his suicidal thoughts", "my son has suicidal
  // thoughts") and topical "patients with suicidal ideation" stay silent.
  new RegExp(
    TP_BLOCK +
      "(?<!\\b(?:his|her|their|your)\\s)(?<!\\bwith\\s)" +
      '\\bsuicidal\\s+(?:thoughts?|ideation)\\b'
  ),
  fp('th(?:ink(?:ing)?|ought)\\s+(?:about|of)\\s+suicide\\b'),
  // Subjectless thinking-about-suicide, anchored to the start of a clause
  // where the dropped subject reads as elided first person (round-4 F43:
  // "been thinking about suicide a lot", "thinking about suicide again").
  // Mid-clause gerunds keep their subject ("he is thinking about suicide",
  // "an article about teens thinking about suicide") and stay silent.
  /(?:^|[.!?\n;])\s*(?:been\s+)?th(?:ink(?:ing)?|ought)\s+(?:about|of)\s+suicide\b/,
  fp('commit(?:ted|ting)?\\s+suicide\\b'),
  sl('commit(?:ted|ting)?\\s+suicide\\b'),
  fp('attempt(?:ed|ing)?\\s+suicide\\b'),
  tp('\\battempting\\s+suicide\\b'),
  // The topical-suffix guard mirrors the self-harm awareness/prevention
  // guard (round-4 F44): "taking an overdose prevention course" / "took an
  // overdose call at work" are professional/topical, not crisis.
  fp('overdos(?:e|ed|ing)\\b(?!\\s+(?:prevention|awareness|call|calls)\\b)'),
  sl('overdos(?:e|ed|ing)\\b(?!\\s+(?:prevention|awareness|call|calls)\\b)'),
  tp('\\bthink(?:ing)?\\s+(?:about|of)\\s+overdosing\\b'),
  /\bmy\s+suicide\s+(?:note|plan|attempt)\b/,
  tp('\\bplan(?:ning|ned)?\\s+to\\s+(?:die|kill|end\\s+(?:it|my\\s+life))\\b'),
  /\bplan(?:ning|ned)?\s+my\s+(?:own\s+)?suicide\b/,
  /\b(?:tak(?:e|ing)|took)\s+my\s+(?:own\s+)?life\b/
];

// Tier 2: conservative warning-sign phrasings (kept minimal on purpose;
// tuning happens later with evals). The can't-go-on family is anchored to
// the end of a clause so everyday objects stay silent.
var TIER2_PATTERNS = [
  /\b(?:giv(?:e|ing|en)|gave)\s+(?:away\s+)?(?:all\s+(?:of\s+)?)?my\s+(?:things|stuff|belongings|possessions)(?:\s+away)?\b/,
  /\bsaying\s+(?:my\s+)?goodbyes?\b/,
  /\bfinal\s+goodbyes?\b/,
  /\bwon'?t\s+matter\s+soon\b/,
  // The can't-go-on family is anchored to the end of a clause: end of
  // message, a newline (normalize preserves newlines as clause
  // boundaries), or any non-alphanumeric tail (punctuation, emoji). When
  // an "anymore"/"like this" tail is present the phrase is unambiguous,
  // so coordinated continuation is allowed ("...anymore and i'm scared").
  /\b(?:can'?t|cannot)\s+(?:do\s+this|go\s+on|take\s+(?:it|this))(?:\s+(?:anymore|any\s+more|like\s+this)\b|(?= *(?:$|\n|[^a-z0-9\s])))/,
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

// Shared timeout for the stdin self-timeout and the stdout flush guard.
// SAFETY_NET_STDIN_TIMEOUT_MS overrides the 5000ms default (used by tests
// to keep the suite fast).
var TIMEOUT_MS = 5000;
var envTimeout = Number(process.env.SAFETY_NET_STDIN_TIMEOUT_MS);
if (envTimeout > 0) {
  TIMEOUT_MS = envTimeout;
}

// Bound the stdin buffer: past this many characters the hook stops
// accumulating, so a pathological payload can never OOM into a nonzero
// exit. The retained prefix is still scanned (raw, since truncated JSON
// can't parse) — crisis language in the first 4MB of an oversized payload
// fires; anything past the bound is treated as no-match. Real prompts are
// orders of magnitude smaller.
var MAX_STDIN_CHARS = 4 * 1024 * 1024;

function normalize(text) {
  // Newlines are preserved as clause boundaries (distressed typing is
  // often unpunctuated and multi-line); only intra-line whitespace is
  // collapsed. Patterns still match across lines via \s+.
  return text
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’‛ʼ`´]/g, "'")
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .toLowerCase();
}

function matchesAny(patterns, text) {
  for (var i = 0; i < patterns.length; i++) {
    if (patterns[i].test(text)) return true;
  }
  return false;
}

function emitNotice() {
  var out =
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: ADDITIONAL_CONTEXT
      }
    }) + '\n';
  // A never-draining stdout must not leave the process hangable: keep a
  // live (ref'd) timer armed until the write callback fires, then let
  // the loop drain to a natural exit 0. If the pipe never drains, the
  // timer exits 0 after TIMEOUT_MS. The stdout 'error' handler below
  // covers EPIPE, and the write callback still fires on error, clearing
  // the timer.
  var flushTimer = setTimeout(function () {
    process.exit(0);
  }, TIMEOUT_MS);
  try {
    process.stdout.write(out, function () {
      clearTimeout(flushTimer);
    });
  } catch (err) {
    clearTimeout(flushTimer);
  }
}

function scanAndEmit(text) {
  if (matchesAny(TIER1_PATTERNS, text) || matchesAny(TIER2_PATTERNS, text)) {
    emitNotice();
  }
}

function main(input) {
  var payload = JSON.parse(input);
  var prompt = payload && payload.prompt;
  if (typeof prompt !== 'string' || prompt.length === 0) {
    return;
  }
  scanAndEmit(normalize(prompt));
}

// Runtime wiring. Wrapped so that ANY synchronous throw during stdio setup
// fails open (exit 0, silent) instead of crashing with a nonzero exit.
try {
  // Never crash on stdout errors (e.g. EPIPE when the reader closed the
  // pipe). Fail-open means exit 0 silently, never a nonzero write crash.
  process.stdout.on('error', function () {});

  // Self-timeout: if stdin never ends (harness bug, unusual spawn), exit 0
  // silently rather than hanging until the harness kills us. The timer is
  // unref'd so it never delays a normal run.
  var stdinTimer = setTimeout(function () {
    process.exit(0);
  }, TIMEOUT_MS);
  if (stdinTimer.unref) stdinTimer.unref();

  var chunks = [];
  var received = 0;
  var overflowed = false;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (chunk) {
    if (overflowed) return;
    received += chunk.length;
    if (received > MAX_STDIN_CHARS) {
      // Keep the prefix up to the bound and stop accumulating: the
      // retained text is still scanned on end (recall-first), while memory
      // stays bounded no matter how large the payload grows.
      overflowed = true;
      chunks.push(chunk.slice(0, chunk.length - (received - MAX_STDIN_CHARS)));
      return;
    }
    chunks.push(chunk);
  });
  process.stdin.on('end', function () {
    clearTimeout(stdinTimer);
    try {
      if (overflowed) {
        // Oversized payload: the truncated input can't JSON.parse, so scan
        // the retained raw prefix directly. Crisis language early in a
        // pathological payload still fires; past the bound is no-match.
        scanAndEmit(normalize(chunks.join('')));
      } else {
        main(chunks.join(''));
      }
    } catch (err) {
      // Fail-open: swallow and fall through to a natural exit 0.
    }
    // No process.exit() here: a pending stdout write (the crisis notice)
    // must be allowed to flush. With stdin ended and the timers handled,
    // the event loop drains and the process exits 0 on its own.
  });
  process.stdin.on('error', function () {
    process.exit(0);
  });
} catch (err) {
  process.exit(0);
}
