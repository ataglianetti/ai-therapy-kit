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

test('tier-1: first-person intensifier, past, and planning forms fire (round-2 F15)', () => {
  assertFires("I'm so suicidal");
  assertFires('I am so suicidal');
  assertFires("I'm feeling really suicidal");
  assertFires("I've never felt this suicidal");
  assertFires('I felt suicidal');
  assertFires('I attempted suicide last year');
  assertFires('attempting suicide');
  assertFires('I am planning my suicide');
  assertFires('planning to kill myself');
  assertFires('I harmed myself last night');
  assertFires('I shot myself on purpose');
});

test('negatives: third-person present-tense crisis reports stay silent (round-2 F16)', () => {
  assertSilent('my brother has been suicidal since the divorce');
  assertSilent("she's been suicidal before");
  assertSilent('he said he was feeling suicidal');
  assertSilent('my friend wants to commit suicide');
  assertSilent('my son keeps thinking about suicide');
  assertSilent('my mom keeps thinking about suicide');
  assertSilent('people who commit suicide often show warning signs');
  assertSilent('an article about teens thinking about suicide');
  assertSilent("if you're feeling suicidal you should call 988");
  assertSilent('his suicidal thoughts scared his wife');
  assertSilent('the documentary was about people committing suicide');
});

test('negatives: third-person want-to-die and overdose recounting stay silent (round-2 F26)', () => {
  assertSilent('my sister wants to die');
  assertSilent('my grandmother overdosed on her medication');
});

test('tier-1: first-person want-to-die and overdose forms still fire (round-2 F26)', () => {
  assertFires('I wanted to die');
  assertFires('I just wanna die');
  assertFires('I overdosed');
  assertFires("I'm going to overdose");
  assertFires('thinking about overdosing');
});

test('negatives: phrasal-verb, idiom, and technical overshoots stay silent (round-2 F17)', () => {
  assertSilent('I checked that task off myself');
  assertSilent('I finished the report off myself');
  assertSilent('I keep shooting myself in the foot at work');
  assertSilent("I don't want to shoot myself in the foot");
  assertSilent("I can't do this presentation");
  assertSilent('we cannot go on vacation like this');
  assertSilent("I can't go on this diet");
  assertSilent("I can't go on and on about it");
  assertSilent('how many kms is the trail');
  assertSilent('the store is a few kms away');
  assertSilent('we use kms for key management');
  assertSilent('our kms activation server is down');
});

test('tier-2: end-of-clause crisis forms still fire (round-2 F17)', () => {
  assertFires("I can't go on");
  assertFires('I cannot go on.');
  assertFires("I can't do this anymore");
  assertFires("I can't go on like this");
  assertFires("I can't take it anymore, everything feels heavy");
});

test('tier-1: volitional, intensifier, take, past, and modal forms fire (round-3 F27)', () => {
  // Volitional gap verbs
  assertFires('I tried to commit suicide last year');
  assertFires('I plan to commit suicide');
  assertFires('I decided to commit suicide');
  assertFires('I intend to commit suicide');
  assertFires('I tried to overdose');
  // Intensifiers, including the profanity register
  assertFires("I'm fucking suicidal");
  assertFires('I feel completely suicidal');
  assertFires("I'm deeply suicidal");
  assertFires("I've been super suicidal lately");
  assertFires("I'm lowkey suicidal");
  assertFires("I'm quite suicidal");
  // Take-forms of the overdose family
  assertFires('I took an overdose of pills last night');
  assertFires("I'm going to take an overdose");
  // Past tail
  assertFires('I almost committed suicide');
  // Off-myself modal allowlist
  assertFires("I'll off myself");
  assertFires('before I off myself');
});

test('tier-1: subjectless first-person forms fire consistently (round-3 F28)', () => {
  assertFires('feeling suicidal again');
  assertFires('been suicidal all week');
  assertFires('planning to commit suicide');
  assertFires('want to commit suicide');
  assertFires('been thinking about committing suicide');
});

test('negatives: third-person-anchored subjectless forms stay silent (round-3 F28)', () => {
  assertSilent('she has been feeling suicidal');
});

test('tier-2: clause anchor handles newlines, continuation, and emoji tails (round-3 F29)', () => {
  assertFires("I can't go on\neverything hurts"); // newline as clause boundary
  assertFires("I can't do this anymore and I'm scared of what I might do");
  assertFires('i cant go on 😢');
});

