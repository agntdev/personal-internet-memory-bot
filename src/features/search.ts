// FEAT03 — /search <query> via tsvector + ILIKE on tags and raw_text,
// with empty-state card and Show-more callback (details.md §6).

import { inlineButton, inlineKeyboard } from "@agntdev/bot-toolkit";
import type { Feature } from "../features.js";
import type { Ctx } from "../session.js";
import type { SearchResult } from "../store.js";

const SEARCH_LIMIT = 25;
const MORE_LIMIT = 50;
const SHOW_MORE_THRESHOLD = 5;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDate(d: Date): string {
  const weekday = WEEKDAYS[d.getUTCDay()]!;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${weekday} ${hh}:${mm}`;
}

function tokenizeQuery(text: string): string {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .join(" ");
}

function buildResultsCard(
  query: string,
  results: SearchResult[],
  total: number,
): string {
  const lines = results.map((r, i) => {
    const title =
      r.summary.length > 40
        ? r.summary.slice(0, 40) + "\u2026"
        : r.summary;
    const tagsStr = r.tags.length > 0 ? "  " + r.tags.join(", ") : "";
    return `${i + 1}. #${r.id}  ${formatDate(r.createdAt)}  ${title}${tagsStr}`;
  });
  return `\uD83D\uDD0E "${query}" \u2014 ${total} results\n${lines.join("\n")}`;
}

async function showSearchResults(
  ctx: Ctx,
  query: string,
  results: SearchResult[],
  total: number,
) {
  const card = buildResultsCard(query, results, total);
  const buttons: ReturnType<typeof inlineButton>[] = [];

  if (total > SHOW_MORE_THRESHOLD && results.length < MORE_LIMIT) {
    buttons.push(inlineButton("Show more", `searchmore:${query}`));
  }

  const replyMarkup = buttons.length > 0 ? inlineKeyboard([buttons]) : undefined;

  if (ctx.callbackQuery) {
    await ctx.editMessageText(card, { reply_markup: replyMarkup });
    await ctx.answerCallbackQuery();
  } else {
    await ctx.reply(card, { reply_markup: replyMarkup });
  }
}

export const searchFeature: Feature = (app) => {
  app.onCommand("search", async (ctx, user) => {
    const text = ctx.message?.text ?? "";
    const match = text.match(/^\/search\s+(.*)/);
    const rawQuery = (match?.[1] ?? "").trim();

    if (!rawQuery) {
      await ctx.reply(
        "Usage: `/search <query>`. Try `/search go architecture march`.",
      );
      return;
    }

    const query = tokenizeQuery(rawQuery);
    if (!query) {
      await ctx.reply(`No matches for "${rawQuery}".`, {
        reply_markup: inlineKeyboard([
          [inlineButton("Try /tags", "tags:list")],
        ]),
      });
      return;
    }

    const results = await app.store.searchItems(user.id, query, SEARCH_LIMIT);

    if (results.length === 0) {
      await ctx.reply(`No matches for "${rawQuery}".`, {
        reply_markup: inlineKeyboard([
          [inlineButton("Try /tags", "tags:list")],
        ]),
      });
      return;
    }

    await showSearchResults(ctx, rawQuery, results, results.length);
  });

  app.onCallback("searchmore", async (ctx, data, user) => {
    const rawQuery = data.split(":").slice(1).join(":");
    const query = tokenizeQuery(rawQuery);
    if (!query) {
      await ctx.answerCallbackQuery({ text: "Stale button" });
      return;
    }
    const results = await app.store.searchItems(user.id, query, MORE_LIMIT);
    if (results.length === 0) {
      await ctx.editMessageText(`No matches for "${rawQuery}".`, {
        reply_markup: inlineKeyboard([
          [inlineButton("Try /tags", "tags:list")],
        ]),
      });
      await ctx.answerCallbackQuery();
      return;
    }
    await showSearchResults(ctx, rawQuery, results, results.length);
  });
};