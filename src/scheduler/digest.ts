// FEAT11 — Weekly digest scheduler (details.md §13).
//
// Cron job: every Sunday 18:00 UTC, iterate every user, pick
// items due for digest (times_shown < 5, next_show_at <= now),
// and DM the digest card to anyone with 5–10 items due.
//
// 5-item floor / 10-item cap / FIFO roll-over (details.md §13):
//   <5 due        → skip, no digest that week
//   5–10 due      → send all
//   >10 due       → send the 10 oldest-due; rest roll over
//
// Idempotency: the bump (markDigestItemsSnoozed) runs in the
// same single-shot pass; a bot crash between send and bump
// re-sends the same items next week (acceptable per design).

import type { Bot } from "grammy";
import type { Ctx } from "../session.js";
import type { Store } from "../store.js";

const DIGEST_LIMIT = 10;
const DIGEST_FLOOR = 5;
const DIGEST_MAX_SHOWS = 5;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDate(d: Date): string {
  const weekday = WEEKDAYS[d.getUTCDay()]!;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${weekday} ${dd}`;
}

function renderDigestCard(
  items: Array<{ id: number; summary: string; createdAt: Date; tags: string[] }>,
): string {
  const lines = items.map((r) => {
    const title = r.summary.length > 40 ? r.summary.slice(0, 40) + "…" : r.summary;
    const tagsStr = r.tags.length > 0 ? "  " + r.tags.join(", ") : "";
    return `#${r.id}  ${formatDate(r.createdAt)}  ${title}${tagsStr}`;
  });
  return `📚 This week's resurfacing (${items.length} items)\n${lines.join("\n")}`;
}

/** One pass of the digest fan-out. Exposed for tests + the
 *  /digest command path (FEAT08). */
export async function runDigestPass(
  bot: Bot<Ctx>,
  store: Store,
): Promise<{ sent: number; skipped: number }> {
  const users = await store.getAllUsers();
  let sent = 0;
  let skipped = 0;
  for (const user of users) {
    const items = await store.pickDigestItems(user.id, DIGEST_LIMIT);
    if (items.length < DIGEST_FLOOR) {
      skipped++;
      continue;
    }
    const card = renderDigestCard(items);
    try {
      await bot.api.sendMessage(user.telegramId, card);
      sent++;
    } catch (err) {
      console.error(
        `[pimb] digest send failed for user ${user.telegramId}:`,
        err,
      );
      continue;
    }
    await store.markDigestItemsSnoozed(items.map((i) => i.id));
  }
  return { sent, skipped };
}

/** Start the weekly digest cron. Idempotent — only one timer per
 *  process. Returns a teardown function that stops the timer.
 *
 *  `intervalMs` defaults to 1h so the check is cheap. The actual
 *  fire logic compares the current UTC day/hour to the schedule
 *  (Sun 18:00). For the harness / test, pass a very small
 *  interval to drive a synthetic tick. */
export function startDigestCron(
  bot: Bot<Ctx>,
  store: Store,
  opts: { intervalMs?: number; now?: () => Date } = {},
): () => void {
  const intervalMs = opts.intervalMs ?? 60 * 60 * 1000;
  const now = opts.now ?? (() => new Date());
  let lastFireKey = "";

  async function tick(): Promise<void> {
    const d = now();
    // Fire only on Sunday 18:xx UTC.
    if (d.getUTCDay() !== 0 || d.getUTCHours() !== 18) return;
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}`;
    if (key === lastFireKey) return; // already fired this hour
    lastFireKey = key;
    try {
      const { sent, skipped } = await runDigestPass(bot, store);
      console.log(
        `[pimb] digest pass: sent=${sent} skipped=${skipped} at ${d.toISOString()}`,
      );
    } catch (err) {
      console.error("[pimb] digest pass failed:", err);
    }
  }

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  // Allow the process to exit even if the timer is still scheduled.
  if (typeof timer.unref === "function") timer.unref();

  return () => clearInterval(timer);
}