test('negatives: clause anchor keeps everyday objects silent (round-3 F29)', () => {
  assertSilent("I can't do this presentation");
  assertSilent("can't go on this diet");
  assertSilent("I can't go on and on about it");
});

test('negatives: third-person subject chains and topical suffixes stay silent (round-3 F30)', () => {
  assertSilent('she has suicidal thoughts');
  assertSilent('my son has suicidal thoughts');
  assertSilent("he's having suicidal thoughts");
  assertSilent('my daughter described suicidal thoughts to her counselor');
  assertSilent('the article discussed suicidal ideation in teens');
  assertSilent('patients with suicidal ideation need screening');
  assertSilent('my friend is attempting suicide');
  assertSilent('he is attempting suicide');
  assertSilent('my son keeps thinking about overdosing');
  assertSilent('she planned to kill herself');
  assertSilent('my brother is planning to end it');
  assertSilent('he keeps talking about ending it all');
  assertSilent('my brother wants to end it all');
  assertSilent('my dad wanted to die at the end, in hospice');
  assertSilent('she said she would be better off dead');
  assertSilent('self-harm awareness month');
});

test('tier-1: first-person forms adjacent to the F30 silent class keep firing (round-3 F30)', () => {
  assertFires('having suicidal thoughts');
  assertFires("I've been having suicidal thoughts");
  assertFires('my suicidal thoughts are back');
  assertFires('the suicidal ideation is back');
  assertFires('I want to end it all');
  assertFires('I engage in self-harm');
  // The anti-anchor chain excludes first-person tokens and conjunctions,
  // so an embedded first-person clause survives a third-person prefix.
  assertFires('she knows i want to die');
  assertFires('my mom died and i want to die too');
  assertFires('they said i would be better off dead');
});

test('tier-1: kms grammar composed from the first-person anchor (round-3 F32)', () => {
  assertFires("i've been wanting to kms");
  assertFires("i've been thinking about kms");
  assertFires('i keep wanting to kms');
  assertFires('this week has been awful, kms'); // trailing vent
});

test('negatives: enumeration heads do not read as a first-person subject (round-3 F36)', () => {
  assertSilent('chapter i was about overdose prevention');
  assertSilent('act i was so suicidal in tone');
});

test('tier-1: elided-first-person suicidal thoughts and ideation fire (round-4 F37)', () => {
  assertFires('these suicidal thoughts wont stop');
  assertFires('those suicidal thoughts came back');
  assertFires('constant suicidal thoughts all day');
  assertFires('suicidal thoughts wont stop');
  assertFires('suicidal thoughts again tonight');
  assertFires('recurring suicidal ideation is ruining me');
  assertFires('cant shake these suicidal thoughts');
  assertFires('my head is full of suicidal thoughts');
});

test('tier-1: embedded first-person clauses behind complementizers fire (round-4 F38)', () => {
  assertFires('i told my mom that i want to die');
  assertFires('i hate that i want to die');
  assertFires("i'm scared that i want to die");
  assertFires('i know that i want to die');
  assertFires('the truth is that i want to die');
  assertFires('i told her that i would be better off dead');
  assertFires('i wrote that i plan to end it');
  assertFires('i admitted that i wanted to die');
  assertFires('i realized that i want to die');
  assertFires('no one knows that i want to die');
  assertFires("i finally accepted that i'd be better off dead");
  assertFires('we talked about that\ni want to die');
});

test('tier-1: metonymy, plan, and IFS-parts constructions fire (round-4 F39)', () => {
  assertFires('my plan is to end it all');
  assertFires('the plan is to end it all');
  assertFires('my goal is to end it all');
  assertFires('my decision is to end it all');
  assertFires('my mind wants to end it all');
  assertFires('my body wants to end it all');
  assertFires('my head keeps saying to end it all');
  assertFires('the voices say to end it all');
  assertFires('my part wanted to die');
  assertFires('my brain keeps thinking about overdosing');
});

test('tier-1: means-in-hand statements fire (round-4 F39 addendum)', () => {
  assertFires('i have the pills to end it all');
  assertFires('i bought the rope to end it all');
  assertFires('i wish i had the courage to end it all');
  assertFires('i found a way to end it all');
  assertFires('i have a way to end it all now');
  assertFires('sometimes i get the urge to just end it all');
  assertFires('the urge to end it all is back');
  assertFires('i spent the night thinking about overdosing');
});

