import { readFile, writeFile, mkdir, readdir, unlink, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { therapyPaths, packageFile } from './lib/paths.js';
import { loadFramework } from './lib/framework.js';
import {
  readVersionJson,
  writeVersionJson,
  emptyVersionJson,
  recordFile,
} from './lib/version.js';
import { hashString } from './lib/hash.js';
import { snapshotTherapy } from './lib/backup.js';
import {
  planSafetyNetMerge,
  planHookMerge,
  applyHookMerge,
  SAFETY_NET_DESC,
  USAGE_STATS_DESC,
} from './lib/settings.js';

const ALWAYS_SKIP_RELATIVE = [
  'profile.md',
  'CLAUDE.md',
  'sessions/',
];

function isProtected(targetRel) {
  for (const p of ALWAYS_SKIP_RELATIVE) {
    if (targetRel === p || targetRel.startsWith(p)) return true;
  }
  return false;
}

function isActiveCopy(targetRel) {
  return (
    targetRel === '.therapy/persona.md' ||
    targetRel === '.therapy/session-structure.md' ||
    targetRel.startsWith('.therapy/modalities/')
  );
}

async function readIfExists(p) {
  if (!existsSync(p)) return null;
  return readFile(p, 'utf8');
}

export async function update(opts) {
  const paths = therapyPaths(opts.path);

  if (!existsSync(paths.therapy)) {
    throw new Error(
      `No therapy folder found at ${paths.root}. Run \`inner-dialogue install\` first.`
    );
  }

  const existing =
    (await readVersionJson(paths.versionJson)) ||
    emptyVersionJson('0.0.0');
  const oldFiles = existing.files || {};
  const isLegacySchema = !existing.files;
  const framework = await loadFramework();
  const pkgJson = JSON.parse(
    await readFile(packageFile('package.json'), 'utf8')
  );

  const plan = {
    updates: [],
    new_files: [],
    skipped_user_edited: [],
    unchanged: [],
    legacy_removed: [],
    scaffolded: [],
  };

  // Top-level scaffolds: directories and template-derived files that ship with
  // newer kit versions. We create dirs unconditionally (mkdir is idempotent)
  // and only copy template files when the target doesn't exist — never
  // overwrite user content (same protection as profile.md and CLAUDE.md).
  const scaffoldDirs = [
    paths.claudeDir,
    paths.contextPeople,
    paths.contextPlaces,
    paths.contextConcepts,
    paths.contextEvents,
  ];
  const scaffoldTemplates = [
    {
      target: paths.claudeSettings,
      rel: '.claude/settings.json',
      source: packageFile('claude-settings.template.json'),
    },
    {
      target: paths.contextIndex,
      rel: 'context/index.md',
      source: packageFile('context', 'index.template.md'),
    },
  ];
  for (const sf of scaffoldTemplates) {
    if (!existsSync(sf.target)) {
      plan.scaffolded.push({ path: sf.rel });
    }
  }

  // Safety-net hook registration (surgical merge). The scaffold path above
  // only copies the settings template when the file is missing entirely.
  // When .claude/settings.json already exists we must never clobber it:
  // cli/lib/settings.js checks whether the safety-net hook is registered
  // under hooks.UserPromptSubmit and, if not, plans a surgical append that
  // touches nothing else in the object. Malformed or unexpectedly-shaped JSON
  // fails open — report and skip, never crash, never overwrite.
  plan.settings_merge = [];
  const settingsMergePlan = await planSafetyNetMerge(paths.claudeSettings);
  if (settingsMergePlan) plan.settings_merge.push(settingsMergePlan);
  // Also plan the usage-stats SessionStart hook registration into a
  // pre-existing settings file (same surgical, fail-open contract).
  const usageMergePlan = await planHookMerge(
    paths.claudeSettings,
    USAGE_STATS_DESC
  );
  if (usageMergePlan) plan.settings_merge.push(usageMergePlan);

  for (const f of framework) {
    if (isProtected(f.target)) continue;
    if (isActiveCopy(f.target)) continue;

    const targetAbs = join(paths.root, f.target);
    const current = await readIfExists(targetAbs);

    if (current === null) {
      plan.new_files.push({
        path: f.target,
        version: f.version,
      });
      continue;
    }

    const currentHash = hashString(current);
    const knownHash = oldFiles[f.target]?.hash;

    if (currentHash === f.hash) {
      plan.unchanged.push({ path: f.target, version: f.version });
      continue;
    }

    if (knownHash && currentHash !== knownHash) {
      plan.skipped_user_edited.push({
        path: f.target,
        reason: 'modified since install',
        from_version: oldFiles[f.target]?.version,
        to_version: f.version,
      });
      continue;
    }

    if (!knownHash) {
      plan.skipped_user_edited.push({
        path: f.target,
        reason: 'unknown origin (pre-2.2.0 install or hand-placed file)',
        to_version: f.version,
      });
      continue;
    }

    plan.updates.push({
      path: f.target,
      from_version: oldFiles[f.target]?.version,
      to_version: f.version,
    });
  }

  // Active-file refresh: .therapy/persona.md, .therapy/session-structure.md,
  // and .therapy/modalities/*.md are copies the user's session loads directly.
  // The library loop above only updates the reference copies under
  // .therapy/library/. Without this loop, library updates land but active
  // sessions keep loading the prior version.
  //
  // Source resolution: modality active files map to library by filename
  // (.therapy/modalities/ifs.md → modalities/ifs.md). Persona and
  // session-structure are slug-less in the active path, so we identify their
  // library source by hash-matching against library files of the same kind.
  //
  // Hash-gating: an active file is safe to refresh if its content matches
  // either (a) the explicitly-recorded active hash, or (b) the previously-
  // recorded library hash for its source. This catches both modern installs
  // (active entries in version.json) and legacy installs (where active
  // entries weren't recorded but library entries were).
  const frameworkBySource = new Map();
  for (const f of framework) {
    if (f.source) frameworkBySource.set(f.source, f);
  }
  const activeToLib = new Map();

  function recordActivePlan(activePath, activeHash, libFile, explicitEntry) {
    if (activeHash === libFile.hash) {
      plan.unchanged.push({ path: activePath, version: libFile.version });
      return;
    }
    const recordedActiveHash = explicitEntry?.hash;
    const recordedLibHash = oldFiles[libFile.target]?.hash;
    const matchesPrior =
      (recordedActiveHash && activeHash === recordedActiveHash) ||
      (recordedLibHash && activeHash === recordedLibHash);
    if (matchesPrior) {
      plan.updates.push({
        path: activePath,
        from_version: explicitEntry?.version ?? null,
        to_version: libFile.version,
      });
      activeToLib.set(activePath, libFile);
    } else {
      plan.skipped_user_edited.push({
        path: activePath,
        reason: 'customized active file',
        to_version: libFile.version,
      });
      activeToLib.set(activePath, libFile);
    }
  }

  async function processSluglessActive(activePath, libraryKind) {
    const activeAbs = join(paths.root, activePath);
    if (!existsSync(activeAbs)) return;
    const content = await readFile(activeAbs, 'utf8');
    const activeHash = hashString(content);
    const explicitEntry = oldFiles[activePath];

    // Prefer explicit source pointer if present
    let libFile = explicitEntry?.source
      ? frameworkBySource.get(explicitEntry.source)
      : null;

    // Fallback: hash-match against library files of this kind, trying current
    // and previously-recorded hashes
    if (!libFile) {
      for (const f of framework) {
        if (!f.source?.startsWith(libraryKind + '/')) continue;
        const recordedHash = oldFiles[f.target]?.hash;
        if (f.hash === activeHash || recordedHash === activeHash) {
          libFile = f;
          break;
        }
      }
    }

    if (!libFile) {
      plan.skipped_user_edited.push({
        path: activePath,
        reason: 'unknown origin (no library source matched on hash)',
      });
      return;
    }

    recordActivePlan(activePath, activeHash, libFile, explicitEntry);
  }

  await processSluglessActive('.therapy/persona.md', 'personas');
  await processSluglessActive('.therapy/session-structure.md', 'structures');

  // Modalities are slug-named, so filename gives us the library source directly.
  const modalitiesDir = join(paths.root, '.therapy', 'modalities');
  if (existsSync(modalitiesDir)) {
    const entries = await readdir(modalitiesDir);
    for (const name of entries) {
      if (!name.endsWith('.md')) continue;
      const activePath = `.therapy/modalities/${name}`;
      const slug = name.replace(/\.md$/, '');
      const libFile = frameworkBySource.get(`modalities/${slug}.md`);
      if (!libFile) {
        plan.skipped_user_edited.push({
          path: activePath,
          reason: `library source modalities/${slug}.md no longer exists`,
        });
        continue;
      }
      const activeAbs = join(paths.root, activePath);
      const content = await readFile(activeAbs, 'utf8');
      const activeHash = hashString(content);
      recordActivePlan(activePath, activeHash, libFile, oldFiles[activePath]);
    }
  }

  // Legacy launcher cleanup. start-session.command and start-session.bat were
  // shipped pre-v2.4.2 as convenience launchers. They're no longer needed —
  // users start sessions via the Claude AI app or by running `claude` directly.
  // Only remove if the file matches a known unmodified shipped pattern; leave
  // customized launchers in place.
  const legacyLaunchers = [
    {
      filename: 'start-session.command',
      patterns: [
        `#!/bin/bash\ncd "${paths.root}"\nclaude\n`,
        `#\\!/bin/bash\ncd "${paths.root}"\nclaude\n`,
      ],
    },
    {
      filename: 'start-session.bat',
      patterns: [
        `@echo off\r\ncd /d "${paths.root}"\r\nclaude\r\n`,
      ],
    },
  ];
  for (const launcher of legacyLaunchers) {
    const launcherAbs = join(paths.root, launcher.filename);
    if (!existsSync(launcherAbs)) continue;
    const content = await readFile(launcherAbs, 'utf8');
    if (launcher.patterns.includes(content)) {
      plan.legacy_removed.push({ path: launcher.filename });
    } else {
      plan.skipped_user_edited.push({
        path: launcher.filename,
        reason: 'launcher file modified; left in place (no longer needed — use Claude AI app)',
      });
    }
  }

  if (opts.force) {
    plan.forced_overwrites = plan.skipped_user_edited;
    plan.skipped_user_edited = [];
  }

  // On legacy schema, surface that we'll fold unchanged files into the new registry.
  // This makes dry-run honest about what migration will accomplish.
  if (isLegacySchema && plan.unchanged.length > 0) {
    plan.registered_on_migration = plan.unchanged.map((u) => ({
      path: u.path,
      version: u.version,
    }));
  }

  if (opts.dryRun) {
    return { ok: true, dry_run: true, plan, legacy_schema: isLegacySchema };
  }

  const willWrite =
    plan.updates.length +
    plan.new_files.length +
    (plan.forced_overwrites?.length || 0) +
    plan.legacy_removed.length +
    plan.scaffolded.length +
    plan.settings_merge.filter(
      (m) =>
        m.action === 'add_safety_net_hook' ||
        m.action === 'add_usage_stats_hook'
    ).length;
  const willMigrateRegistry =
    isLegacySchema && plan.unchanged.length > 0;

  if (willWrite === 0 && !willMigrateRegistry) {
    // When the only plan item is a skipped settings merge (e.g. malformed
    // settings.json), "Already up to date." right after the skip notice reads
    // as a contradiction — suppress it and let the skip reason stand alone.
    const mergeSkipped = plan.settings_merge.some(
      (m) => m.action === 'skipped'
    );
    return {
      ok: true,
      backup: null,
      plan,
      ...(mergeSkipped ? {} : { message: 'Already up to date.' }),
    };
  }

  const backupPath = await snapshotTherapy(paths.therapy);

  const newVersion = { ...existing };
  newVersion.kit_version = pkgJson.version;
  newVersion.files = { ...oldFiles };
  newVersion.last_update = new Date().toISOString().slice(0, 10);

  const frameworkByTarget = new Map(framework.map((f) => [f.target, f]));

  const toWrite = [
    ...plan.updates,
    ...plan.new_files,
    ...(plan.forced_overwrites || []),
  ];
  for (const item of toWrite) {
    const isActive = isActiveCopy(item.path);
    const f = isActive ? activeToLib.get(item.path) : frameworkByTarget.get(item.path);
    if (!f) continue;
    const targetAbs = join(paths.root, item.path);
    await mkdir(dirname(targetAbs), { recursive: true });
    await writeFile(targetAbs, f.content, 'utf8');
    recordFile(newVersion, item.path, isActive ? null : f.version, f.hash, f.source);
  }

  // Legacy-schema migration: fold unchanged files into the registry so future
  // updates don't re-flag them as "unknown origin". Their content already
  // matches bundled, so we record hash without rewriting the file.
  if (isLegacySchema) {
    for (const item of plan.unchanged) {
      const f = frameworkByTarget.get(item.path);
      if (!f) continue;
      recordFile(newVersion, f.target, f.version, f.hash, f.source);
    }
  }

  // Remove deprecated launcher files (only those matching unmodified shipped patterns)
  for (const item of plan.legacy_removed) {
    const launcherAbs = join(paths.root, item.path);
    if (existsSync(launcherAbs)) {
      await unlink(launcherAbs);
    }
  }

  // Apply scaffolds: create directories (idempotent) and copy templates
  // only when the target doesn't exist. Never overwrites user content.
  for (const dir of scaffoldDirs) {
    await mkdir(dir, { recursive: true });
  }
  for (const sf of scaffoldTemplates) {
    if (!existsSync(sf.target)) {
      await copyFile(sf.source, sf.target);
    }
  }

  // Surgical settings merge: applySafetyNetMerge snapshots the file first (it
  // lives outside .therapy/, so snapshotTherapy doesn't cover it), appends the
  // canonical exec-form entry without reordering or dropping anything else,
  // and writes atomically. The apply step is self-sufficient — it re-reads and
  // re-verifies the file rather than trusting state captured at planning time,
  // so if the file changed underneath us the item downgrades to a skip with a
  // reason instead of silently no-opping or clobbering.
  const MERGE_DESC_BY_ACTION = {
    add_safety_net_hook: SAFETY_NET_DESC,
    add_usage_stats_hook: USAGE_STATS_DESC,
  };
  for (const item of plan.settings_merge) {
    const desc = MERGE_DESC_BY_ACTION[item.action];
    if (!desc) continue;
    // applyHookMerge is fail-soft: an fs failure inside the merge comes
    // back as { merged: false, code: 'error', reason } rather than throwing,
    // so the run completes (framework files are already written above and
    // version.json is written below — a crash here would leave a stale hash
    // registry and doctor would false-flag every updated file as "modified").
    const mergeResult = await applyHookMerge(paths.claudeSettings, desc);
    if (mergeResult.merged) {
      item.backup = mergeResult.backup;
    } else {
      item.action = 'skipped';
      item.reason =
        mergeResult.reason ||
        'settings.json changed between planning and writing — merge skipped.';
    }
  }

  await writeVersionJson(paths.versionJson, newVersion);

  return {
    ok: true,
    backup: backupPath,
    plan,
    kit_version: pkgJson.version,
    legacy_schema_migrated: isLegacySchema,
  };
}
