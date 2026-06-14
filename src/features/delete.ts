// FEAT07 — /delete <id> with inline confirm (✅ Yes / ❌ No)
// and shortcut del:<item_id> from the save confirmation card.

import { inlineButton, inlineKeyboard } from "@agntdev/bot-toolkit";
import type { Feature } from "../features.js";
import type { Ctx } from "../session.js";
import type { SavedItemMeta } from "../store.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDate(d: Date): string {
  const weekday = WEEKDAYS[d.getUTCDay()]!;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${weekday} ${hh}:${mm}`;
}

function confirmCard(item: SavedItemMeta): string {
  const title =
    item.summary.length > 60
      ? item.summary.slice(0, 60) + "\u2026"
      : item.summary;
  const tagsStr = item.tags.length > 0 ? "  " + item.tags.join(", ") : "";
  return (
    `Delete #${item.id}?\n` +
    `${title}\n` +
    `${formatDate(item.createdAt)}${tagsStr}`
  );
}

async function showConfirm(
  ctx: Ctx,
  item: SavedItemMeta,
  edit: boolean,
): Promise<void> {
  const card = confirmCard(item);
  const replyMarkup = inlineKeyboard([
    [
      inlineButton("\u2705 Yes", `delconfirm:${item.id}:yes`),
      inlineButton("\u274c No", `delconfirm:${item.id}:no`),
    ],
  ]);

  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(card, { reply_markup: replyMarkup });
    await ctx.answerCallbackQuery();
  } else {
    await ctx.reply(card, { reply_markup: replyMarkup });
  }
}

export const deleteFeature: Feature = (app) => {
  app.onCommand("delete", async (ctx, user) => {
    const text = ctx.message?.text ?? "";
    const match = text.match(/^\/delete\s+(\d+)/);
    const idStr = match?.[1];
    if (!idStr) {
      await ctx.reply("Usage: `/delete <id>`. Find the id from /list or /search.");
      return;
    }

    const itemId = Number(idStr);
    if (!Number.isFinite(itemId) || itemId <= 0) {
      await ctx.reply("Usage: `/delete <id>`. The id must be a positive number.");
      return;
    }

    const item = await app.store.getItem(user.id, itemId);
    if (!item) {
      await ctx.reply(`No item #${itemId} found.`);
      return;
    }

    await showConfirm(ctx, item, false);
  });

  app.onCallback("del", async (ctx, data, user) => {
    const itemIdStr = data.split(":", 2)[1];
    const itemId = Number(itemIdStr);
    if (!Number.isFinite(itemId) || itemId <= 0) {
      await ctx.answerCallbackQuery({ text: "Stale button" });
      return;
    }

    const item = await app.store.getItem(user.id, itemId);
    if (!item) {
      try {
        await ctx.api.editMessageText(
          ctx.chat!.id,
          ctx.callbackQuery!.message!.message_id,
          `Item #${itemId} already gone.`,
        );
      } catch {
        // message may be deleted
      }
      await ctx.answerCallbackQuery();
      return;
    }

    await showConfirm(ctx, item, true);
  });

  app.onCallback("delconfirm", async (ctx, data, user) => {
    const parts = data.split(":");
    const itemId = Number(parts[1]);
    const action = parts[2];

    if (!Number.isFinite(itemId) || itemId <= 0) {
      await ctx.answerCallbackQuery({ text: "Stale button" });
      return;
    }

    if (action === "no") {
      await ctx.editMessageText("Cancelled.");
      await ctx.answerCallbackQuery();
      return;
    }

    if (action === "yes") {
      const deleted = await app.store.deleteItem(user.id, itemId);
      if (deleted) {
        await ctx.editMessageText(`Deleted #${itemId}. \u2705`);
      } else {
        await ctx.editMessageText(`Item #${itemId} already gone.`);
      }
      await ctx.answerCallbackQuery();
      return;
    }

    await ctx.answerCallbackQuery({ text: "Stale button" });
  });
};