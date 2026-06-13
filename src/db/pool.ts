// Postgres connection pool. Single shared pool per process; the
// harness specs use a separate pool with a dummy URL so they
// never actually open a connection.

import pg from "pg";

export type Pool = pg.Pool;

/** Build a pool from a connection URL. `log` defaults to no-op;
 *  pass `console` to surface connection errors during dev. */
export function makePool(
  connectionString: string,
  log: (msg: string, err?: unknown) => void = () => {},
): Pool {
  const pool = new pg.Pool({ connectionString });
  pool.on("error", (err) => log("[pimb] pg pool error", err));
  return pool;
}
