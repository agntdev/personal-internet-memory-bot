// FEAT08 — /digest manual trigger with 5-item floor, snooze callback
// that bumps srs_state.next_show_at by 7 days (details.md §12).

import { inlineButton, inlineKeyboard } from "@agntdev/bot-toolkit";
import type { Feature } from "../features.js";
import type { Ctx } from "../session.js";
import type { SearchResult } from "../store.js";

const DIGEST_LIMIT = 10;
const FLOOR = 5;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDate(d: Date): string {
  const weekday = WEEKDAYS[d.getUTCDay()]!;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${weekday} ${dd}`;
}

export function renderDigest(items: SearchResult[]): string {
  const lines = items.map(
    (r) => {
      const title =
        r.summary.length > 40
          ? r.summary.slice(0, 40) + "\u2026"
          : r.summary;
      const tagsStr = r.tags.length > 0 ? "  " + r.tags.join(", ") : "";
      return `#${r.id}  ${formatDate(r.createdAt)}  ${title}${tagsStr}`;
    },
  );
  return `\uD83D\uDCDA This week's resurfacing (${items.length} items)\n${lines.join("\n")}`;
}

export const digestFeature: Feature = (app) => {
  app.onCommand("digest", async (ctx, user) => {
    const items = await app.store.pickDigestItems(user.id, DIGEST_LIMIT);

    if (items.length < FLOOR) {
      const due = await app.store.getDigestDueCount(user.id);
      await ctx.reply(
        `Not enough items due yet — your next digest is when ${FLOOR}+ items are ready. You have ${due} due so far. Use /list to see everything.`,
      );
      return;
    }

    const card = renderDigest(items);
    const itemIds = items.map((i) => i.id);
    await ctx.reply(card, {
      reply_markup: inlineKeyboard([
        [
          inlineButton(
            "Snooze all",
            `digest:snooze:${itemIds.join(",")}`,
          ),
        ],
      ]),
    });
  });

  app.onCallback("digest", async (ctx, data, _user) => {
    const parts = data.split(":");
    if (parts[1] !== "snooze") {
      await ctx.answerCallbackQuery({ text: "Stale button" });
      return;
    }
    const idsStr = parts.slice(2).join(":");
    if (!idsStr) {
      await ctx.answerCallbackQuery({ text: "Stale button" });
      return;
    }
    const itemIds = idsStr.split(",").map(Number).filter(
      (n) => Number.isFinite(n) && n > 0,
    );
    if (itemIds.length === 0) {
      await ctx.answerCallbackQuery({ text: "Stale button" });
      return;
    }

    await app.store.markDigestItemsSnoozed(itemIds);

    try {
      await ctx.editMessageText("Snoozed for 7 days. \u2705");
    } catch {
      // message may be deleted
    }
    await ctx.answerCallbackQuery();
  });
};
