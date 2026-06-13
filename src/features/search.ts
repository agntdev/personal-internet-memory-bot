import type { Feature } from "../features.js";
import type { Ctx } from "../session.js";
import type { UserRecord } from "../store.js";
import { inlineButton, inlineKeyboard } from "@agntdev/bot-toolkit";

const PAGE_SIZE = 5;
const MAX_PAGES = 10;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDate(d: Date): string {
  const weekday = WEEKDAYS[d.getUTCDay()]!;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${weekday} ${hh}:${mm}`;
}

export const searchFeature: Feature = (app) => {
  app.onCommand("search", async (ctx, user) => {
    const msg = ctx.message;
    if (!msg) return;

    const query = msg.text!.split(/\s+/).slice(1).join(" ").trim();
    if (!query) {
      await ctx.reply(
        "Please provide a search query.\nUsage: /search <query>",
      );
      return;
    }

    await runSearch(ctx, user, query, 0);
  });

  app.onCallback("srch", async (ctx, data, user) => {
    const parts = data.split(":");
    if (parts.length < 3) {
      await ctx.answerCallbackQuery({ text: "Stale button" });
      return;
    }

    if (parts[1] === "more" && parts.length >= 4) {
      const query = decodeURIComponent(parts[2]!);
      const page = Number(parts[3]!);
      if (!Number.isFinite(page) || page < 0) {
        await ctx.answerCallbackQuery({ text: "Stale button" });
        return;
      }
      await runSearch(ctx, user, query, page);
      await ctx.answerCallbackQuery();
      return;
    }

    if (parts[1] === "del" && parts.length >= 3) {
      const itemId = Number(parts[2]!);
      if (!Number.isFinite(itemId) || itemId <= 0) {
        await ctx.answerCallbackQuery({ text: "Stale button" });
        return;
      }
      try {
        await ctx.api.editMessageText(
          ctx.chat!.id,
          ctx.callbackQuery!.message!.message_id,
          `Deleted #${itemId}. \u2705`,
        );
      } catch {
      }
      await ctx.answerCallbackQuery();
      return;
    }

    await ctx.answerCallbackQuery({ text: "Stale button" });
  });

  async function runSearch(
    ctx: Ctx,
    user: UserRecord,
    query: string,
    page: number,
  ): Promise<void> {
    const limit = PAGE_SIZE * MAX_PAGES;
    const result = await app.store.searchItems(user.id, query, limit);

    if (result.length === 0) {
      const emptyCard =
        `\u{1F50D} No results for \u201C${query}\u201D.\n` +
        `Try different keywords or save more items first.`;
      if (ctx.callbackQuery?.message) {
        await ctx.api.editMessageText(
          ctx.chat!.id,
          ctx.callbackQuery.message.message_id,
          emptyCard,
        );
      } else {
        await ctx.reply(emptyCard);
      }
      return;
    }

    const totalPages = Math.ceil(result.length / PAGE_SIZE);
    const clampedPage = Math.min(page, totalPages - 1);
    const start = clampedPage * PAGE_SIZE;
    const pageItems = result.slice(start, start + PAGE_SIZE);

    const lines = [
      `\u{1F50D} \u201C${query}\u201D \u2014 ${result.length} result${
        result.length === 1 ? "" : "s"
      }`,
    ];
    for (const item of pageItems) {
      const tagsStr =
        item.tags.length > 0 ? "  " + item.tags.join(", ") : "";
      const title =
        item.summary.length > 40
          ? item.summary.slice(0, 40) + "\u2026"
          : item.summary;
      lines.push(
        `#${item.id}  ${formatDate(item.createdAt)}  ${title}${tagsStr}`,
      );
    }

    if (totalPages > 1) {
      lines.push(`\nPage ${clampedPage + 1} / ${totalPages}`);
    }

    const buttons: ReturnType<typeof inlineButton>[] = [];
    if (clampedPage > 0) {
      buttons.push(
        inlineButton(
          `\u25C0 Prev`,
          `srch:more:${encodeURIComponent(query)}:${clampedPage - 1}`,
        ),
      );
    }
    if (clampedPage < totalPages - 1) {
      buttons.push(
        inlineButton(
          `Next \u25B6`,
          `srch:more:${encodeURIComponent(query)}:${clampedPage + 1}`,
        ),
      );
    }

    const text = lines.join("\n");
    const replyMarkup =
      buttons.length > 0 ? inlineKeyboard([buttons]) : undefined;

    if (ctx.callbackQuery?.message) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        ctx.callbackQuery.message.message_id,
        text,
        { reply_markup: replyMarkup },
      );
    } else {
      await ctx.reply(text, { reply_markup: replyMarkup });
    }
  }
};
