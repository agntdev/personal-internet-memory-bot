// FEAT06 — /rename <old> <new> across tags and manual collections
// with disambiguation when both match (details.md §10).

import { inlineButton, inlineKeyboard } from "@agntdev/bot-toolkit";
import type { Feature } from "../features.js";
import type { Ctx } from "../session.js";

export const renameFeature: Feature = (app) => {
  app.onCommand("rename", async (ctx, user) => {
    const text = ctx.message?.text ?? "";
    const match = text.match(/^\/rename\s+(\S+)\s+(\S.*?)\s*$/);
    const oldName = match?.[1];
    const newName = match?.[2]?.trim();

    if (!oldName || !newName) {
      await ctx.reply("Usage: `/rename <old> <new>`.");
      return;
    }

    if (oldName === newName) {
      await ctx.reply(
        `"${oldName}" and "${newName}" are the same — nothing to rename.`,
      );
      return;
    }

    const tags = await app.store.getTags(user.id);
    const tagMatch = tags.find((t) => t.name === oldName);

    const collections = await app.store.getCollections(user.id);
    const collMatch = collections.find(
      (c) => c.name === oldName && c.kind === "manual",
    );

    const hasTag = !!tagMatch;
    const hasColl = !!collMatch;

    if (!hasTag && !hasColl) {
      await ctx.reply(`Nothing called "${oldName}" to rename.`);
      return;
    }

    // Check if new name is already taken
    if (hasTag) {
      const newTagExists = tags.some((t) => t.name === newName);
      if (newTagExists && hasColl) {
        // Both match, but new tag name exists — can still offer coll rename
        await ctx.reply(
          `"${newName}" is already used as a tag. ` +
            `The tag "${oldName}" cannot be renamed to it.`,
        );
        return;
      }
      if (newTagExists && !hasColl) {
        await ctx.reply(
          `"${newName}" is already used as a tag. Try a different name.`,
        );
        return;
      }
    }

    if (hasColl) {
      const newCollExists = collections.some(
        (c) => c.name === newName && c.kind === "manual",
      );
      if (newCollExists && hasTag) {
        // Both match, but new collection name exists — can still offer tag rename
        await ctx.reply(
          `"${newName}" is already used as a collection. ` +
            `The collection "${oldName}" cannot be renamed to it.`,
        );
        return;
      }
      if (newCollExists && !hasTag) {
        await ctx.reply(
          `"${newName}" is already used as a collection. Try a different name.`,
        );
        return;
      }
    }

    // Only one matches — rename directly
    if (hasTag && !hasColl) {
      const count = await app.store.renameTag(user.id, oldName, newName);
      await ctx.reply(
        `Renamed tag "${oldName}" → "${newName}" across ${count} items. ✅`,
      );
      return;
    }

    if (hasColl && !hasTag) {
      await app.store.renameCollection(user.id, oldName, newName);
      const itemCount = collMatch!.itemCount;
      await ctx.reply(
        `Renamed collection "${oldName}" → "${newName}" (${itemCount} items). ✅`,
      );
      return;
    }

    // Both match — disambiguation
    ctx.session.step = "awaiting_rename_target";
    ctx.session.renameOld = oldName;
    ctx.session.renameNew = newName;
    ctx.session.renameTargets = ["tag", "collection"];

    await ctx.reply(
      `Both a tag and a manual collection are named "${oldName}". Which one do you want to rename?`,
      {
        reply_markup: inlineKeyboard([
          [
            inlineButton("🏷 Tag", "rename:tag"),
            inlineButton("📁 Collection", "rename:collection"),
          ],
        ]),
      },
    );
  });

  // Callback for disambiguation buttons
  app.onCallback("rename", async (ctx, data, user) => {
    const parts = data.split(":");
    const kind = parts[1];

    if (kind !== "tag" && kind !== "collection") {
      await ctx.answerCallbackQuery({ text: "Stale button" });
      return;
    }

    const oldName = ctx.session.renameOld;
    const newName = ctx.session.renameNew;

    if (!oldName || !newName) {
      await ctx.answerCallbackQuery({ text: "Stale button" });
      await ctx.editMessageText("This rename flow has expired. Try /rename again.");
      return;
    }

    ctx.session.step = "idle";
    ctx.session.renameOld = undefined;
    ctx.session.renameNew = undefined;
    ctx.session.renameTargets = undefined;

    if (kind === "tag") {
      const count = await app.store.renameTag(user.id, oldName, newName);
      await ctx.editMessageText(
        `Renamed tag "${oldName}" → "${newName}" across ${count} items. ✅`,
      );
    } else {
      await app.store.renameCollection(user.id, oldName, newName);
      const collections = await app.store.getCollections(user.id);
      const coll = collections.find((c) => c.name === newName && c.kind === "manual");
      await ctx.editMessageText(
        `Renamed collection "${oldName}" → "${newName}" (${coll?.itemCount ?? 0} items). ✅`,
      );
    }

    await ctx.answerCallbackQuery();
  });

  // State handler: user sent text while in disambiguation — guide them back
  app.onState("awaiting_rename_target", async (ctx) => {
    ctx.session.step = "idle";
    ctx.session.renameOld = undefined;
    ctx.session.renameNew = undefined;
    ctx.session.renameTargets = undefined;
    await ctx.reply(
      "Please use `/rename <old> <new>` to start a new rename.",
    );
  });
};
