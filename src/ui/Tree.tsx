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
  | { kind: 'schema'; depth: 0; schema: SchemaNode }
  | { kind: 'schema-loading'; depth: 1; schema: SchemaNode }
  | { kind: 'schema-error'; depth: 1; schema: SchemaNode }
  | { kind: 'table'; depth: 1; schema: SchemaNode; table: TableNode }
  | { kind: 'table-loading'; depth: 2; schema: SchemaNode; table: TableNode }
  | { kind: 'table-error'; depth: 2; schema: SchemaNode; table: TableNode }
  | { kind: 'column'; depth: 2; schema: SchemaNode; table: TableNode; column: ColumnInfo };

type Props = {
  conn: Connection;
  focused: boolean;
  maxCols: number;
  maxRows: number;
  onSelectTable: (schema: string, table: string) => void;
};

function truncate(s: string, width: number): string {
  if (width <= 0) return '';
  if (s.length <= width) return s;
  if (width <= 1) return '…';
  return s.slice(0, width - 1) + '…';
}

export const Tree: React.FC<Props> = ({ conn, focused, maxCols, maxRows, onSelectTable }) => {
  const [schemas, setSchemas] = useState<SchemaNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [topError, setTopError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [scroll, setScroll] = useState(0);

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
    flat.push({ kind: 'schema', depth: 0, schema });
    if (schema.expanded) {
      if (schema.loading) {
        flat.push({ kind: 'schema-loading', depth: 1, schema });
      } else if (schema.error) {
        flat.push({ kind: 'schema-error', depth: 1, schema });
      } else if (schema.tables) {
        schema.tables.forEach((table) => {
          flat.push({ kind: 'table', depth: 1, schema, table });
          if (table.expanded) {
            if (table.loading) {
              flat.push({ kind: 'table-loading', depth: 2, schema, table });
            } else if (table.error) {
              flat.push({ kind: 'table-error', depth: 2, schema, table });
            } else if (table.columns) {
              table.columns.forEach((column) => {
                flat.push({ kind: 'column', depth: 2, schema, table, column });
              });
            }
          }
        });
      }
    }
  });

  const safeCursor = flat.length === 0 ? 0 : Math.min(cursor, flat.length - 1);

  // header (1) + optional ▲ (1) + optional ▼ (1) + items
  const headerRows = 2; // "Schemas" + blank line
  const viewport = Math.max(1, maxRows - headerRows - 2); // -2 for indicator rows
  const safeScroll = Math.max(
    0,
    Math.min(scroll, Math.max(0, flat.length - viewport)),
  );

  // keep cursor in view
  useEffect(() => {
    setScroll((prev) => {
      let next = prev;
      if (safeCursor < next) next = safeCursor;
      else if (safeCursor >= next + viewport) next = safeCursor - viewport + 1;
      const max = Math.max(0, flat.length - viewport);
      if (next > max) next = max;
      if (next < 0) next = 0;
      return next;
    });
  }, [safeCursor, viewport, flat.length]);

  const visible = flat.slice(safeScroll, safeScroll + viewport);
  const hasAbove = safeScroll > 0;
  const hasBelow = safeScroll + viewport < flat.length;

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

  const current = flat[safeCursor];

  useInput(
    (_input, key) => {
      if (flat.length === 0) return;

      if (key.upArrow) {
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow) {
        setCursor((c) => Math.min(flat.length - 1, c + 1));
        return;
      }
      if (key.pageUp) {
        setCursor((c) => Math.max(0, c - viewport));
        return;
      }
      if (key.pageDown) {
        setCursor((c) => Math.min(flat.length - 1, c + viewport));
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
        <Text color="red">{truncate(topError, Math.max(8, maxCols - 2))}</Text>
      </Box>
    );
  }

  // available width for label (after arrow ' ', indent, icon ' ')
  const lineWidth = Math.max(8, maxCols - 1); // -1 padding-x

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text bold color={focused ? 'cyan' : undefined}>
          Schemas{' '}
          <Text dimColor>
            ({safeCursor + (flat.length === 0 ? 0 : 1)}/{flat.length})
          </Text>
        </Text>
      </Box>
      <Box height={1}>
        {hasAbove ? <Text dimColor>▲ {safeScroll} more</Text> : <Text> </Text>}
      </Box>
      {flat.length === 0 ? (
        <Text dimColor>No schemas.</Text>
      ) : (
        visible.map((item, i) => {
          const realIndex = safeScroll + i;
          const sel = realIndex === safeCursor && focused;
          return <Row key={realIndex} item={item} selected={sel} maxWidth={lineWidth} />;
        })
      )}
      <Box height={1}>
        {hasBelow ? (
          <Text dimColor>▼ {flat.length - (safeScroll + viewport)} more</Text>
        ) : (
          <Text> </Text>
        )}
      </Box>
    </Box>
  );
};

const Row: React.FC<{ item: FlatItem; selected: boolean; maxWidth: number }> = ({
  item,
  selected,
  maxWidth,
}) => {
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

  // build the line and clip to one terminal line
  const prefix = `${arrow} ${indent}${icon} `;
  const labelBudget = Math.max(1, maxWidth - prefix.length);
  const line = prefix + truncate(label, labelBudget);

  return (
    <Text color={selected ? 'green' : color} dimColor={dim && !selected} wrap="truncate">
      {line}
    </Text>
  );
};
