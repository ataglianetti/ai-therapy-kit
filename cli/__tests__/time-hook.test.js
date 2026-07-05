// Tests for the time hook shipped in claude-settings.template.json.
// Repo rule (docs/execution/CLAUDE_ORCHESTRATION_GUIDE.md): anything shipped
// to user installs must be Node, never bash — cross-platform Mac + Windows.
// These tests enforce that rule mechanically so a bash `date` command can't
// sneak back in, and verify the hook's actual output shape by executing it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'claude-settings.template.json'
);

function loadHookCommands() {
  const settings = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8'));
  const commands = [];
  for (const matchers of Object.values(settings.hooks || {})) {
    for (const matcher of matchers) {
      for (const hook of matcher.hooks || []) {
        if (hook.type === 'command') commands.push(hook.command);
      }
    }
  }
  return commands;
}

test('template parses and registers a UserPromptSubmit command hook', () => {
  const settings = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8'));
  assert.ok(settings.hooks.UserPromptSubmit, 'UserPromptSubmit hook missing');
  assert.ok(loadHookCommands().length > 0, 'no command hooks found');
});

test('every shipped hook command is Node, never a shell built-in', () => {
  for (const command of loadHookCommands()) {
    // Two shapes ship: shell form (`node -e "..."`, args in the string) and
    // exec form (`command: "node"` with the script path in a separate `args`
    // array — spawned without a shell). Both must invoke node, so allow bare
    // `node` as well as `node <args>`; still rejects `date`/`sh`/builtins.
    assert.match(
      command,
      /^node(\.exe)?(\s|$)/,
      `hook command must invoke node (cross-platform rule): ${command}`
    );
  }
});

test('hook commands avoid characters that differ between sh and cmd.exe', () => {
  // The command string is executed by /bin/sh on Mac and cmd.exe on Windows.
  // Inside double quotes, sh expands $ and backslash escapes; cmd.exe expands
  // %VAR% regardless of quoting. Banning these keeps one string valid on both.
  for (const command of loadHookCommands()) {
    for (const forbidden of ['$', '`', '\\', '%']) {
      assert.ok(
        !command.includes(forbidden),
        `hook command contains ${JSON.stringify(forbidden)}, which is not portable between sh and cmd.exe: ${command}`
      );
    }
  }
});

test('time hook emits valid UserPromptSubmit JSON with a local timestamp', () => {
  const [command] = loadHookCommands();
  const stdout = execSync(command, { encoding: 'utf8', timeout: 10_000 });
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(
    parsed.hookSpecificOutput.additionalContext,
    /^Current local time: \d{2}:\d{2} \S+, [A-Z][a-z]+ \d{4}-\d{2}-\d{2}$/,
    'additionalContext should read like "Current local time: 14:05 PDT, Sunday 2026-07-05"'
  );
});
