import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { therapyPaths } from './lib/paths.js';
import { readVersionJson } from './lib/version.js';
import { hashFile } from './lib/hash.js';
import { hasSafetyNetHook, hasHook, USAGE_STATS_DESC } from './lib/settings.js';

// Minimal seed sections. Profiles are expected to evolve beyond these — the
// LLM is instructed to add H2s as themes emerge and reorganize around active
// modalities. We only warn if the file appears truly unstructured.
const SEED_PROFILE_SECTIONS = ['Background', 'Current Focus', 'Notes'];

// Exec-form hook registration ({"type":"command","command":"node","args":[...]})
// requires Claude Code >= 2.1.139. On older CLIs the registration is silently
// ignored — the safety-net hook never runs even though every file-level check
// passes (verified live on both sides of the boundary during T-006, RUN_LOG
// Round 3: inert on 2.1.138, fires on 2.1.139). Doctor warns below this floor
// so a green report can't mean "installed but inert".
export const MIN_CLAUDE_CODE_VERSION = '2.1.139';

// Parses `claude --version` output (e.g. "2.1.138 (Claude Code)") and compares
// against the floor. Pure function, exported for direct testing. Returns:
//   { status: 'ok', version }        — at or above the floor
//   { status: 'outdated', version }  — parseable and below the floor
//   { status: 'unknown' }            — unparseable/missing (caller stays silent)
export function checkClaudeCodeVersion(
  output,
  floor = MIN_CLAUDE_CODE_VERSION
) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(output ?? ''));
  if (!match) {
    return { status: 'unknown' };
  }
  const version = `${match[1]}.${match[2]}.${match[3]}`;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])];
  const floorParts = floor.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (parts[i] < floorParts[i]) {
      return { status: 'outdated', version };
    }
    if (parts[i] > floorParts[i]) {
      return { status: 'ok', version };
    }
  }
  return { status: 'ok', version };
}

// How to spawn `claude --version` on this platform. On Windows, `claude`
// resolves to a .cmd shim (npm install) or .exe (native installer) that
// spawnSync can't execute without a shell — so the version check would stay
// permanently silent exactly where the exec-form floor risk lives. shell:true
// on win32 only lets cmd.exe resolve the shim via PATHEXT. Command and args
// are fixed literals, so there is no injection surface. Pure function,
// exported for direct testing (no Windows box required).
export function claudeVersionSpawnPlan(platform = process.platform) {
  return {
    command: 'claude',
    args: ['--version'],
    shell: platform === 'win32',
  };
}

// Spawn seam for the version check. Returns raw `claude --version` output, or
// null when the CLI isn't on PATH / errors / times out — doctor may run in
// environments where claude isn't visible, and that must not raise alarms.
function readClaudeVersionOutput() {
  const plan = claudeVersionSpawnPlan();
  try {
    const result = spawnSync(plan.command, plan.args, {
      encoding: 'utf8',
      timeout: 5000,
      shell: plan.shell,
    });
    if (result.error || result.status !== 0) {
      return null;
    }
    return result.stdout;
  } catch {
    return null;
  }
}

function checkProfileStructure(content) {
  const errors = [];
  const warnings = [];

  const h2s = [...content.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) =>
    m[1].trim()
  );

  if (h2s.length === 0) {
    errors.push(
      'profile.md has no H2 sections — the LLM has nothing to append updates under'
    );
    return { errors, warnings };
  }

  // If the profile has a healthy number of H2s, assume it has evolved its own
  // structure and don't second-guess it.
  if (h2s.length >= 4) {
    return { errors, warnings };
  }

  // Small profile — check it has at least one seed-ish section to give the LLM
  // somewhere to start. Background and Current Focus are the most universal.
  const hasBackground =
    h2s.some((h) => /background/i.test(h)) ||
    h2s.some((h) => /context|history/i.test(h));
  if (!hasBackground) {
    warnings.push(
      'profile.md has no Background section (or equivalent). New profiles should seed with at least Background, Current Focus, and Notes — the LLM grows structure from there.'
    );
  }

  return { errors, warnings };
}

