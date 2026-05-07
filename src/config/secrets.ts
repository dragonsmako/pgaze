import { logWarn } from '../lib/log.js';

const SERVICE = 'pgaze';

type EntryCtor = new (service: string, account: string) => {
  getPassword(): Promise<string | undefined>;
  setPassword(password: string): Promise<void>;
  deleteCredential(): Promise<boolean>;
};

let cachedCtor: EntryCtor | null | undefined;
let loadFailureLogged = false;

async function getEntryCtor(): Promise<EntryCtor | null> {
  if (cachedCtor !== undefined) return cachedCtor;
  try {
    const mod = await import('@napi-rs/keyring');
    cachedCtor = (mod as unknown as { AsyncEntry: EntryCtor }).AsyncEntry;
  } catch (err) {
    if (!loadFailureLogged) {
      loadFailureLogged = true;
      logWarn(
        `Keyring backend unavailable (${err instanceof Error ? err.message : String(err)}). ` +
          `Passwords will be prompted on connect.`,
      );
    }
    cachedCtor = null;
  }
  return cachedCtor;
}

export async function isKeyringAvailable(): Promise<boolean> {
  const Entry = await getEntryCtor();
  if (!Entry) return false;
  try {
    const probe = new Entry(SERVICE, '__probe__');
    // a missing entry throws on this backend; treat that as "available".
    await probe.getPassword().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export async function getPassword(serverId: string): Promise<string | null> {
  const Entry = await getEntryCtor();
  if (!Entry) return null;
  try {
    const entry = new Entry(SERVICE, serverId);
    const value = await entry.getPassword();
    return value ?? null;
  } catch {
    // The Rust backend throws "no entry" when the credential is missing; treat
    // missing as "no stored password" rather than an error.
    return null;
  }
}

export async function setPassword(serverId: string, password: string): Promise<boolean> {
  const Entry = await getEntryCtor();
  if (!Entry) return false;
  try {
    const entry = new Entry(SERVICE, serverId);
    await entry.setPassword(password);
    return true;
  } catch (err) {
    logWarn(`Keyring write failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export async function deletePassword(serverId: string): Promise<void> {
  const Entry = await getEntryCtor();
  if (!Entry) return;
  try {
    const entry = new Entry(SERVICE, serverId);
    await entry.deleteCredential();
  } catch {
    /* ignore — missing entry is fine */
  }
}
