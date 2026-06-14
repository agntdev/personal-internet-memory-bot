// FEAT09 — /stats dashboard: totals, top-3 tags, next-digest
// status, Run-digest-now callback (details.md §14).

import { inlineButton, inlineKeyboard } from "@agntdev/bot-toolkit";
import type { Feature } from "../features.js";

export const statsFeature: Feature = (app) => {
  app.onCommand("stats", async (ctx, user) => {
    const [recent, tags, collections, dueCount] = await Promise.all([
      app.store.getRecentItems(user.id, 1, 0),
      app.store.getTags(user.id),
      app.store.listCollections(user.id),
      app.store.getDigestDueCount(user.id),
    ]);

    const totalItems = recent.total;
    const totalTags = tags.length;
    const totalCollections = collections.length;

    const top3Str = tags
      .slice(0, 3)
      .map((t) => `${t.name} (${t.count})`)
      .join(", ");

    const top3Line = top3Str ? `Top tags: ${top3Str}` : "Top tags: none yet";

    const digestLine =
      dueCount >= 5
        ? `Next digest: ${dueCount} items ready`
        : `Next digest: when 5+ items are ready (${dueCount} so far)`;

    const card =
      `\uD83D\uDCCA Your memory\n` +
      `Items: ${totalItems}  \u00B7  Tags: ${totalTags}  \u00B7  Collections: ${totalCollections}\n` +
      `${top3Line}\n` +
      `${digestLine}`;

    await ctx.reply(card, {
      reply_markup: inlineKeyboard([
        [inlineButton("Run digest now", "digest:run")],
      ]),
    });
  });
};