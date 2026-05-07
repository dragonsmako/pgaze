#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { installKeypressDetector, uninstallKeypressDetector } from './lib/keypress.js';

const ENTER_ALT_SCREEN = '\x1b[?1049h\x1b[H';
const EXIT_ALT_SCREEN = '\x1b[?1049l';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

let restored = false;
function restoreScreen(): void {
  if (restored) return;
  restored = true;
  try {
    uninstallKeypressDetector();
    process.stdout.write(SHOW_CURSOR + EXIT_ALT_SCREEN);
  } catch {
    /* ignore */
  }
}

process.stdout.write(ENTER_ALT_SCREEN + HIDE_CURSOR);
installKeypressDetector();
process.on('exit', restoreScreen);

const ink = render(<App />, { exitOnCtrlC: true });
ink.waitUntilExit().finally(restoreScreen);
