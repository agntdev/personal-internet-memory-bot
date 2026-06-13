// FEAT07 — /delete <id> with inline confirm (details.md §11).
//
// - /delete <id> command: shows a confirmation card with [Yes] [No].
// - `del:<id>:yes` callback (from /delete confirm): deletes the
//   item, edits the message to "Deleted #<id>. ✅".
// - `del:<id>:no` callback: edits the message to "Cancelled.".
// - `del:<id>` callback (from the save flow's confirmation card
//   shortcut): same as `:yes` — deletes immediately, no confirm
//   step (the user just saw the card). This overrides the save
//   flow's stub "del" handler so the actual row is removed.

import { inlineButton, inlineKeyboard } from "@agntdev/bot-toolkit";
import type { Feature } from "../features.js";
import type { Ctx } from "../session.js";
import type { UserRecord } from "../store.js";

export const deleteFeature: Feature = (app) => {
  app.onCommand("delete", async (ctx: Ctx) => {
    const msg = ctx.message;
    if (!msg || !("text" in msg)) return;
    const parts = msg.text!.trim().split(/\s+/);
    if (parts.length !== 2) {
      await ctx.reply("Usage: `/delete <id>`.");
      return;
    }
    const id = Number(parts[1]);
    if (!Number.isInteger(id) || id <= 0) {
      await ctx.reply("Usage: `/delete <id>`.");
      return;
    }

    const user = ctx.from ? app.store.upsertUser(ctx.from.id) : undefined;
    if (!user) return;

    // Find the item to confirm it exists before showing the card.
    const item = await app.store.getItem(user.id, id);
    if (!item) {
      await ctx.reply(`No item #${id}.`);
      return;
    }

    const title = item.summary.length > 60
      ? item.summary.slice(0, 59) + "…"
      : item.summary;
    const kb = inlineKeyboard([
      [
        inlineButton("✅ Yes", `del:${id}:yes`),
        inlineButton("❌ No", `del:${id}:no`),
      ],
    ]);
    await ctx.reply(`Delete #${id} ("${title}")? This can't be undone.`, {
      reply_markup: kb,
    });
  });

  // Confirm: delete + edit message.
  app.onCallback("del", async (ctx: Ctx, data: string, _user: UserRecord) => {
    // Possible shapes:
    //   del:<id>           → from save flow card (immediate)
    //   del:<id>:yes       → from /delete confirm
    //   del:<id>:no        → from /delete confirm
    const parts = data.split(":");
    const id = Number(parts[1]);
    const decision = parts[2] ?? "yes";
    if (!Number.isInteger(id) || id <= 0) {
      await ctx.answerCallbackQuery({ text: "Stale button" });
      return;
    }

    if (decision === "no") {
      await ctx.answerCallbackQuery({ text: "Cancelled" });
      try {
        await ctx.editMessageText("Cancelled.");
      } catch {
        /* message may already be edited */
      }
      return;
    }

    const user = ctx.from ? app.store.upsertUser(ctx.from.id) : undefined;
    if (!user) {
      await ctx.answerCallbackQuery({ text: "Stale button" });
      return;
    }
    const deleted = await app.store.deleteItem(user.id, id);
    await ctx.answerCallbackQuery({ text: deleted ? "Deleted" : "Not found" });
    if (!deleted) {
      try {
        await ctx.editMessageText(`#${id} is already gone.`);
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      await ctx.editMessageText(`Deleted #${id}. ✅`);
    } catch {
      /* message may have been deleted or already edited */
    }
  });
};
