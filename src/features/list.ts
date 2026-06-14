// FEAT02 — /list [n] with pagination (10 default, 50 max,
// OFFSET-based, paginate() helper).

import { inlineButton, inlineKeyboard } from "@agntdev/bot-toolkit";
import type { Feature } from "../features.js";
import type { Ctx } from "../session.js";
import type { SearchResult } from "../store.js";

const PER_PAGE_DEFAULT = 10;
const PER_PAGE_MAX = 50;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDate(d: Date): string {
  const weekday = WEEKDAYS[d.getUTCDay()]!;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${weekday} ${hh}:${mm}`;
}

/**
 * OFFSET-based pagination helper. Clamps `page` to >= 0 and
 * `perPage` to [1, PER_PAGE_MAX]; returns the computed offset,
 * effective limit, and the clamped page number.
 */
export function paginate(
  page: number,
  perPage: number = PER_PAGE_DEFAULT,
): { offset: number; limit: number; page: number } {
  const clampedPer = Math.min(Math.max(1, perPage), PER_PAGE_MAX);
  const clampedPage = Math.max(0, page);
  return {
    offset: clampedPage * clampedPer,
    limit: clampedPer,
    page: clampedPage,
  };
}

function renderItems(
  items: SearchResult[],
  page: number,
  perPage: number,
): string {
  const lines = items.map((r, i) => {
    const title =
      r.summary.length > 40
        ? r.summary.slice(0, 40) + "\u2026"
        : r.summary;
    const tagsStr = r.tags.length > 0 ? "  " + r.tags.join(", ") : "";
    return `${page * perPage + i + 1}. #${r.id}  ${formatDate(r.createdAt)}  ${title}${tagsStr}`;
  });
  return lines.join("\n");
}

function paginationButtons(
  page: number,
  totalPages: number,
  perPage: number,
) {
  if (totalPages <= 1) return [];
  const row: ReturnType<typeof inlineButton>[] = [];
  if (page > 0)
    row.push(
      inlineButton("\u00ab Prev", `listpg:${perPage}:${page - 1}`),
    );
  if (page < totalPages - 1)
    row.push(
      inlineButton("Next \u00bb", `listpg:${perPage}:${page + 1}`),
    );
  return row.length > 0 ? [row] : [];
}

async function showList(
  ctx: Ctx,
  items: SearchResult[],
  total: number,
  page: number,
  perPage: number,
) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const card =
    `\uD83D\uDCCB Your saved items (${total})\n` +
    renderItems(items, page, perPage);
  const buttons = paginationButtons(page, totalPages, perPage);
  const replyMarkup = buttons.length > 0 ? inlineKeyboard(buttons) : undefined;

  if (ctx.callbackQuery) {
    await ctx.editMessageText(card, { reply_markup: replyMarkup });
    await ctx.answerCallbackQuery();
  } else {
    await ctx.reply(card, { reply_markup: replyMarkup });
  }
}

export const listFeature: Feature = (app) => {
  app.onCommand("list", async (ctx, user) => {
    const text = ctx.message?.text ?? "";
    const match = text.match(/^\/list\s+(\d+)/);
    const n = match ? Number(match[1]) : PER_PAGE_DEFAULT;
    const { offset, limit, page } = paginate(0, n);

    const { items, total } = await app.store.getRecentItems(
      user.id,
      limit,
      offset,
    );

    if (items.length === 0) {
      await ctx.reply(
        "Your memory is empty \u2014 forward a few things and I\u2019ll start tagging.",
      );
      return;
    }

    await showList(ctx, items, total, page, limit);
  });

  app.onCallback("listpg", async (ctx, data, user) => {
    const parts = data.split(":");
    const perPage = Number(parts[1]);
    const page = Number(parts[2]);
    if (
      !Number.isFinite(perPage) ||
      perPage < 1 ||
      !Number.isFinite(page) ||
      page < 0
    ) {
      await ctx.answerCallbackQuery({ text: "Stale button" });
      return;
    }

    const { offset, limit, page: clampedPage } = paginate(
      page,
      perPage,
    );
    const { items, total } = await app.store.getRecentItems(
      user.id,
      limit,
      offset,
    );
    await showList(ctx, items, total, clampedPage, limit);
  });
};
