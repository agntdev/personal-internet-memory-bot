// FEAT11 — Weekly digest scheduler: node-cron Sun 18:00 UTC,
// queries srs_state, respects 5-10 bound (skip if <5, cap at
// 10 oldest-due, roll over the rest) (details.md §13).

import cron from "node-cron";
import type { Bot } from "grammy";
import type { Ctx } from "./session.js";
import type { Store, SearchResult } from "./store.js";

const DIGEST_LIMIT = 10;
const FLOOR = 5;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDate(d: Date): string {
  const weekday = WEEKDAYS[d.getUTCDay()]!;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${weekday} ${dd}`;
}

function renderDigest(items: SearchResult[]): string {
  const lines = items.map((r) => {
    const title =
      r.summary.length > 40
        ? r.summary.slice(0, 40) + "\u2026"
        : r.summary;
    const tagsStr = r.tags.length > 0 ? "  " + r.tags.join(", ") : "";
    return `#${r.id}  ${formatDate(r.createdAt)}  ${title}${tagsStr}`;
  });
  return `\uD83D\uDCDA This week's resurfacing (${items.length} items)\n${lines.join("\n")}`;
}

export function startWeeklyDigest(bot: Bot<Ctx>, store: Store): void {
  cron.schedule(
    "0 18 * * 0",
    async () => {
      console.log("[pimb] weekly digest cron fired");
      const users = await store.getAllUsers();
      for (const user of users) {
        try {
          const due = await store.getDigestDueCount(user.id);
          if (due < FLOOR) continue;
          const items = await store.pickDigestItems(user.id, DIGEST_LIMIT);
          if (items.length === 0) continue;
          const card = renderDigest(items);
          await bot.api.sendMessage(user.telegramId, card);
          await store.markDigestItemsSnoozed(items.map((i) => i.id));
        } catch (err) {
          console.error(
            `[pimb] digest failed for user ${user.telegramId}:`,
            err,
          );
        }
      }
    },
    { timezone: "UTC" },
  );
  console.log("[pimb] weekly digest scheduler started (Sun 18:00 UTC)");
}
