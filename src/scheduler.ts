// FEAT11 — Weekly digest scheduler: node-cron Sun 18:00 UTC,
// queries srs_state, respects 5-10 bound (skip if <5, cap at 10
// oldest-due, roll over the rest).

import cron from "node-cron";
import type { Bot } from "grammy";
import type { Ctx } from "./session.js";
import { type Store } from "./store.js";
import { renderDigest } from "./features/digest.js";

const DIGEST_LIMIT = 10;
const FLOOR = 5;

/**
 * Start the weekly digest cron job.
 * Runs every Sunday at 18:00 UTC.
 * Must only be called in production (main.ts), not in the test harness.
 */
export function startWeeklyDigestScheduler(bot: Bot<Ctx>, store: Store): cron.ScheduledTask {
  return cron.schedule("0 18 * * 0", async () => {
    console.log("[pimb] weekly digest cron fired");
    const users = store.getAllUsers();

    for (const user of users) {
      try {
        const dueCount = await store.getDigestDueCount(user.id);
        if (dueCount < FLOOR) {
          console.log(`[pimb] digest skip user ${user.telegramId}: ${dueCount} due (< ${FLOOR})`);
          continue;
        }

        const items = await store.pickDigestItems(user.id, DIGEST_LIMIT);
        if (items.length === 0) continue;

        const card = renderDigest(items);
        const itemIds = items.map((i) => i.id);

        await bot.api.sendMessage(user.telegramId, card);
        await store.markDigestItemsSnoozed(itemIds);

        console.log(
          `[pimb] digest sent to ${user.telegramId}: ${itemIds.length} items, ${dueCount} total due`,
        );
      } catch (err) {
        console.error(`[pimb] digest failed for user ${user.telegramId}:`, err);
      }
    }

    console.log("[pimb] weekly digest cron finished");
  }, {
    scheduled: true,
    timezone: "UTC",
  });
}
