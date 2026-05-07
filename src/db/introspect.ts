import type { Connection } from './client.js';
import { withClient } from './client.js';
import type { ColumnInfo, QueryResult, TableInfo } from '../types.js';

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

export async function listTables(conn: Connection, schema: string): Promise<TableInfo[]> {
  return withClient(conn, async (c) => {
    const res = await c.query<{ table_name: string; table_type: string }>(
      `SELECT table_name, table_type
         FROM information_schema.tables
        WHERE table_schema = $1
        ORDER BY lower(table_name), table_name`,
      [schema],
    );
    return res.rows.map((r) => ({ name: r.table_name, kind: r.table_type }));
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
): Promise<QueryResult> {
  return withClient(conn, async (c) => {
    const sql = `SELECT * FROM ${quoteIdent(schema)}.${quoteIdent(table)} LIMIT $1 OFFSET $2`;
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

export async function runQuery(conn: Connection, sql: string): Promise<QueryResult> {
  return withClient(conn, async (c) => {
    const res = await c.query({ text: sql, rowMode: 'array' });
    if (Array.isArray(res)) {
      const last = res[res.length - 1] as pg_QueryArrayResult | undefined;
      if (!last) return { columns: [], rows: [], rowCount: 0 };
      return {
        columns: last.fields.map((f) => f.name),
        rows: last.rows as unknown[][],
        rowCount: last.rows.length,
      };
    }
    return {
      columns: res.fields.map((f) => f.name),
      rows: res.rows as unknown[][],
      rowCount: res.rows.length,
    };
  });
}

type pg_QueryArrayResult = {
  fields: { name: string }[];
  rows: unknown[];
};