export async function doctor(opts) {
  const paths = therapyPaths(opts.path);
  const errors = [];
  const warnings = [];
  const ok = [];

  if (!existsSync(paths.root)) {
    errors.push(`Therapy folder not found: ${paths.root}`);
    return { ok: false, errors, warnings, checks: ok };
  }
  ok.push(`folder exists: ${paths.root}`);

  if (!existsSync(paths.therapy)) {
    errors.push('.therapy/ folder missing');
  } else {
    ok.push('.therapy/ folder present');
  }

  const versionData = await readVersionJson(paths.versionJson);
  if (!versionData) {
    errors.push('.therapy/version.json missing or unparseable');
  } else {
    ok.push(`version.json present (kit ${versionData.kit_version || '?'})`);
    if (!versionData.files) {
      warnings.push(
        'version.json uses legacy schema (no per-file hashes) — run `inner-dialogue update --force` to migrate'
      );
    }
  }

  for (const required of [
    paths.safetyProtocol,
    paths.persona,
    paths.sessionStructure,
    paths.commands,
  ]) {
    if (!existsSync(required)) {
      errors.push(
        `missing framework file: ${required.replace(paths.root + '/', '')}`
      );
    }
  }

  if (existsSync(paths.profile)) {
    const content = await readFile(paths.profile, 'utf8');
    const result = checkProfileStructure(content);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    if (result.errors.length === 0 && result.warnings.length === 0) {
      ok.push('profile.md structure valid');
    }
  } else {
    errors.push('profile.md missing');
  }

  let claudeSettings = null;
  let settingsMalformed = false;
  if (existsSync(paths.claudeSettings)) {
    // Read once: parse for the safety-net registration checks below, and
    // scan the raw text for the legacy time-hook command.
    const settingsContent = await readFile(paths.claudeSettings, 'utf8');
    try {
      claudeSettings = JSON.parse(settingsContent);
    } catch (err) {
      // Malformed settings is its own problem — don't report the file as
      // plainly "present" ok, and don't prescribe `update` as the fix:
      // update deliberately skips malformed files, so that advice loops.
      settingsMalformed = true;
      warnings.push(
        `.claude/settings.json exists but is not valid JSON (${err.message}) — safety-net hook registration can't be verified, and updates will leave the file untouched rather than risk clobbering it. Fix the JSON syntax by hand (or restore from a .claude/settings.json.bak-* backup if one exists).`
      );
    }
    if (!settingsMalformed) {
      // Pre-2.9 scaffolds used the POSIX `date` command for the time hook. On
      // Windows, cmd.exe's `date` prompts to change the system date instead of
      // printing it, so the hook hangs or breaks. The template is scaffold_only
      // (never overwritten by update), so existing installs need a manual fix.
      if (/"command"\s*:\s*"date /.test(settingsContent)) {
        warnings.push(
          ".claude/settings.json uses the legacy shell `date` command for the time hook — it is Mac-only and breaks on Windows. If you haven't customized this file, delete it and run `inner-dialogue update` to re-scaffold the cross-platform (Node) version."
        );
      } else {
        ok.push('.claude/settings.json present');
      }
    }
  } else {
    warnings.push(
      '.claude/settings.json missing — without it the therapist has no signal for current local time (affects session pacing and time-of-day awareness). Run `inner-dialogue update` to scaffold it.'
    );
  }

  // Safety-net hook backstop checks. Warning (not error) severity is
  // deliberate: pre-feature installs must keep validating clean until the
  // user runs `update`.
  const safetyNetFix = `npx inner-dialogue@latest update --path "${paths.root}"`;
  if (existsSync(paths.safetyNetHook)) {
    ok.push('.therapy/hooks/safety-net.js present');
    // Integrity check: compare the installed hook against the hash recorded
    // at install/update time in version.json. Warning (not error) severity —
    // users are free to edit the hook, but the posture is that they
    // shouldn't: the safety net is there for a reason. No record (pre-hook
    // install or hand-placed script) → skip the check gracefully.
    const hookRecord = versionData?.files?.['.therapy/hooks/safety-net.js'];
    if (hookRecord?.hash) {
      const installedHash = await hashFile(paths.safetyNetHook);
      if (installedHash === hookRecord.hash) {
        ok.push('safety-net hook matches its installed version');
      } else {
        warnings.push(
          `safety-net hook (.therapy/hooks/safety-net.js) has been modified from the shipped version. You're free to edit it, but we recommend you don't — the safety net is there for a reason, and edits can quietly break it. To restore the shipped version, run \`${safetyNetFix} --force\` (note: --force also overwrites any other framework files you've edited; a backup is taken first).`
        );
      }
    }
  } else {
    warnings.push(
      `safety-net hook script missing (.therapy/hooks/safety-net.js) — the mechanical crisis-resource backstop is not installed. Run \`${safetyNetFix}\` to install it.`
    );
  }
  if (settingsMalformed) {
    // Registration can't be verified and `update` can't fix a malformed file —
    // the malformed-settings warning above already carries the real fix, so
    // don't stack a "run update" prescription on top of it.
  } else if (hasSafetyNetHook(claudeSettings)) {
    ok.push('safety-net hook registered in .claude/settings.json');
  } else {
    warnings.push(
      `safety-net hook not registered in .claude/settings.json — the hook will not run on prompts even if the script is present. Run \`${safetyNetFix}\` to register it.`
    );
  }

  // Usage-stats reflection checks. Same warning-severity posture as the
  // safety-net checks above: this is a reflection aid, not the safety net, so
  // pre-feature or pre-`update` installs must keep validating clean until the
  // user runs update. The Claude Code version floor above already covers
  // exec-form hook support, so it is not re-checked here.
  const usageStatsFix = `npx inner-dialogue@latest update --path "${paths.root}"`;
  if (existsSync(paths.usageStatsHook)) {
    ok.push('.therapy/hooks/usage-stats.js present');
    // Integrity check against the hash recorded in version.json, mirroring the
    // safety-net check but softer: editing a reflection aid is lower-stakes
    // than editing the crisis backstop. No record → skip gracefully.
    const usageRecord = versionData?.files?.['.therapy/hooks/usage-stats.js'];
    if (usageRecord?.hash) {
      const installedHash = await hashFile(paths.usageStatsHook);
      if (installedHash === usageRecord.hash) {
        ok.push('usage-stats hook matches its installed version');
      } else {
        warnings.push(
          `usage-stats hook (.therapy/hooks/usage-stats.js) has been modified from the shipped version. It's a reflection aid rather than the safety net, so edits are lower-stakes — but they can skew the usage signal it records. To restore the shipped version, run \`${usageStatsFix} --force\` (note: --force also overwrites any other framework files you've edited; a backup is taken first).`
        );
      }
    }
  } else {
    warnings.push(
      `usage-stats hook script missing (.therapy/hooks/usage-stats.js) — the session-usage reflection signal is not installed. Run \`${usageStatsFix}\` to install it.`
    );
  }
  if (existsSync(paths.usageReflection)) {
    ok.push('.therapy/usage-reflection.md present');
  } else {
    warnings.push(
      `usage-reflection guidance missing (.therapy/usage-reflection.md) — the usage-pattern reflection prompt is not installed. Run \`${usageStatsFix}\` to install it.`
    );
  }
  if (settingsMalformed) {
    // Registration can't be verified and `update` can't fix a malformed file —
    // the malformed-settings warning above already carries the real fix, so
    // don't stack a "run update" prescription on top of it.
  } else if (hasHook(claudeSettings, USAGE_STATS_DESC)) {
    ok.push('usage-stats hook registered in .claude/settings.json');
  } else {
    warnings.push(
      `usage-stats hook not registered in .claude/settings.json (SessionStart) — the hook will not run at session start even if the script is present. Run \`${usageStatsFix}\` to register it.`
    );
  }

  // Claude Code version floor (see MIN_CLAUDE_CODE_VERSION). Warning severity:
  // the install itself is fine — it's the runtime that can't execute the hook.
  // `opts.claudeVersionOutput` is the injectable seam for tests (pass null to
  // skip the real spawn); undefined means "ask the real CLI".
  const versionOutput =
    opts.claudeVersionOutput !== undefined
      ? opts.claudeVersionOutput
      : readClaudeVersionOutput();
  const claudeVersion = checkClaudeCodeVersion(versionOutput);
  if (claudeVersion.status === 'outdated') {
    warnings.push(
      `Claude Code ${claudeVersion.version} is older than ${MIN_CLAUDE_CODE_VERSION}, which does not support the hook registration format this kit uses — the safety-net hook will not run on prompts even though everything is installed correctly. Update Claude Code: run \`claude update\`, or \`npm i -g @anthropic-ai/claude-code@latest\` if you installed via npm.`
    );
  } else if (claudeVersion.status === 'ok') {
    ok.push(
      `Claude Code ${claudeVersion.version} supports the safety-net hook (>= ${MIN_CLAUDE_CODE_VERSION})`
    );
  }
  // status 'unknown' (claude not on PATH or unparseable output): skip silently.

  // Profile-protocol presence. Warning (not error) severity: pre-feature
  // installs that haven't run `update` yet must keep validating clean.
  if (existsSync(paths.profileProtocol)) {
    ok.push('.therapy/profile-protocol.md present');
  } else {
    warnings.push(
      'profile-protocol.md missing (.therapy/profile-protocol.md) — the profile provenance rules (dated writes + staleness review) are not installed. Run `inner-dialogue update` to install it.'
    );
  }

  if (existsSync(paths.context)) {
    ok.push('context/ folder present');
    if (!existsSync(paths.contextIndex)) {
      warnings.push(
        'context/index.md missing — the index routes the therapist to subject files (people, places, concepts, events). Run `inner-dialogue update` to scaffold it.'
      );
    } else {
      ok.push('context/index.md present');
    }
  } else {
    warnings.push(
      'context/ folder missing — the subject-level context library is a newer feature. Run `inner-dialogue update` to scaffold it.'
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    issues: errors, // backwards compat for older output handlers
    checks: ok,
  };
}
