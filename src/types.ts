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
  kind: string;
};

export type RoutineInfo = {
  name: string;
  args: string;
  result: string;
  prokind: 'f' | 'p' | 'a' | 'w' | string;
};

export type NoticeMessage = {
  severity: string;
  message: string;
  detail?: string;
  hint?: string;
};

export type QueryResult = {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  notices?: NoticeMessage[];
  command?: string;
};
