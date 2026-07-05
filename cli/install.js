import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { homedir } from 'node:os';

import { packageFile, therapyPaths, expandHome } from './lib/paths.js';
import { loadFramework, listLibrary, libraryAbsolute } from './lib/framework.js';
import { emptyVersionJson, recordFile, writeVersionJson } from './lib/version.js';
import { hashString } from './lib/hash.js';
import { applySafetyNetMerge, SETTINGS_REL_PATH } from './lib/settings.js';

const PERSONA_LABELS = {
  'warm-4o': 'Warm 4o-Style',
  'direct-challenging': 'Direct & Challenging',
  'warm-supportive': 'Warm & Supportive',
  coach: 'Coach',
  'grounded-real': 'Grounded & Real',
  contemplative: 'Contemplative & Spacious',
  philosophical: 'Philosophical & Existential',
  creative: 'Creative & Playful',
};

const STRUCTURE_LABELS = {
  structured: 'Structured',
  moderate: 'Moderate',
  freeform: 'Freeform',
};

async function prompt(rl, question, fallback) {
  const a = (await rl.question(question)).trim();
  return a || fallback;
}

async function gatherInteractive(partial) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const personas = await listLibrary('personas');
    const modalities = await listLibrary('modalities');
    const structures = await listLibrary('structures');

    const name =
      partial.name ||
      (await prompt(rl, 'Therapist name [Sage]: ', 'Sage'));

    const defaultPath = join(homedir(), name);
    const path =
      partial.path ||
      (await prompt(rl, `Storage path [${defaultPath}]: `, defaultPath));

    let persona = partial.persona;
    if (!persona) {
      stdout.write('\nCommunication styles:\n');
      personas.forEach((p, i) =>
        stdout.write(`  ${i + 1}. ${PERSONA_LABELS[p] || p} (${p})\n`)
      );
      const ans = await prompt(rl, 'Select [1]: ', '1');
      persona = personas[Number(ans) - 1] || personas[0];
    }

    let structure = partial.structure;
    if (!structure) {
      stdout.write('\nSession structures:\n');
      structures.forEach((s, i) =>
        stdout.write(`  ${i + 1}. ${STRUCTURE_LABELS[s] || s} (${s})\n`)
      );
      const ans = await prompt(rl, 'Select [2]: ', '2');
      structure = structures[Number(ans) - 1] || 'moderate';
    }

    let selectedModalities = partial.modalities;
    if (!selectedModalities) {
      stdout.write('\nTherapeutic approaches:\n');
      modalities.forEach((m, i) => stdout.write(`  ${i + 1}. ${m}\n`));
      const ans = await prompt(
        rl,
        'Select numbers comma-separated [1]: ',
        '1'
      );
      selectedModalities = ans
        .split(',')
        .map((s) => Number(s.trim()) - 1)
        .filter((i) => i >= 0 && i < modalities.length)
        .map((i) => modalities[i]);
      if (selectedModalities.length === 0) selectedModalities = ['cbt'];
    }

    return { name, path, persona, structure, modalities: selectedModalities };
  } finally {
    rl.close();
  }
}

function validate(opts, available) {
  const errs = [];
  if (!opts.name) errs.push('--name required');
  if (!opts.path) errs.push('--path required');
  if (!opts.persona) errs.push('--persona required');
  else if (!available.personas.includes(opts.persona))
    errs.push(`unknown persona: ${opts.persona}`);
  if (!opts.structure) errs.push('--structure required');
  else if (!available.structures.includes(opts.structure))
    errs.push(`unknown structure: ${opts.structure}`);
  if (!opts.modalities || opts.modalities.length === 0)
    errs.push('--modalities required');
  else {
    for (const m of opts.modalities) {
      if (!available.modalities.includes(m))
        errs.push(`unknown modality: ${m}`);
    }
  }
  return errs;
}

async function writeTemplateClaudeMd(targetPath, therapistName) {
  const template = await readFile(packageFile('CLAUDE.template.md'), 'utf8');
  const rendered = template.replaceAll('{{THERAPIST_NAME}}', therapistName);
  await writeFile(targetPath, rendered, 'utf8');
  return rendered;
}

