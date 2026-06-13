// In-memory store stub. F01 replaces this with the real Postgres
// pool + query helpers. Keeping the interface small and stable
// means F02 / F03 / FEAT* can be written against the contract
// before the DB is fully wired.

export interface Store {
  /** Get-or-create the user row for a Telegram user id. */
  upsertUser(telegramId: number): UserRecord;
  /** Look up a user; returns undefined if the row doesn't exist. */
  getUser(telegramId: number): UserRecord | undefined;
  /** List recent items for a user, newest first. Returns page + total count. */
  listRecentItems(userId: number, limit: number, offset: number): { items: ItemRecord[]; total: number };
}

export interface UserRecord {
  telegramId: number;
  /** Internal primary key; assigned on first upsert. */
  id: number;
  createdAt: Date;
}

/** Minimal item shape that the bot's command handlers see. */
export interface ItemRecord {
  id: number;
  userId: number;
  summary: string;
  createdAt: Date;
}

/** In-memory implementation. The harness relies on a fresh
 *  instance per spec; the production runtime replaces this with
 *  the Postgres-backed implementation from F01. */
export class MemoryStore implements Store {
  private byTelegram = new Map<number, UserRecord>();
  private items: ItemRecord[] = [];
  private nextId = 1;
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

  listRecentItems(userId: number, limit: number, offset: number): { items: ItemRecord[]; total: number } {
    const userItems = this.items.filter((it) => it.userId === userId);
    userItems.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return {
      items: userItems.slice(offset, offset + limit),
      total: userItems.length,
    };
  }

  /** Insert an item into the in-memory store (for test harness use). */
  insertItem(userId: number, summary: string, createdAt?: Date): ItemRecord {
    const item: ItemRecord = {
      id: this.nextItemId++,
      userId,
      summary,
      createdAt: createdAt ?? new Date(),
    };
    this.items.push(item);
    return item;
  }
}
