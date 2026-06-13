// FEAT03 — save flow feature installer.
//
// Wires:
// - /save command: sets session.step = "awaiting_save_input",
//   prompts user for input.
// - "awaiting_save_input" state handler: takes the next text /
//   link, runs the save pipeline, replies with the confirmation
//   card (or the "couldn't summarize" error).
// - Slash-free `message` handler: any non-command message in a
//   private chat when `session.step === "idle"` runs the save
//   pipeline directly (kind detection handles media).
//
// The Tagger + Summarizer short-circuit for `kind = 'other'` is
// enforced inside the pipeline (./pipeline.ts), not in the AI
// impls themselves, so a future LLM-backed impl can't
// reintroduce tags for media-without-caption (details.md §3.3).

import type { Context } from "grammy";
import { SummaryLengthError } from "../ai/types.js";
import { detectMessageKind } from "./kind.js";
import { makeSavePipeline, type SavePipeline } from "./pipeline.js";
import { buildConfirmationCard } from "./card.js";
import type { Feature } from "../features.js";
import type { UserRecord } from "../store.js";

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

export const saveFeature: Feature = (app) => {
  const pipeline = makeSavePipeline(app.store);

  // /save: prompt the user for input.
  app.onCommand("save", async (ctx) => {
    ctx.session.step = "awaiting_save_input";
    await ctx.reply("Send me the text or link to save.");
  });

  // State handler: the next message after /save.
  app.onState("awaiting_save_input", async (ctx, text, user) => {
    const url = text.match(/\bhttps?:\/\/\S+/)?.[0] ?? null;
    const ok = await runSave(ctx, user, pipeline, {
      kind: url ? "link" : "text",
      rawText: text,
      sourceUrl: url,
      telegramMessageId: ctx.message?.message_id ?? null,
    });
    if (ok) ctx.session.step = "idle";
  });

  // Slash-free text handler for `idle` step: run the save flow
  // with a text-kind item when the user sends plain text. The
  // 2+ words → /search shortcut is handled by the /search
  // feature (FEAT03+); this installer only catches single-word
  // or empty text in idle.
  app.onText(async (ctx, text, user) => {
    if (text.split(/\s+/).filter((t) => t.length >= 2).length < 2) {
      await runSave(ctx, user, pipeline, {
        kind: isUrl(text) ? "link" : "text",
        rawText: text,
        sourceUrl: isUrl(text) ? text : null,
        telegramMessageId: ctx.message?.message_id ?? null,
      });
    }
  });
};

async function runSave(
  ctx: Context,
  user: UserRecord,
  pipeline: SavePipeline,
  detected: {
    kind: "link" | "text";
    rawText: string;
    sourceUrl: string | null;
    telegramMessageId: number | null;
  },
): Promise<boolean> {
  try {
    const { item, duplicateOf } = await pipeline.save({
      user,
      kind: detected.kind,
      rawText: detected.rawText,
      sourceUrl: detected.sourceUrl,
      telegramMessageId: detected.telegramMessageId,
    });
    const card = buildConfirmationCard(item, {
      dupNotice: duplicateOf
        ? { id: duplicateOf.id, createdAt: duplicateOf.createdAt }
        : undefined,
    });
    await ctx.reply(card.text, {
      reply_markup: {
        inline_keyboard: card.reply_markup.inline_keyboard.map((row) =>
          row.map((b) => {
            if (b.url) return { text: b.text, url: b.url } as const;
            return { text: b.text, callback_data: b.callback_data! } as const;
          }),
        ) as never,
      },
    });
    return true;
  } catch (err) {
    if (err instanceof SummaryLengthError) {
      await ctx.reply(
        "⚠️ I couldn't summarize this — try /save with a longer text or pick a richer source.",
      );
    } else {
      console.error("[pimb] save flow error:", err);
      await ctx.reply("⚠️ Couldn't save right now, try again in a moment.");
    }
    return false;
  }
}

// Re-export for spec coverage and side-effect-free imports.
export { detectMessageKind } from "./kind.js";
