// FEAT01 — /start. Idempotent user upsert + welcome reply
// (details.md §1).
//
// Re-issuing /start from an existing user does not duplicate the
// users row (handled by the Store / upsertUser in db/queries.ts
// via ON CONFLICT) and the reply is the same.

import type { Feature } from "../features.js";

const WELCOME =
  "Welcome to your Personal Internet Memory 🧠\n" +
  "Forward me anything — articles, tweets, links, notes.\n" +
  "I'll tag, summarize, and resurface it weekly.\n\n" +
  "Try /list, /search, or /tags to find stuff later.";

export const startFeature: Feature = (app) => {
  app.onCommand("start", async (ctx) => {
    if (ctx.from) app.store.upsertUser(ctx.from.id);
    await ctx.reply(WELCOME);
  });
};
