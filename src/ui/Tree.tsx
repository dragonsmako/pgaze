import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import type { ColumnInfo, RoutineInfo, TableInfo } from '../types.js';
import type { Connection } from '../db/client.js';
import {
  listAllObjects,
  listColumns,
  listRoutines,
  listSchemas,
  listTables,
  listViews,
  type AllObject,
} from '../db/introspect.js';
import { truncate } from '../lib/textUtil.js';
import { useScrollViewport } from '../lib/useScrollViewport.js';
import { assertNever } from '../lib/assert.js';
import { SEARCH_DEBOUNCE_MS } from '../config/uiConstants.js';

type SectionKind = 'tables' | 'views' | 'functions';

const SECTION_LABELS: Record<SectionKind, string> = {
  tables: 'Tables',
  views: 'Views',
  functions: 'Functions',
};

type TableNode = {
  name: string;
  kind: string;
  expanded: boolean;
  loading: boolean;
  columns?: ColumnInfo[];
  error?: string;
};

type RoutineNode = RoutineInfo;

type SectionState = {
  kind: SectionKind;
  expanded: boolean;
  loading: boolean;
  error?: string;
  tables?: TableNode[];
  routines?: RoutineNode[];
};

type SchemaNode = {
  name: string;
  expanded: boolean;
  sections: SectionState[];
};

type FlatItem =
  | { kind: 'schema'; depth: 0; schema: SchemaNode }
  | { kind: 'section'; depth: 1; schema: SchemaNode; section: SectionState }
  | { kind: 'section-loading'; depth: 2; schema: SchemaNode; section: SectionState }
  | { kind: 'section-error'; depth: 2; schema: SchemaNode; section: SectionState }
  | { kind: 'section-empty'; depth: 2; schema: SchemaNode; section: SectionState }
  | { kind: 'table'; depth: 2; schema: SchemaNode; section: SectionState; table: TableNode }
  | { kind: 'table-loading'; depth: 3; schema: SchemaNode; table: TableNode }
  | { kind: 'table-error'; depth: 3; schema: SchemaNode; table: TableNode }
  | { kind: 'column'; depth: 3; schema: SchemaNode; table: TableNode; column: ColumnInfo }
  | { kind: 'function'; depth: 2; schema: SchemaNode; routine: RoutineNode };

type Props = {
  conn: Connection;
  focused: boolean;
  maxCols: number;
  maxRows: number;
  onSelectTable: (schema: string, table: string) => void;
  onSelectFunction: (sql: string) => void;
  onSearchingChange?: (searching: boolean) => void;
};

function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

