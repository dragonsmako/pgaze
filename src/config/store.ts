import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ServerConfig } from '../types.js';

function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), '.config');
  return path.join(base, 'pgaze');
}

function configFile(): string {
  return path.join(configDir(), 'servers.json');
}

export async function loadServers(): Promise<ServerConfig[]> {
  const file = configFile();
  try {
    const buf = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(buf);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is ServerConfig =>
        s &&
        typeof s.id === 'string' &&
        typeof s.name === 'string' &&
        typeof s.host === 'string' &&
        typeof s.port === 'number' &&
        typeof s.database === 'string' &&
        typeof s.user === 'string',
    );
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return [];
    throw err;
  }
}

export async function saveServers(servers: ServerConfig[]): Promise<void> {
  const dir = configDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = configFile();
  const data = JSON.stringify(servers, null, 2);
  await fs.writeFile(file, data, { mode: 0o600 });
}
