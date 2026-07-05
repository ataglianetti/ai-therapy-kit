// Shared safety-net settings helpers — the single home for the registration
// matcher, the canonical hook entry, and the surgical merge that install and
// update both apply to .claude/settings.json.
//
// Matching semantics are deliberately loose (substring): any hook whose
// command string — or any element of its args array — contains
// "safety-net.js" counts as registered. Exec form, shell form, and
// hand-written variants all match. Loose matching is what prevents the merge
// from double-registering the hook against an entry we didn't write ourselves.

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

// The canonical exec-form registration entry. Returned as a fresh object each
// call so no caller can mutate shared state. ${CLAUDE_PROJECT_DIR} is a
// literal placeholder Claude Code expands at runtime, not a JS template.
export function safetyNetHookEntry() {
  return {
    matcher: '',
    hooks: [
      {
        type: 'command',
        command: 'node',
        args: ['${CLAUDE_PROJECT_DIR}/.therapy/hooks/safety-net.js'],
      },
    ],
  };
}

// True if any hooks.UserPromptSubmit entry references safety-net.js (see the
// module header for why this is a substring match).
export function hasSafetyNetHook(settings) {
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

// Parse + shape-validate raw settings content for merging.
// Returns { ok: true, settings } or { ok: false, code, reason }.
// The skip reasons are user-facing (they surface in plan.settings_merge and
// the human-readable CLI output) and must stay aligned with doctor's
// malformed-settings guidance: the fix is a hand edit, never `update` alone —
// update deliberately skips malformed files.
export function parseSettingsForMerge(raw) {
  let candidate;
  try {
    candidate = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      code: 'malformed',
      reason: `settings.json is not valid JSON (${err.message}) — left untouched. Fix the JSON syntax by hand, then re-run update to register the safety-net hook.`,
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
      reason:
        'settings.json is not a JSON object — left untouched. Fix the file by hand, then re-run update to register the safety-net hook.',
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
      reason:
        '"hooks" is not an object — left untouched; register the safety-net hook manually.',
    };
  }
  const promptHooks = hooksVal?.UserPromptSubmit;
  if (promptHooks !== undefined && !Array.isArray(promptHooks)) {
    return {
      ok: false,
      code: 'bad_shape',
      reason:
        '"hooks.UserPromptSubmit" is not an array — left untouched; register the safety-net hook manually.',
    };
  }
  return { ok: true, settings: candidate };
}

// Planning half: examine the settings file and decide whether a merge is
// needed. Returns a plan.settings_merge item, or null when there's nothing to
// plan (file missing — the scaffold path owns that — or already registered).
export async function planSafetyNetMerge(settingsPath) {
  if (!existsSync(settingsPath)) return null;
  const parsed = parseSettingsForMerge(await readFile(settingsPath, 'utf8'));
  if (!parsed.ok) {
    return { path: SETTINGS_REL_PATH, action: 'skipped', reason: parsed.reason };
  }
  if (hasSafetyNetHook(parsed.settings)) return null;
  return { path: SETTINGS_REL_PATH, action: 'add_safety_net_hook' };
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
export async function applySafetyNetMerge(settingsPath) {
  let backup = null;
  try {
    if (!existsSync(settingsPath)) {
      return {
        merged: false,
        code: 'missing',
        reason: 'settings.json no longer exists — merge skipped.',
      };
    }
    const parsed = parseSettingsForMerge(await readFile(settingsPath, 'utf8'));
    if (!parsed.ok) {
      return { merged: false, code: parsed.code, reason: parsed.reason };
    }
    if (hasSafetyNetHook(parsed.settings)) {
      return {
        merged: false,
        code: 'already_registered',
        reason: 'safety-net hook already registered.',
      };
    }
    backup = await snapshotFile(settingsPath);
    const settings = parsed.settings;
    settings.hooks = settings.hooks || {};
    settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit || [];
    settings.hooks.UserPromptSubmit.push(safetyNetHookEntry());
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
        ' Register the safety-net hook manually, or fix the underlying' +
        ' issue and re-run update.',
    };
  }
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
