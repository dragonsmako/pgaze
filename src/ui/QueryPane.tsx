import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import type { Connection } from '../db/client.js';
import { runQuery } from '../db/introspect.js';
import type { QueryResult } from '../types.js';
import { DataGrid } from './DataGrid.js';

type Props = {
  conn: Connection;
  focused: boolean;
  maxCols: number;
  maxRows: number;
};

export const QueryPane: React.FC<Props> = ({ conn, focused, maxCols, maxRows }) => {
  const [sql, setSql] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(true);

  useInput(
    (input, key) => {
      if (!editing) {
        if (input === 'i' || key.return) {
          setEditing(true);
        }
      }
    },
    { isActive: focused && !editing },
  );

  function handleSubmit(): void {
    const trimmed = sql.trim();
    if (trimmed.length === 0) return;
    setRunning(true);
    setError(null);
    runQuery(conn, trimmed)
      .then((res) => {
        setResult(res);
        setRunning(false);
        setEditing(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setRunning(false);
        setEditing(false);
      });
  }

  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        <Text bold color="magenta">SQL </Text>
        <Text dimColor>{editing ? '(Enter to run)' : '(i / Enter to edit)'}</Text>
      </Box>
      <Box paddingX={1}>
        <Text color="green">› </Text>
        {editing && focused ? (
          <TextInput value={sql} onChange={setSql} onSubmit={handleSubmit} />
        ) : (
          <Text dimColor>{sql || '<empty>'}</Text>
        )}
      </Box>

      <Box paddingX={1} marginTop={1}>
        {running ? (
          <Text>
            <Spinner type="dots" /> Running…
          </Text>
        ) : error ? (
          <Text color="red">{error}</Text>
        ) : result ? (
          <Text dimColor>
            {result.rows.length} row{result.rows.length === 1 ? '' : 's'}
            {result.columns.length > 0 ? ` · ${result.columns.length} col(s)` : ''}
          </Text>
        ) : (
          <Text dimColor>Type a SQL statement and press Enter.</Text>
        )}
      </Box>

      {result && !running && (
        <DataGrid
          columns={result.columns}
          rows={result.rows}
          maxCols={maxCols}
          maxRows={maxRows - 4}
        />
      )}
    </Box>
  );
};
