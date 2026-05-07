#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { installKeypressDetector, uninstallKeypressDetector } from './lib/keypress.js';

// Single atomic write to enter the alt-screen, home the cursor, and hide it.
const ENTER = '\x1b[?1049h\x1b[H\x1b[?25l';
const EXIT = '\x1b[?25h\x1b[?1049l';

let restored = false;
function restoreScreen(): void {
  if (restored) return;
  restored = true;
  try {
    uninstallKeypressDetector();
  } catch {
    /* ignore */
  }
  try {
    process.stdout.write(EXIT);
  } catch {
    /* ignore */
  }
}

// Make sure the terminal is restored even on signals or fatal errors.
process.on('exit', restoreScreen);
process.on('SIGINT', () => {
  restoreScreen();
  process.exit(130);
});
process.on('SIGTERM', () => {
  restoreScreen();
  process.exit(143);
});
process.on('SIGHUP', () => {
  restoreScreen();
  process.exit(129);
});
process.on('uncaughtException', (err) => {
  restoreScreen();
  // eslint-disable-next-line no-console
  console.error('Uncaught exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  restoreScreen();
  // eslint-disable-next-line no-console
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

if (process.stdout.isTTY) {
  process.stdout.write(ENTER);
} else {
  // not a TTY (piped output) — skip the alt-screen toggle
}
installKeypressDetector();

const ink = render(<App />, { exitOnCtrlC: true });
ink.waitUntilExit().finally(restoreScreen);