function buildFunctionTemplate(
  schema: string,
  name: string,
  prokind: string | undefined,
  args?: string,
): string {
  const qualified = `${quoteIdent(schema)}.${quoteIdent(name)}`;
  // Escape any `*/` in the argument signature so a malicious function
  // metadata cannot break out of the comment and inject SQL.
  const safe = args ? args.replace(/\*\//g, '*\\/') : '';
  const argList = safe.trim().length > 0 ? `/* ${safe} */` : '';
  if (prokind === 'p') {
    return `CALL ${qualified}(${argList});`;
  }
  return `SELECT * FROM ${qualified}(${argList});`;
}

function makeSchema(name: string): SchemaNode {
  return {
    name,
    expanded: false,
    sections: [
      { kind: 'tables', expanded: false, loading: false },
      { kind: 'views', expanded: false, loading: false },
      { kind: 'functions', expanded: false, loading: false },
    ],
  };
}

export const Tree: React.FC<Props> = ({
  conn,
  focused,
  maxCols,
  maxRows,
  onSelectTable,
  onSelectFunction,
  onSearchingChange,
}) => {
  const [schemas, setSchemas] = useState<SchemaNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [topError, setTopError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);

  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [allObjects, setAllObjects] = useState<AllObject[] | null>(null);
  const [allObjectsLoading, setAllObjectsLoading] = useState(false);
  const [allObjectsError, setAllObjectsError] = useState<string | null>(null);

  useEffect(() => {
    onSearchingChange?.(searchMode);
  }, [searchMode, onSearchingChange]);

  // Debounce the search query so filtering doesn't run on every keystroke.
  useEffect(() => {
    if (!searchMode) {
      setDebouncedQuery('');
      return;
    }
    const t = setTimeout(() => setDebouncedQuery(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchQuery, searchMode]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listSchemas(conn)
      .then((names) => {
        if (cancelled) return;
        setSchemas(names.map(makeSchema));
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

  // ─────────────── flat list (memoised) ───────────────
  const searchResults = useMemo<AllObject[]>(() => {
    if (!searchMode) return [];
    const q = debouncedQuery.trim().toLowerCase();
    const source = allObjects ?? [];
    if (q.length === 0) return source.slice(0, 200);
    return source.filter((o) => (o.schema + '.' + o.name).toLowerCase().includes(q));
  }, [searchMode, debouncedQuery, allObjects]);

  const flat = useMemo<FlatItem[]>(() => {
    if (searchMode) return [];
    const out: FlatItem[] = [];
    schemas.forEach((schema) => {
      out.push({ kind: 'schema', depth: 0, schema });
      if (!schema.expanded) return;
      schema.sections.forEach((section) => {
        out.push({ kind: 'section', depth: 1, schema, section });
        if (!section.expanded) return;
        if (section.loading) {
          out.push({ kind: 'section-loading', depth: 2, schema, section });
          return;
        }
        if (section.error) {
          out.push({ kind: 'section-error', depth: 2, schema, section });
          return;
        }
        if (section.kind === 'functions') {
          const items = section.routines ?? [];
          if (items.length === 0) {
            out.push({ kind: 'section-empty', depth: 2, schema, section });
            return;
          }
          items.forEach((routine) => {
            out.push({ kind: 'function', depth: 2, schema, routine });
          });
        } else {
          const items = section.tables ?? [];
          if (items.length === 0) {
            out.push({ kind: 'section-empty', depth: 2, schema, section });
            return;
          }
          items.forEach((table) => {
            out.push({ kind: 'table', depth: 2, schema, section, table });
            if (!table.expanded) return;
            if (table.loading) {
              out.push({ kind: 'table-loading', depth: 3, schema, table });
              return;
            }
            if (table.error) {
              out.push({ kind: 'table-error', depth: 3, schema, table });
              return;
            }
            (table.columns ?? []).forEach((column) => {
              out.push({ kind: 'column', depth: 3, schema, table, column });
            });
          });
        }
      });
    });
    return out;
  }, [schemas, searchMode]);

  const total = searchMode ? searchResults.length : flat.length;
  const headerRows = searchMode ? 3 : 2;
  const viewport = Math.max(1, maxRows - headerRows - 2);
  const { safeCursor, safeScroll } = useScrollViewport({ cursor, total, viewport });

  // ─────────────── mutators ───────────────
  function patchSchema(name: string, fn: (s: SchemaNode) => SchemaNode): void {
    setSchemas((prev) => prev.map((s) => (s.name === name ? fn(s) : s)));
  }

  function patchSection(
    schemaName: string,
    sectionKind: SectionKind,
    fn: (s: SectionState) => SectionState,
  ): void {
    patchSchema(schemaName, (schema) => ({
      ...schema,
      sections: schema.sections.map((sec) => (sec.kind === sectionKind ? fn(sec) : sec)),
    }));
  }

  function patchTable(
    schemaName: string,
    sectionKind: SectionKind,
    tableName: string,
    fn: (t: TableNode) => TableNode,
  ): void {
    patchSection(schemaName, sectionKind, (section) => ({
      ...section,
      tables: (section.tables ?? []).map((t) => (t.name === tableName ? fn(t) : t)),
    }));
  }

  async function loadSection(schemaName: string, section: SectionState): Promise<void> {
    patchSection(schemaName, section.kind, (s) => ({
      ...s,
      loading: true,
      error: undefined,
    }));
    try {
      if (section.kind === 'tables') {
        const tables = await listTables(conn, schemaName);
        patchSection(schemaName, 'tables', (s) => ({
          ...s,
          loading: false,
          tables: tables.map((t) => ({ ...t, expanded: false, loading: false })),
        }));
      } else if (section.kind === 'views') {
        const views = await listViews(conn, schemaName);
        patchSection(schemaName, 'views', (s) => ({
          ...s,
          loading: false,
          tables: views.map((t) => ({ ...t, expanded: false, loading: false })),
        }));
      } else {
        const routines = await listRoutines(conn, schemaName);
        patchSection(schemaName, 'functions', (s) => ({
          ...s,
          loading: false,
          routines,
        }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      patchSection(schemaName, section.kind, (s) => ({ ...s, loading: false, error: msg }));
    }
  }

  async function expandSection(schema: SchemaNode, section: SectionState): Promise<void> {
    patchSection(schema.name, section.kind, (s) => ({ ...s, expanded: true }));
    const alreadyLoaded =
      (section.kind === 'functions' && section.routines !== undefined) ||
      (section.kind !== 'functions' && section.tables !== undefined);
    if (!alreadyLoaded && !section.loading) {
      await loadSection(schema.name, section);
    }
  }

  async function expandTable(
    schemaName: string,
    sectionKind: SectionKind,
    table: TableNode,
  ): Promise<void> {
    if (table.columns) {
      patchTable(schemaName, sectionKind, table.name, (t) => ({ ...t, expanded: true }));
      return;
    }
    patchTable(schemaName, sectionKind, table.name, (t) => ({
      ...t,
      expanded: true,
      loading: true,
      error: undefined,
    }));
    try {
      const columns = await listColumns(conn, schemaName, table.name);
      patchTable(schemaName, sectionKind, table.name, (t) => ({
        ...t,
        loading: false,
        columns,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      patchTable(schemaName, sectionKind, table.name, (t) => ({
        ...t,
        loading: false,
        error: msg,
      }));
    }
  }

  // ─────────────── search ───────────────
  async function enterSearchMode(): Promise<void> {
    setSearchMode(true);
    setSearchQuery('');
    setDebouncedQuery('');
    setCursor(0);
    if (allObjects === null && !allObjectsLoading) {
      setAllObjectsLoading(true);
      setAllObjectsError(null);
      try {
        const list = await listAllObjects(conn);
        setAllObjects(list);
      } catch (err) {
        setAllObjectsError(err instanceof Error ? err.message : String(err));
      } finally {
        setAllObjectsLoading(false);
      }
    }
  }

  function exitSearchMode(): void {
    setSearchMode(false);
    setSearchQuery('');
    setDebouncedQuery('');
    setCursor(0);
  }

  function activateSearchResult(): void {
    const r = searchResults[safeCursor];
    if (!r) return;
    if (r.category === 'function') {
      onSelectFunction(buildFunctionTemplate(r.schema, r.name, r.prokind, ''));
    } else {
      onSelectTable(r.schema, r.name);
    }
    exitSearchMode();
  }

  // ─────────────── ctrl-arrow jumps ───────────────
  function jumpToSibling(direction: 1 | -1): void {
    if (searchMode) return;
    if (flat.length === 0) return;
    const currentDepth = flat[safeCursor]?.depth ?? 0;
    if (direction === 1) {
      for (let i = safeCursor + 1; i < flat.length; i++) {
        if ((flat[i]?.depth ?? 0) <= currentDepth) {
          setCursor(i);
          return;
        }
      }
      setCursor(flat.length - 1);
    } else {
      for (let i = safeCursor - 1; i >= 0; i--) {
        if ((flat[i]?.depth ?? 0) <= currentDepth) {
          setCursor(i);
          return;
        }
      }
      setCursor(0);
    }
  }

  // ─────────────── input ───────────────
  const currentItem = !searchMode ? flat[safeCursor] : null;

  useInput(
    (input, key) => {
      if (!focused) return;

      if (searchMode) {
        if (key.escape) {
          exitSearchMode();
          return;
        }
        if (key.upArrow) {
          setCursor((c) => Math.max(0, c - 1));
          return;
        }
        if (key.downArrow) {
          setCursor((c) => Math.min(Math.max(0, searchResults.length - 1), c + 1));
          return;
        }
        if (key.pageUp) {
          setCursor((c) => Math.max(0, c - viewport));
          return;
        }
        if (key.pageDown) {
          setCursor((c) => Math.min(Math.max(0, searchResults.length - 1), c + viewport));
          return;
        }
        return;
      }

      if (input === '/' && !key.ctrl && !key.meta) {
        void enterSearchMode();
        return;
      }

      if (total === 0) return;

      if (key.ctrl && key.upArrow) {
        jumpToSibling(-1);
        return;
      }
      if (key.ctrl && key.downArrow) {
        jumpToSibling(1);
        return;
      }
      if (key.upArrow) {
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow) {
        setCursor((c) => Math.min(total - 1, c + 1));
        return;
      }
      if (key.pageUp) {
        setCursor((c) => Math.max(0, c - viewport));
        return;
      }
      if (key.pageDown) {
        setCursor((c) => Math.min(total - 1, c + viewport));
        return;
      }

      if (!currentItem) return;

      if (key.return) {
        activateCurrent(currentItem);
        return;
      }
      if (key.rightArrow) {
        expandCurrent(currentItem);
        return;
      }
      if (key.leftArrow) {
        collapseCurrent(currentItem);
        return;
      }
    },
    { isActive: focused },
  );

  function activateCurrent(item: FlatItem): void {
    switch (item.kind) {
      case 'schema':
        patchSchema(item.schema.name, (s) => ({ ...s, expanded: !s.expanded }));
        return;
      case 'section':
        if (item.section.expanded) {
          patchSection(item.schema.name, item.section.kind, (s) => ({
            ...s,
            expanded: false,
          }));
        } else {
          void expandSection(item.schema, item.section);
        }
        return;
      case 'table':
      case 'column':
        onSelectTable(item.schema.name, item.table.name);
        return;
      case 'function':
        onSelectFunction(
          buildFunctionTemplate(
            item.schema.name,
            item.routine.name,
            item.routine.prokind,
            item.routine.args,
          ),
        );
        return;
      case 'section-loading':
      case 'section-error':
      case 'section-empty':
      case 'table-loading':
      case 'table-error':
        return; // non-actionable rows
      default:
        return assertNever(item);
    }
  }

  function expandCurrent(item: FlatItem): void {
    if (item.kind === 'schema' && !item.schema.expanded) {
      patchSchema(item.schema.name, (s) => ({ ...s, expanded: true }));
    } else if (item.kind === 'section' && !item.section.expanded) {
      void expandSection(item.schema, item.section);
    } else if (item.kind === 'table' && !item.table.expanded) {
      void expandTable(item.schema.name, item.section.kind, item.table);
    }
  }

  function collapseCurrent(item: FlatItem): void {
    if (item.kind === 'schema' && item.schema.expanded) {
      patchSchema(item.schema.name, (s) => ({ ...s, expanded: false }));
    } else if (item.kind === 'section' && item.section.expanded) {
      patchSection(item.schema.name, item.section.kind, (s) => ({ ...s, expanded: false }));
    } else if (item.kind === 'table' && item.table.expanded) {
      patchTable(item.schema.name, item.section.kind, item.table.name, (t) => ({
        ...t,
        expanded: false,
      }));
    } else if (item.kind === 'column') {
      patchTable(
        item.schema.name,
        sectionKindOfColumn(item, schemas),
        item.table.name,
        (t) => ({ ...t, expanded: false }),
      );
    }
  }

  // ─────────────── render ───────────────
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

  const lineWidth = Math.max(8, maxCols - 1);
  const visibleStart = safeScroll;
  const visibleEnd = Math.min(total, safeScroll + viewport);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text bold color={focused ? 'cyan' : undefined}>
          {searchMode ? 'Search' : 'Schemas'}{' '}
          <Text dimColor>
            ({total === 0 ? 0 : safeCursor + 1}/{total})
          </Text>
        </Text>
      </Box>
      {searchMode && (
        <Box>
          <Text color="cyan">/ </Text>
          <Box flexGrow={1}>
            <TextInput
              value={searchQuery}
              onChange={(v) => {
                setSearchQuery(v);
                setCursor(0);
              }}
              onSubmit={() => activateSearchResult()}
              placeholder="type to search schema.name…"
            />
          </Box>
        </Box>
      )}
      <Box height={1}>
        {safeScroll > 0 ? <Text dimColor>▲ {safeScroll} more</Text> : <Text> </Text>}
      </Box>
      {total === 0 ? (
        searchMode ? (
          allObjectsLoading ? (
            <Text>
              <Spinner type="dots" /> loading objects…
            </Text>
          ) : allObjectsError ? (
            <Text color="red">{truncate(allObjectsError, lineWidth)}</Text>
          ) : (
            <Text dimColor>No matches.</Text>
          )
        ) : (
          <Text dimColor>No schemas.</Text>
        )
      ) : searchMode ? (
        searchResults.slice(visibleStart, visibleEnd).map((res, i) => {
          const realIndex = visibleStart + i;
          const sel = realIndex === safeCursor;
          const tag =
            res.category === 'function' ? (res.kind === 'PROCEDURE' ? 'P' : 'ƒ') :
            res.category === 'view' ? 'V' : 'T';
          const label = `${tag}  ${res.schema}.${res.name}`;
          const arrow = sel ? '▸' : ' ';
          const line = `${arrow} ${truncate(label, Math.max(1, lineWidth - 2))}`;
          return (
            <Text key={realIndex} color={sel ? 'green' : undefined} wrap="truncate">
              {line}
            </Text>
          );
        })
      ) : (
        flat.slice(visibleStart, visibleEnd).map((item, i) => {
          const realIndex = visibleStart + i;
          const sel = realIndex === safeCursor && focused;
          return <Row key={realIndex} item={item} selected={sel} maxWidth={lineWidth} />;
        })
      )}
      <Box height={1}>
        {visibleEnd < total ? (
          <Text dimColor>▼ {total - visibleEnd} more</Text>
        ) : (
          <Text> </Text>
        )}
      </Box>
      {searchMode && (
        <Text dimColor>[Enter] open · [↑↓] move · [Esc] cancel</Text>
      )}
    </Box>
  );
};

function sectionKindOfColumn(
  item: Extract<FlatItem, { kind: 'column' }>,
  schemas: SchemaNode[],
): SectionKind {
  // column may belong to either tables or views; figure out which section holds it.
  const schema = schemas.find((s) => s.name === item.schema.name);
  if (!schema) return 'tables';
  for (const sec of schema.sections) {
    if (sec.kind === 'functions') continue;
    if ((sec.tables ?? []).some((t) => t.name === item.table.name)) return sec.kind;
  }
  return 'tables';
}

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
  let bold = false;

  if (item.kind === 'schema') {
    icon = item.schema.expanded ? '▾' : '▸';
    label = item.schema.name;
    bold = true;
  } else if (item.kind === 'section') {
    icon = item.section.expanded ? '▾' : '▸';
    const count =
      item.section.kind === 'functions'
        ? item.section.routines?.length
        : item.section.tables?.length;
    label =
      SECTION_LABELS[item.section.kind] +
      (count !== undefined ? `  (${count})` : '');
    color = 'cyan';
  } else if (item.kind === 'section-loading') {
    label = 'loading…';
    dim = true;
  } else if (item.kind === 'section-error') {
    icon = '!';
    label = item.section.error ?? 'error';
    color = 'red';
  } else if (item.kind === 'section-empty') {
    label = '(none)';
    dim = true;
  } else if (item.kind === 'table') {
    icon = item.table.expanded ? '▾' : '▸';
    const showKind =
      item.table.kind !== 'TABLE' && item.table.kind !== 'VIEW'
        ? `  (${item.table.kind.toLowerCase()})`
        : '';
    label = item.table.name + showKind;
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
  } else if (item.kind === 'function') {
    const tag =
      item.routine.prokind === 'p'
        ? 'P'
        : item.routine.prokind === 'a'
          ? 'A'
          : 'ƒ';
    icon = tag;
    const args = item.routine.args ? `(${item.routine.args})` : '()';
    const ret =
      item.routine.result && item.routine.prokind !== 'p'
        ? ` → ${item.routine.result}`
        : '';
    label = `${item.routine.name}${args}${ret}`;
  }

  const prefix = `${arrow} ${indent}${icon} `;
  const labelBudget = Math.max(1, maxWidth - prefix.length);
  const line = prefix + truncate(label, labelBudget);

  return (
    <Text
      color={selected ? 'green' : color}
      dimColor={dim && !selected}
      bold={bold}
      wrap="truncate"
    >
      {line}
    </Text>
  );
};
