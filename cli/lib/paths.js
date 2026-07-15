import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const PACKAGE_ROOT = resolve(__dirname, '..', '..');

export function packageFile(...parts) {
  return join(PACKAGE_ROOT, ...parts);
}

export function expandHome(p) {
  if (!p) return p;
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

export function therapyPaths(root) {
  const r = resolve(expandHome(root));
  return {
    root: r,
    claudeMd: join(r, 'CLAUDE.md'),
    profile: join(r, 'profile.md'),
    sessions: join(r, 'sessions'),
    therapy: join(r, '.therapy'),
    versionJson: join(r, '.therapy', 'version.json'),
    safetyProtocol: join(r, '.therapy', 'safety-protocol.md'),
    commands: join(r, '.therapy', 'commands.md'),
    profileProtocol: join(r, '.therapy', 'profile-protocol.md'),
    persona: join(r, '.therapy', 'persona.md'),
    sessionStructure: join(r, '.therapy', 'session-structure.md'),
    modalitiesDir: join(r, '.therapy', 'modalities'),
    hooksDir: join(r, '.therapy', 'hooks'),
    safetyNetHook: join(r, '.therapy', 'hooks', 'safety-net.js'),
    usageStatsHook: join(r, '.therapy', 'hooks', 'usage-stats.js'),
    usageReflection: join(r, '.therapy', 'usage-reflection.md'),
    usageLog: join(r, '.therapy', 'usage-log.txt'),
    library: join(r, '.therapy', 'library'),
    libraryPersonas: join(r, '.therapy', 'library', 'personas'),
    libraryModalities: join(r, '.therapy', 'library', 'modalities'),
    libraryStructures: join(r, '.therapy', 'library', 'structures'),
    claudeDir: join(r, '.claude'),
    claudeSettings: join(r, '.claude', 'settings.json'),
    context: join(r, 'context'),
    contextIndex: join(r, 'context', 'index.md'),
    contextPeople: join(r, 'context', 'people'),
    contextPlaces: join(r, 'context', 'places'),
    contextConcepts: join(r, 'context', 'concepts'),
    contextEvents: join(r, 'context', 'events'),
  };
}
