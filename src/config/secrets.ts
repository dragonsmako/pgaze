const SERVICE = 'pgadmin-tui';

type Keytar = {
  getPassword: (service: string, account: string) => Promise<string | null>;
  setPassword: (service: string, account: string, password: string) => Promise<void>;
  deletePassword: (service: string, account: string) => Promise<boolean>;
};

let cached: Keytar | null | undefined;

async function getKeytar(): Promise<Keytar | null> {
  if (cached !== undefined) return cached;
  try {
    const mod = (await import('keytar')) as unknown as { default?: Keytar } & Keytar;
    cached = mod.default ?? mod;
  } catch {
    cached = null;
  }
  return cached;
}

export async function isKeyringAvailable(): Promise<boolean> {
  const k = await getKeytar();
  if (!k) return false;
  try {
    // probe with a no-op read
    await k.getPassword(SERVICE, '__probe__');
    return true;
  } catch {
    return false;
  }
}

export async function getPassword(serverId: string): Promise<string | null> {
  const k = await getKeytar();
  if (!k) return null;
  try {
    return await k.getPassword(SERVICE, serverId);
  } catch {
    return null;
  }
}

export async function setPassword(serverId: string, password: string): Promise<boolean> {
  const k = await getKeytar();
  if (!k) return false;
  try {
    await k.setPassword(SERVICE, serverId, password);
    return true;
  } catch {
    return false;
  }
}

export async function deletePassword(serverId: string): Promise<void> {
  const k = await getKeytar();
  if (!k) return;
  try {
    await k.deletePassword(SERVICE, serverId);
  } catch {
    /* ignore */
  }
}
