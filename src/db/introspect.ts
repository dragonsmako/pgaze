import type { Connection } from './client.js';
import { withClient } from './client.js';
import type {
  ColumnInfo,
  NoticeMessage,
  QueryResult,
  RoutineInfo,
  TableInfo,
} from '../types.js';

export function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

export async function listSchemas(conn: Connection): Promise<string[]> {
  return withClient(conn, async (c) => {
    const res = await c.query<{ schema_name: string }>(
      `SELECT schema_name
         FROM information_schema.schemata
        WHERE schema_name NOT IN ('pg_catalog','information_schema')
          AND schema_name NOT LIKE 'pg\\_%' ESCAPE '\\'
        ORDER BY lower(schema_name), schema_name`,
    );
    return res.rows.map((r) => r.schema_name);
  });
}

export type AllObject = {
  schema: string;
  name: string;
  kind: string;        // human label
  category: 'table' | 'view' | 'function';
  prokind?: string;    // for functions
};

export async function listAllObjects(conn: Connection): Promise<AllObject[]> {
  return withClient(conn, async (c) => {
    const res = await c.query<{
      schema: string;
      name: string;
      relkind?: string;
      prokind?: string;
      category: string;
    }>(
      `SELECT n.nspname AS schema, c.relname AS name,
              c.relkind::text AS relkind, NULL::text AS prokind,
              CASE c.relkind WHEN 'v' THEN 'view'
                             WHEN 'm' THEN 'view'
                             ELSE 'table' END AS category
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog','information_schema')
          AND n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
          AND c.relkind IN ('r','p','f','v','m')
        UNION ALL
        SELECT n.nspname AS schema, p.proname AS name,
               NULL::text AS relkind, p.prokind::text AS prokind,
               'function' AS category
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname NOT IN ('pg_catalog','information_schema')
           AND n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
        ORDER BY lower(schema), schema, lower(name), name`,
    );
    return res.rows.map((r): AllObject => {
      if (r.category === 'function') {
        const map: Record<string, string> = { f: 'FUNCTION', p: 'PROCEDURE', a: 'AGGREGATE', w: 'WINDOW' };
        return {
          schema: r.schema,
          name: r.name,
          kind: map[r.prokind ?? 'f'] ?? 'FUNCTION',
          category: 'function',
          ...(r.prokind ? { prokind: r.prokind } : {}),
        };
      }
      const map = r.category === 'view' ? VIEW_KIND : TABLE_KIND;
      return {
        schema: r.schema,
        name: r.name,
        kind: map[r.relkind ?? 'r'] ?? (r.category === 'view' ? 'VIEW' : 'TABLE'),
        category: r.category as 'table' | 'view',
      };
    });
  });
}

// Backwards-compat alias (kept temporarily; new code should call listAllObjects)
export const listAllTables = listAllObjects;

const TABLE_KIND: Record<string, string> = {
  r: 'TABLE',
  p: 'PARTITIONED TABLE',
  f: 'FOREIGN TABLE',
};

const VIEW_KIND: Record<string, string> = {
  v: 'VIEW',
  m: 'MATERIALIZED VIEW',
};

export async function listTables(conn: Connection, schema: string): Promise<TableInfo[]> {
  return withClient(conn, async (c) => {
    const res = await c.query<{ name: string; relkind: string }>(
      `SELECT c.relname AS name, c.relkind::text AS relkind
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1
          AND c.relkind IN ('r','p','f')
        ORDER BY lower(c.relname), c.relname`,
      [schema],
    );
    return res.rows.map((r) => ({ name: r.name, kind: TABLE_KIND[r.relkind] ?? 'TABLE' }));
  });
}

export async function listViews(conn: Connection, schema: string): Promise<TableInfo[]> {
  return withClient(conn, async (c) => {
    const res = await c.query<{ name: string; relkind: string }>(
      `SELECT c.relname AS name, c.relkind::text AS relkind
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1
          AND c.relkind IN ('v','m')
        ORDER BY lower(c.relname), c.relname`,
      [schema],
    );
    return res.rows.map((r) => ({ name: r.name, kind: VIEW_KIND[r.relkind] ?? 'VIEW' }));
  });
}

