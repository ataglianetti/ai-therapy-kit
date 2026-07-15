import { readFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { packageFile, PACKAGE_ROOT } from './paths.js';
import { hashString, extractVersion } from './hash.js';

const SINGLE_FILES = [
  { source: 'safety-protocol.md', target: '.therapy/safety-protocol.md' },
  { source: 'commands.md', target: '.therapy/commands.md' },
  { source: 'profile-protocol.md', target: '.therapy/profile-protocol.md' },
  { source: 'hooks/safety-net.js', target: '.therapy/hooks/safety-net.js' },
  { source: 'hooks/usage-stats.js', target: '.therapy/hooks/usage-stats.js' },
  { source: 'usage-reflection.md', target: '.therapy/usage-reflection.md' },
];

const LIBRARY_DIRS = [
  { source: 'personas', target: '.therapy/library/personas' },
  { source: 'modalities', target: '.therapy/library/modalities' },
  { source: 'structures', target: '.therapy/library/structures' },
];

async function readFrameworkFile(relSource) {
  const abs = packageFile(relSource);
  const content = await readFile(abs, 'utf8');
  return {
    source: relSource,
    content,
    hash: hashString(content),
    version: extractVersion(content),
  };
}

export async function loadFramework() {
  const files = [];
  for (const f of SINGLE_FILES) {
    const data = await readFrameworkFile(f.source);
    files.push({ ...data, target: f.target });
  }
  for (const dir of LIBRARY_DIRS) {
    const entries = await readdir(packageFile(dir.source));
    for (const name of entries) {
      if (!name.endsWith('.md')) continue;
      const source = `${dir.source}/${name}`;
      const data = await readFrameworkFile(source);
      files.push({ ...data, target: `${dir.target}/${name}` });
    }
  }
  return files;
}

export async function listLibrary(kind) {
  const dir = LIBRARY_DIRS.find((d) => d.source === kind);
  if (!dir) throw new Error(`Unknown library kind: ${kind}`);
  const entries = await readdir(packageFile(dir.source));
  return entries.filter((n) => n.endsWith('.md')).map((n) => basename(n, '.md'));
}

export function libraryAbsolute(kind, slug) {
  const dir = LIBRARY_DIRS.find((d) => d.source === kind);
  if (!dir) throw new Error(`Unknown library kind: ${kind}`);
  return packageFile(dir.source, `${slug}.md`);
}

export { PACKAGE_ROOT };
