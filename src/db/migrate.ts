// One-shot schema applier. Reads schema.sql and runs it on the
// given pool. Idempotent — all DDL is `CREATE ... IF NOT EXISTS`.
// Used at deploy time and (optionally) from a CLI.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "./pool.js";

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(here, "./schema.sql");

/** Apply schema.sql to the pool. Returns the SQL that ran. */
export async function applySchema(pool: Pool): Promise<string> {
  const sql = await readFile(SCHEMA_PATH, "utf8");
  await pool.query(sql);
  return sql;
}

/** CLI entry: `node dist/db/migrate.js`. */
export async function migrateCli(connectionString: string): Promise<void> {
  const { makePool } = await import("./pool.js");
  const pool = makePool(connectionString, console.error);
  try {
    await applySchema(pool);
    console.log("[pimb] schema applied");
  } finally {
    await pool.end();
  }
}

// Allow `node dist/db/migrate.js` to invoke migrateCli().
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("migrate.js")
) {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    console.error("[pimb] DATABASE_URL is required");
    process.exit(1);
  }
  void migrateCli(url);
}