test('negatives: third-person det+noun subjects stay silent (round-4 F39)', () => {
  assertSilent('my brother wants to end it all');
  assertSilent('my son wants to die');
});

test('tier-1: first person after everyday nouns fires (round-4 F40)', () => {
  assertFires('after class i was so suicidal');
  assertFires('in class i was so suicidal today');
  assertFires("at this stage i'm honestly suicidal");
  assertFires('at this stage i am really suicidal');
  assertFires('at some level i am suicidal');
  assertFires('during the war i was suicidal');
  assertFires('last season i was really suicidal');
  assertFires("in class i've been thinking about suicide");
  assertFires("since the war i've been thinking about suicide");
});

test('tier-1: first-person-plural we-forms fire (round-4 F41, PM ruling)', () => {
  assertFires('we want to die');
  assertFires("we'd be better off dead");
});

test('negatives: generic-you venting stays silent (round-4 F41, PM ruling)', () => {
  assertSilent('sometimes you just want to die');
  assertSilent("if you're feeling suicidal you should call 988");
});

test('negatives: third-person adverb chains and contractions stay silent (round-4 F42)', () => {
  assertSilent('my brother has honestly been suicidal');
  assertSilent('my daughter is genuinely feeling suicidal');
  assertSilent('my son has actually been feeling suicidal');
  assertSilent('she is basically planning to commit suicide');
  assertSilent("they've been thinking about overdosing");
  assertSilent('my best friend is attempting suicide');
  assertSilent('she said she wanna die');
});

test('tier-1: subjectless thinking-about-suicide fires (round-4 F43)', () => {
  assertFires('been thinking about suicide a lot');
  assertFires('thinking about suicide again');
});

test('negatives: subject-bearing thinking-about-suicide stays silent (round-4 F43)', () => {
  assertSilent('he is thinking about suicide');
});

test('negatives: topical take-overdose forms stay silent (round-4 F44)', () => {
  assertSilent("i'm taking an overdose prevention course");
  assertSilent('i took an overdose call at work today');
});

test('tier-1: real take-overdose forms keep firing (round-4 F44)', () => {
  assertFires('I took an overdose of pills last night');
  assertFires('I took an overdose');
});

test('tier-1: self-harm split across space+newline fires (round-4 F46)', () => {
  assertFires('self \nharm');
  assertFires('self\n harm');
  assertFires('i keep thinking about self \n harm');
  assertFires('self\nharm');
});

test('tier-1: overdose with help-imperative or idiom tail fires (round-5 F47)', () => {
  assertFires('i overdosed call 911');
  assertFires('i took an overdose call an ambulance');
  assertFires("i'm going to overdose call someone please");
  assertFires('im gonna overdose call someone please');
  assertFires('been wanting to overdose call me weak');
  assertFires('i want to overdose call it what you want');
  assertFires('i might overdose call me crazy');
});

test('tier-1: struggle/deal/live-with idioms and modified suicidal thoughts fire (round-5 F48)', () => {
  assertFires("i'm struggling with suicidal thoughts");
  assertFires('i struggle with suicidal thoughts');
  assertFires("i'm dealing with suicidal thoughts");
  assertFires("i've been living with suicidal thoughts for years");
  assertFires("i've been dealing with suicidal ideation");
  assertFires('struggling with suicidal thoughts');
  assertFires('living with suicidal ideation is exhausting');
  assertFires('my intrusive suicidal thoughts are back');
  assertFires('the constant suicidal thoughts wont stop');
  assertFires('my recurring suicidal ideation is ruining me');
});

test('negatives: professional/topical and third-person with-forms stay silent (round-5 F48)', () => {
  assertSilent('an article about suicidal ideation in teens');
  assertSilent('he is struggling with suicidal thoughts');
  assertSilent('my brother struggles with suicidal thoughts');
  assertSilent("she's been dealing with suicidal ideation");
  assertSilent('shes been dealing with suicidal ideation');
  assertSilent('hes struggling with suicidal thoughts');
  assertSilent('teens who struggle with suicidal ideation need help');
  assertSilent('a person with suicidal ideation should get help');
});

