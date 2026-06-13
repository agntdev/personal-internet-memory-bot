// FEAT04 — /tag <name> + /tags list with item counts and
// per-row callback navigation (details.md §7–8).

import {
  inlineButton,
  inlineKeyboard,
} from "@agntdev/bot-toolkit";
import type { Feature } from "../features.js";
import type { Ctx } from "../session.js";
import type { SearchResult } from "../store.js";

const PER_PAGE = 10;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDate(d: Date): string {
  const weekday = WEEKDAYS[d.getUTCDay()]!;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${weekday} ${hh}:${mm}`;
}

function renderItemLines(pageItems: SearchResult[], page: number): string[] {
  return pageItems.map((r, i) => {
    const title =
      r.summary.length > 40
        ? r.summary.slice(0, 40) + "\u2026"
        : r.summary;
    return `${page * PER_PAGE + i + 1}. #${r.id}  ${formatDate(r.createdAt)}  ${title}`;
  });
}

function paginationButtons(
  page: number,
  totalPages: number,
  callbackPrefix: string,
) {
  if (totalPages <= 1) return [];
  const row: ReturnType<typeof inlineButton>[] = [];
  if (page > 0)
    row.push(inlineButton("\u00ab Prev", `${callbackPrefix}:prev:${page - 1}`));
  if (page < totalPages - 1)
    row.push(inlineButton("Next \u00bb", `${callbackPrefix}:next:${page + 1}`));
  return row.length > 0 ? [row] : [];
}

async function showTagPage(
  ctx: Ctx,
  tagName: string,
  items: SearchResult[],
  page: number,
) {
  const totalPages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);
  const pageItems = items.slice(
    clampedPage * PER_PAGE,
    (clampedPage + 1) * PER_PAGE,
  );
  const lines = renderItemLines(pageItems, clampedPage);
  const card = `#tag ${tagName} \u2014 ${items.length} items\n${lines.join("\n")}`;
  const buttons = paginationButtons(
    clampedPage,
    totalPages,
    `tagpg:${tagName}`,
  );
  const replyMarkup = buttons.length > 0 ? inlineKeyboard(buttons) : undefined;

  if (ctx.callbackQuery) {
    await ctx.editMessageText(card, { reply_markup: replyMarkup });
    await ctx.answerCallbackQuery();
  } else {
    await ctx.reply(card, { reply_markup: replyMarkup });
  }
}

async function showTagsList(
  ctx: Ctx,
  tags: Array<{ name: string; count: number }>,
  page: number,
) {
  const totalPages = Math.max(1, Math.ceil(tags.length / PER_PAGE));
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);
  const pageTags = tags.slice(
    clampedPage * PER_PAGE,
    (clampedPage + 1) * PER_PAGE,
  );

  const rows = pageTags.map((t) => [
    inlineButton(`${t.name}  (${t.count})`, `tag:${t.name}`),
  ]);
  const pgBtns = paginationButtons(clampedPage, totalPages, "taglp");
  const allRows = rows.concat(pgBtns);
  const replyMarkup = inlineKeyboard(allRows);
  const card = `\uD83C\uDFF7 Your tags (${tags.length})`;

  if (ctx.callbackQuery) {
    await ctx.editMessageText(card, { reply_markup: replyMarkup });
    await ctx.answerCallbackQuery();
  } else {
    await ctx.reply(card, { reply_markup: replyMarkup });
  }
}

export const tagsFeature: Feature = (app) => {
  app.onCommand("tag", async (ctx, user) => {
    const text = ctx.message?.text ?? "";
    const match = text.match(/^\/tag\s+(.+)/);
    const name = match?.[1]?.trim();
    if (!name) {
      await ctx.reply(
        "Usage: `/tag <name>`. Try /tags to see what\u2019s in your memory.",
      );
      return;
    }
    const items = await app.store.getItemsByTag(user.id, name);
    if (items.length === 0) {
      await ctx.reply(`No items tagged "${name}".`, {
        reply_markup: inlineKeyboard([
          [inlineButton("Show all tags", "tags:list")],
        ]),
      });
      return;
    }
    await showTagPage(ctx, name, items, 0);
  });

  app.onCommand("tags", async (ctx, user) => {
    const tags = await app.store.getTags(user.id);
    if (tags.length === 0) {
      await ctx.reply(
        "No tags yet \u2014 forward a few things and I\u2019ll start tagging.",
      );
      return;
    }
    await showTagsList(ctx, tags, 0);
  });

  app.onCallback("tag", async (ctx, data, user) => {
    const name = data.slice(4);
    const items = await app.store.getItemsByTag(user.id, name);
    if (items.length === 0) {
      await ctx.editMessageText(`No items tagged "${name}".`, {
        reply_markup: inlineKeyboard([
          [inlineButton("Show all tags", "tags:list")],
        ]),
      });
      await ctx.answerCallbackQuery();
      return;
    }
    await showTagPage(ctx, name, items, 0);
  });

  app.onCallback("tags", async (ctx, data, user) => {
    void data;
    const tags = await app.store.getTags(user.id);
    if (tags.length === 0) {
      await ctx.editMessageText(
        "No tags yet \u2014 forward a few things and I\u2019ll start tagging.",
      );
      await ctx.answerCallbackQuery();
      return;
    }
    await showTagsList(ctx, tags, 0);
  });

  // /tag pagination: callback "tagpg:<name>:prev|next:<page>"
  app.onCallback("tagpg", async (ctx, data, user) => {
    const parts = data.split(":");
    const dir = parts[parts.length - 2]!;
    const page = Number(parts[parts.length - 1]);
    const tagName = parts.slice(1, -2).join(":");
    if (!Number.isFinite(page) || page < 0) {
      await ctx.answerCallbackQuery({ text: "Stale button" });
      return;
    }
    const items = await app.store.getItemsByTag(user.id, tagName);
    await showTagPage(ctx, tagName, items, page);
  });

  // /tags pagination: callback "taglp:prev|next:<page>"
  app.onCallback("taglp", async (ctx, data, user) => {
    const parts = data.split(":");
    const page = Number(parts[2]);
    if (!Number.isFinite(page) || page < 0) {
      await ctx.answerCallbackQuery({ text: "Stale button" });
      return;
    }
    const tags = await app.store.getTags(user.id);
    await showTagsList(ctx, tags, page);
  });
};
