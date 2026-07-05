import { cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

export async function snapshotTherapy(therapyDir) {
  if (!existsSync(therapyDir)) return null;
  const parent = dirname(therapyDir);
  const base = basename(therapyDir);
  const dest = join(parent, `${base}.bak-${timestamp()}`);
  await cp(therapyDir, dest, { recursive: true });
  return dest;
}

export async function snapshotFile(filePath) {
  if (!existsSync(filePath)) return null;
  const dest = `${filePath}.bak-${timestamp()}`;
  await cp(filePath, dest);
  return dest;
}
