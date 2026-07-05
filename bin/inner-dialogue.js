#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { install } from '../cli/install.js';
import { update } from '../cli/update.js';
import { doctor } from '../cli/doctor.js';
import { packageFile } from '../cli/lib/paths.js';

const HELP = `inner-dialogue — private AI therapist toolkit

Usage:
  inner-dialogue install   [flags]   Create a new therapist setup
  inner-dialogue update    [flags]   Update framework files in an existing setup
  inner-dialogue doctor    [flags]   Validate a therapy folder
  inner-dialogue --version           Print version
  inner-dialogue --help              Print this help

Install flags:
  --name <name>              Therapist name (e.g. Sage)
  --path <dir>               Storage location (absolute or ~/...)
  --persona <slug>           e.g. warm-4o, direct-challenging, coach
  --structure <slug>         structured | moderate | freeform
  --modalities <a,b,c>       Comma-separated slugs (cbt,ifs,...)
  --force                    Reinstall over existing .therapy/
  --json                     Print JSON result

Update flags:
  --path <dir>               Therapy folder (default: cwd)
  --dry-run                  Show plan without writing
  --force                    Overwrite user-edited framework files
  --json                     Print JSON result

Doctor flags:
  --path <dir>               Therapy folder (default: cwd)
  --json                     Print JSON result

Examples:
  npx inner-dialogue install --name Sage --path ~/Sage \\
      --persona warm-4o --structure moderate --modalities cbt,ifs
  npx inner-dialogue update --path ~/Sage --dry-run
  npx inner-dialogue doctor --path ~/Sage
`;

