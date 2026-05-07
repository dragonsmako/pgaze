import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import type { Connection } from '../db/client.js';
import { countRows, fetchRows } from '../db/introspect.js';
import type { QueryResult } from '../types.js';
import { DataGrid, type GridCursor, type GridSort } from './DataGrid.js';

type Selection = { schema: string; table: string } | null;

type Props = {
  conn: Connection;
  selection: Selection;
  focused: boolean;
  maxCols: number;
  maxRows: number;
};

function formatForClipboard(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return value.toString('hex');
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function copyToClipboard(text: string): void {
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  process.stdout.write(`\x1b]52;c;${b64}\x07`);
}

export const TablePane: React.FC<Props> = ({ conn, selection, focused, maxCols, maxRows }) => {
  const pageSize = Math.max(5, maxRows - 5);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<QueryResult | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<GridSort | null>(null);
  const [cursor, setCursor] = useState<GridCursor>({ row: 0, col: 0 });
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  useEffect(() => {
    setPage(0);
    setData(null);
    setTotal(null);
    setError(null);
    setSort(null);
    setCursor({ row: 0, col: 0 });
    setCopyMsg(null);
  }, [selection?.schema, selection?.table]);

  useEffect(() => {
    if (!selection) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchRows(
        conn,
        selection.schema,
        selection.table,
        pageSize,
        page * pageSize,
        sort ?? undefined,
      ),
      total === null
        ? countRows(conn, selection.schema, selection.table).catch(() => null)
        : Promise.resolve(total),
    ])
      .then(([rows, count]) => {
        if (cancelled) return;
        setData(rows);
        if (count !== null) setTotal(count);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conn, selection?.schema, selection?.table, page, pageSize, sort]);

  // clamp cursor when data changes
  useEffect(() => {
    if (!data) return;
    setCursor((c) => ({
      row: Math.min(c.row, Math.max(0, data.rows.length - 1)),
      col: Math.min(c.col, Math.max(0, data.columns.length - 1)),
    }));
  }, [data]);

  useEffect(() => {
    if (copyMsg === null) return;
    const t = setTimeout(() => setCopyMsg(null), 1500);
    return () => clearTimeout(t);
  }, [copyMsg]);

  function toggleSort(): void {
    if (!data) return;
    const colName = data.columns[cursor.col];
    if (!colName) return;
    setSort((cur) => {
      if (!cur || cur.column !== colName) return { column: colName, dir: 'asc' };
      if (cur.dir === 'asc') return { column: colName, dir: 'desc' };
      return null;
    });
    setPage(0);
  }

  function copyCurrentCell(): void {
    if (!data) return;
    const value = data.rows[cursor.row]?.[cursor.col];
    const text = formatForClipboard(value);
    try {
      copyToClipboard(text);
      const preview = text.length > 24 ? text.slice(0, 21) + '…' : text;
      setCopyMsg(`Copied: ${preview || '(empty)'}`);
    } catch {
      setCopyMsg('Copy failed');
    }
  }

  useInput(
    (input, key) => {
      if (!selection || !data) return;

      if (key.ctrl && key.upArrow) {
        setCursor((c) => ({ ...c, row: 0 }));
        return;
      }
      if (key.ctrl && key.downArrow) {
        setCursor((c) => ({ ...c, row: Math.max(0, data.rows.length - 1) }));
        return;
      }
      if (key.ctrl && key.leftArrow) {
        setCursor((c) => ({ ...c, col: 0 }));
        return;
      }
      if (key.ctrl && key.rightArrow) {
        setCursor((c) => ({ ...c, col: Math.max(0, data.columns.length - 1) }));
        return;
      }
      if (key.upArrow) {
        setCursor((c) => ({ ...c, row: Math.max(0, c.row - 1) }));
        return;
      }
      if (key.downArrow) {
        setCursor((c) => ({
          ...c,
          row: Math.min(Math.max(0, data.rows.length - 1), c.row + 1),
        }));
        return;
      }
      if (key.leftArrow) {
        setCursor((c) => ({ ...c, col: Math.max(0, c.col - 1) }));
        return;
      }
      if (key.rightArrow) {
        setCursor((c) => ({
          ...c,
          col: Math.min(Math.max(0, data.columns.length - 1), c.col + 1),
        }));
        return;
      }
      if (key.return) {
        copyCurrentCell();
        return;
      }
      if (input === 's') {
        toggleSort();
        return;
      }
      if (input === 'n') {
        if (total === null || (page + 1) * pageSize < total) {
          setPage((p) => p + 1);
          setCursor((c) => ({ ...c, row: 0 }));
        }
        return;
      }
      if (input === 'p') {
        if (page > 0) {
          setPage((p) => Math.max(0, p - 1));
          setCursor((c) => ({ ...c, row: 0 }));
        }
        return;
      }
    },
    { isActive: focused },
  );

  if (!selection) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text dimColor>Select a table from the tree (Enter on a table) to view rows.</Text>
      </Box>
    );
  }

  if (loading && !data) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text>
          <Spinner type="dots" /> Loading {selection.schema}.{selection.table}…
        </Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>{selection.schema}.{selection.table}</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  if (!data) return null;

  const start = page * pageSize + 1;
  const end = page * pageSize + data.rows.length;
  const totalLabel = total === null ? '?' : String(total);
  const currentColName = data.columns[cursor.col] ?? '';
  const sortLabel = sort ? `sort: ${sort.column} ${sort.dir}` : 'no sort';

  return (
    <Box flexDirection="column">
      <Box paddingX={1} flexDirection="column">
        <Text>
          <Text bold>{selection.schema}.{selection.table}</Text>
          <Text dimColor>
            {'  '}rows {data.rows.length === 0 ? 0 : start}–{end} / {totalLabel}
            {'  '}page {page + 1}
          </Text>
        </Text>
        <Text dimColor>
          cell [{cursor.row + 1},{cursor.col + 1}] · col: {currentColName} · {sortLabel}
          {focused && '  · [↑↓←→] move · [Enter] copy · [s] sort · [n/p] page'}
          {copyMsg && (
            <Text color="green">  ✓ {copyMsg}</Text>
          )}
        </Text>
      </Box>
      <DataGrid
        columns={data.columns}
        rows={data.rows}
        maxCols={maxCols}
        maxRows={maxRows - 4}
        cursor={focused ? cursor : null}
        sort={sort}
      />
    </Box>
  );
};
