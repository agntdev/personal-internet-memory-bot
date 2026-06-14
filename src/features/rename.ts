// FEAT06 — /rename <old> <new> across tags and manual collections
// with disambiguation when both match (details.md §10).

import { inlineButton, inlineKeyboard } from "@agntdev/bot-toolkit";
import type { Feature } from "../features.js";
import type { Ctx } from "../session.js";

export const renameFeature: Feature = (app) => {
  app.onCommand("rename", async (ctx, user) => {
    const text = ctx.message?.text ?? "";
    const match = text.match(/^\/rename\s+(\S+)\s+(.+)$/);
    if (!match) {
      await ctx.reply("Usage: `/rename <old> <new>`.");
      return;
    }
    const oldName = match[1]!.trim();
    const newName = match[2]!.trim();

    const tags = await app.store.getTags(user.id);
    const tagExists = tags.some(
      (t) => t.name.toLowerCase() === oldName.toLowerCase(),
    );
    const coll = await app.store.getCollection(user.id, oldName);
    const collExists = coll !== undefined && coll.kind === "manual";

    if (!tagExists && !collExists) {
      await ctx.reply(`Nothing called "${oldName}" to rename.`);
      return;
    }

    if (tagExists && collExists) {
      ctx.session.step = "awaiting_rename_target";
      ctx.session.renameOld = oldName;
      ctx.session.renameNew = newName;
      ctx.session.renameTargets = ["tag", "collection"];
      const encOld = encodeURIComponent(oldName);
      const encNew = encodeURIComponent(newName);
      await ctx.reply(
        `Both a tag and a manual collection named "${oldName}" exist. Which one should I rename?`,
        {
          reply_markup: inlineKeyboard([
            [
              inlineButton("Tag", `rename:tag:${encOld}:${encNew}`),
              inlineButton(
                "Collection",
                `rename:collection:${encOld}:${encNew}`,
              ),
            ],
          ]),
        },
      );
      return;
    }

    if (tagExists) {
      const newNameTaken = tags.some(
        (t) => t.name.toLowerCase() === newName.toLowerCase(),
      );
      if (newNameTaken) {
        await ctx.reply(`"${newName}" is already in use. Try a different name.`);
        return;
      }
      const result = await app.store.renameTag(user.id, oldName, newName);
      await ctx.reply(
        `Renamed tag "${oldName}" → "${newName}" across ${result.itemsAffected} items. ✅`,
      );
      return;
    }

    if (collExists) {
      const existingColl = await app.store.getCollection(user.id, newName);
      if (existingColl) {
        await ctx.reply(`"${newName}" is already in use. Try a different name.`);
        return;
      }
      await app.store.renameCollection(user.id, oldName, newName);
      await ctx.reply(`Renamed collection "${oldName}" → "${newName}". ✅`);
      return;
    }
  });

  app.onCallback("rename", async (ctx, data, user) => {
    const parts = data.split(":");
    const kind = parts[1] as "tag" | "collection";
    const oldName = decodeURIComponent(parts[2]!);
    const newName = decodeURIComponent(parts.slice(3).join(":"));

    if (kind === "tag") {
      const tags = await app.store.getTags(user.id);
      const newNameTaken = tags.some(
        (t) => t.name.toLowerCase() === newName.toLowerCase(),
      );
      if (newNameTaken) {
        await ctx.editMessageText(
          `"${newName}" is already in use. Try a different name.`,
        );
        await ctx.answerCallbackQuery();
        return;
      }
      const result = await app.store.renameTag(user.id, oldName, newName);
      await ctx.editMessageText(
        `Renamed tag "${oldName}" → "${newName}" across ${result.itemsAffected} items. ✅`,
      );
    } else {
      const existingColl = await app.store.getCollection(user.id, newName);
      if (existingColl) {
        await ctx.editMessageText(
          `"${newName}" is already in use. Try a different name.`,
        );
        await ctx.answerCallbackQuery();
        return;
      }
      await app.store.renameCollection(user.id, oldName, newName);
      await ctx.editMessageText(
        `Renamed collection "${oldName}" → "${newName}". ✅`,
      );
    }

    ctx.session.step = "idle";
    delete ctx.session.renameOld;
    delete ctx.session.renameNew;
    delete ctx.session.renameTargets;
    await ctx.answerCallbackQuery();
  });

  app.onState("awaiting_rename_target", async (ctx) => {
    ctx.session.step = "idle";
    delete ctx.session.renameOld;
    delete ctx.session.renameNew;
    delete ctx.session.renameTargets;
    await ctx.reply("Cancelled. Use /rename to try again.");
  });
};
