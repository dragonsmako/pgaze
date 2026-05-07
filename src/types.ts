export type ServerConfig = {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  user: string;
};

export type ColumnInfo = {
  name: string;
  dataType: string;
  nullable: boolean;
};

export type TableInfo = {
  name: string;
  kind: 'BASE TABLE' | 'VIEW' | 'MATERIALIZED VIEW' | string;
};

export type QueryResult = {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
};
