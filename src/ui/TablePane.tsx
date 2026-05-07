import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import type { Connection } from '../db/client.js';
import { countRows, fetchRows } from '../db/introspect.js';
import type { QueryResult } from '../types.js';
import { DataGrid } from './DataGrid.js';

type Selection = { schema: string; table: string } | null;

type Props = {
  conn: Connection;
  selection: Selection;
  focused: boolean;
  maxCols: number;
  maxRows: number;
};

export const TablePane: React.FC<Props> = ({ conn, selection, focused, maxCols, maxRows }) => {
  const pageSize = Math.max(5, maxRows - 4);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<QueryResult | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(0);
    setData(null);
    setTotal(null);
    setError(null);
  }, [selection?.schema, selection?.table]);

  useEffect(() => {
    if (!selection) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchRows(conn, selection.schema, selection.table, pageSize, page * pageSize),
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
  }, [conn, selection?.schema, selection?.table, page, pageSize]);

  useInput(
    (input) => {
      if (!selection || !data) return;
      if (input === 'n') {
        if (total === null || (page + 1) * pageSize < total) {
          setPage((p) => p + 1);
        }
      } else if (input === 'p') {
        setPage((p) => Math.max(0, p - 1));
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

  return (
    <Box flexDirection="column">
      <Box paddingX={1} flexDirection="row" justifyContent="space-between">
        <Text>
          <Text bold>{selection.schema}.{selection.table}</Text>
          <Text dimColor>
            {'  '}rows {data.rows.length === 0 ? 0 : start}–{end} / {totalLabel}
            {'  '}page {page + 1}
          </Text>
        </Text>
      </Box>
      <DataGrid
        columns={data.columns}
        rows={data.rows}
        maxCols={maxCols}
        maxRows={maxRows - 2}
      />
    </Box>
  );
};