function parseList(v) {
  if (!v) return undefined;
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function printSettingsMerge(merges, dryRun) {
  for (const m of merges || []) {
    if (m.action === 'add_safety_net_hook') {
      process.stdout.write(
        dryRun
          ? `\nWill register the safety-net hook in .claude/settings.json.\n`
          : `\nRegistered the safety-net hook in .claude/settings.json.\n` +
              (m.backup ? `  Backup: ${m.backup}\n` : '')
      );
    } else if (m.action === 'skipped') {
      process.stdout.write(
        `\nSkipped .claude/settings.json: ${m.reason}\n`
      );
    }
  }
}

function printResult(result, json) {
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  if (result.ok && result.path) {
    process.stdout.write(
      `\nReady: ${result.therapist} at ${result.path}\n` +
        `  persona:    ${result.persona}\n` +
        `  structure:  ${result.structure}\n` +
        `  modalities: ${result.modalities.join(', ')}\n`
    );
    printSettingsMerge(result.settings_merge);
    process.stdout.write(
      `\nStart a session: open the Claude AI app and navigate to ${result.path}, or run \`claude\` in Terminal from that folder.\n`
    );
    return;
  }
  if (result.plan) {
    const p = result.plan;
    if (result.dry_run) process.stdout.write('Dry run — no files written.\n\n');
    if (result.backup) process.stdout.write(`Backup: ${result.backup}\n\n`);
    if (p.updates.length) {
      process.stdout.write(`Updated (${p.updates.length}):\n`);
      for (const u of p.updates)
        process.stdout.write(`  ${u.path}  ${u.from_version ?? '?'} → ${u.to_version ?? '?'}\n`);
    }
    if (p.new_files.length) {
      process.stdout.write(`\nAdded (${p.new_files.length}):\n`);
      for (const u of p.new_files)
        process.stdout.write(`  ${u.path}  (v${u.to_version ?? '?'})\n`);
    }
    if (p.skipped_user_edited.length) {
      process.stdout.write(
        `\nSkipped — user edits preserved (${p.skipped_user_edited.length}):\n`
      );
      for (const u of p.skipped_user_edited)
        process.stdout.write(`  ${u.path}  (${u.reason})\n`);
      process.stdout.write(
        `\nUse --force to overwrite these. Your edits are backed up regardless.\n`
      );
    }
    if (p.forced_overwrites && p.forced_overwrites.length) {
      process.stdout.write(
        `\nForce-overwritten (${p.forced_overwrites.length}):\n`
      );
      for (const u of p.forced_overwrites)
        process.stdout.write(`  ${u.path}  (was: ${u.reason})\n`);
    }
    if (p.legacy_removed && p.legacy_removed.length) {
      process.stdout.write(
        `\nRemoved deprecated launcher files (${p.legacy_removed.length}):\n`
      );
      for (const u of p.legacy_removed)
        process.stdout.write(`  ${u.path}\n`);
      process.stdout.write(
        `  Start sessions via the Claude AI app, or run \`claude\` in Terminal.\n`
      );
    }
    printSettingsMerge(p.settings_merge, result.dry_run);
    if (p.registered_on_migration && p.registered_on_migration.length) {
      process.stdout.write(
        `\nFolded into new registry (${p.registered_on_migration.length}):\n`
      );
      process.stdout.write(
        `  Files already matching the current bundled content. Hashes will be recorded\n` +
          `  in version.json so future updates can diff against them without flagging.\n`
      );
    }
    if (result.message) process.stdout.write(`\n${result.message}\n`);
    return;
  }
  if (result.errors !== undefined || result.issues !== undefined) {
    const errs = result.errors || result.issues || [];
    const warns = result.warnings || [];

    if (errs.length === 0 && warns.length === 0) {
      process.stdout.write('All checks passed:\n');
      for (const c of result.checks) process.stdout.write(`  ok  ${c}\n`);
      return;
    }

    if (errs.length) {
      process.stdout.write(`Errors (${errs.length}):\n`);
      for (const i of errs) process.stdout.write(`  !!  ${i}\n`);
    }
    if (warns.length) {
      process.stdout.write(
        `${errs.length ? '\n' : ''}Warnings (${warns.length}):\n`
      );
      for (const w of warns) process.stdout.write(`  ~~  ${w}\n`);
    }
    if (result.checks.length) {
      process.stdout.write('\nPassed:\n');
      for (const c of result.checks) process.stdout.write(`  ok  ${c}\n`);
    }
    if (errs.length === 0 && warns.length > 0) {
      process.stdout.write(
        '\nNo errors. Warnings are informational — your folder works fine as-is.\n'
      );
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    process.stdout.write(HELP);
    return 0;
  }

  if (argv.includes('--version') || argv.includes('-v')) {
    const pkg = JSON.parse(await readFile(packageFile('package.json'), 'utf8'));
    process.stdout.write(pkg.version + '\n');
    return 0;
  }

  const command = argv[0];
  const rest = argv.slice(1);

  const commonOptions = {
    path: { type: 'string' },
    json: { type: 'boolean' },
    force: { type: 'boolean' },
  };

  let parsed;
  try {
    if (command === 'install') {
      parsed = parseArgs({
        args: rest,
        options: {
          ...commonOptions,
          name: { type: 'string' },
          persona: { type: 'string' },
          structure: { type: 'string' },
          modalities: { type: 'string' },
        },
        strict: true,
      });
    } else if (command === 'update') {
      parsed = parseArgs({
        args: rest,
        options: {
          ...commonOptions,
          'dry-run': { type: 'boolean' },
        },
        strict: true,
      });
    } else if (command === 'doctor') {
      parsed = parseArgs({
        args: rest,
        options: { path: { type: 'string' }, json: { type: 'boolean' } },
        strict: true,
      });
    } else {
      process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
      return 1;
    }
  } catch (err) {
    process.stderr.write(`Argument error: ${err.message}\n`);
    return 2;
  }

  const v = parsed.values;
  try {
    let result;
    if (command === 'install') {
      result = await install({
        name: v.name,
        path: v.path,
        persona: v.persona,
        structure: v.structure,
        modalities: parseList(v.modalities),
        force: v.force,
        json: v.json,
      });
    } else if (command === 'update') {
      result = await update({
        path: v.path || process.cwd(),
        dryRun: v['dry-run'],
        force: v.force,
      });
    } else {
      result = await doctor({ path: v.path || process.cwd() });
    }
    printResult(result, v.json);
    return result.ok === false ? 1 : 0;
  } catch (err) {
    if (v.json) {
      process.stdout.write(
        JSON.stringify({ ok: false, error: err.message }, null, 2) + '\n'
      );
    } else {
      process.stderr.write(`Error: ${err.message}\n`);
    }
    return 1;
  }
}

main().then((code) => process.exit(code));
