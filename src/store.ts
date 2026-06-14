// In-memory store stub. F01 replaces this with the real Postgres
// pool + query helpers. Keeping the interface small and stable
// means F02 / F03 / FEAT* can be written against the contract
// before the DB is fully wired.

export interface CollectionRecord {
  id: number;
  userId: number;
  name: string;
  kind: "auto" | "manual";
  itemCount: number;
  createdAt: Date;
}

export interface SavedItemMeta {
  id: number;
  userId: number;
  kind: string;
  rawText: string;
  sourceUrl: string | null;
  summary: string;
  tags: string[];
  createdAt: Date;
}

export interface SearchResult {
  id: number;
  summary: string;
  createdAt: Date;
  tags: string[];
}

export interface Store {
  /** Get-or-create the user row for a Telegram user id. */
  upsertUser(telegramId: number): UserRecord;
  /** Look up a user; returns undefined if the row doesn't exist. */
  getUser(telegramId: number): UserRecord | undefined;

  /** Insert an item with tags + srs_state seed. Returns the new item metadata. */
  insertItem(input: {
    userId: number;
    kind: string;
    rawText: string;
    sourceUrl?: string | null;
    telegramMessageId?: number | null;
    summary: string;
    tags: string[];
  }): Promise<SavedItemMeta>;

  /** Check if a URL has already been saved by the user. Returns the
   *  earliest matching item or undefined. */
  findUrlDuplicate(userId: number, url: string): Promise<SavedItemMeta | undefined>;

  /** Simple text search across item summaries/tags for the search
   *  shortcut (details.md §3). */
  searchItems(userId: number, query: string, limit: number): Promise<SearchResult[]>;

  /** Ensure an auto-collection exists for a tag and attach the item.
   *  No-op in the in-memory store (auto-collections are a Postgres concern). */
  ensureAutoCollection(userId: number, itemId: number, tagName: string): Promise<void>;

  /** List all tags for a user with item counts, ordered by count
   *  desc then name asc, capped at 100. */
  getTags(userId: number): Promise<Array<{ name: string; count: number }>>;

  /** Find all items with a given tag name, newest first. */
  getItemsByTag(userId: number, tagName: string): Promise<SearchResult[]>;

  /** Pick items due for the digest (times_shown < 5, next_show_at <= now).
   *  Ordered by next_show_at ASC, limited to `limit` results. */
  pickDigestItems(userId: number, limit: number): Promise<SearchResult[]>;

  /** Mark digest items as shown: bump times_shown, set
   *  next_show_at = now + 7 days (snooze). */
  markDigestItemsSnoozed(itemIds: number[]): Promise<void>;

  /** Count items currently due for digest (times_shown < 5,
   *  next_show_at <= now) for a user. */
  getDigestDueCount(userId: number): Promise<number>;

  /** List recent items for a user with OFFSET-based pagination.
   *  Newest first. Returns the page slice + total count. */
  getRecentItems(
    userId: number,
    limit: number,
    offset: number,
  ): Promise<{ items: SearchResult[]; total: number }>;

  /** List all collections for a user, grouped by kind (auto
   *  first, then manual), ordered by name within each group. */
  listCollections(userId: number): Promise<CollectionRecord[]>;

  /** Get a single collection by id (number) or name (string
   *  match, case-insensitive) for a user. Returns undefined
   *  when not found. */
  getCollection(
    userId: number,
    idOrName: string | number,
  ): Promise<CollectionRecord | undefined>;

  /** Get items in a collection, newest first, with
   *  OFFSET-based pagination. */
  getCollectionItems(
    collectionId: number,
    userId: number,
    limit: number,
    offset: number,
  ): Promise<{ items: SearchResult[]; total: number }>;

  /** Delete a manual collection and its item associations.
   *  Returns info about what was deleted. Auto-collections
   *  must be refused by the caller (this method only does
   *  the mechanical delete). */
  deleteCollection(collectionId: number): Promise<{
    deleted: boolean;
    name: string;
    itemCount: number;
  }>;

  /** Create a manual collection (empty on creation). */
  createManualCollection(
    userId: number,
    name: string,
  ): Promise<CollectionRecord>;