export async function install(rawOpts) {
  const available = {
    personas: await listLibrary('personas'),
    modalities: await listLibrary('modalities'),
    structures: await listLibrary('structures'),
  };

  let opts = { ...rawOpts };

  const haveAll =
    opts.name && opts.path && opts.persona && opts.structure && opts.modalities;
  if (!haveAll) {
    if (!stdin.isTTY && !rawOpts.json) {
      const errs = validate(opts, available);
      throw new Error(
        'Non-interactive install missing flags:\n  ' + errs.join('\n  ')
      );
    }
    opts = await gatherInteractive(opts);
  }

  const errs = validate(opts, available);
  if (errs.length) throw new Error(errs.join('\n'));

  const paths = therapyPaths(opts.path);

  if (existsSync(paths.therapy) && !opts.force) {
    throw new Error(
      `Therapy folder already exists: ${paths.root}\nUse \`inner-dialogue update\` to update an existing install, or pass --force to reinstall.`
    );
  }

  await mkdir(paths.sessions, { recursive: true });
  await mkdir(paths.modalitiesDir, { recursive: true });
  await mkdir(paths.libraryPersonas, { recursive: true });
  await mkdir(paths.libraryModalities, { recursive: true });
  await mkdir(paths.libraryStructures, { recursive: true });
  await mkdir(paths.claudeDir, { recursive: true });
  await mkdir(paths.contextPeople, { recursive: true });
  await mkdir(paths.contextPlaces, { recursive: true });
  await mkdir(paths.contextConcepts, { recursive: true });
  await mkdir(paths.contextEvents, { recursive: true });

  const framework = await loadFramework();
  const pkgJson = JSON.parse(
    await readFile(packageFile('package.json'), 'utf8')
  );
  const versionData = emptyVersionJson(pkgJson.version);

  for (const f of framework) {
    const target = join(paths.root, f.target);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, f.content, 'utf8');
    recordFile(versionData, f.target, f.version, f.hash, f.source);
  }

  const personaContent = await readFile(
    libraryAbsolute('personas', opts.persona),
    'utf8'
  );
  await writeFile(paths.persona, personaContent, 'utf8');
  recordFile(
    versionData,
    '.therapy/persona.md',
    null,
    hashString(personaContent),
    `personas/${opts.persona}.md`
  );

  const structureContent = await readFile(
    libraryAbsolute('structures', opts.structure),
    'utf8'
  );
  await writeFile(paths.sessionStructure, structureContent, 'utf8');
  recordFile(
    versionData,
    '.therapy/session-structure.md',
    null,
    hashString(structureContent),
    `structures/${opts.structure}.md`
  );

  for (const m of opts.modalities) {
    const src = libraryAbsolute('modalities', m);
    const dest = join(paths.modalitiesDir, `${m}.md`);
    const content = await readFile(src, 'utf8');
    await writeFile(dest, content, 'utf8');
    recordFile(
      versionData,
      `.therapy/modalities/${m}.md`,
      null,
      hashString(content),
      `modalities/${m}.md`
    );
  }

  if (!existsSync(paths.profile)) {
    await copyFile(packageFile('profile.template.md'), paths.profile);
  }

  // Settings: scaffold from the template when missing. When the folder
  // already has a .claude/settings.json (install --force over an existing
  // setup, or a pre-created project folder), never clobber it — apply the
  // same surgical append-if-absent merge `update` uses, backup first.
  const settingsMerge = [];
  if (!existsSync(paths.claudeSettings)) {
    await copyFile(packageFile('claude-settings.template.json'), paths.claudeSettings);
  } else {
    // An fs failure inside the merge (backup copy or write) must not crash
    // the install — everything else about the setup is fine. Downgrade to a
    // skipped item carrying the error so the run completes and version.json
    // is still written.
    let mergeResult;
    try {
      mergeResult = await applySafetyNetMerge(paths.claudeSettings);
    } catch (err) {
      mergeResult = {
        merged: false,
        code: 'error',
        reason: `settings merge failed (${err.message}) — settings.json left as-is. Register the safety-net hook manually, or fix the underlying issue and run \`inner-dialogue update\`.`,
      };
    }
    if (mergeResult.merged) {
      settingsMerge.push({
        path: SETTINGS_REL_PATH,
        action: 'add_safety_net_hook',
        backup: mergeResult.backup,
      });
    } else if (mergeResult.code !== 'already_registered') {
      settingsMerge.push({
        path: SETTINGS_REL_PATH,
        action: 'skipped',
        reason: mergeResult.reason,
      });
    }
  }

  if (!existsSync(paths.contextIndex)) {
    await copyFile(packageFile('context', 'index.template.md'), paths.contextIndex);
  }

  await writeTemplateClaudeMd(paths.claudeMd, opts.name);

  await writeVersionJson(paths.versionJson, versionData);

  return {
    ok: true,
    therapist: opts.name,
    path: paths.root,
    persona: opts.persona,
    structure: opts.structure,
    modalities: opts.modalities,
    files_written: Object.keys(versionData.files).length + 1,
    settings_merge: settingsMerge,
  };
}
