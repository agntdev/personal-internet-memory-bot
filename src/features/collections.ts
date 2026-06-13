// FEAT05 — /collections + /collection <name|id> + /deletecollection
// Auto-collections ungroup when the source tag drops below 3 items.

import type { Feature } from "../features.js";
import { inlineButton, inlineKeyboard } from "@agntdev/bot-toolkit";

const MAX_ITEMS = 25;

function matchArg(ctx: { match?: string | RegExpMatchArray }): string {
  const m = ctx.match;
  return typeof m === "string" ? m.trim() : "";
}

export const collectionsFeature: Feature = (app) => {
  app.onCommand("collections", async (ctx, user) => {
    const colls = await app.store.listCollections(user.id);
    if (colls.length === 0) {
      await ctx.reply(
        "No collections yet.\n\n" +
          "Auto-collections appear when you save 3+ items with the same tag.",
      );
      return;
    }

    const auto = colls.filter((c) => c.kind === "auto");
    const manual = colls.filter((c) => c.kind === "manual");

    const lines: string[] = ["📂 Collections\n"];

    if (auto.length > 0) {
      lines.push(
        "Auto (from tags — ungrouped when source tag drops below 3 items):",
      );
      for (const c of auto) {
        lines.push(`  #${c.id}: “${c.name}” (${c.itemCount} items)`);
      }
      lines.push("");
    }

    if (manual.length > 0) {
      lines.push("Manual:");
      for (const c of manual) {
        lines.push(`  #${c.id}: “${c.name}” (${c.itemCount} items)`);
      }
    }

    await ctx.reply(lines.join("\n"));
  });

  app.onCommand("collection", async (ctx, user) => {
    const args = matchArg(ctx as { match?: string | RegExpMatchArray });
    if (!args) {
      await ctx.reply(
        "Usage: /collection <name|id>\nExample: /collection tech or /collection 3",
      );
      return;
    }

    const coll = await app.store.findCollection(user.id, args);
    if (!coll) {
      await ctx.reply(`No collection matching "${args}".`);
      return;
    }

    const { items, total } = await app.store.findCollectionItems(
      coll.id,
      MAX_ITEMS,
      0,
    );

    const kindLabel = coll.kind === "auto" ? "auto" : "manual";
    const prefix = `📂 “${coll.name}” (${kindLabel}) — ${total} items`;

    if (items.length === 0) {
      await ctx.reply(`${prefix}\n\n(empty)`);
      return;
    }

    const itemLines = items.map((item, i) => {
      const title =
        item.summary.length > 50
          ? item.summary.slice(0, 50) + "…"
          : item.summary;
      return `${i + 1}. #${item.id}  ${title}`;
    });

    let suffix = "";
    if (total > MAX_ITEMS) {
      suffix = `\n\n… and ${total - MAX_ITEMS} more items.`;
    }

    await ctx.reply(`${prefix}\n\n${itemLines.join("\n")}${suffix}`);
  });

  app.onCommand("deletecollection", async (ctx, user) => {
    const args = matchArg(ctx as { match?: string | RegExpMatchArray });
    if (!args) {
      await ctx.reply(
        "Usage: /deletecollection <name|id>\nExample: /deletecollection favorites",
      );
      return;
    }

    const coll = await app.store.findCollection(user.id, args);
    if (!coll) {
      await ctx.reply(`No collection matching "${args}".`);
      return;
    }

    if (coll.kind === "auto") {
      await ctx.reply(
        "Auto-collections can’t be deleted directly. They’re ungrouped automatically when the source tag drops below 3 items.",
      );
      return;
    }

    const buttons = [
      inlineButton("Yes, delete", `delcol:confirm:${coll.id}`),
      inlineButton("Cancel", `delcol:cancel:${coll.id}`),
    ];

    await ctx.reply(
      `Delete “${coll.name}” with ${coll.itemCount} items? Items and tags are preserved.`,
      { reply_markup: inlineKeyboard([buttons]) },
    );
  });

  app.onCallback("delcol", async (ctx, data, user) => {
    const parts = data.split(":");
    const action = parts[1];
    const collId = Number(parts[2]);
    if (!action || !Number.isFinite(collId) || collId <= 0) {
      await ctx.answerCallbackQuery({ text: "Stale button" });
      return;
    }

    if (action === "cancel") {
      try {
        await ctx.api.editMessageText(
          ctx.chat!.id,
          ctx.callbackQuery!.message!.message_id,
          "Deletion cancelled.",
        );
      } catch {
        // message may be deleted
      }
      await ctx.answerCallbackQuery();
      return;
    }

    if (action === "confirm") {
      const deleted = await app.store.deleteCollection(user.id, collId);
      try {
        if (deleted) {
          await ctx.api.editMessageText(
            ctx.chat!.id,
            ctx.callbackQuery!.message!.message_id,
            "Collection deleted. Items and tags preserved. ✅",
          );
        } else {
          await ctx.api.editMessageText(
            ctx.chat!.id,
            ctx.callbackQuery!.message!.message_id,
            "Couldn’t find that collection.",
          );
        }
      } catch {
        // message may be deleted
      }
      await ctx.answerCallbackQuery();
      return;
    }

    await ctx.answerCallbackQuery({ text: "Stale button" });
  });
};
