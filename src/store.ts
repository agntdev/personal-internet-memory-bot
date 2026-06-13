// Async Store. The bot's command handlers and the save flow
// call these. MemoryStore is the test/harness default; PgStore
// (F01 + future wire-up) implements the same surface against
// Postgres.

import type { ItemKind } from "./ai/types.js";

export interface UserRecord {
  telegramId: number;
  id: number;
  createdAt: Date;
}

export interface SavedItem {
  id: number;
  userId: number;
  kind: ItemKind;
  rawText: string;
  sourceUrl: string | null;
  telegramMessageId: number | null;
  summary: string;
  createdAt: Date;
  tags: string[];
}

export interface Store {
  // Users
  upsertUser(telegramId: number): Promise<UserRecord>;
  getUser(telegramId: number): Promise<UserRecord | undefined>;

  // Items
  saveItem(input: {
    userId: number;
    kind: ItemKind;
    rawText: string;
    sourceUrl?: string | null;
    telegramMessageId?: number | null;
    summary: string;
    tags: string[];
  }): Promise<SavedItem>;
  findItemByUrl(userId: number, sourceUrl: string): Promise<SavedItem | undefined>;
  getItem(userId: number, id: number): Promise<SavedItem | undefined>;
  listRecentItems(
    userId: number,
    limit: number,
    offset?: number,
  ): Promise<{ items: SavedItem[]; total: number }>;
  searchItems(userId: number, query: string, limit: number): Promise<SavedItem[]>;
  deleteItem(userId: number, id: number): Promise<SavedItem | undefined>;
  listTags(userId: number, limit?: number): Promise<Array<{ name: string; count: number }>>;
  findItemsByTag(
    userId: number,
    tagName: string,
    limit: number,
    offset?: number,
  ): Promise<{ items: SavedItem[]; total: number }>;
  listCollections(
    userId: number,
  ): Promise<Array<{ id: number; name: string; kind: "auto" | "manual"; itemCount: number }>>;
  findCollection(userId: number, ref: string): Promise<
    { id: number; name: string; kind: "auto" | "manual" } | undefined
  >;
  findCollectionItems(
    collectionId: number,
    limit: number,
    offset?: number,
  ): Promise<{ items: SavedItem[]; total: number }>;
  deleteCollection(userId: number, collectionId: number): Promise<boolean>;
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
  pickDigestItems(userId: number, limit: number): Promise<SavedItem[]>;
  markItemsShown(itemIds: number[]): Promise<void>;
  getStats(userId: number): Promise<{
    totalItems: number;
    totalTags: number;
    totalCollections: number;
    topTags: Array<{ name: string; count: number }>;
    dueCount: number;
  }>;
}

/** In-memory implementation. Fresh per makeBot() call → harness
 *  isolation. The production runtime replaces this with PgStore. */
export class MemoryStore implements Store {
  private byTelegram = new Map<number, UserRecord>();
  private items: SavedItem[] = [];
  private nextUserId = 1;
  private nextItemId = 1;
  private byItemId = new Map<number, SavedItem>();

  async upsertUser(telegramId: number): Promise<UserRecord> {
    let u = this.byTelegram.get(telegramId);
    if (!u) {
      u = { telegramId, id: this.nextUserId++, createdAt: new Date() };
      this.byTelegram.set(telegramId, u);
    }
    return u;
  }

  async getUser(telegramId: number): Promise<UserRecord | undefined> {
    return this.byTelegram.get(telegramId);
  }

  async saveItem(input: {
    userId: number;
    kind: ItemKind;
    rawText: string;
    sourceUrl?: string | null;
    telegramMessageId?: number | null;
    summary: string;
    tags: string[];
  }): Promise<SavedItem> {
    const item: SavedItem = {
      id: this.nextItemId++,
      userId: input.userId,
      kind: input.kind,
      rawText: input.rawText,
      sourceUrl: input.sourceUrl ?? null,
      telegramMessageId: input.telegramMessageId ?? null,
      summary: input.summary,
      createdAt: new Date(),
      tags: input.tags,
    };
    this.items.push(item);
    this.byItemId.set(item.id, item);
    return item;
  }

