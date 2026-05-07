import pg from 'pg';
import type { ServerConfig } from '../types.js';

const { Pool } = pg;

export type Connection = {
  pool: pg.Pool;
  server: ServerConfig;
};

export async function connect(server: ServerConfig, password: string): Promise<Connection> {
  const pool = new Pool({
    host: server.host,
    port: server.port,
    database: server.database,
    user: server.user,
    password,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // Surface configuration / DNS errors at connect time so the UI can show them.
  const probe = await pool.connect();
  probe.release();
  return { pool, server };
}

export async function disconnect(conn: Connection): Promise<void> {
  await conn.pool.end();
}

export async function withClient<T>(
  conn: Connection,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await conn.pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