test('negatives: third-person possessive self-noun constructions stay silent (round-5 F49)', () => {
  assertSilent('his plan is to end it all');
  assertSilent('their goal is to end it all');
  assertSilent('her mind wants to end it all');
  assertSilent('their part wanted to die');
  assertSilent('his urge to end it all is back');
  assertSilent('she said her goal is to end it all');
  assertSilent('the voices in his head say to end it all');
});

test('tier-1: first-person/neutral self-noun constructions keep firing (round-5 F49)', () => {
  assertFires('my plan is to end it all');
  assertFires('the urge to end it all is back');
  assertFires('our plan is to end it all');
});

test('tier-1: concatenated selfharm fires; blank-line stitching stays silent (round-5 F50)', () => {
  assertFires('i keep thinking about selfharm');
  assertFires('selfharm again tonight');
  assertSilent('my old self\n\nharm reduction is the topic at work');
  assertSilent('self-harm awareness month');
});

test('tier-1: apostrophe-less first-person clause rescue fires (round-5 F51)', () => {
  assertFires('ive got the pills to end it all');
  assertFires('im holding the pills to end it all');
});

test('negatives: adjacent pronoun-possessive thoughts stay silent (round-6 F53 / round-8 F58)', () => {
  // The only possessive-of-other guard left after the PM asymmetric-close
  // ruling (2026-07-05): his/her/their/your immediately before the keyword.
  assertSilent('her suicidal ideation');
  assertSilent('their suicidal thoughts');
  // round-8 F66: `your` had no fixture; the guard covers it via TP_DET_THIRD.
  assertSilent('your suicidal thoughts');
});

test('tier-1: first-person forms behind the removed round-6 guards fire (round-8 F57/F58)', () => {
  // F57: the bare-s/genitive lookbehind silenced these (s-ending word
  // right before the keyword). Guard removed — must fire.
  assertFires('i have serious suicidal thoughts');
  assertFires("i'm having serious suicidal thoughts");
  assertFires('i keep having anxious suicidal thoughts');
  assertFires('my depression causes suicidal thoughts');
  assertFires('my anxiety triggers suicidal thoughts constantly');
  assertFires('the panic attacks suicidal thoughts insomnia are all back');
  assertFires('ever since starting these meds suicidal thoughts have gotten worse');
  assertFires('as suicidal thoughts take over i cant function');
  // F58: the pronoun-gap guard swallowed object-pronoun her/your inside
  // first-person clauses. Reverted to immediate adjacency — must fire.
  assertFires("i can't tell her these suicidal thoughts are getting worse");
  assertFires('i never told her the suicidal thoughts got this bad');
  assertFires('since i lost her the suicidal thoughts came back');
  assertFires('i lied to her about the suicidal thoughts');
  // round-8 F63: the retained adjacency guard used bare `\s`, which matched
  // a newline and read "her\nsuicidal" as a possessive across a clause
  // boundary normalize() preserves. Fixed to `[^\S\n]` — these fire.
  assertFires('i cant tell her\nsuicidal thoughts are getting worse');
  assertFires('i cant tell her\nthese suicidal thoughts are getting worse');
  assertFires('i talked to her about suicidal thoughts i keep having');
});

test('tier-1: genitive and modified-possessive over-fires accepted (round-8 F57/F58)', () => {
  // accepted over-fire per PM asymmetric-close ruling 2026-07-05 — Plan-2
  // eval candidate (each fixture below was a round-6 must-silent; the
  // guards that silenced them also silenced first-person crisis phrases).
  assertFires("my brother's suicidal thoughts scare me");
  assertFires('my sons suicidal ideation worries me so much');
  assertFires("my mom's suicidal thoughts scare me");
  assertFires("her coworker's suicidal thoughts came up at work");
  assertFires("my daughter's suicidal ideation is getting worse");
  assertFires('the patients suicidal ideation worsened overnight');
  assertFires('his intrusive suicidal thoughts scare his wife');
  assertFires('her constant suicidal ideation worries me');
  assertFires('their recurring suicidal thoughts need treatment');
});

