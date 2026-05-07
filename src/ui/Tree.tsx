import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import type { ColumnInfo, TableInfo } from '../types.js';
import type { Connection } from '../db/client.js';
import { listColumns, listSchemas, listTables } from '../db/introspect.js';

type SchemaNode = {
  name: string;
  expanded: boolean;
  loading: boolean;
  tables?: TableNode[];
  error?: string;
};

type TableNode = {
  name: string;
  kind: string;
  expanded: boolean;
  loading: boolean;
  columns?: ColumnInfo[];
  error?: string;
};

type FlatItem =
  | { kind: 'schema'; depth: 0; schema: SchemaNode; index: number }
  | { kind: 'schema-loading'; depth: 1; schema: SchemaNode; index: number }
  | { kind: 'schema-error'; depth: 1; schema: SchemaNode; index: number }
  | { kind: 'table'; depth: 1; schema: SchemaNode; table: TableNode; tableIndex: number; index: number }
  | { kind: 'table-loading'; depth: 2; schema: SchemaNode; table: TableNode; index: number }
  | { kind: 'table-error'; depth: 2; schema: SchemaNode; table: TableNode; index: number }
  | { kind: 'column'; depth: 2; schema: SchemaNode; table: TableNode; column: ColumnInfo; index: number };

type Props = {
  conn: Connection;
  focused: boolean;
  onSelectTable: (schema: string, table: string) => void;
};