export async function listRoutines(conn: Connection, schema: string): Promise<RoutineInfo[]> {
  return withClient(conn, async (c) => {
    const res = await c.query<{
      name: string;
      args: string;
      result: string;
      prokind: string;
    }>(
      `SELECT p.proname        AS name,
              pg_get_function_arguments(p.oid) AS args,
              pg_get_function_result(p.oid)    AS result,
              p.prokind::text   AS prokind
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = $1
        ORDER BY lower(p.proname), p.proname, args`,
      [schema],
    );
    return res.rows;
  });
}

export async function listColumns(
  conn: Connection,
  schema: string,
  table: string,
): Promise<ColumnInfo[]> {
  return withClient(conn, async (c) => {
    const res = await c.query<{
      column_name: string;
      data_type: string;
      is_nullable: 'YES' | 'NO';
    }>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position`,
      [schema, table],
    );
    return res.rows.map((r) => ({
      name: r.column_name,
      dataType: r.data_type,
      nullable: r.is_nullable === 'YES',
    }));
  });
}

export async function fetchRows(
  conn: Connection,
  schema: string,
  table: string,
  limit: number,
  offset: number,
  sort?: { column: string; dir: 'asc' | 'desc' },
): Promise<QueryResult> {
  return withClient(conn, async (c) => {
    let sql = `SELECT * FROM ${quoteIdent(schema)}.${quoteIdent(table)}`;
    if (sort) {
      const dir = sort.dir === 'asc' ? 'ASC' : 'DESC';
      sql += ` ORDER BY ${quoteIdent(sort.column)} ${dir} NULLS LAST`;
    }
    sql += ` LIMIT $1 OFFSET $2`;
    const res = await c.query({ text: sql, rowMode: 'array', values: [limit, offset] });
    const columns = res.fields.map((f) => f.name);
    const rows = res.rows as unknown[][];
    return { columns, rows, rowCount: rows.length };
  });
}

export async function countRows(
  conn: Connection,
  schema: string,
  table: string,
): Promise<number> {
  return withClient(conn, async (c) => {
    const sql = `SELECT count(*)::bigint AS n FROM ${quoteIdent(schema)}.${quoteIdent(table)}`;
    const res = await c.query<{ n: string }>(sql);
    return Number(res.rows[0]?.n ?? 0);
  });
}

export async function runQuery(
  conn: Connection,
  sql: string,
  values?: unknown[],
): Promise<QueryResult> {
  return withClient(conn, async (c) => {
    const notices: NoticeMessage[] = [];
    // pg's PoolClient is an EventEmitter that forwards 'notice' from the underlying connection.
    const onNotice = (raw: unknown) => {
      const n = (raw ?? {}) as {
        severity?: string;
        message?: string;
        detail?: string;
        hint?: string;
      };
      notices.push({
        severity: n.severity ?? 'NOTICE',
        message: n.message ?? '',
        ...(n.detail ? { detail: n.detail } : {}),
        ...(n.hint ? { hint: n.hint } : {}),
      });
    };
    const emitter = c as unknown as {
      on(ev: string, cb: (n: unknown) => void): void;
      off(ev: string, cb: (n: unknown) => void): void;
    };
    emitter.on('notice', onNotice);
    try {
      const cfg = values && values.length > 0
        ? { text: sql, rowMode: 'array' as const, values }
        : { text: sql, rowMode: 'array' as const };
      const res = await c.query(cfg);
      if (Array.isArray(res)) {
        const last = res[res.length - 1] as pg_QueryArrayResult | undefined;
        if (!last) return { columns: [], rows: [], rowCount: 0, notices };
        return {
          columns: last.fields.map((f) => f.name),
          rows: last.rows as unknown[][],
          rowCount: last.rowCount ?? last.rows.length,
          notices,
          ...(last.command ? { command: last.command } : {}),
        };
      }
      return {
        columns: res.fields.map((f) => f.name),
        rows: res.rows as unknown[][],
        rowCount: res.rowCount ?? res.rows.length,
        notices,
        ...(res.command ? { command: res.command } : {}),
      };
    } finally {
      emitter.off('notice', onNotice);
    }
  });
}

type pg_QueryArrayResult = {
  fields: { name: string }[];
  rows: unknown[];
  command?: string;
  rowCount?: number;
};