  /** Rename a tag for a user. Returns count of affected items. */
  renameTag(userId: number, oldName: string, newName: string): Promise<{ itemsAffected: number }>;

  /** Rename a manual collection for a user. Only renames
   *  kind='manual' collections. */
  renameCollection(userId: number, oldName: string, newName: string): Promise<{ collectionsAffected: number }>;

  /** Get a single item by id, scoped to the user. Returns
   *  undefined when not found or not owned by the user. */
  getItem(userId: number, itemId: number): Promise<SavedItemMeta | undefined>;

  /** Delete a single item by id, scoped to the user. Returns
   *  true if an item was deleted, false if not found. */
  deleteItem(userId: number, itemId: number): Promise<boolean>;

  /** List all known users. Used by the weekly digest scheduler to
   *  iterate over every user who may have due items. */
  getAllUsers(): UserRecord[];
}

export interface UserRecord {
  telegramId: number;
  /** Internal primary key; assigned on first upsert. */
  id: number;
  createdAt: Date;
}

interface InternalItem {
  id: number;
  userId: number;
  kind: string;
  rawText: string;
  sourceUrl: string | null;
  telegramMessageId: number | null;
  summary: string;
  tags: string[];
  createdAt: Date;
}

interface InternalCollection {
  id: number;
  userId: number;
  name: string;
  kind: "auto" | "manual";
  createdAt: Date;
}

interface InternalSrsState {
  itemId: number;
  lastShownAt: Date | null;
  timesShown: number;
  nextShowAt: Date;
}

/** In-memory implementation. The harness relies on a fresh
 *  instance per spec; the production runtime replaces this with
 *  the Postgres-backed implementation from F01. */
export class MemoryStore implements Store {
  private byTelegram = new Map<number, UserRecord>();
  private nextId = 1;
  private items = new Map<number, InternalItem>();
  private srs = new Map<number, InternalSrsState>();
  private nextItemId = 1;
  private collections = new Map<number, InternalCollection>();
  private collectionItems = new Map<number, Set<number>>();
  private nextCollectionId = 1;

  upsertUser(telegramId: number): UserRecord {
    let u = this.byTelegram.get(telegramId);
    if (!u) {
      u = { telegramId, id: this.nextId++, createdAt: new Date() };
      this.byTelegram.set(telegramId, u);
    }
    return u;
  }

  getUser(telegramId: number): UserRecord | undefined {
    return this.byTelegram.get(telegramId);
  }

  async insertItem(input: {
    userId: number;
    kind: string;
    rawText: string;
    sourceUrl?: string | null;
    telegramMessageId?: number | null;
    summary: string;
    tags: string[];
  }): Promise<SavedItemMeta> {
    const id = this.nextItemId++;
    const item: InternalItem = {
      id,
      userId: input.userId,
      kind: input.kind,
      rawText: input.rawText,
      sourceUrl: input.sourceUrl ?? null,
      telegramMessageId: input.telegramMessageId ?? null,
      summary: input.summary,
      tags: input.tags,
      createdAt: new Date(),
    };
    this.items.set(id, item);
    const nextShowAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    this.srs.set(id, { itemId: id, lastShownAt: null, timesShown: 0, nextShowAt });
    return {
      id: item.id,
      userId: item.userId,
      kind: item.kind,
      rawText: item.rawText,
      sourceUrl: item.sourceUrl,
      summary: item.summary,
      tags: item.tags,
      createdAt: item.createdAt,
    };
  }

  async findUrlDuplicate(userId: number, url: string): Promise<SavedItemMeta | undefined> {
    for (const item of this.items.values()) {
      if (item.userId === userId && item.sourceUrl === url) {
        return {
          id: item.id,
          userId: item.userId,
          kind: item.kind,
          rawText: item.rawText,
          sourceUrl: item.sourceUrl,
          summary: item.summary,
          tags: item.tags,
          createdAt: item.createdAt,
        };
      }
    }
    return undefined;
  }