test('tier-1: first-person possessive and elided-determiner forms keep firing (round-6 F53)', () => {
  assertFires('my intrusive suicidal thoughts are back');
  assertFires('the constant suicidal thoughts wont stop');
  assertFires('my suicidal thoughts are back');
  assertFires('these suicidal thoughts wont stop');
  assertFires('our suicidal thoughts are back');
  // s-ending modifiers fire (the round-6 genitive lookbehind is gone —
  // round-8 F57; these pins now guard against its reintroduction).
  assertFires('my relentless suicidal thoughts are back');
  assertFires('some nights suicidal thoughts take over');
  assertFires('this suicidal ideation is destroying me');
});

test('tier-1: overdose help imperatives with kinship, service, and bare tails fire (round-6 F54)', () => {
  assertFires('i overdosed call mom');
  assertFires('i overdosed call dad please');
  assertFires('im going to overdose call mom please');
  assertFires('i overdosed call poison control');
  assertFires('i overdosed call police');
  assertFires('i overdosed call emergency services');
  assertFires('i overdosed call for help');
  assertFires('i overdosed call for an ambulance');
  assertFires('i overdosed call now');
});

test('negatives: professional overdose-call continuations stay silent (round-6 F54 / round-8 F59)', () => {
  // Boundary of the narrowed blocklist: bare preposition/adverb and
  // compound-noun continuations only. (round-8 F66: the byte-duplicate
  // "at work today" pin removed — kept the round-4 F44 original.)
  assertSilent('i handled an overdose call yesterday');
  assertSilent('the overdose call center is hiring');
});

test('tier-1: first-person overdose imperatives behind stripped blocklist tokens fire (round-8 F62)', () => {
  // PM option-A ruling (2026-07-05): the surviving blocklist tokens
  // during|while|today|tonight|once|every silenced first-person overdose
  // imperatives. Stripped — these must fire.
  assertFires('i overdosed call every hotline');
  assertFires('gonna overdose call every friend i have');
  assertFires('i overdosed call once you get this');
  assertFires('im overdosing call tonight please');
  assertFires('i overdosed call today or itll be too late');
  assertFires('i overdosed call during the night if you want');
  assertFires('i overdosed call while you still can');
  // The pinned professional silents that survive the strip (at/yesterday/
  // cent) stay covered by the round-4 F44 and round-8 F59 negative tests
  // above — not re-pinned here to avoid the byte-duplicates F66 removed.
});

test('tier-1: determiner-led overdose-call continuations fire (round-8 F59)', () => {
  // The round-6 determiner+time-noun blocklist branch swallowed help
  // imperatives (the F47 shape again). Branch removed — must fire.
  assertFires('i overdosed call the night nurse');
  assertFires('im overdosing call the morning nurse');
  assertFires('gonna overdose call the other hotline');
  assertFires("i'm going to overdose call the other number if no one answers");
  assertFires('i overdosed call a couple friends');
  // accepted over-fire per PM asymmetric-close ruling 2026-07-05 — Plan-2
  // eval candidate (round-6 must-silents that shared the removed branch).
  assertFires('i took an overdose call an hour into my shift');
  assertFires('i took an overdose call the other day at work');
  assertFires('i take overdose calls a lot at work');
});

test('tier-1: first-person clauses behind professional with-heads fire (round-6 F55)', () => {
  assertFires("i'm one of those people struggling with suicidal thoughts");
  assertFires('as someone dealing with suicidal thoughts i need help');
  assertFires('im one of those people living with suicidal ideation');
  // accepted over-fire per PM asymmetric-close ruling 2026-07-05 — Plan-2
  // eval candidate (F60: clause rescue fires professional first-person
  // framing; as-carve-out fires descriptive "as people with" apposition).
  assertFires('i see patients with suicidal ideation every day at work');
  assertFires('as people with suicidal ideation know recovery is not linear');
});

test('negatives: subjectless professional/topical with-forms stay silent (round-6 F55)', () => {
  // Boundary of the clause rescue: no first-person token in the clause.
  assertSilent('patients with suicidal ideation need screening');
  assertSilent('teens who struggle with suicidal thoughts');
  assertSilent('people with suicidal thoughts deserve support');
  assertSilent('so many people struggle with suicidal thoughts');
});

