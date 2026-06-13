// FEAT01 — /help. Lists every command with a one-line
// description (details.md §2). Plain Markdown-free text, one
// command per line.

import type { Feature } from "../features.js";

const HELP_TEXT =
  "/start — Greet + one-line overview\n" +
  "/help — List every command with one-line description\n" +
  "/save — Manual save: bot asks for text/link, then tags + summarizes\n" +
  "/list [n] — Most recent N items (default 10, max 50)\n" +
  "/search <query> — Natural-language search\n" +
  "/tag <name> — Show all items with that tag\n" +
  "/tags — List all the user's tags with item counts\n" +
  "/collections — List collections\n" +
  "/collection <name|id> — Show items in a collection\n" +
  "/deletecollection <name|id> — Delete a manual collection (with confirm)\n" +
  "/rename <old> <new> — Rename a tag or manual collection\n" +
  "/delete <id> — Delete an item (with confirm)\n" +
  "/digest — Manually trigger this week's digest\n" +
  "/stats — Dashboard: totals, top tags, next digest\n" +
  "/cancel — Abort any in-flight multi-step flow";

export const helpFeature: Feature = (app) => {
  app.onCommand("help", async (ctx) => {
    await ctx.reply(HELP_TEXT);
  });
};