export const Tree: React.FC<Props> = ({ conn, focused, onSelectTable }) => {
  const [schemas, setSchemas] = useState<SchemaNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [topError, setTopError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listSchemas(conn)
      .then((names) => {
        if (cancelled) return;
        setSchemas(
          names.map((n) => ({ name: n, expanded: false, loading: false })),
        );
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setTopError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conn]);

  const flat: FlatItem[] = [];
  schemas.forEach((schema) => {
    flat.push({ kind: 'schema', depth: 0, schema, index: flat.length });
    if (schema.expanded) {
      if (schema.loading) {
        flat.push({ kind: 'schema-loading', depth: 1, schema, index: flat.length });
      } else if (schema.error) {
        flat.push({ kind: 'schema-error', depth: 1, schema, index: flat.length });
      } else if (schema.tables) {
        schema.tables.forEach((table, tableIndex) => {
          flat.push({
            kind: 'table',
            depth: 1,
            schema,
            table,
            tableIndex,
            index: flat.length,
          });
          if (table.expanded) {
            if (table.loading) {
              flat.push({ kind: 'table-loading', depth: 2, schema, table, index: flat.length });
            } else if (table.error) {
              flat.push({ kind: 'table-error', depth: 2, schema, table, index: flat.length });
            } else if (table.columns) {
              table.columns.forEach((column) => {
                flat.push({
                  kind: 'column',
                  depth: 2,
                  schema,
                  table,
                  column,
                  index: flat.length,
                });
              });
            }
          }
        });
      }
    }
  });

  const safeCursor = flat.length === 0 ? 0 : Math.min(cursor, flat.length - 1);
  const current = flat[safeCursor];

  function updateSchema(name: string, patch: Partial<SchemaNode>): void {
    setSchemas((prev) =>
      prev.map((s) => (s.name === name ? { ...s, ...patch } : s)),
    );
  }

  function updateTable(schemaName: string, tableName: string, patch: Partial<TableNode>): void {
    setSchemas((prev) =>
      prev.map((s) => {
        if (s.name !== schemaName || !s.tables) return s;
        return {
          ...s,
          tables: s.tables.map((t) => (t.name === tableName ? { ...t, ...patch } : t)),
        };
      }),
    );
  }

  async function expandSchema(schema: SchemaNode): Promise<void> {
    if (schema.tables) {
      updateSchema(schema.name, { expanded: true });
      return;
    }
    updateSchema(schema.name, { expanded: true, loading: true, error: undefined });
    try {
      const tables = await listTables(conn, schema.name);
      updateSchema(schema.name, {
        loading: false,
        tables: tables.map((t) => ({
          name: t.name,
          kind: t.kind,
          expanded: false,
          loading: false,
        })),
      });
    } catch (err) {
      updateSchema(schema.name, {
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function expandTable(schemaName: string, table: TableNode): Promise<void> {
    if (table.columns) {
      updateTable(schemaName, table.name, { expanded: true });
      return;
    }
    updateTable(schemaName, table.name, { expanded: true, loading: true, error: undefined });
    try {
      const columns = await listColumns(conn, schemaName, table.name);
      updateTable(schemaName, table.name, { loading: false, columns });
    } catch (err) {
      updateTable(schemaName, table.name, {
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  useInput(
    (input, key) => {
      if (flat.length === 0) return;

      if (key.upArrow) {
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow) {
        setCursor((c) => Math.min(flat.length - 1, c + 1));
        return;
      }

      if (!current) return;

      if (key.return) {
        if (current.kind === 'schema') {
          if (current.schema.expanded) {
            updateSchema(current.schema.name, { expanded: false });
          } else {
            void expandSchema(current.schema);
          }
        } else if (current.kind === 'table') {
          onSelectTable(current.schema.name, current.table.name);
        } else if (current.kind === 'column') {
          onSelectTable(current.schema.name, current.table.name);
        }
        return;
      }

      if (key.rightArrow) {
        if (current.kind === 'schema' && !current.schema.expanded) {
          void expandSchema(current.schema);
        } else if (current.kind === 'table' && !current.table.expanded) {
          void expandTable(current.schema.name, current.table);
        }
        return;
      }

      if (key.leftArrow) {
        if (current.kind === 'schema' && current.schema.expanded) {
          updateSchema(current.schema.name, { expanded: false });
        } else if (current.kind === 'table' && current.table.expanded) {
          updateTable(current.schema.name, current.table.name, { expanded: false });
        } else if (current.kind === 'column') {
          updateTable(current.schema.name, current.table.name, { expanded: false });
        }
        return;
      }
    },
    { isActive: focused },
  );

  if (loading) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>
          <Spinner type="dots" /> Loading schemas…
        </Text>
      </Box>
    );
  }

  if (topError) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">{topError}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Box marginBottom={1}>
        <Text bold color={focused ? 'cyan' : undefined}>
          {focused ? '▸ ' : '  '}Schemas
        </Text>
      </Box>
      {flat.length === 0 ? (
        <Text dimColor>No schemas.</Text>
      ) : (
        flat.map((item, i) => {
          const sel = i === safeCursor && focused;
          return <Row key={i} item={item} selected={sel} />;
        })
      )}
    </Box>
  );
};

const Row: React.FC<{ item: FlatItem; selected: boolean }> = ({ item, selected }) => {
  const indent = '  '.repeat(item.depth);
  const arrow = selected ? '▸' : ' ';
  let icon = ' ';
  let label = '';
  let dim = false;
  let color: string | undefined;

  if (item.kind === 'schema') {
    icon = item.schema.expanded ? '▾' : '▸';
    label = item.schema.name;
  } else if (item.kind === 'schema-loading') {
    icon = ' ';
    label = 'loading…';
    dim = true;
  } else if (item.kind === 'schema-error') {
    icon = '!';
    label = item.schema.error ?? 'error';
    color = 'red';
  } else if (item.kind === 'table') {
    icon = item.table.expanded ? '▾' : '▸';
    const isView = item.table.kind !== 'BASE TABLE';
    label = item.table.name + (isView ? ` (${item.table.kind.toLowerCase()})` : '');
  } else if (item.kind === 'table-loading') {
    icon = ' ';
    label = 'loading…';
    dim = true;
  } else if (item.kind === 'table-error') {
    icon = '!';
    label = item.table.error ?? 'error';
    color = 'red';
  } else if (item.kind === 'column') {
    icon = '·';
    label = `${item.column.name}  ${item.column.dataType}`;
    dim = true;
  }

  return (
    <Text color={selected ? 'green' : color} dimColor={dim && !selected}>
      {arrow} {indent}{icon} {label}
    </Text>
  );
};
