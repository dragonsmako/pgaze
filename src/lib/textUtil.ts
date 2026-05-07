// Truncate to `width`, ending with an ellipsis if cut. Width 0 → empty.
export function truncate(s: string, width: number): string {
  if (width <= 0) return '';
  if (s.length <= width) return s;
  if (width <= 1) return '…';
  return s.slice(0, width - 1) + '…';
}

// Pad-or-truncate to exactly `width` columns.
export function pad(s: string, width: number): string {
  if (width <= 0) return '';
  if (s.length === width) return s;
  if (s.length > width) return truncate(s, width);
  return s + ' '.repeat(width - s.length);
}

// Hard-clip without an ellipsis.
export function clip(s: string, width: number): string {
  if (width <= 0) return '';
  return s.length > width ? s.slice(0, width) : s;
}

// Strip ANSI / OSC / DCS / SOS-PM-APC escape sequences and most C0/C1 control
// chars. Used on row data and notice messages so a malicious value cannot
// hijack the user's terminal (clipboard, cursor, colors).
//
// IMPORTANT: longer escape sequences are listed first; the C0-control class
// must come last and must NOT include 0x1B, otherwise it would consume the
// leading ESC of an OSC/CSI sequence and leave the rest as plain text.
const ANSI_RE = new RegExp(
  // OSC: ESC ] ... (BEL | ESC \)
  '\\x1b\\][\\s\\S]*?(?:\\x07|\\x1b\\\\)' +
    // DCS / SOS / PM / APC: ESC P|X|^|_ ... ESC \
    '|\\x1b[PX^_][\\s\\S]*?\\x1b\\\\' +
    // CSI: ESC [ params intermediates final
    '|\\x1b\\[[0-?]*[ -/]*[@-~]' +
    // Lone ESC fragment (e.g. ESC \ alone or unmatched)
    '|\\x1b' +
    // Other C0 controls (excludes \r \n \t which we collapse separately)
    '|[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1a\\x1c-\\x1f\\x7f]',
  'g',
);

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

// Convenience: strip control chars + collapse newlines/tabs to single space.
export function sanitizeCell(s: string): string {
  return stripAnsi(s).replace(/[\r\n\t]+/g, ' ');
}