// Extract a word-class declaration from the hook source and return its
// alternation members as a plain array ("var NAME = 'a|b' + '|c';" → [a,b,c]).
function wordClass(hookSource, name) {
  const decl = hookSource.match(new RegExp(`var ${name} =[\\s\\S]*?;`));
  assert.ok(decl, `${name} declaration found in hook source`);
  const joined = (decl[0].match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g) || [])
    .map((s) => s.slice(1, -1))
    .join('');
  const words = joined
    .replace(/\\\\[a-z]\+?|\(\?:|\)|\{\d+(?:,\d+)?\}/g, '')
    .split('|')
    .filter(Boolean);
  // Guard the extraction itself (round-5 F52): a refactor that changes the
  // declaration shape must fail loudly here, not vacuously pass the
  // membership checks below on an empty list.
  assert.ok(words.length > 0, `${name} extraction produced at least one word`);
  return words;
}

test('FP_GAP membership guard: dropping a gap word breaks the suite (round-3 F36)', () => {
  // Source-level guard: every closed-class gap word the matcher depends on
  // must stay reachable through the FP_GAP composite (fillers + the shared
  // ADVERBS class). A behavioral phrase per family lives in the F27/F28
  // tests; this catches a silently dropped word.
  const hookSource = readFileSync(HOOK_PATH, 'utf8');
  const gapWords = new Set([
    ...wordClass(hookSource, 'FP_GAP_FILLERS'),
    ...wordClass(hookSource, 'ADVERBS')
  ]);
  const required = [
    // auxiliaries / progressives
    'am', 'been', 'being', 'have', 'having', 'feel', 'feeling', 'keep',
    'going', 'gonna', 'thinking', 'almost',
    // volitional verbs (round-3 F27)
    'tried', 'try', 'trying', 'plan', 'plans', 'planned', 'planning',
    'decided', 'decide', 'intend', 'hoping', 'hope', 'wanting',
    // take-forms (round-3 F27)
    'take', 'took', 'taking', 'taken',
    // intensifiers incl. profanity register (round-3 F27)
    'fucking', 'freaking', 'goddamn', 'damn', 'completely', 'totally',
    'deeply', 'seriously', 'dangerously', 'quite', 'super', 'real',
    'really', 'lowkey', 'low-key', 'hella'
  ];
  for (const word of required) {
    assert.ok(gapWords.has(word), `FP_GAP is missing gap word: ${word}`);
  }
});

