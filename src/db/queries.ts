// Typed query helpers. The bot's command handlers and the save
// flow call these — never raw `pool.query(...)` — so types stay
// honest and the SQL surface is small.

import type { PoolClient } from "pg";
import type { Pool } from "./pool.js";

/** Run `fn` inside a single transaction. Commits on success,
 *  rolls back on throw. */
export async function withTx<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export interface UserRow {
  id: number;
  telegram_id: string; // BIGINT comes back as a string from pg
  created_at: Date;
}

/** Get-or-create the user row. Returns the row. */
export async function upsertUser(
  pool: Pool,
  telegramId: number,
): Promise<UserRow> {
  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (telegram_id) VALUES ($1)
     ON CONFLICT (telegram_id) DO UPDATE SET telegram_id = EXCLUDED.telegram_id
     RETURNING id, telegram_id, created_at`,
    [telegramId],
  );
  return rows[0]!;
}

/** Look up a user by telegram id. Returns undefined if not found. */
export async function getUserByTelegramId(
  pool: Pool,
  telegramId: number,
): Promise<UserRow | undefined> {
  const { rows } = await pool.query<UserRow>(
    `SELECT id, telegram_id, created_at FROM users WHERE telegram_id = $1`,
    [telegramId],
  );
  return rows[0];
}

export type ItemKind =
  | "link"
  | "text"
  | "image"
  | "video"
  | "audio"
  | "voice"
  | "document"
  | "other";

export interface ItemRow {
  id: number;
  user_id: number;
  kind: ItemKind;
  raw_text: string;
  source_url: string | null;
  telegram_message_id: string | null;
  summary: string;
  created_at: Date;
}

/** Insert an item + tag rows + item_tags rows in one transaction.
 *  Returns the new item row. */
export async function insertItem(
  pool: Pool,
  input: {
    userId: number;
    kind: ItemKind;
    rawText: string;
    sourceUrl?: string | null;
    telegramMessageId?: number | null;
    summary: string;
    tags: string[];
  },
): Promise<ItemRow> {
  return withTx(pool, async (client) => {
    const { rows: itemRows } = await client.query<ItemRow>(
      `INSERT INTO items
         (user_id, kind, raw_text, source_url, telegram_message_id, summary)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id, kind, raw_text, source_url,
                 telegram_message_id, summary, created_at`,
      [
        input.userId,
        input.kind,
        input.rawText,
        input.sourceUrl ?? null,
        input.telegramMessageId ?? null,
        input.summary,
      ],
    );
    const item = itemRows[0]!;
    for (const tagName of input.tags) {
      const { rows: tagRows } = await client.query<{ id: number }>(
        `INSERT INTO tags (user_id, name) VALUES ($1, $2)
         ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [input.userId, tagName.toLowerCase()],
      );
      const tagId = tagRows[0]!.id;
      await client.query(
        `INSERT INTO item_tags (item_id, tag_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [item.id, tagId],
      );
    }
    // Seed srs_state row (default next_show_at = +7 days).
    await client.query(
      `INSERT INTO srs_state (item_id) VALUES ($1)
       ON CONFLICT (item_id) DO NOTHING`,
      [item.id],
    );
    return item;
  });
}

/** List recent items for a user, newest first. */
export async function listRecentItems(
  pool: Pool,
  userId: number,
  limit: number,
  offset: number = 0,
): Promise<{ items: ItemRow[]; total: number }> {
  const { rows: items } = await pool.query<ItemRow>(
    `SELECT id, user_id, kind, raw_text, source_url, telegram_message_id,
            summary, created_at
       FROM items
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
  const { rows: countRows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM items WHERE user_id = $1`,
    [userId],
  );
  return { items, total: Number(countRows[0]?.count ?? 0) };
}

/** Find items matching a query, scoped to a user, ordered by
 *  recency. Matches against raw_text (tsvector + ILIKE) and
 *  against tag names. */
export async function searchItems(
  pool: Pool,
  userId: number,
  query: string,
  limit: number,
): Promise<ItemRow[]> {
  const { rows } = await pool.query<ItemRow>(
    `SELECT DISTINCT i.id, i.user_id, i.kind, i.raw_text, i.source_url,
            i.telegram_message_id, i.summary, i.created_at
       FROM items i
       LEFT JOIN item_tags it ON it.item_id = i.id
       LEFT JOIN tags t ON t.id = it.tag_id
      WHERE i.user_id = $1
        AND (
          to_tsvector('simple', i.raw_text) @@ websearch_to_tsquery('simple', $2)
          OR i.raw_text ILIKE '%' || $2 || '%'
          OR t.name ILIKE '%' || $2 || '%'
        )
      ORDER BY i.created_at DESC
      LIMIT $3`,
    [userId, query, limit],
  );
  return rows;
}

export interface TagRow {
  id: number;
  user_id: number;
  name: string;
  count: number;
}

/** List tags for a user, ordered by item count desc, then name. */
export async function listTags(
  pool: Pool,
  userId: number,
  limit: number = 100,
): Promise<TagRow[]> {
  const { rows } = await pool.query<TagRow>(
    `SELECT t.id, t.user_id, t.name, COUNT(it.item_id)::int AS count
       FROM tags t
       LEFT JOIN item_tags it ON it.tag_id = t.id
      WHERE t.user_id = $1
      GROUP BY t.id, t.user_id, t.name
      ORDER BY count DESC, t.name ASC
      LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

/** Find items with a given tag name. */
export async function findItemsByTag(
  pool: Pool,
  userId: number,
  tagName: string,
  limit: number,
  offset: number = 0,
): Promise<{ items: ItemRow[]; total: number }> {
  const { rows: items } = await pool.query<ItemRow>(
    `SELECT i.id, i.user_id, i.kind, i.raw_text, i.source_url,
            i.telegram_message_id, i.summary, i.created_at
       FROM items i
       JOIN item_tags it ON it.item_id = i.id
       JOIN tags t ON t.id = it.tag_id
      WHERE i.user_id = $1 AND t.name = $2
      ORDER BY i.created_at DESC
      LIMIT $3 OFFSET $4`,
    [userId, tagName.toLowerCase(), limit, offset],
  );
  const { rows: countRows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM items i
       JOIN item_tags it ON it.item_id = i.id
       JOIN tags t ON t.id = it.tag_id
      WHERE i.user_id = $1 AND t.name = $2`,
    [userId, tagName.toLowerCase()],
  );
  return { items, total: Number(countRows[0]?.count ?? 0) };
}

export interface CollectionRow {
  id: number;
  user_id: number;
  name: string;
  kind: "auto" | "manual";
}

/** List collections for a user, grouped by kind. */
export async function listCollections(
  pool: Pool,
  userId: number,
): Promise<CollectionRow[]> {
  const { rows } = await pool.query<CollectionRow>(
    `SELECT c.id, c.user_id, c.name, c.kind,
            COUNT(ci.item_id)::int AS item_count
       FROM collections c
       LEFT JOIN collection_items ci ON ci.collection_id = c.id
      WHERE c.user_id = $1
      GROUP BY c.id, c.user_id, c.name, c.kind
      ORDER BY c.kind, c.name`,
    [userId],
  );
  return rows;
}

/** Find a collection by id or by name. */
export async function findCollection(
  pool: Pool,
  userId: number,
  ref: string,
): Promise<CollectionRow | undefined> {
  const asNumber = Number(ref);
  if (Number.isInteger(asNumber) && asNumber > 0) {
    const { rows } = await pool.query<CollectionRow>(
      `SELECT id, user_id, name, kind FROM collections
        WHERE user_id = $1 AND id = $2`,
      [userId, asNumber],
    );
    if (rows[0]) return rows[0];
  }
  const { rows } = await pool.query<CollectionRow>(
    `SELECT id, user_id, name, kind FROM collections
      WHERE user_id = $1 AND name = $2`,
    [userId, ref],
  );
  return rows[0];
}

/** Find items in a collection, newest first. */
export async function findCollectionItems(
  pool: Pool,
  collectionId: number,
  limit: number,
  offset: number = 0,
): Promise<{ items: ItemRow[]; total: number }> {
  const { rows: items } = await pool.query<ItemRow>(
    `SELECT i.id, i.user_id, i.kind, i.raw_text, i.source_url,
            i.telegram_message_id, i.summary, i.created_at
       FROM items i
       JOIN collection_items ci ON ci.item_id = i.id
      WHERE ci.collection_id = $1
      ORDER BY i.created_at DESC
      LIMIT $2 OFFSET $3`,
    [collectionId, limit, offset],
  );
  const { rows: countRows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM collection_items
      WHERE collection_id = $1`,
    [collectionId],
  );
  return { items, total: Number(countRows[0]?.count ?? 0) };
}

/** Delete a manual collection (preserves items + tags). */
export async function deleteCollection(
  pool: Pool,
  userId: number,
  collectionId: number,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM collections
      WHERE id = $1 AND user_id = $2 AND kind = 'manual'`,
    [collectionId, userId],
  );
  return (rowCount ?? 0) > 0;
}

/** Auto-collection creation: ensure a `kind='auto'` collection
 *  exists for `name`; attach the item; (re)compute auto-collect
 *  lifecycle. Idempotent. */
export async function ensureAutoCollection(
  pool: Pool,
  userId: number,
  itemId: number,
  tagName: string,
): Promise<CollectionRow | undefined> {
  return withTx(pool, async (client) => {
    // Count items carrying this tag for the user.
    const { rows: countRows } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM item_tags it
         JOIN tags t ON t.id = it.tag_id
        WHERE t.user_id = $1 AND t.name = $2`,
      [userId, tagName.toLowerCase()],
    );
    const count = Number(countRows[0]?.count ?? 0);
    if (count < 3) return undefined;

    // Upsert the auto collection (kind='auto' has no unique-name
    // constraint, so we look it up first).
    const { rows: existing } = await client.query<CollectionRow>(
      `SELECT id, user_id, name, kind FROM collections
        WHERE user_id = $1 AND name = $2 AND kind = 'auto'`,
      [userId, tagName.toLowerCase()],
    );
    let coll: CollectionRow;
    if (existing[0]) {
      coll = existing[0];
    } else {
      const { rows: created } = await client.query<CollectionRow>(
        `INSERT INTO collections (user_id, name, kind) VALUES ($1, $2, 'auto')
         RETURNING id, user_id, name, kind`,
        [userId, tagName.toLowerCase()],
      );
      coll = created[0]!;
    }
    // Attach the item.
    await client.query(
      `INSERT INTO collection_items (collection_id, item_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [coll.id, itemId],
    );
    return coll;
  });
}

/** Ungroup an auto-collection if its source tag has dropped
 *  below 3 items. Called inside the same transaction as the
 *  delete / rename that triggered it. */
export async function maybeUngroupAutoCollection(
  pool: Pool,
  userId: number,
  tagName: string,
): Promise<void> {
  await pool.query(
    `DELETE FROM collections c
      WHERE c.user_id = $1 AND c.name = $2 AND c.kind = 'auto'
        AND (SELECT COUNT(*)::int
               FROM item_tags it
               JOIN tags t ON t.id = it.tag_id
              WHERE t.user_id = $1 AND t.name = $2) < 3`,
    [userId, tagName.toLowerCase()],
  );
}

/** Delete an item and its item_tags + srs_state rows. Does not
 *  touch collections. Returns the deleted item's row. */
export async function deleteItem(
  pool: Pool,
  userId: number,
  itemId: number,
): Promise<ItemRow | undefined> {
  const { rows } = await pool.query<ItemRow>(
    `DELETE FROM items
      WHERE id = $1 AND user_id = $2
      RETURNING id, user_id, kind, raw_text, source_url,
                telegram_message_id, summary, created_at`,
    [itemId, userId],
  );
  return rows[0];
}

/** Rename a tag (or a manual collection) for a user. After
 *  renaming a tag, recompute any auto-collection lifecycle. */
export async function renameTag(
  pool: Pool,
  userId: number,
  oldName: string,
  newName: string,
): Promise<{ itemsAffected: number }> {
  return withTx(pool, async (client) => {
    const { rows: updated } = await client.query<{ id: number }>(
      `UPDATE tags SET name = $3
        WHERE user_id = $1 AND name = $2
        RETURNING id`,
      [userId, oldName.toLowerCase(), newName.toLowerCase()],
    );
    const itemsAffected = updated.length;
    // For each tag that changed name, recompute auto-collection
    // lifecycle on the NEW name (might now be <3 → ungroup; or
    // ≥3 but no auto collection yet → create).
    for (const tag of updated) {
      const { rows: newNameRows } = await client.query<{ name: string }>(
        `SELECT name FROM tags WHERE id = $1`,
        [tag.id],
      );
      const newNameActual = newNameRows[0]?.name ?? newName.toLowerCase();
      // Drop auto collection if count < 3.
      await client.query(
        `DELETE FROM collections c
          WHERE c.user_id = $1 AND c.name = $2 AND c.kind = 'auto'
            AND (SELECT COUNT(*)::int
                   FROM item_tags it WHERE it.tag_id = $3) < 3`,
        [userId, newNameActual, tag.id],
      );
    }
    return { itemsAffected };
  });
}

export async function renameCollection(
  pool: Pool,
  userId: number,
  oldName: string,
  newName: string,
): Promise<{ collectionsAffected: number }> {
  const { rowCount } = await pool.query(
    `UPDATE collections SET name = $3
      WHERE user_id = $1 AND name = $2 AND kind = 'manual'`,
    [userId, oldName, newName],
  );
  return { collectionsAffected: rowCount ?? 0 };
}

/** Pick items due for the weekly digest (5–10 bound, oldest first). */
export async function pickDigestItems(
  pool: Pool,
  userId: number,
  limit: number,
): Promise<ItemRow[]> {
  const { rows } = await pool.query<ItemRow>(
    `SELECT i.id, i.user_id, i.kind, i.raw_text, i.source_url,
            i.telegram_message_id, i.summary, i.created_at
       FROM items i
       JOIN srs_state s ON s.item_id = i.id
      WHERE i.user_id = $1
        AND s.times_shown < 5
        AND s.next_show_at <= now()
      ORDER BY s.next_show_at ASC
      LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

/** Mark a set of items as shown (bumps times_shown, pushes
 *  next_show_at by 7 days). */
export async function markItemsShown(
  pool: Pool,
  itemIds: number[],
): Promise<void> {
  if (itemIds.length === 0) return;
  await pool.query(
    `UPDATE srs_state
        SET times_shown = times_shown + 1,
            last_shown_at = now(),
            next_show_at = now() + interval '7 days'
      WHERE item_id = ANY($1::int[])`,
    [itemIds],
  );
}

export interface StatsRow {
  totalItems: number;
  totalTags: number;
  totalCollections: number;
  topTags: Array<{ name: string; count: number }>;
  dueCount: number;
}

export async function getStats(pool: Pool, userId: number): Promise<StatsRow> {
  const [itemsR, tagsR, collsR, topR, dueR] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM items WHERE user_id = $1`,
      [userId],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM tags WHERE user_id = $1`,
      [userId],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM collections WHERE user_id = $1`,
      [userId],
    ),
    pool.query<{ name: string; count: string }>(
      `SELECT t.name, COUNT(it.item_id)::text AS count
         FROM tags t
         LEFT JOIN item_tags it ON it.tag_id = t.id
        WHERE t.user_id = $1
        GROUP BY t.name
        ORDER BY COUNT(it.item_id) DESC, t.name ASC
        LIMIT 3`,
      [userId],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM srs_state s
         JOIN items i ON i.id = s.item_id
        WHERE i.user_id = $1 AND s.times_shown < 5 AND s.next_show_at <= now()`,
      [userId],
    ),
  ]);
  return {
    totalItems: Number(itemsR.rows[0]?.count ?? 0),
    totalTags: Number(tagsR.rows[0]?.count ?? 0),
    totalCollections: Number(collsR.rows[0]?.count ?? 0),
    topTags: topR.rows.map((r) => ({ name: r.name, count: Number(r.count) })),
    dueCount: Number(dueR.rows[0]?.count ?? 0),
  };
}
