import React from 'react';
import { Box, Text } from 'ink';

type Props = {
  columns: string[];
  rows: unknown[][];
  maxCols: number;
  maxRows: number;
};

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value).replace(/[\r\n\t]+/g, ' ');
}

function pad(s: string, width: number): string {
  if (width <= 0) return '';
  if (s.length === width) return s;
  if (s.length > width) {
    if (width <= 1) return '…';
    return s.slice(0, width - 1) + '…';
  }
  return s + ' '.repeat(width - s.length);
}

function clip(s: string, width: number): string {
  if (width <= 0) return '';
  return s.length > width ? s.slice(0, width) : s;
}

export const DataGrid: React.FC<Props> = ({ columns, rows, maxCols, maxRows }) => {
  if (columns.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>No columns.</Text>
      </Box>
    );
  }

  const visibleRows = rows.slice(0, Math.max(0, maxRows));
  const cellStrings: string[][] = visibleRows.map((row) =>
    columns.map((_, i) => formatCell(row[i])),
  );

  // Pick a separator and per-column widths that fit maxCols.
  // Try ' │ ' (3) first, then ' ' (1) if there's no room.
  const candidates: { sep: string; width: number }[] = [
    { sep: ' │ ', width: 3 },
    { sep: ' ', width: 1 },
  ];
  let sep = ' │ ';
  let widths: number[] = [];
  let displayCols = columns.length;

  for (const cand of candidates) {
    const sepCost = cand.width * (columns.length - 1);
    const budget = maxCols - sepCost;
    if (budget < columns.length * 2) continue; // need at least 2 chars per col

    // natural widths capped at 32
    const natural = columns.map((c, i) => {
      let w = c.length;
      for (const row of cellStrings) {
        const v = row[i] ?? '';
        if (v.length > w) w = v.length;
      }
      return Math.min(w, 32);
    });

    const total = natural.reduce((a, b) => a + b, 0);
    let cw = natural;
    if (total > budget) {
      const scale = budget / total;
      cw = natural.map((w) => Math.max(2, Math.floor(w * scale)));
      // shrink further if still over
      let cur = cw.reduce((a, b) => a + b, 0);
      let i = 0;
      while (cur > budget && i < cw.length * 4) {
        const idx = i % cw.length;
        if ((cw[idx] ?? 0) > 2) {
          cw[idx] = (cw[idx] ?? 0) - 1;
          cur -= 1;
        }
        i++;
      }
    }
    sep = cand.sep;
    widths = cw;
    break;
  }

  // If no candidate fit, drop trailing columns until we fit.
  if (widths.length === 0) {
    const sepCost = 1;
    let n = columns.length;
    while (n > 0 && (n - 1) * sepCost + n * 2 > maxCols) {
      n -= 1;
    }
    displayCols = Math.max(1, n);
    sep = ' ';
    widths = new Array(displayCols).fill(2);
  }

  const headerLine = clip(
    columns.slice(0, displayCols).map((c, i) => pad(c, widths[i] ?? 0)).join(sep),
    maxCols,
  );
  const ruleLine = clip(widths.slice(0, displayCols).map((w) => '─'.repeat(w)).join(sep.replace(/[│ ]/g, '─')), maxCols);

  const dataLines = cellStrings.map((row) =>
    clip(
      row.slice(0, displayCols).map((v, i) => pad(v, widths[i] ?? 0)).join(sep),
      maxCols,
    ),
  );

  const droppedCols = columns.length - displayCols;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold wrap="truncate">{headerLine}</Text>
      <Text dimColor wrap="truncate">{ruleLine}</Text>
      {dataLines.length === 0 ? (
        <Text dimColor>(0 rows)</Text>
      ) : (
        dataLines.map((line, r) => (
          <Text key={r} wrap="truncate">{line}</Text>
        ))
      )}
      {droppedCols > 0 && (
        <Text dimColor>… +{droppedCols} more column(s) hidden</Text>
      )}
    </Box>
  );
};
