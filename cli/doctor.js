import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { therapyPaths } from './lib/paths.js';
import { readVersionJson } from './lib/version.js';

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

// The safety-net hook is registered under hooks.UserPromptSubmit[].hooks[] as
// either exec form ({command: "node", args: [".../safety-net.js"]}) or a shell
// command string containing the script path. Match both.
function hasSafetyNetRegistration(settings) {
  const groups = settings?.hooks?.UserPromptSubmit;
  if (!Array.isArray(groups)) return false;
  for (const group of groups) {
    if (!Array.isArray(group?.hooks)) continue;
    for (const hook of group.hooks) {
      if (
        typeof hook?.command === 'string' &&
        hook.command.includes('safety-net.js')
      ) {
        return true;
      }
      if (
        Array.isArray(hook?.args) &&
        hook.args.some(
          (a) => typeof a === 'string' && a.includes('safety-net.js')
        )
      ) {
        return true;
      }
    }
  }
  return false;
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
  if (existsSync(paths.claudeSettings)) {
    ok.push('.claude/settings.json present');
    try {
      claudeSettings = JSON.parse(await readFile(paths.claudeSettings, 'utf8'));
    } catch {
      // Unparseable settings — the safety-net registration check below
      // reports this as a warning with a fix.
      claudeSettings = null;
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
  } else {
    warnings.push(
      `safety-net hook script missing (.therapy/hooks/safety-net.js) — the mechanical crisis-resource backstop is not installed. Run \`${safetyNetFix}\` to install it.`
    );
  }
  if (hasSafetyNetRegistration(claudeSettings)) {
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
