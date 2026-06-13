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

  /** Pick items due for the digest (times_shown < 5, next_show_at <= now).
   *  Ordered by next_show_at ASC, limited to `limit` results. */
  pickDigestItems(userId: number, limit: number): Promise<SearchResult[]>;

  /** Mark digest items as shown: bump times_shown, set
   *  next_show_at = now + 7 days (snooze). */
  markDigestItemsSnoozed(itemIds: number[]): Promise<void>;

  /** Count items currently due for digest (times_shown < 5,
   *  next_show_at <= now) for a user. */
  getDigestDueCount(userId: number): Promise<number>;

  // FEAT11 (scheduler): iterate every known user for the weekly
  // digest cron. Production wires this to the users table.
  getAllUsers(): Promise<UserRecord[]>;
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

  // FEAT11 (scheduler): list every known user.
  async getAllUsers(): Promise<UserRecord[]> {
    return [...this.byTelegram.values()];
  }
}