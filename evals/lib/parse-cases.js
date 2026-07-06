// Zero-dependency, stdlib-only parser for the crisis-eval case-file format.
//
// This is NOT a general YAML parser. It accepts a deliberately small, fixed
// subset that matches exactly one document shape (see evals/cases/SCHEMA.md):
//   - top-level scalar entries:  `id: ...`, `category: ...`
//   - a top-level block list:    `messages:` then `- ...` items
//   - one `expect:` block containing three block lists:
//       must_include, must_not_include, rubric_gates
//
// Anything outside that shape throws a descriptive Error naming the offending
// line and field. No flow syntax, anchors, multi-doc, or inline comments —
// only full-line `#` comments and blank lines are tolerated.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Category enum. 1/2/5 are active for this plan; 3/4/6 are reserved (accepted
// by the parser but unused). Meanings documented in evals/cases/SCHEMA.md.
const ACTIVE_CATEGORIES = [1, 2, 5];
const RESERVED_CATEGORIES = [3, 4, 6];
const VALID_CATEGORIES = [...ACTIVE_CATEGORIES, ...RESERVED_CATEGORIES];

const TOP_LEVEL_KEYS = ['id', 'category', 'messages', 'expect'];
// `fires` is the only scalar under `expect`; the other three are block lists.
const EXPECT_KEYS = ['must_include', 'must_not_include', 'rubric_gates', 'fires'];

// Detect the indentation of a raw line (spaces only; tabs are rejected).
function indentOf(rawLine) {
  const m = rawLine.match(/^( *)/);
  return m[1].length;
}

// Strip a single layer of matching quotes and return the literal string.
// Leaves unquoted scalars as trimmed text. Throws on an unterminated quote.
function parseScalar(raw, lineNo) {
  const value = raw.trim();
  if (value.length === 0) {
    throw new Error(`Line ${lineNo}: expected a value but found empty scalar`);
  }
  const first = value[0];
  if (first === '"' || first === "'") {
    if (value.length < 2 || value[value.length - 1] !== first) {
      throw new Error(
        `Line ${lineNo}: unterminated ${first === '"' ? 'double' : 'single'} quote`,
      );
    }
    return value.slice(1, -1);
  }
  return value;
}

// Split a line into [key, rest] at the first colon that is not inside quotes.
// Returns null when the line has no top-level colon (e.g. a list item).
function splitKey(raw) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === ':' && !inSingle && !inDouble) {
      return [raw.slice(0, i).trim(), raw.slice(i + 1)];
    }
  }
  return null;
}

// Pre-pass: drop blank lines and full-line comments, reject tabs, and keep the
// original 1-based line numbers so errors point at the source file.
function tokenize(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;
    if (raw.includes('\t')) {
      throw new Error(`Line ${lineNo}: tabs are not allowed; use spaces`);
    }
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    out.push({ lineNo, raw, indent: indentOf(raw), trimmed });
  }
  return out;
}

// Consume a block list ("- item" lines) that follows a `key:` header. `parent`
// is the header token; items must be indented strictly more than the header.
// Returns { items, next } where next is the index after the last consumed item.
function readBlockList(tokens, start, parent) {
  const items = [];
  let i = start;
  // The first item fixes the list's indent; every sibling must match it. This
  // mirrors the `baseIndent` equality check parseExpectBlock uses for keys.
  let itemIndent = null;
  while (i < tokens.length && tokens[i].indent > parent.indent) {
    const tok = tokens[i];
    if (itemIndent === null) {
      itemIndent = tok.indent;
    } else if (tok.indent !== itemIndent) {
      throw new Error(
        `Line ${tok.lineNo}: inconsistent list-item indentation under "${parent.key}" (expected ${itemIndent} spaces, got ${tok.indent})`,
      );
    }
    const body = tok.trimmed;
    if (!body.startsWith('-')) {
      throw new Error(
        `Line ${tok.lineNo}: expected a list item ("- ...") under "${parent.key}"`,
      );
    }
    const itemRaw = body.slice(1);
    if (splitKey(itemRaw) && !/^\s*['"]/.test(itemRaw)) {
      // A "- key: value" line would be a nested mapping — not in the subset.
      throw new Error(
        `Line ${tok.lineNo}: nested mappings inside lists are not supported`,
      );
    }
    items.push(parseScalar(itemRaw, tok.lineNo));
    i++;
  }
  if (items.length === 0) {
    throw new Error(
      `Line ${parent.lineNo}: list "${parent.key}" has no items — list items must be indented more than the key`,
    );
  }
  return { items, next: i };
}

function assertStringList(value, field, lineNo) {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new Error(`Line ${lineNo}: "${field}" must be a list of strings`);
  }
}

/**
 * Parse case-file text into a case object.
 * @param {string} text
 * @returns {{id: string, category: number, messages: string[], expect: {must_include: string[], must_not_include: string[], rubric_gates: string[], fires?: boolean}}}
 */
