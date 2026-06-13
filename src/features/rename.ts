// FEAT06 — /rename <old> <new>. Across tags and manual
// collections. Disambiguates when both match.

import { inlineButton, inlineKeyboard } from "@agntdev/bot-toolkit";
import type { Feature } from "../features.js";
import type { Ctx } from "../session.js";
import type { UserRecord } from "../store.js";

const RENAME_KIND_TAG = "rename_tag";
const RENAME_KIND_COLLECTION = "rename_collection";

export const renameFeature: Feature = (app) => {
  app.onCommand("rename", async (ctx: Ctx) => {
    const msg = ctx.message;
    if (!msg || !("text" in msg)) return;
    const parts = msg.text!.trim().split(/\s+/);
    if (parts.length !== 3) {
      await ctx.reply("Usage: `/rename <old> <new>`.");
      return;
    }
    const [, oldName, newName] = parts;
    if (!oldName || !newName) {
      await ctx.reply("Usage: `/rename <old> <new>`.");
      return;
    }
    if (oldName === newName) {
      await ctx.reply("Old and new names are the same.");
      return;
    }

    const user = ctx.from ? app.store.upsertUser(ctx.from.id) : undefined;
    if (!user) return;

    // Check what matches.
    const tags = await app.store.getTags(user.id);
    const tagMatch = tags.find((t: { name: string; count: number }) => t.name === oldName);

    const colls = await app.store.listCollections(user.id);
    const collMatch = colls.find(
      (c: { name: string; kind: "auto" | "manual" }) => c.name === oldName && c.kind === "manual",
    );

    if (!tagMatch && !collMatch) {
      await ctx.reply(`Nothing called \`${oldName}\` to rename.`);
      return;
    }

    // Check for collision on <new>.
    const newTagExists = tags.some((t: { name: string; count: number }) => t.name === newName);
    const newCollExists = colls.some(
      (c: { name: string; kind: "auto" | "manual" }) => c.name === newName,
    );
    if ((tagMatch && newTagExists) || (collMatch && newCollExists)) {
      await ctx.reply(`\`${newName}\` is already in use. Try a different name.`);
      return;
    }

    // If both match: ask the user to disambiguate.
    if (tagMatch && collMatch) {
      const kb = inlineKeyboard([
        [
          inlineButton(
            `🏷 Rename tag "${oldName}" → "${newName}"`,
            `${RENAME_KIND_TAG}:${oldName}:${newName}`,
          ),
        ],
        [
          inlineButton(
            `📁 Rename collection "${oldName}" → "${newName}"`,
            `${RENAME_KIND_COLLECTION}:${oldName}:${newName}`,
          ),
        ],
      ]);
      await ctx.reply(
        `Both a tag and a manual collection are named \`${oldName}\`. Pick one:`,
        { reply_markup: kb },
      );
      // Stash the disambiguation in the session.
      ctx.session.step = "awaiting_rename_target";
      ctx.session.renameOld = oldName;
      ctx.session.renameNew = newName;
      ctx.session.renameTargets = ["tag", "collection"];
      return;
    }

    // Only one matches: do it directly.
    if (tagMatch) {
      const { itemsAffected } = await app.store.renameTag(user.id, oldName, newName);
      await ctx.reply(`Renamed \`${oldName}\` → \`${newName}\` across ${itemsAffected} items. ✅`);
      return;
    }
    if (collMatch) {
      const { collectionsAffected } = await app.store.renameCollection(user.id, oldName, newName);
      await ctx.reply(`Renamed collection \`${oldName}\` → \`${newName}\` across ${collectionsAffected} collections. ✅`);
      return;
    }
  });

  // Callback for disambiguation: user picks tag or collection.
  app.onCallback("rename_tag", async (ctx: Ctx, data: string, _user: UserRecord) => {
    const [, oldName, newName] = data.split(":");
    if (!oldName || !newName) return;
    const user = ctx.from ? app.store.upsertUser(ctx.from.id) : undefined;
    if (!user) return;
    const { itemsAffected } = await app.store.renameTag(user.id, oldName, newName);
    await ctx.answerCallbackQuery({ text: "Renamed" });
    await ctx.editMessageText(
      `Renamed \`${oldName}\` → \`${newName}\` across ${itemsAffected} items. ✅`,
    );
    ctx.session.step = "idle";
    ctx.session.renameOld = undefined;
    ctx.session.renameNew = undefined;
    ctx.session.renameTargets = undefined;
  });

  app.onCallback("rename_collection", async (ctx: Ctx, data: string, _user: UserRecord) => {
    const [, oldName, newName] = data.split(":");
    if (!oldName || !newName) return;
    const user = ctx.from ? app.store.upsertUser(ctx.from.id) : undefined;
    if (!user) return;
    const { collectionsAffected } = await app.store.renameCollection(user.id, oldName, newName);
    await ctx.answerCallbackQuery({ text: "Renamed" });
    await ctx.editMessageText(
      `Renamed collection \`${oldName}\` → \`${newName}\` across ${collectionsAffected} collections. ✅`,
    );
    ctx.session.step = "idle";
    ctx.session.renameOld = undefined;
    ctx.session.renameNew = undefined;
    ctx.session.renameTargets = undefined;
  });
};
