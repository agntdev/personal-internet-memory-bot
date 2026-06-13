// In-memory store stub. F01 replaces this with the real Postgres
// pool + query helpers. Keeping the interface small and stable
// means F02 / F03 / FEAT* can be written against the contract
// before the DB is fully wired.

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

  // FEAT07 (delete): look up a single item, delete it.
  getItem(
    userId: number,
    id: number,
  ): Promise<{ id: number; summary: string } | undefined>;
  deleteItem(userId: number, id: number): Promise<boolean>;

  // FEAT06 (rename): list collections for a user, rename a tag,
  // rename a manual collection. The in-memory store tracks
  // collections in a separate Map; the Postgres impl (F01 +
  // future wire-up) hits the collections table.
  listCollections(
    userId: number,
  ): Promise<Array<{ name: string; kind: "auto" | "manual" }>>;
  renameTag(
    userId: number,
    oldName: string,
    newName: string,
  ): Promise<{ itemsAffected: number }>;
  renameCollection(
    userId: number,
    oldName: string,
    newName: string,
  ): Promise<{ collectionsAffected: number }>;
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

/** In-memory implementation. The harness relies on a fresh
 *  instance per spec; the production runtime replaces this with
 *  the Postgres-backed implementation from F01. */
export class MemoryStore implements Store {
  private byTelegram = new Map<number, UserRecord>();
  private nextId = 1;
  private items = new Map<number, InternalItem>();
  private nextItemId = 1;

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

  // FEAT07 (delete): look up a single item, delete it.
  async getItem(
    userId: number,
    id: number,
  ): Promise<{ id: number; summary: string } | undefined> {
    const item = this.items.get(id);
    if (!item || item.userId !== userId) return undefined;
    return { id: item.id, summary: item.summary };
  }

  async deleteItem(userId: number, id: number): Promise<boolean> {
    const item = this.items.get(id);
    if (!item || item.userId !== userId) return false;
    return this.items.delete(id);
  }

  // FEAT06 (rename): minimal in-memory collection tracking.
  // Keyed by `${userId}:${name}:${kind}` for unique-per-user
  // scoping. Real impl (Postgres) hits the collections table.
  private collections = new Map<string, { name: string; kind: "auto" | "manual" }>();
  private collKey(userId: number, name: string, kind: "auto" | "manual"): string {
    return `${userId}:${name}:${kind}`;
  }

  async listCollections(
    userId: number,
  ): Promise<Array<{ name: string; kind: "auto" | "manual" }>> {
    const out: Array<{ name: string; kind: "auto" | "manual" }> = [];
    for (const [key, c] of this.collections.entries()) {
      if (key.startsWith(`${userId}:`)) out.push({ name: c.name, kind: c.kind });
    }
    return out;
  }

  async renameTag(
    userId: number,
    oldName: string,
    newName: string,
  ): Promise<{ itemsAffected: number }> {
    let n = 0;
    for (const item of this.items.values()) {
      if (item.userId !== userId) continue;
      const idx = item.tags.indexOf(oldName);
      if (idx >= 0) {
        item.tags[idx] = newName;
        n++;
      }
    }
    return { itemsAffected: n };
  }

  async renameCollection(
    userId: number,
    oldName: string,
    newName: string,
  ): Promise<{ collectionsAffected: number }> {
    let n = 0;
    for (const [key, c] of this.collections.entries()) {
      if (c.name === oldName && key.startsWith(`${userId}:`) && c.kind === "manual") {
        const newKey = this.collKey(userId, newName, c.kind);
        this.collections.delete(key);
        this.collections.set(newKey, { name: newName, kind: c.kind });
        n++;
      }
    }
    return { collectionsAffected: n };
  }
}