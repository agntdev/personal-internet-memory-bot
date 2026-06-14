// FEAT07 — /delete <id> with inline confirm (✅ Yes / ❌ No)
// and shortcut del:<item_id> from confirmation card.

import { confirmKeyboard } from "@agntdev/bot-toolkit";
import type { Feature } from "../features.js";
import type { Ctx } from "../session.js";

function confirmCard(summary: string, itemId: number): string {
  const title =
    summary.length > 60 ? summary.slice(0, 60) + "\u2026" : summary;
  return `Delete item #${itemId}?\n${title}`;
}

export const deleteFeature: Feature = (app) => {
  app.onCommand("delete", async (ctx, user) => {
    const text = ctx.message?.text ?? "";
    const match = text.match(/^\/delete\s+(\d+)/);
    const idStr = match?.[1];
    if (!idStr) {
      await ctx.reply("Usage: `/delete <item-id>`. Find the id with /list.");
      return;
    }

    const itemId = Number(idStr);
    const item = await app.store.getItem(user.id, itemId);
    if (!item) {
      await ctx.reply(`No item #${itemId}.`);
      return;
    }

    await ctx.reply(confirmCard(item.summary, itemId), {
      reply_markup: confirmKeyboard(`del:${itemId}`),
    });
  });

  app.onCallback("del", async (ctx, data, user) => {
    const parts = data.split(":");
    // del:<id>  or  del:<id>:yes  or  del:<id>:no
    const itemId = Number(parts[1]);
    if (!Number.isFinite(itemId) || itemId <= 0) {
      await ctx.answerCallbackQuery({ text: "Stale button" });
      return;
    }

    const action = parts[2];

    if (action === "no") {
      try {
        await ctx.editMessageText("Cancelled.");
      } catch {
        // message may be deleted
      }
      await ctx.answerCallbackQuery();
      return;
    }

    if (action === "yes") {
      const deleted = await app.store.deleteItem(user.id, itemId);
      try {
        await ctx.editMessageText(
          deleted ? `Deleted #${itemId}. \u2705` : `Item #${itemId} not found.`,
        );
      } catch {
        // message may be deleted
      }
      await ctx.answerCallbackQuery();
      return;
    }

    // No action suffix — show confirm card (triggered from save
    // confirmation card's Delete button or other places)
    const item = await app.store.getItem(user.id, itemId);
    if (!item) {
      await ctx.answerCallbackQuery({ text: "Item gone." });
      return;
    }

    try {
      await ctx.editMessageText(confirmCard(item.summary, itemId), {
        reply_markup: confirmKeyboard(`del:${itemId}`),
      });
    } catch {
      // message may be deleted
    }
    await ctx.answerCallbackQuery();
  });
};