test('word-class drift guard: shared adverbs, SL_HEAD subset, chain exclusions (round-4 F45)', () => {
  const hookSource = readFileSync(HOOK_PATH, 'utf8');

  // Both grammars must consume the single shared ADVERBS constant — the
  // drift this prevents is an adverb landing in one class but not the
  // other ("i'm honestly suicidal" firing while "my brother has honestly
  // been suicidal" also fires).
  const fpGapDecl = hookSource.match(/var FP_GAP =[\s\S]*?;/);
  const tpChainDecl = hookSource.match(/var TP_CHAIN =[\s\S]*?;/);
  assert.ok(fpGapDecl && /\bADVERBS\b/.test(fpGapDecl[0]), 'FP_GAP consumes ADVERBS');
  assert.ok(
    fpGapDecl && /\bFP_GAP_FILLERS\b/.test(fpGapDecl[0]),
    'FP_GAP consumes FP_GAP_FILLERS'
  );
  assert.ok(tpChainDecl && /\bADVERBS\b/.test(tpChainDecl[0]), 'TP_CHAIN consumes ADVERBS');

  // Round-5 F51: the third-person clause rescue must recognize the same
  // first-person tokens FP_HEAD accepts — both sides derive from the
  // shared FP_SUFFIX constant, consumed via FP_TOKEN in tpBlock().
  const fpHeadDecl = hookSource.match(/var FP_HEAD =[\s\S]*?;/);
  assert.ok(fpHeadDecl && /\bFP_SUFFIX\b/.test(fpHeadDecl[0]), 'FP_HEAD consumes FP_SUFFIX');
  const fpTokenDecl = hookSource.match(/var FP_TOKEN =[\s\S]*?;/);
  assert.ok(fpTokenDecl && /\bFP_SUFFIX\b/.test(fpTokenDecl[0]), 'FP_TOKEN consumes FP_SUFFIX');
  const tpBlockFn = hookSource.match(/function tpBlock[\s\S]*?\n\}/);
  assert.ok(tpBlockFn && /\bFP_TOKEN\b/.test(tpBlockFn[0]), 'tpBlock clause rescue consumes FP_TOKEN');

  // Every subjectless head must be absorbable as a first-person gap filler
  // ("i have been feeling suicidal" needs FP_GAP to cross what SL_HEAD
  // anchors on when the subject is present).
  const gapWords = new Set([
    ...wordClass(hookSource, 'FP_GAP_FILLERS'),
    ...wordClass(hookSource, 'ADVERBS')
  ]);
  for (const head of wordClass(hookSource, 'SL_HEAD')) {
    assert.ok(gapWords.has(head), `SL_HEAD word not in FP_GAP classes: ${head}`);
  }

  // The third-person chain must never absorb a first-person token — that
  // is the invariant that lets "she knows i want to die" keep firing. And
  // per the recorded F41 ruling, first-person-plural we-forms fire, so no
  // we-form may appear in the chain or the pronoun class.
  const chainWords = new Set([
    ...wordClass(hookSource, 'TP_CHAIN_LINKS'),
    ...wordClass(hookSource, 'ADVERBS')
  ]);
  const pronWords = new Set(wordClass(hookSource, 'TP_PRON'));
  const firstPerson = [
    'i', "i'm", "i've", "i'd", "i'll", 'im', 'ive', 'me', 'my', 'myself',
    'we', "we're", "we'd", "we've", "we'll"
  ];
  for (const token of firstPerson) {
    assert.ok(!chainWords.has(token), `TP_CHAIN must not absorb: ${token}`);
    assert.ok(!pronWords.has(token), `TP_PRON must not include: ${token}`);
  }
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

test('T-005/T-006 tuning guards: measured idiom/transactional silent, crisis adjacents fire (crisis-eval-precision)', () => {
  // T-A (retreated, T-006): ONLY "of embarrassment" + clause-end/benign
  // continuation is silent...
  assertSilent('ugh, I want to die of embarrassment after that presentation');
  assertSilent('i wanna die of embarrassment');
  assertSilent('I want to die of embarrassment.');
  // ...while adjacent first-person crisis forms keep firing — including the
  // round-1 F1 live-proven composites (shame is NOT an unambiguous idiom)
  // and unknown continuations after the listed noun (F2 suffix bounding).
  assertFires('I want to die');
  assertFires('I want to die tonight');
  assertFires('honestly i wanna die');
  assertFires('I want to die of grief');
  assertFires('I want to die of shame');
  assertFires('I want to die of shame. I have a plan.');
  assertFires('I want to die of shame for what I did and I am going to end it');
  assertFires('I want to die of embarrassment and I mean it');
  assertFires('I want to die of boredom');
  // T-B (retreated, T-006): ONLY clause-final "of <det> contract/lease" is
  // silent...
  assertSilent('I read the lease again and there is no way out of this contract');
  assertSilent('there is no way out of the lease');
  // ...while bare forms, despair continuations, unmeasured nouns, and
  // crisis continuations after a listed noun keep firing (round-1 F2/F3).
  assertFires('there is no way out');
  assertFires('I feel trapped, no way out.');
  assertFires('there is no way out of this life');
  assertFires('no way out of this pain');
  assertFires('there is no way out of this meeting alive');
  assertFires('no way out of the deal I made with myself to keep living');
  assertFires('there is no way out of this meeting');
});

test('T-008 run-bounded guards: mid-message punctuation is a connector, not a clause end (round-2 F17/F18)', () => {
  // F17: punctuation composites must fire — a comma/period/ellipsis does
  // not terminate the idiom reading; distressed typing connects clauses.
  assertFires('I want to die of embarrassment, i am not joking');
  assertFires('I want to die of embarrassment. I have a plan.');
  assertFires('I want to die of embarrassment... and I mean it this time');
  assertFires('I want to die of embarrassment! I really do.');
  assertFires('I want to die of embarrassment, and this time i have the pills');
  assertFires('I want to die of embarrassment, tonight');
  assertFires('there is no way out of this contract, i am done with everything');
  assertFires('no way out of this lease: my life');
  assertFires('no way out of the contract of my life');
  // F18: despair-rationale/frequency continuation tokens were dropped;
  // first-person tokens inside a benign continuation break the guard.
  assertFires('I want to die of embarrassment because nothing matters anymore');
  assertFires('I want to die of embarrassment every single day and I might actually do it');
  assertFires('I want to die of embarrassment about how i am going to end it');
  assertFires('I want to die of embarrassment after i take all these pills');
  // The measured-envelope silents still hold: clean benign run to
  // end-of-message only.
  assertSilent('ugh, I want to die of embarrassment after that presentation');
  assertSilent('I want to die of embarrassment about that email');
  assertSilent('there is no way out of this contract.');
});

test('T-008 recall addition: going-to end-it declaration fires (round-2 F19)', () => {
  // "i am going to end it" matched nothing — a violation of the
  // asymmetric-close ruling. First-person forms fire...
  assertFires('i am going to end it');
  assertFires('im gonna end it');
  assertFires("I'm going to end it tonight");
  // ...third-person reports stay silent (tp anti-anchor)...
  assertSilent('she said she is going to end it');
  assertSilent('my brother is going to end it');
  // ...and breakup phrasing over-fires by design (over-fire side of the
  // ruling; no "with"-guard because "end it with pills" is method
  // language). Measured + gate-locked in the eval corpus.
  assertFires('I am going to end it with my boyfriend');
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

test('oversized stdin: crisis language in the first 4MB still fires (round-4 F45)', () => {
  // Past the stdin buffer bound the hook stops accumulating but scans the
  // retained prefix raw (truncated JSON can't parse) — crisis language
  // early in a pathological payload is not discarded with the overflow.
  const big = JSON.stringify({
    prompt: 'I want to die ' + 'a'.repeat(5 * 1024 * 1024)
  });
  const { status, stdout } = runHook(big);
  assert.equal(status, 0);
  const parsed = parseEnvelope(stdout, 'oversized crisis-early');
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('988'));
});

test('fail-open: crisis language past the 4MB bound exits 0 silently (round-2 F25 / round-4 F45)', () => {
  // Beyond the bound the payload is treated as no-match — memory stays
  // bounded and the exit is 0 no matter how large the payload grows.
  const big = JSON.stringify({
    prompt: 'a'.repeat(5 * 1024 * 1024) + ' I want to die'
  });
  const { status, stdout } = runHook(big);
  assert.equal(status, 0);
  assert.equal(stdout, '');
});

test('match path: exits promptly even when stdout is never read (round-2 F25)', async () => {
  // The flush guard must not leave the process hangable on a stdout pipe
  // nobody drains: the write callback (or the guard timer) ends the run.
  const child = spawn(process.execPath, [HOOK_PATH], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  child.stdin.on('error', () => {});
  child.stdout.pause(); // never consume the child's stdout
  child.stdin.end(JSON.stringify({ prompt: 'I want to die' }));
  const start = Date.now();
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
  assert.ok(Date.now() - start < 8000, 'exited without hanging');
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
  // uppercase character in any pattern can never match. Guard the
  // convention across both regex literals and the string-composed
  // first-person patterns (ADVERBS / FP_HEAD / FP_GAP / fp() tails).
  const hookSource = readFileSync(HOOK_PATH, 'utf8');
  const m = hookSource.match(
    /var ADVERBS[\s\S]*?var TIER2_PATTERNS = \[[\s\S]*?\];/
  );
  assert.ok(m, 'pattern definition region found in hook source');
  // Strip whole-line comments so prose casing does not trip the check.
  const region = m[0].replace(/^\s*\/\/.*$/gm, '');
  const literals = region.match(/\/(?:[^/\\\n]|\\.)+\//g) || [];
  const strings =
    region.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g) || [];
  const sources = [...literals, ...strings];
  assert.ok(
    sources.length >= 40,
    `expected to extract pattern sources, got ${sources.length}`
  );
  for (const src of sources) {
    // Regex metacharacter shorthands are case-significant and can never
    // match a literal character, so their uppercase forms (\S \D \W \B) are
    // exempt — e.g. the `[^\S\n]` idiom normalize() uses (round-8 F63).
    const scrub = src.replace(/\\[SDWB]/g, '');
    assert.equal(scrub, scrub.toLowerCase(), `pattern source is not lowercase: ${src}`);
  }
});

test('version marker: hook carries a parseable version comment', () => {
  const hookSource = readFileSync(HOOK_PATH, 'utf8');
  const m = hookSource.match(/<!--\s*version:\s*([^\s>-]+)\s*-->/);
  assert.ok(m, 'version marker present');
  assert.equal(m[1], '1.0.0');
});
