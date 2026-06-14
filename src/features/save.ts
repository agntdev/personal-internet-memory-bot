// F03 — Save flow core: forwarded-message kind detection,
// raw_text extraction, save pipeline (tag → summarize → store),
// confirmation card builder, dedupe-notice behavior.

import type { Feature } from "../features.js";
import type { Ctx } from "../session.js";
import { LocalTagger } from "../ai/tagger.js";
import { LocalSummarizer } from "../ai/summarizer.js";
import { SummaryLengthError, type ItemKind } from "../ai/types.js";
import { inlineButton, urlButton, inlineKeyboard } from "@agntdev/bot-toolkit";
import type { SavedItemMeta, UserRecord } from "../store.js";

const URL_RE = /https?:\/\/\S+/i;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDate(d: Date): string {
  const weekday = WEEKDAYS[d.getUTCDay()]!;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${weekday} ${hh}:${mm}`;
}

function detectKind(
  msg: NonNullable<Ctx["message"]>,
): { kind: ItemKind; rawText: string; sourceUrl: string | null } {
  const text = msg.text ?? "";
  const caption = msg.caption ?? "";
  const body = text || caption;

  const urlMatch = body.match(URL_RE);
  const hasUrlEntity = msg.entities?.some(
    (e) => e.type === "text_link" || e.type === "url",
  );
  const hasUrl = !!urlMatch || !!hasUrlEntity;

  if (hasUrl) {
    let sourceUrl: string | null = null;
    if (hasUrlEntity) {
      const urlEntity = msg.entities?.find((e) => e.type === "text_link");
      if (urlEntity && "url" in urlEntity) {
        sourceUrl = (urlEntity as { url: string }).url;
      }
    }
    if (!sourceUrl) {
      sourceUrl = urlMatch?.[0] ?? null;
    }
    return { kind: "link", rawText: sourceUrl ?? body, sourceUrl };
  }

  if (text) {
    return { kind: "text", rawText: text, sourceUrl: null };
  }

  if (caption) {
    if (msg.photo) return { kind: "image", rawText: caption, sourceUrl: null };
    if (msg.video) return { kind: "video", rawText: caption, sourceUrl: null };
    if (msg.audio) return { kind: "audio", rawText: caption, sourceUrl: null };
    if (msg.voice) return { kind: "voice", rawText: caption, sourceUrl: null };
    if (msg.document)
      return { kind: "document", rawText: caption, sourceUrl: null };
  }

  return { kind: "other", rawText: "", sourceUrl: null };
}

function isSearchShortcut(text: string): boolean {
  const tokens = text.trim().split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length < 2) return false;
  if (URL_RE.test(text)) return false;
  return true;
}

export const saveFeature: Feature = (app) => {
  const tagger = new LocalTagger();
  const summarizer = new LocalSummarizer();

  async function runSaveFlow(
    ctx: Ctx,
    user: UserRecord,
  ): Promise<void> {
    const msg = ctx.message;
    if (!msg) return;

    const { kind, rawText, sourceUrl } = detectKind(msg);

    const placeholder = await ctx.reply("\u23f3 saving\u2026");

    try {
      let tags: string[] = [];
      if (kind !== "other") {
        tags = await tagger.tag({ text: rawText, kind });
      }

      let summary: string;
      if (kind === "other") {
        summary = "[media]";
      } else {
        summary = await summarizer.summarize({ text: rawText, kind });
      }

      const result: SavedItemMeta = await app.store.insertItem({
        userId: user.id,
        kind,
        rawText,
        sourceUrl,
        telegramMessageId: msg.message_id,
        summary,
        tags,
      });

      let dedupeNotice = "";
      if (sourceUrl) {
        const dupe = await app.store.findUrlDuplicate(user.id, sourceUrl);
        if (dupe && dupe.id !== result.id) {
          dedupeNotice =
            `\nAlready have this one (#${dupe.id}, ${formatDate(dupe.createdAt)}) \u2014 saved as a new entry #${result.id} too.`;
        }
      }

      for (const tag of tags) {
        await app.store.ensureAutoCollection(user.id, result.id, tag);
      }

      const tagsStr =
        tags.length > 0 ? tags.join(", ") : "(no tags yet)";
      const dateStr = formatDate(result.createdAt);

      const card =
        `\u2705 Saved (#${result.id})\n` +
        `Tags: ${tagsStr}\n` +
        `Summary: ${summary}\n` +
        `Saved ${dateStr}.${dedupeNotice}`;

      const buttons: Array<ReturnType<typeof inlineButton> | ReturnType<typeof urlButton>> =
        [];

      if (kind === "link" && sourceUrl) {
        buttons.push(urlButton("Open", sourceUrl));
      } else {
        const username = ctx.me?.username;
        if (username) {
          const permalink = `https://t.me/${username}/${msg.message_id}`;
          if (kind === "link" && !sourceUrl) {
            buttons.push(urlButton("Open", permalink));
          }
        }
      }

      buttons.push(inlineButton("More like this", `more:${result.id}`));
      buttons.push(inlineButton("Delete", `del:${result.id}`));

      await ctx.api.editMessageText(msg.chat.id, placeholder.message_id, card, {
        reply_markup: inlineKeyboard([buttons]),
      });
    } catch (err) {
      if (err instanceof SummaryLengthError) {
        await ctx.api
          .editMessageText(
            msg.chat.id,
            placeholder.message_id,
            "\u26a0\ufe0f I couldn\u2019t summarize this \u2014 try /save with a longer text or pick a richer source.",
          )
          .catch(() => {});
      } else {
        await ctx.api
          .editMessageText(
            msg.chat.id,
            placeholder.message_id,
            "\u26a0\ufe0f Couldn\u2019t save right now, try again in a moment.",
          )
          .catch(() => {});
      }
    }
  }

  app.onCommand("save", async (ctx) => {
    ctx.session.step = "awaiting_save_input";
    await ctx.reply("Send me the text or link to save.");
  });

  app.onText(async (ctx, text, user) => {
    const msg = ctx.message;
    if (!msg) return;

    const isForwarded = !!msg.forward_origin;

    if (!isForwarded && isSearchShortcut(text)) {
      const results = await app.store.searchItems(user.id, text, 25);
      if (results.length === 0) {
        await ctx.reply(`No matches for "${text}".`);
      } else {
        const lines = results.map((r, i) => {
          const tagsStr =
            r.tags.length > 0 ? "  " + r.tags.join(", ") : "";
          const title =
            r.summary.length > 40
              ? r.summary.slice(0, 40) + "\u2026"
              : r.summary;
          return `${i + 1}. #${r.id}  ${formatDate(r.createdAt)}  ${title}${tagsStr}`;
        });
        await ctx.reply(
          `\ud83d\udd0e "${text}" \u2014 ${results.length} results\n${lines.join("\n")}`,
        );
      }
      return;
    }

    await runSaveFlow(ctx, user);
  });

  app.onState("awaiting_save_input", async (ctx, _text, user) => {
    ctx.session.step = "idle";
    await runSaveFlow(ctx, user);
  });

  app.onMessage(async (ctx, user) => {
    await runSaveFlow(ctx, user);
  });

  app.onCallback("more", async (ctx, data, _user) => {
    const itemIdStr = data.split(":", 2)[1];
    if (!itemIdStr) {
      await ctx.answerCallbackQuery({ text: "Stale button" });
      return;
    }
    try {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        ctx.callbackQuery!.message!.message_id,
        "No similar items yet \u2014 keep saving!",
      );
    } catch {
      // message may be deleted
    }
    await ctx.answerCallbackQuery();
  });
};
