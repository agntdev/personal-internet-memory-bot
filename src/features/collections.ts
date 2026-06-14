// FEAT05 — /collections + /collection <name|id> + /deletecollection
// (manual only) with auto-collection ungrouping explanation.
//
// Collections can be auto (created when a tag reaches ≥ 3 items)
// or manual (created by /collection <new-name>). Auto-collections
// cannot be deleted — they ungroup themselves automatically when
// their source tag drops below 3 items.

import { inlineButton, inlineKeyboard } from "@agntdev/bot-toolkit";
import type { Feature } from "../features.js";
import type { Ctx } from "../session.js";
import type { CollectionRecord, SearchResult } from "../store.js";

const PER_PAGE = 10;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDate(d: Date): string {
  const weekday = WEEKDAYS[d.getUTCDay()]!;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${weekday} ${hh}:${mm}`;
}

// ── Collections list (part of §9.1.1) ──

async function showCollectionsList(
  ctx: Ctx,
  collections: CollectionRecord[],
) {
  const auto = collections.filter((c) => c.kind === "auto");
  const manual = collections.filter((c) => c.kind === "manual");

  const lines: string[] = [];
  const buttons: ReturnType<typeof inlineButton>[] = [];

  if (auto.length > 0) {
    lines.push("Auto:");
    for (const c of auto) {
      lines.push(`  \u2022 ${c.name} (${c.itemCount} items)`);
      buttons.push(inlineButton(c.name, `coll:${c.id}`));
    }
  }

  if (manual.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Manual:");
    for (const c of manual) {
      lines.push(`  \u2022 ${c.name} (${c.itemCount} items)`);
      buttons.push(inlineButton(c.name, `coll:${c.id}`));
    }
  }

  const card = `\uD83D\uDCC1 Your collections (${collections.length})\n${lines.join("\n")}`;

  const replyMarkup =
    buttons.length > 0
      ? inlineKeyboard(
          buttons.map((b) => [b]),
        )
      : undefined;

  if (ctx.callbackQuery) {
    await ctx.editMessageText(card, { reply_markup: replyMarkup });
    await ctx.answerCallbackQuery();
  } else {
    await ctx.reply(card, { reply_markup: replyMarkup });
  }
}

// ── Collection-items card (§9.2.1) ──

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
  collectionId: number,
  showDelete: boolean,
) {
  const rows: ReturnType<typeof inlineButton>[][] = [];
  const navRow: ReturnType<typeof inlineButton>[] = [];
  if (page > 0)
    navRow.push(
      inlineButton(
        "\u00ab Prev",
        `collpg:${collectionId}:prev:${page - 1}`,
      ),
    );
  if (page < totalPages - 1)
    navRow.push(
      inlineButton(
        "Next \u00bb",
        `collpg:${collectionId}:next:${page + 1}`,
      ),
    );
  if (navRow.length > 0) rows.push(navRow);

  if (showDelete) {
    rows.push([
      inlineButton(
        "Delete collection",
        `colldel:${collectionId}`,
      ),
    ]);
  }

  return rows;
}

async function showCollectionPage(
  ctx: Ctx,
  coll: CollectionRecord,
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
  const kindLabel = coll.kind === "auto" ? "[auto]" : "[manual]";
  const card =
    `\uD83D\uDCC1 ${coll.name} \u2014 ${items.length} items ${kindLabel}\n${lines.join("\n")}`;
  const buttons = paginationButtons(
    clampedPage,
    totalPages,
    coll.id,
    coll.kind === "manual",
  );
  const replyMarkup = buttons.length > 0 ? inlineKeyboard(buttons) : undefined;

  if (ctx.callbackQuery) {
    await ctx.editMessageText(card, { reply_markup: replyMarkup });
    await ctx.answerCallbackQuery();
  } else {
    await ctx.reply(card, { reply_markup: replyMarkup });
  }
}

// ── Delete-confirm card (§9.3.1) ──

function deleteConfirmCard(coll: CollectionRecord): string {
  return `Delete collection "${coll.name}" (${coll.itemCount} items)?\nItems are kept \u2014 they just leave this collection.`;
}

export const collectionsFeature: Feature = (app) => {
  // ── /collections ──
  app.onCommand("collections", async (ctx, user) => {
    const collections = await app.store.listCollections(user.id);
    if (collections.length === 0) {
      await ctx.reply(
        "No collections yet \u2014 save a few items and collections will appear automatically when tags reach 3+ items.",
      );
      return;
    }
    await showCollectionsList(ctx, collections);
  });

  // ── /collection <name|id> ──
  app.onCommand("collection", async (ctx, user) => {
    const text = ctx.message?.text ?? "";
    const match = text.match(/^\/collection\s+(.+)/);
    const arg = (match?.[1] ?? "").trim();
    if (!arg) {
      await ctx.reply(
        "Usage: `/collection <name|id>`. Try /collections to see what\u2019s available.",
      );
      return;
    }

    let coll = await app.store.getCollection(
      user.id,
      /^\d+$/.test(arg) ? Number(arg) : arg,
    );

    if (!coll) {
      // Implicit create — if the argument doesn't look like an id,
      // create a new manual collection.
      if (!/^\d+$/.test(arg)) {
        coll = await app.store.createManualCollection(user.id, arg);
      } else {
        await ctx.reply(`No collection "${arg}".`, {
          reply_markup: inlineKeyboard([
            [inlineButton("Show collections", "collections:list")],
          ]),
        });
        return;
      }
    }

    const { items } = await app.store.getCollectionItems(
      coll.id,
      user.id,
      PER_PAGE,
      0,
    );
    await showCollectionPage(ctx, coll, items, 0);
  });

  // ── /deletecollection <name|id> ──
  app.onCommand("deletecollection", async (ctx, user) => {
    const text = ctx.message?.text ?? "";
    const match = text.match(/^\/deletecollection\s+(.+)/);
    const arg = (match?.[1] ?? "").trim();
    if (!arg) {
      await ctx.reply(
        "Usage: `/deletecollection <name|id>`. Only manual collections can be deleted.",
      );
      return;
    }

    const coll = await app.store.getCollection(
      user.id,
      /^\d+$/.test(arg) ? Number(arg) : arg,
    );

    if (!coll) {
      await ctx.reply(`No collection "${arg}".`);
      return;
    }

    if (coll.kind === "auto") {
      await ctx.reply(
        "Auto-collections can\u2019t be deleted \u2014 they ungroup themselves when their source tag drops below 3 items.",
        {
          reply_markup: inlineKeyboard([
            [inlineButton("Show collection", `coll:${coll.id}`)],
          ]),
        },
      );
      return;
    }

    await ctx.reply(deleteConfirmCard(coll), {
      reply_markup: inlineKeyboard([
        [
          inlineButton("\u2705 Yes", `colldel:${coll.id}:yes`),
          inlineButton("\u274c No", `colldel:${coll.id}:no`),
        ],
      ]),
    });
  });

  // ── Callback: show collection page when clicking a collection name ──
  app.onCallback("coll", async (ctx, data, user) => {
    const collId = Number(data.split(":")[1]);
    if (!Number.isFinite(collId) || collId <= 0) {
      await ctx.answerCallbackQuery({ text: "Stale button" });
      return;
    }
    const coll = await app.store.getCollection(user.id, collId);
    if (!coll) {
      await ctx.answerCallbackQuery({ text: "Collection gone." });
      return;
    }
    const { items } = await app.store.getCollectionItems(
      coll.id,
      user.id,
      PER_PAGE,
      0,
    );
    await showCollectionPage(ctx, coll, items, 0);
  });

  // ── Callback: collections list from "Show collections" button ──
  app.onCallback("collections", async (ctx, _data, user) => {
    const collections = await app.store.listCollections(user.id);
    if (collections.length === 0) {
      await ctx.editMessageText(
        "No collections yet \u2014 save a few items and collections will appear automatically when tags reach 3+ items.",
      );
      await ctx.answerCallbackQuery();
      return;
    }
    await showCollectionsList(ctx, collections);
  });

  // ── Callback: collection-item page pagination ──
  app.onCallback("collpg", async (ctx, data, user) => {
    const parts = data.split(":");
    // "collpg:<collId>:prev|next:<page>"
    const collId = Number(parts[1]);
    const dir = parts[2]!;
    const page = Number(parts[3]);
    if (
      !Number.isFinite(collId) ||
      collId <= 0 ||
      !Number.isFinite(page) ||
      page < 0
    ) {
      await ctx.answerCallbackQuery({ text: "Stale button" });
      return;
    }
    const coll = await app.store.getCollection(user.id, collId);
    if (!coll) {
      await ctx.answerCallbackQuery({ text: "Collection gone." });
      return;
    }
    const { items } = await app.store.getCollectionItems(
      coll.id,
      user.id,
      PER_PAGE,
      page * PER_PAGE,
    );
    if (items.length === 0 && page > 0) {
      await ctx.answerCallbackQuery({ text: "Stale button" });
      return;
    }
    await showCollectionPage(ctx, coll, items, page);
    void dir;
  });

  // ── Callback: delete collection confirm / abort ──
  app.onCallback("colldel", async (ctx, data, user) => {
    const parts = data.split(":");
    // "colldel:<collId>:yes|no"  (yes=confirm)  or  "colldel:<collId>" (from the "Delete collection" button on the items card)

    const collId = Number(parts[1]);
    if (!Number.isFinite(collId) || collId <= 0) {
      await ctx.answerCallbackQuery({ text: "Stale button" });
      return;
    }

    const action = parts[2];

    if (action === "no") {
      await ctx.editMessageText("Cancelled.");
      await ctx.answerCallbackQuery();
      return;
    }

    const coll = await app.store.getCollection(user.id, collId);
    if (!coll) {
      await ctx.editMessageText("Collection gone.");
      await ctx.answerCallbackQuery();
      return;
    }

    if (coll.kind === "auto") {
      await ctx.editMessageText(
        "Auto-collections can\u2019t be deleted \u2014 they ungroup themselves when their source tag drops below 3 items.",
      );
      await ctx.answerCallbackQuery();
      return;
    }

    // If no "yes"/"no" suffix, show the confirm card (triggered from
    // the "Delete collection" button on the collection-items card).
    if (!action) {
      await ctx.editMessageText(deleteConfirmCard(coll), {
        reply_markup: inlineKeyboard([
          [
            inlineButton("\u2705 Yes", `colldel:${coll.id}:yes`),
            inlineButton("\u274c No", `colldel:${coll.id}:no`),
          ],
        ]),
      });
      await ctx.answerCallbackQuery();
      return;
    }

    if (action === "yes") {
      const { name, itemCount } = await app.store.deleteCollection(coll.id);
      await ctx.editMessageText(
        `Deleted collection "${name}". ${itemCount} items preserved. \u2705`,
      );
      await ctx.answerCallbackQuery();
      return;
    }

    await ctx.answerCallbackQuery({ text: "Stale button" });
  });
};
