// Shared settings-merge helpers — the single home for hook registration
// matchers, the canonical hook entries, and the surgical merge that install
// and update both apply to .claude/settings.json.
//
// The machinery is generalized over a *hook descriptor* so it can register
// more than one kind of hook (the crisis safety-net hook under
// UserPromptSubmit, and a usage-stats hook under SessionStart) from one code
// path. The safety-net-specific functions are preserved as thin wrappers that
// bind the generic functions to SAFETY_NET_DESC, so their public API and
// behavior are byte-identical to before this generalization.
//
// Matching semantics are deliberately loose (substring): any hook whose
// command string — or any element of its args array — contains the
// descriptor's marker (e.g. "safety-net.js") counts as registered. Exec form,
// shell form, and hand-written variants all match. Loose matching is what
// prevents the merge from double-registering the hook against an entry we
// didn't write ourselves.

import {
  readFile,
  writeFile,
  rename,
  unlink,
  stat,
  chmod,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { randomBytes } from 'node:crypto';

import { snapshotFile } from './backup.js';

export const SETTINGS_REL_PATH = '.claude/settings.json';

// Hook descriptors. Each fully specifies one registerable hook:
//   event     — the hooks.<event> group it lives under
//   matcher   — the matcher string on the group entry
//   marker    — substring that identifies the hook in a command/args (loose match)
//   scriptRel — repo-relative script path used to build the exec-form entry
//   label     — human string used in user-facing reason messages
//   action    — the plan action token planHookMerge returns
export const SAFETY_NET_DESC = {
  event: 'UserPromptSubmit',
  matcher: '',
  marker: 'safety-net.js',
  scriptRel: '.therapy/hooks/safety-net.js',
  label: 'safety-net hook',
  action: 'add_safety_net_hook',
};

export const USAGE_STATS_DESC = {
  event: 'SessionStart',
  matcher: 'startup|resume|clear|compact',
  marker: 'usage-stats.js',
  scriptRel: '.therapy/hooks/usage-stats.js',
  label: 'usage-stats hook',
  action: 'add_usage_stats_hook',
};

// The canonical exec-form registration entry for a descriptor. Returned as a
// fresh object each call so no caller can mutate shared state.
// ${CLAUDE_PROJECT_DIR} is a literal placeholder Claude Code expands at
// runtime, not a JS template.
export function hookEntry(desc) {
  return {
    matcher: desc.matcher,
    hooks: [
      {
        type: 'command',
        command: 'node',
        args: ['${CLAUDE_PROJECT_DIR}/' + desc.scriptRel],
      },
    ],
  };
}

// True if any hooks.<desc.event> entry references the descriptor's marker (see
// the module header for why this is a substring match).
export function hasHook(settings, desc) {
  const groups = settings?.hooks?.[desc.event];
  if (!Array.isArray(groups)) return false;
  for (const group of groups) {
    if (!Array.isArray(group?.hooks)) continue;
    for (const hook of group.hooks) {
      if (
        typeof hook?.command === 'string' &&
        hook.command.includes(desc.marker)
      ) {
        return true;
      }
      if (
        Array.isArray(hook?.args) &&
        hook.args.some(
          (a) => typeof a === 'string' && a.includes(desc.marker)
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

// Parse + shape-validate raw settings content for merging.
// Returns { ok: true, settings } or { ok: false, code, reason }.
// The skip reasons are user-facing (they surface in plan.settings_merge and
// the human-readable CLI output) and must stay aligned with doctor's
// malformed-settings guidance: the fix is a hand edit, never `update` alone —
// update deliberately skips malformed files. Reason strings are parameterized
// by the descriptor's label/event so they name the hook actually being merged;
// with SAFETY_NET_DESC (the default) they are byte-identical to the historical
// safety-net strings.
export function parseSettingsForMerge(raw, desc = SAFETY_NET_DESC) {
  let candidate;
  try {
    candidate = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      code: 'malformed',
      reason: `settings.json is not valid JSON (${err.message}) — left untouched. Fix the JSON syntax by hand, then re-run update to register the ${desc.label}.`,
    };
  }
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    Array.isArray(candidate)
  ) {
    return {
      ok: false,
      code: 'malformed',
      reason: `settings.json is not a JSON object — left untouched. Fix the file by hand, then re-run update to register the ${desc.label}.`,
    };
  }
  const hooksVal = candidate.hooks;
  if (
    hooksVal !== undefined &&
    (typeof hooksVal !== 'object' || hooksVal === null || Array.isArray(hooksVal))
  ) {
    return {
      ok: false,
      code: 'bad_shape',
      reason: `"hooks" is not an object — left untouched; register the ${desc.label} manually.`,
    };
  }
  const eventHooks = hooksVal?.[desc.event];
  if (eventHooks !== undefined && !Array.isArray(eventHooks)) {
    return {
      ok: false,
      code: 'bad_shape',
      reason: `"hooks.${desc.event}" is not an array — left untouched; register the ${desc.label} manually.`,
    };
  }
  return { ok: true, settings: candidate };
}

// Planning half: examine the settings file and decide whether a merge is
// needed. Returns a plan.settings_merge item, or null when there's nothing to
// plan (file missing — the scaffold path owns that — or already registered).
export async function planHookMerge(settingsPath, desc) {
  if (!existsSync(settingsPath)) return null;
  const parsed = parseSettingsForMerge(
    await readFile(settingsPath, 'utf8'),
    desc
  );
  if (!parsed.ok) {
    return { path: SETTINGS_REL_PATH, action: 'skipped', reason: parsed.reason };
  }
  if (hasHook(parsed.settings, desc)) return null;
  return { path: SETTINGS_REL_PATH, action: desc.action };
}

// Apply half: self-sufficient — re-reads and re-parses the file at apply time
// so a stale plan can never clobber a file that changed between planning and
// writing. Backs up first, appends the canonical entry without reordering or
// dropping anything else, and writes atomically (temp file in the same
// directory + rename) so a mid-write crash can't corrupt settings.json.
// Returns { merged: true, backup } or { merged: false, code, reason }.
//
// Fail-soft: this function never throws. An fs error anywhere in the merge
// (read, backup copy, atomic write) comes back as { merged: false, code:
// 'error', reason } — install and update both treat the merge as
// best-effort, and a crash here would strand a run whose framework writes
// already landed (stale hash registry, doctor false-flags). If the failure
// happened after the backup was taken, the reason names the backup path so
// the snapshot is never orphaned silently.
export async function applyHookMerge(settingsPath, desc) {
  let backup = null;
  try {
    if (!existsSync(settingsPath)) {
      return {
        merged: false,
        code: 'missing',
        reason: 'settings.json no longer exists — merge skipped.',
      };
    }
    const parsed = parseSettingsForMerge(
      await readFile(settingsPath, 'utf8'),
      desc
    );
    if (!parsed.ok) {
      return { merged: false, code: parsed.code, reason: parsed.reason };
    }
    if (hasHook(parsed.settings, desc)) {
      return {
        merged: false,
        code: 'already_registered',
        reason: `${desc.label} already registered.`,
      };
    }
    backup = await snapshotFile(settingsPath);
    const settings = parsed.settings;
    settings.hooks = settings.hooks || {};
    settings.hooks[desc.event] = settings.hooks[desc.event] || [];
    settings.hooks[desc.event].push(hookEntry(desc));
    await writeFileAtomic(
      settingsPath,
      JSON.stringify(settings, null, 2) + '\n'
    );
    return { merged: true, backup };
  } catch (err) {
    const detail = err && err.message ? err.message : String(err);
    return {
      merged: false,
      code: 'error',
      reason:
        `settings merge failed (${detail}) — settings.json left as-is.` +
        (backup ? ` A pre-merge backup was saved at ${backup}.` : '') +
        ` Register the ${desc.label} manually, or fix the underlying` +
        ' issue and re-run update.',
    };
  }
}

// ---------------------------------------------------------------------------
// Preserved safety-net wrappers. These bind the generic functions above to
// SAFETY_NET_DESC. install.js imports applySafetyNetMerge + SETTINGS_REL_PATH;
// update.js imports planSafetyNetMerge + applySafetyNetMerge; doctor.js imports
// hasSafetyNetHook. Their behavior and user-facing strings are byte-identical
// to the pre-generalization module.
// ---------------------------------------------------------------------------

export function safetyNetHookEntry() {
  return hookEntry(SAFETY_NET_DESC);
}

export function hasSafetyNetHook(settings) {
  return hasHook(settings, SAFETY_NET_DESC);
}

export async function planSafetyNetMerge(settingsPath) {
  return planHookMerge(settingsPath, SAFETY_NET_DESC);
}

export async function applySafetyNetMerge(settingsPath) {
  return applyHookMerge(settingsPath, SAFETY_NET_DESC);
}

// Exported for direct testing (temp-file cleanup and mode preservation are
// hard to exercise through the CLI alone). Preserves the target's existing
// file mode: rename() replaces the inode, so without an explicit chmod a
// user's `chmod 600 settings.json` would silently become the default 0644
// after a merge. New files get the platform default.
export async function writeFileAtomic(target, content) {
  let mode = null;
  try {
    mode = (await stat(target)).mode & 0o777;
  } catch {
    // Target doesn't exist (or isn't stat-able) — use the default mode.
  }
  const tmp = join(
    dirname(target),
    `.${basename(target)}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`
  );
  try {
    // Create the temp file with the preserved mode from the start (writeFile
    // mode applies at creation, umask-masked) so a 600 settings.json never
    // sits world-readable in the window before the chmod; the explicit chmod
    // still runs to clear whatever bits the umask stripped.
    await writeFile(
      tmp,
      content,
      mode !== null ? { encoding: 'utf8', mode } : 'utf8'
    );
    if (mode !== null) await chmod(tmp, mode);
    await rename(tmp, target);
  } catch (err) {
    // Clean up the temp file whether the write, chmod, or rename failed —
    // a failed *write* (e.g. ENOSPC) can leave a partial temp file behind
    // just as a failed rename can.
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
