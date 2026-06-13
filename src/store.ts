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

export interface CollectionMeta {
  id: number;
  userId: number;
  name: string;
  kind: "auto" | "manual";
  itemCount: number;
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

  /** Ensure an auto-collection exists for a tag and attach the item. */
  ensureAutoCollection(userId: number, itemId: number, tagName: string): Promise<void>;

  /** List collections for a user, with item counts. */
  listCollections(userId: number): Promise<CollectionMeta[]>;
  /** Find a collection by name or id. */
  findCollection(userId: number, ref: string): Promise<CollectionMeta | undefined>;
  /** Find items in a collection, newest first. */
  findCollectionItems(collectionId: number, limit: number, offset?: number): Promise<{ items: SavedItemMeta[]; total: number }>;
  /** Delete a manual collection (preserves items + tags). */
  deleteCollection(userId: number, collectionId: number): Promise<boolean>;
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
}

/** In-memory implementation. The harness relies on a fresh
 *  instance per spec; the production runtime replaces this with
 *  the Postgres-backed implementation from F01. */
export class MemoryStore implements Store {
  private byTelegram = new Map<number, UserRecord>();
  private nextId = 1;
  private items = new Map<number, InternalItem>();
  private nextItemId = 1;
  private collections = new Map<number, InternalCollection>();
  private nextCollectionId = 1;
  private collectionItems = new Map<number, Set<number>>();

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

  async ensureAutoCollection(userId: number, itemId: number, tagName: string): Promise<void> {
    const name = tagName.toLowerCase();
    let coll = [...this.collections.values()].find(
      (c) => c.userId === userId && c.name === name && c.kind === "auto",
    );
    if (!coll) {
      coll = { id: this.nextCollectionId++, userId, name, kind: "auto" };
      this.collections.set(coll.id, coll);
    }
    let items = this.collectionItems.get(coll.id);
    if (!items) {
      items = new Set();
      this.collectionItems.set(coll.id, items);
    }
    items.add(itemId);
  }

  async listCollections(userId: number): Promise<CollectionMeta[]> {
    const result: CollectionMeta[] = [];
    for (const coll of this.collections.values()) {
      if (coll.userId !== userId) continue;
      const count = this.collectionItems.get(coll.id)?.size ?? 0;
      result.push({
        id: coll.id,
        userId: coll.userId,
        name: coll.name,
        kind: coll.kind,
        itemCount: count,
      });
    }
    result.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "auto" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return result;
  }

  async findCollection(userId: number, ref: string): Promise<CollectionMeta | undefined> {
    const asNumber = Number(ref);
    if (Number.isInteger(asNumber) && asNumber > 0) {
      const coll = this.collections.get(asNumber);
      if (coll && coll.userId === userId) {
        const count = this.collectionItems.get(coll.id)?.size ?? 0;
        return { id: coll.id, userId: coll.userId, name: coll.name, kind: coll.kind, itemCount: count };
      }
    }
    for (const coll of this.collections.values()) {
      if (coll.userId === userId && coll.name === ref.toLowerCase()) {
        const count = this.collectionItems.get(coll.id)?.size ?? 0;
        return { id: coll.id, userId: coll.userId, name: coll.name, kind: coll.kind, itemCount: count };
      }
    }
    return undefined;
  }

  async findCollectionItems(collectionId: number, limit: number, offset: number = 0): Promise<{ items: SavedItemMeta[]; total: number }> {
    const ids = this.collectionItems.get(collectionId);
    if (!ids) return { items: [], total: 0 };
    const allItems = [...ids]
      .map((id) => this.items.get(id))
      .filter((i): i is InternalItem => !!i);
    allItems.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = allItems.length;
    const paged = allItems.slice(offset, offset + limit);
    return {
      items: paged.map((item) => ({
        id: item.id,
        userId: item.userId,
        kind: item.kind,
        rawText: item.rawText,
        sourceUrl: item.sourceUrl,
        summary: item.summary,
        tags: item.tags,
        createdAt: item.createdAt,
      })),
      total,
    };
  }

  async deleteCollection(userId: number, collectionId: number): Promise<boolean> {
    const coll = this.collections.get(collectionId);
    if (!coll || coll.userId !== userId || coll.kind !== "manual") return false;
    this.collections.delete(collectionId);
    this.collectionItems.delete(collectionId);
    return true;
  }
}