import React from 'react';
import { Box, Text } from 'ink';

export type GridCursor = { row: number; col: number };
export type GridSort = { column: string; dir: 'asc' | 'desc' };

type Props = {
  columns: string[];
  rows: unknown[][];
  maxCols: number;
  maxRows: number;
  cursor?: GridCursor | null;
  sort?: GridSort | null;
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

const MAX_COL_WIDTH = 32;
const MIN_COL_WIDTH = 3;

function naturalWidth(header: string, cellsForCol: string[]): number {
  let w = header.length;
  for (const v of cellsForCol) if (v.length > w) w = v.length;
  return Math.min(w, MAX_COL_WIDTH);
}

type Window = {
  start: number;
  end: number; // inclusive
  widths: number[];
  sep: string;
  sepWidth: number;
};

function computeWindow(
  natural: number[],
  maxCols: number,
  cursorCol: number | null,
): Window {
  // Try ' │ ' first, then ' '
  for (const { sep, sepWidth } of [
    { sep: ' │ ', sepWidth: 3 },
    { sep: ' ', sepWidth: 1 },
  ]) {
    let start = 0;
    while (start < natural.length) {
      let used = 0;
      const widths: number[] = [];
      let end = start - 1;
      for (let i = start; i < natural.length; i++) {
        const cellW = Math.max(MIN_COL_WIDTH, natural[i] ?? MIN_COL_WIDTH);
        const cost = i === start ? cellW : cellW + sepWidth;
        if (used + cost > maxCols && end >= start) break;
        used += cost;
        widths.push(cellW);
        end = i;
        if (used >= maxCols) break;
      }
      if (end < start) {
        // can't fit even one column at this start; advance
        start += 1;
        continue;
      }
      const cursorVisible = cursorCol === null || (cursorCol >= start && cursorCol <= end);
      const cursorBeforeWindow = cursorCol !== null && cursorCol < start;
      if (cursorVisible) return { start, end, widths, sep, sepWidth };
      if (cursorBeforeWindow) {
        // shouldn't happen because we increment start; bail
        return { start, end, widths, sep, sepWidth };
      }
      start += 1;
    }
  }
  // Fallback: a single column truncated
  return { start: 0, end: 0, widths: [Math.max(1, maxCols)], sep: ' ', sepWidth: 1 };
}

function buildSegments(
  cells: string[],
  widths: number[],
  sep: string,
  start: number,
  end: number,
  highlightCol: number | null,
): { prefix: string; mid: string; suffix: string } {
  const padded = cells.slice(start, end + 1).map((c, i) => pad(c, widths[i] ?? 0));
  if (highlightCol === null || highlightCol < start || highlightCol > end) {
    return { prefix: padded.join(sep), mid: '', suffix: '' };
  }
  const localIdx = highlightCol - start;
  const before = padded.slice(0, localIdx).join(sep);
  const mid = padded[localIdx] ?? '';
  const after = padded.slice(localIdx + 1).join(sep);
  return {
    prefix: before + (before ? sep : ''),
    mid,
    suffix: after ? sep + after : '',
  };
}

export const DataGrid: React.FC<Props> = ({ columns, rows, maxCols, maxRows, cursor, sort }) => {
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

  // Header text decorated with sort arrow
  const headers = columns.map((c) => {
    if (sort && sort.column === c) return c + (sort.dir === 'asc' ? ' ↑' : ' ↓');
    return c;
  });

  // natural widths from headers + visible cells
  const natural = columns.map((_, i) => {
    const colCells = cellStrings.map((r) => r[i] ?? '');
    return naturalWidth(headers[i] ?? '', colCells);
  });

  const cursorCol = cursor ? Math.min(Math.max(0, cursor.col), columns.length - 1) : null;
  const win = computeWindow(natural, maxCols, cursorCol);

  // Build header line (prefix/mid/suffix split if cursor is in window)
  const headerSegs = buildSegments(
    headers,
    win.widths,
    win.sep,
    win.start,
    win.end,
    cursorCol,
  );

  const ruleParts = win.widths.map((w) => '─'.repeat(w));
  const ruleSep = win.sep.replace(/[│ ]/g, '─');
  const ruleLine = ruleParts.join(ruleSep);

  const dataLines = cellStrings.map((row, rIdx) => {
    const isCursorRow = cursor !== null && cursor !== undefined && cursor.row === rIdx;
    const segs = buildSegments(
      row,
      win.widths,
      win.sep,
      win.start,
      win.end,
      isCursorRow ? cursorCol : null,
    );
    return { isCursorRow, ...segs };
  });

  const droppedLeft = win.start;
  const droppedRight = columns.length - win.end - 1;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text wrap="truncate">
        {droppedLeft > 0 && <Text dimColor>◂ </Text>}
        <Text bold>{headerSegs.prefix}</Text>
        {headerSegs.mid && <Text bold inverse>{headerSegs.mid}</Text>}
        <Text bold>{headerSegs.suffix}</Text>
        {droppedRight > 0 && <Text dimColor> ▸</Text>}
      </Text>
      <Text dimColor wrap="truncate">{ruleLine}</Text>
      {dataLines.length === 0 ? (
        <Text dimColor>(0 rows)</Text>
      ) : (
        dataLines.map((line, r) => (
          <Text key={r} wrap="truncate">
            <Text>{line.prefix}</Text>
            {line.mid && <Text inverse>{line.mid}</Text>}
            <Text>{line.suffix}</Text>
          </Text>
        ))
      )}
      {(droppedLeft > 0 || droppedRight > 0) && (
        <Text dimColor>
          showing cols {win.start + 1}–{win.end + 1} of {columns.length}
          {droppedLeft > 0 ? '  (← more left)' : ''}
          {droppedRight > 0 ? '  (more right →)' : ''}
        </Text>
      )}
    </Box>
  );
};