  async searchItems(userId: number, query: string, limit: number): Promise<SearchResult[]> {
    const q = query.toLowerCase();
    const results: SearchResult[] = [];
    for (const item of this.items.values()) {
      if (item.userId !== userId) continue;
      if (item.summary.toLowerCase().includes(q) || item.tags.some((t) => t.includes(q))) {
        results.push({
          id: item.id,
          summary: item.summary,
          createdAt: item.createdAt,
          tags: item.tags,
        });
      }
    }
    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return results.slice(0, limit);
  }

  async ensureAutoCollection(_userId: number, _itemId: number, _tagName: string): Promise<void> {
    // No-op: auto-collections are a Postgres concern.
  }

  async getTags(userId: number): Promise<Array<{ name: string; count: number }>> {
    const tagCounts = new Map<string, number>();
    for (const item of this.items.values()) {
      if (item.userId !== userId) continue;
      for (const tag of item.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(tagCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 100);
  }

  async getItemsByTag(userId: number, tagName: string): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const tag = tagName.toLowerCase();
    for (const item of this.items.values()) {
      if (item.userId !== userId) continue;
      if (!item.tags.some((t) => t.toLowerCase() === tag)) continue;
      results.push({
        id: item.id,
        summary: item.summary,
        createdAt: item.createdAt,
        tags: item.tags,
      });
    }
    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return results;
  }

  async pickDigestItems(userId: number, limit: number): Promise<SearchResult[]> {
    const now = new Date();
    const candidates: Array<{ item: InternalItem; nextShowAt: Date }> = [];
    for (const [itemId, srsState] of this.srs) {
      if (srsState.timesShown >= 5) continue;
      if (srsState.nextShowAt > now) continue;
      const item = this.items.get(itemId);
      if (!item || item.userId !== userId) continue;
      candidates.push({ item, nextShowAt: srsState.nextShowAt });
    }
    candidates.sort((a, b) => a.nextShowAt.getTime() - b.nextShowAt.getTime());
    return candidates.slice(0, limit).map((c) => ({
      id: c.item.id,
      summary: c.item.summary,
      createdAt: c.item.createdAt,
      tags: c.item.tags,
    }));
  }

  async markDigestItemsSnoozed(itemIds: number[]): Promise<void> {
    for (const id of itemIds) {
      const s = this.srs.get(id);
      if (!s) continue;
      s.lastShownAt = new Date();
      s.timesShown += 1;
      s.nextShowAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }
  }

  async getDigestDueCount(userId: number): Promise<number> {
    const now = new Date();
    let count = 0;
    for (const [itemId, srsState] of this.srs) {
      if (srsState.timesShown >= 5) continue;
      if (srsState.nextShowAt > now) continue;
      const item = this.items.get(itemId);
      if (!item || item.userId !== userId) continue;
      count++;
    }
    return count;
  }

  async getRecentItems(
    userId: number,
    limit: number,
    offset: number,
  ): Promise<{ items: SearchResult[]; total: number }> {
    const userItems: InternalItem[] = [];
    for (const item of this.items.values()) {
      if (item.userId !== userId) continue;
      userItems.push(item);
    }
    userItems.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = userItems.length;
    const page = userItems.slice(offset, offset + limit).map((item) => ({
      id: item.id,
      summary: item.summary,
      createdAt: item.createdAt,
      tags: item.tags,
    }));
    return { items: page, total };
  }

  async listCollections(userId: number): Promise<CollectionRecord[]> {
    const result: CollectionRecord[] = [];
    for (const c of this.collections.values()) {
      if (c.userId !== userId) continue;
      const itemCount = this.collectionItems.get(c.id)?.size ?? 0;
      result.push({
        id: c.id,
        userId: c.userId,
        name: c.name,
        kind: c.kind,
        itemCount,
        createdAt: c.createdAt,
      });
    }
    result.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "auto" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return result;
  }

  async getCollection(
    userId: number,
    idOrName: string | number,
  ): Promise<CollectionRecord | undefined> {
    if (typeof idOrName === "number" || /^\d+$/.test(String(idOrName))) {
      const id = Number(idOrName);
      const c = this.collections.get(id);
      if (c && c.userId === userId) {
        return {
          id: c.id,
          userId: c.userId,
          name: c.name,
          kind: c.kind,
          itemCount: this.collectionItems.get(c.id)?.size ?? 0,
          createdAt: c.createdAt,
        };
      }
      return undefined;
    }
    const name = String(idOrName).toLowerCase();
    for (const c of this.collections.values()) {
      if (c.userId === userId && c.name.toLowerCase() === name) {
        return {
          id: c.id,
          userId: c.userId,
          name: c.name,
          kind: c.kind,
          itemCount: this.collectionItems.get(c.id)?.size ?? 0,
          createdAt: c.createdAt,
        };
      }
    }
    return undefined;
  }

  async getCollectionItems(
    collectionId: number,
    userId: number,
    limit: number,
    offset: number,
  ): Promise<{ items: SearchResult[]; total: number }> {
    const coll = this.collections.get(collectionId);
    if (!coll || coll.userId !== userId) return { items: [], total: 0 };

    const itemIds = this.collectionItems.get(collectionId);
    if (!itemIds || itemIds.size === 0) return { items: [], total: 0 };

    const results: SearchResult[] = [];
    for (const id of itemIds) {
      const item = this.items.get(id);
      if (item) {
        results.push({
          id: item.id,
          summary: item.summary,
          createdAt: item.createdAt,
          tags: item.tags,
        });
      }
    }
    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = results.length;
    const page = results.slice(offset, offset + limit);
    return { items: page, total };
  }

  async deleteCollection(collectionId: number): Promise<{
    deleted: boolean;
    name: string;
    itemCount: number;
  }> {
    const coll = this.collections.get(collectionId);
    const itemCount = this.collectionItems.get(collectionId)?.size ?? 0;
    if (coll) {
      this.collections.delete(collectionId);
      this.collectionItems.delete(collectionId);
      return { deleted: true, name: coll.name, itemCount };
    }
    return { deleted: false, name: "", itemCount: 0 };
  }

  async createManualCollection(
    userId: number,
    name: string,
  ): Promise<CollectionRecord> {
    const id = this.nextCollectionId++;
    const coll: InternalCollection = {
      id,
      userId,
      name,
      kind: "manual",
      createdAt: new Date(),
    };
    this.collections.set(id, coll);
    this.collectionItems.set(id, new Set());
    return {
      id: coll.id,
      userId: coll.userId,
      name: coll.name,
      kind: coll.kind,
      itemCount: 0,
      createdAt: coll.createdAt,
    };
  }

  async renameTag(userId: number, oldName: string, newName: string): Promise<{ itemsAffected: number }> {
    const oldLower = oldName.toLowerCase();
    let itemsAffected = 0;
    for (const item of this.items.values()) {
      if (item.userId !== userId) continue;
      for (let i = 0; i < item.tags.length; i++) {
        if (item.tags[i]!.toLowerCase() === oldLower) {
          item.tags[i] = newName;
          itemsAffected++;
          break;
        }
      }
    }
    return { itemsAffected };
  }

  async renameCollection(userId: number, oldName: string, newName: string): Promise<{ collectionsAffected: number }> {
    const oldLower = oldName.toLowerCase();
    let collectionsAffected = 0;
    for (const c of this.collections.values()) {
      if (c.userId === userId && c.kind === "manual" && c.name.toLowerCase() === oldLower) {
        c.name = newName;
        collectionsAffected++;
      }
    }
    return { collectionsAffected };
  }

  getAllUsers(): UserRecord[] {
    return Array.from(this.byTelegram.values());
  }

  async getItem(userId: number, itemId: number): Promise<SavedItemMeta | undefined> {
    const item = this.items.get(itemId);
    if (!item || item.userId !== userId) return undefined;
    return {
      id: item.id,
      userId: item.userId,
      kind: item.kind,
      rawText: item.rawText,
      sourceUrl: item.sourceUrl,
      summary: item.summary,
      tags: item.tags,
      createdAt: item.createdAt,
    };
  }

  async deleteItem(userId: number, itemId: number): Promise<boolean> {
    const item = this.items.get(itemId);
    if (!item || item.userId !== userId) return false;
    this.items.delete(itemId);
    this.srs.delete(itemId);
    return true;
  }
}