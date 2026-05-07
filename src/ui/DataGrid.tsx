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
  return String(value);
}

function truncate(s: string, width: number): string {
  if (width <= 0) return '';
  if (s.length <= width) return s.padEnd(width, ' ');
  if (width <= 1) return '…';
  return s.slice(0, width - 1) + '…';
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

  // compute natural widths, then fit to maxCols
  const natural = columns.map((c, i) => {
    let w = c.length;
    for (const row of cellStrings) {
      const v = row[i] ?? '';
      if (v.length > w) w = v.length;
    }
    return Math.min(w, 40);
  });

  const sep = ' │ ';
  const sepCost = sep.length * (columns.length - 1);
  const budget = Math.max(columns.length * 3, maxCols - sepCost);
  const total = natural.reduce((a, b) => a + b, 0);
  let widths = natural;
  if (total > budget) {
    const scale = budget / total;
    widths = natural.map((w) => Math.max(3, Math.floor(w * scale)));
  }

  const headerLine = columns.map((c, i) => truncate(c, widths[i] ?? 0)).join(sep);
  const ruleLine = widths.map((w) => '─'.repeat(w)).join('─┼─');

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>{headerLine}</Text>
      <Text dimColor>{ruleLine}</Text>
      {cellStrings.length === 0 ? (
        <Text dimColor>(0 rows)</Text>
      ) : (
        cellStrings.map((row, r) => (
          <Text key={r}>
            {row.map((v, i) => truncate(v, widths[i] ?? 0)).join(sep)}
          </Text>
        ))
      )}
    </Box>
  );
};
