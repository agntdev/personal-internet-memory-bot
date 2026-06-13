// FEAT09 — /stats dashboard: totals, top-3 tags, next-digest status,
// Run-digest-now callback (details.md §14).

import { inlineButton, inlineKeyboard } from "@agntdev/bot-toolkit";
import type { Feature } from "../features.js";

function formatNextDigest(): string {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon..6=Sat
  const hours = now.getUTCHours();
  const isSunday = dayOfWeek === 0;
  const hasPassed = isSunday && hours >= 18;
  if (isSunday && !hasPassed) return "Sun 18:00 UTC";
  return "Sun 18:00 UTC";
}

export const statsFeature: Feature = (app) => {
  app.onCommand("stats", async (ctx, user) => {
    const [itemsCount, tags, tagsCount] = await Promise.all([
      app.store.countItems(user.id),
      app.store.getTags(user.id),
      app.store.getTags(user.id).then((t) => t.length),
    ]);
    const collectionsCount = 0;
    const top3 = tags.slice(0, 3);
    const top3Str =
      top3.length > 0
        ? top3.map((t) => `${t.name} (${t.count})`).join(", ")
        : "(none yet)";
    const nextDigest = formatNextDigest();

    const card =
      `📊 Your memory\n` +
      `Items: ${itemsCount}  ·  Tags: ${tagsCount}  ·  Collections: ${collectionsCount}\n` +
      `Top tags: ${top3Str}\n` +
      `Next digest: ${nextDigest}`;

    await ctx.reply(card, {
      reply_markup: inlineKeyboard([
        [inlineButton("Run digest now", "digest:run")],
      ]),
    });
  });

  app.onCallback("digest", async (ctx, data) => {
    if (data === "digest:run") {
      await ctx.answerCallbackQuery({ text: "Running digest…" });
      const msg = ctx.callbackQuery?.message;
      if (msg && "text" in msg) {
        const base = msg.text ?? "";
        await ctx.editMessageText(
          base + "\n\n⏳ Digest coming soon — /digest will be available in a future update.",
        );
      }
    }
  });
};
