import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { therapyPaths } from './lib/paths.js';
import { readVersionJson } from './lib/version.js';
import { hashFile } from './lib/hash.js';
import { hasSafetyNetHook } from './lib/settings.js';

// Minimal seed sections. Profiles are expected to evolve beyond these — the
// LLM is instructed to add H2s as themes emerge and reorganize around active
// modalities. We only warn if the file appears truly unstructured.
const SEED_PROFILE_SECTIONS = ['Background', 'Current Focus', 'Notes'];

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
    try {
      claudeSettings = JSON.parse(await readFile(paths.claudeSettings, 'utf8'));
      ok.push('.claude/settings.json present');
    } catch (err) {
      // Malformed settings is its own problem — don't report the file as
      // plainly "present" ok, and don't prescribe `update` as the fix:
      // update deliberately skips malformed files, so that advice loops.
      settingsMalformed = true;
      warnings.push(
        `.claude/settings.json exists but is not valid JSON (${err.message}) — safety-net hook registration can't be verified, and updates will leave the file untouched rather than risk clobbering it. Fix the JSON syntax by hand (or restore from a .claude/settings.json.bak-* backup if one exists).`
      );
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
