import { EventEmitter } from 'node:events';

class KeypressBus extends EventEmitter {
  lastCtrlEnterAt = 0;
}

export const keypressBus = new KeypressBus();

let listener: ((chunk: Buffer | string) => void) | null = null;

const ENABLE_PROTOCOLS = '\x1b[>1u\x1b[>4;1m';
const DISABLE_PROTOCOLS = '\x1b[<u\x1b[>4m';

export function installKeypressDetector(): void {
  if (listener) return;
  try {
    process.stdout.write(ENABLE_PROTOCOLS);
  } catch {
    /* ignore */
  }
  listener = (chunk) => {
    const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (s.includes('\x1b[13;5u') || s.includes('\x1b[27;5;13~')) {
      keypressBus.lastCtrlEnterAt = Date.now();
      keypressBus.emit('ctrl-enter');
    }
  };
  process.stdin.on('data', listener);
}

export function uninstallKeypressDetector(): void {
  if (listener) {
    process.stdin.off('data', listener);
    listener = null;
  }
  try {
    process.stdout.write(DISABLE_PROTOCOLS);
  } catch {
    /* ignore */
  }
}

export function recentlySawCtrlEnter(windowMs = 80): boolean {
  return Date.now() - keypressBus.lastCtrlEnterAt < windowMs;
}

const CSI_FRAGMENT_RE = /^\[(?:13;5u|27;\d+;13~)/;

export function looksLikeCtrlEnterFragment(input: string): boolean {
  return CSI_FRAGMENT_RE.test(input);
}