  async findItemByUrl(userId: number, sourceUrl: string): Promise<SavedItem | undefined> {
    return this.items.find(
      (i) => i.userId === userId && i.sourceUrl === sourceUrl,
    );
  }

  async getItem(userId: number, id: number): Promise<SavedItem | undefined> {
    const it = this.byItemId.get(id);
    if (!it || it.userId !== userId) return undefined;
    return it;
  }

  async listRecentItems(
    userId: number,
    limit: number,
    offset: number = 0,
  ): Promise<{ items: SavedItem[]; total: number }> {
    const userItems = this.items
      .filter((i) => i.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return {
      items: userItems.slice(offset, offset + limit),
      total: userItems.length,
    };
  }

  async searchItems(userId: number, query: string, limit: number): Promise<SavedItem[]> {
    const q = query.toLowerCase();
    return this.items
      .filter(
        (i) =>
          i.userId === userId &&
          (i.rawText.toLowerCase().includes(q) ||
            i.tags.some((t) => t.toLowerCase().includes(q)) ||
            i.summary.toLowerCase().includes(q)),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async deleteItem(userId: number, id: number): Promise<SavedItem | undefined> {
    const it = this.byItemId.get(id);
    if (!it || it.userId !== userId) return undefined;
    this.byItemId.delete(id);
    this.items = this.items.filter((i) => i.id !== id);
    return it;
  }

  async listTags(userId: number, limit: number = 100): Promise<Array<{ name: string; count: number }>> {
    const counts = new Map<string, number>();
    for (const it of this.items) {
      if (it.userId !== userId) continue;
      for (const t of it.tags) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([name, count]) => ({ name, count }));
  }

  async findItemsByTag(
    userId: number,
    tagName: string,
    limit: number,
    offset: number = 0,
  ): Promise<{ items: SavedItem[]; total: number }> {
    const userItems = this.items
      .filter((i) => i.userId === userId && i.tags.includes(tagName))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return {
      items: userItems.slice(offset, offset + limit),
      total: userItems.length,
    };
  }

  async listCollections(
    userId: number,
  ): Promise<Array<{ id: number; name: string; kind: "auto" | "manual"; itemCount: number }>> {
    // MemoryStore has no real collection tracking yet — FEAT05
    // (collections) implements this. Return empty for now.
    return [];
  }

  async findCollection(
    userId: number,
    ref: string,
  ): Promise<{ id: number; name: string; kind: "auto" | "manual" } | undefined> {
    return undefined;
  }

  async findCollectionItems(
    collectionId: number,
    limit: number,
    offset: number = 0,
  ): Promise<{ items: SavedItem[]; total: number }> {
    return { items: [], total: 0 };
  }

  async deleteCollection(userId: number, collectionId: number): Promise<boolean> {
    return false;
  }

  async renameTag(
    userId: number,
    oldName: string,
    newName: string,
  ): Promise<{ itemsAffected: number }> {
    let n = 0;
    for (const it of this.items) {
      if (it.userId !== userId) continue;
      const idx = it.tags.indexOf(oldName);
      if (idx >= 0) {
        it.tags[idx] = newName;
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
    return { collectionsAffected: 0 };
  }

  async pickDigestItems(userId: number, limit: number): Promise<SavedItem[]> {
    return this.items
      .filter((i) => i.userId === userId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit);
  }

  async markItemsShown(itemIds: number[]): Promise<void> {
    // No-op in MemoryStore.
  }

  async getStats(userId: number): Promise<{
    totalItems: number;
    totalTags: number;
    totalCollections: number;
    topTags: Array<{ name: string; count: number }>;
    dueCount: number;
  }> {
    const userItems = this.items.filter((i) => i.userId === userId);
    const tagCounts = new Map<string, number>();
    for (const it of userItems) {
      for (const t of it.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    }
    const top = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }));
    return {
      totalItems: userItems.length,
      totalTags: tagCounts.size,
      totalCollections: 0,
      topTags: top,
      dueCount: userItems.length,
    };
  }
}
