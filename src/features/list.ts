// FEAT02 — /list [n] with pagination (10 default, 50 max, OFFSET-based, paginate() helper)
// See docs/design.md §4.5 and docs/details.md §5.

import { paginate, type InlineKeyboardMarkup } from "@agntdev/bot-toolkit";
import type { Feature } from "../features.js";
import type { ItemRecord } from "../store.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const CALLBACK_PREFIX = "pg";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatDate(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]!} ${day}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function buildListReply(items: ItemRecord[], limit: number): string {
  const header = `🗂 Your last ${limit} items`;
  if (items.length === 0) return "No items saved yet — forward something to start.";
  const rows = items.slice(0, limit).map((it, i) => {
    const date = formatDate(it.createdAt);
    const title = truncate(it.summary, 40);
    return `${i + 1}. #${it.id}  ${date}  ${title}`;
  });
  return [header, ...rows].join("\n");
}

/** Build pagination controls using the toolkit's paginate() against
 *  the full item count (OFFSET-based: we re-query per page from DB). */
function buildControls(total: number, page: number, perPage: number, prefix: string): InlineKeyboardMarkup {
  if (total <= perPage) return { inline_keyboard: [] };
  // paginate() slices items internally; we pass a sparse array sized to `total`
  // so the total-pages math is correct. Only the current page's slots are filled.
  const sparse: (ItemRecord | undefined)[] = new Array(total);
  // Fill the current page's slots with placeholder to ensure the slice is non-empty.
  const start = page * perPage;
  const end = Math.min(start + perPage, total);
  for (let i = start; i < end; i++) sparse[i] = undefined as never;
  const result = paginate(sparse as ItemRecord[], {
    page,
    perPage,
    callbackPrefix: prefix,
    prevLabel: "« Prev",
    nextLabel: "Next »",
  });
  return result.controls;
}

/** Parse a /list [n] command. Returns the resolved limit value. */
function parseLimit(text: string): number {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2) return DEFAULT_LIMIT;
  const n = Number(parts[1]);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/** Parse the page number from a pagination callback like "pg:next:2". */
function parsePage(data: string): number {
  const parts = data.split(":");
  const page = Number(parts[parts.length - 1]);
  return Number.isInteger(page) && page >= 0 ? page : 0;
}

export const listFeature: Feature = (app) => {
  const perUserPageSize = new Map<number, number>();

  app.onCommand("list", async (ctx, user) => {
    const text = ctx.message?.text ?? "";
    const n = parseLimit(text);
    perUserPageSize.set(user.id, n);
    const perPage = n;
    const page = 0;
    const offset = page * perPage;
    const { items, total } = app.store.listRecentItems(user.id, perPage, offset);
    const reply = buildListReply(items, perPage);
    const controls = buildControls(total, page, perPage, CALLBACK_PREFIX);
    await ctx.reply(reply, { reply_markup: controls });
  });

  app.onCallback(CALLBACK_PREFIX, async (ctx, data, user) => {
    const page = parsePage(data);
    const perPage = perUserPageSize.get(user.id) ?? DEFAULT_LIMIT;
    const offset = page * perPage;
    const { items, total } = app.store.listRecentItems(user.id, perPage, offset);
    const reply = buildListReply(items, perPage);
    const controls = buildControls(total, page, perPage, CALLBACK_PREFIX);
    await ctx.editMessageText(reply, { reply_markup: controls });
  });
};