export function parseCase(text) {
  if (typeof text !== 'string') {
    throw new Error('parseCase expects a string');
  }
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    throw new Error('Empty case file: no fields found');
  }

  const result = {};
  const seen = new Set();
  let i = 0;

  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok.indent !== 0) {
      throw new Error(
        `Line ${tok.lineNo}: unexpected indentation at top level`,
      );
    }
    const split = splitKey(tok.raw);
    if (!split) {
      throw new Error(`Line ${tok.lineNo}: expected "key: value" at top level`);
    }
    const [key, rest] = split;
    if (!TOP_LEVEL_KEYS.includes(key)) {
      throw new Error(
        `Line ${tok.lineNo}: unknown top-level key "${key}" (allowed: ${TOP_LEVEL_KEYS.join(', ')})`,
      );
    }
    if (seen.has(key)) {
      throw new Error(`Line ${tok.lineNo}: duplicate top-level key "${key}"`);
    }
    seen.add(key);

    if (key === 'id') {
      result.id = parseScalar(rest, tok.lineNo);
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(result.id)) {
        throw new Error(
          `Line ${tok.lineNo}: "id" must match [A-Za-z0-9][A-Za-z0-9._-]* (got "${result.id}")`,
        );
      }
      i++;
    } else if (key === 'category') {
      const scalar = parseScalar(rest, tok.lineNo);
      if (!/^-?\d+$/.test(scalar)) {
        throw new Error(`Line ${tok.lineNo}: "category" must be an integer`);
      }
      const num = Number(scalar);
      if (!VALID_CATEGORIES.includes(num)) {
        throw new Error(
          `Line ${tok.lineNo}: "category" ${num} is out of enum (allowed: ${VALID_CATEGORIES.join(', ')})`,
        );
      }
      result.category = num;
      i++;
    } else if (key === 'messages') {
      if (rest.trim() !== '') {
        throw new Error(
          `Line ${tok.lineNo}: "messages" must be a block list, not an inline value`,
        );
      }
      const { items, next } = readBlockList(tokens, i + 1, {
        ...tok,
        key,
      });
      result.messages = items;
      i = next;
    } else if (key === 'expect') {
      if (rest.trim() !== '') {
        throw new Error(
          `Line ${tok.lineNo}: "expect" must be a nested block, not an inline value`,
        );
      }
      const parsed = parseExpectBlock(tokens, i + 1, tok);
      result.expect = parsed.expect;
      i = parsed.next;
    }
  }

  // Required-field validation.
  if (result.id === undefined) throw new Error('Missing required field: "id"');
  if (result.category === undefined) {
    throw new Error('Missing required field: "category"');
  }
  if (result.messages === undefined) {
    throw new Error('Missing required field: "messages"');
  }
  assertStringList(result.messages, 'messages', 1);
  if (result.expect === undefined) {
    throw new Error('Missing required field: "expect"');
  }
  return result;
}

// Parse the nested block under `expect:`. Returns { expect, next }.
function parseExpectBlock(tokens, start, header) {
  const expect = {
    must_include: [],
    must_not_include: [],
    rubric_gates: [],
  };
  const seen = new Set();
  let i = start;

  // Every line in the block must be indented more than `expect:`.
  const baseIndent = i < tokens.length ? tokens[i].indent : 0;
  if (i >= tokens.length || tokens[i].indent <= header.indent) {
    throw new Error(
      `Line ${header.lineNo}: "expect" block is empty; "rubric_gates" is required`,
    );
  }

  while (i < tokens.length && tokens[i].indent > header.indent) {
    const tok = tokens[i];
    if (tok.indent !== baseIndent) {
      throw new Error(
        `Line ${tok.lineNo}: inconsistent indentation inside "expect" block`,
      );
    }
    const split = splitKey(tok.raw);
    if (!split) {
      throw new Error(
        `Line ${tok.lineNo}: expected "key:" inside "expect" block`,
      );
    }
    const [key, rest] = split;
    if (!EXPECT_KEYS.includes(key)) {
      throw new Error(
        `Line ${tok.lineNo}: unknown key "${key}" inside "expect" (allowed: ${EXPECT_KEYS.join(', ')})`,
      );
    }
    if (seen.has(key)) {
      throw new Error(
        `Line ${tok.lineNo}: duplicate key "${key}" inside "expect"`,
      );
    }
    seen.add(key);
    if (key === 'fires') {
      // `fires` is an optional scalar (yes/no/true/false) → JS boolean.
      const scalar = parseScalar(rest, tok.lineNo).toLowerCase();
      if (scalar === 'yes' || scalar === 'true') {
        expect.fires = true;
      } else if (scalar === 'no' || scalar === 'false') {
        expect.fires = false;
      } else {
        throw new Error(
          `Line ${tok.lineNo}: "fires" must be yes/no (or true/false), got "${scalar}"`,
        );
      }
      i++;
      continue;
    }
    if (rest.trim() !== '') {
      throw new Error(
        `Line ${tok.lineNo}: "${key}" must be a block list, not an inline value`,
      );
    }
    const { items, next } = readBlockList(tokens, i + 1, {
      ...tok,
      key,
    });
    expect[key] = items;
    i = next;
  }

  if (!seen.has('rubric_gates')) {
    throw new Error(
      `Line ${header.lineNo}: "expect" is missing required field "rubric_gates"`,
    );
  }
  return { expect, next: i };
}

/**
 * Read and parse a case file from disk.
 * @param {string} filePath
 * @returns {object}
 */
export function parseFile(filePath) {
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read ${filePath}: ${err.message}`);
  }
  try {
    return parseCase(text);
  } catch (err) {
    // Prefix the file path so --check output is actionable.
    throw new Error(`${filePath}: ${err.message}`);
  }
}

// --check CLI: `node evals/lib/parse-cases.js <paths...>`
// Parses each path, prints OK/error per file, exits non-zero on any failure.
function runCheck(paths) {
  if (paths.length === 0) {
    process.stderr.write(
      'usage: node evals/lib/parse-cases.js --check <file...>\n',
    );
    process.exit(2);
  }
  let failures = 0;
  for (const p of paths) {
    try {
      parseFile(p);
      process.stdout.write(`OK   ${p}\n`);
    } catch (err) {
      failures++;
      process.stdout.write(`FAIL ${err.message}\n`);
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

// Entry point when run directly (ESM-safe main check).
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const paths = args.filter((a) => a !== '--check');
  runCheck(paths);
}
