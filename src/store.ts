// In-memory store stub. F01 replaces this with the real Postgres
// pool + query helpers. Keeping the interface small and stable
// means F02 / F03 / FEAT* can be written against the contract
// before the DB is fully wired.

export interface Store {
  /** Get-or-create the user row for a Telegram user id. */
  upsertUser(telegramId: number): UserRecord;
  /** Look up a user; returns undefined if the row doesn't exist. */
  getUser(telegramId: number): UserRecord | undefined;
}

export interface UserRecord {
  telegramId: number;
  /** Internal primary key; assigned on first upsert. */
  id: number;
  createdAt: Date;
}

/** In-memory implementation. The harness relies on a fresh
 *  instance per spec; the production runtime replaces this with
 *  the Postgres-backed implementation from F01. */
export class MemoryStore implements Store {
  private byTelegram = new Map<number, UserRecord>();
  private nextId = 1;

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
}
