// Core bot assembly: the error boundary, /cancel, the callback
// router, and the text router. Feature installers (startFeature,
// helpFeature, plus F03 + FEAT02..FEAT12) plug into the BotApp
// in between, so registration order is always correct: commands
// first, generic text/callback fallbacks last.

import { createBot } from "@agntdev/bot-toolkit";
import type { Bot } from "grammy";
import type { BotConfig } from "./config.js";
import { type BotApp, type Feature, defaultFeatures } from "./features.js";
import { type Ctx, initialSession } from "./session.js";
import { type Store, MemoryStore } from "./store.js";

/** Build the bot with the given store, config, and feature
 *  installers. Used by both main.ts (real token, real store) and
 *  harness-entry.ts (dummy token, fresh store). */
export function buildBot(
  token: string,
  store: Store,
  cfg: BotConfig,
  features: Feature[] = defaultFeatures,
): Bot<Ctx> {
  const bot = createBot<Ctx["session"]>(token, { initial: initialSession });

  // F00: error boundary. A single handler failure logs and apologises
  // — the update loop never crashes (details.md §17).
  bot.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      console.error("[pimb] handler error:", err);
      try {
        await ctx.reply("⚠️ Something went wrong. Try again in a moment.");
      } catch {
        /* replying itself failed — nothing left to do */
      }
    }
  });

  // ── /cancel (FEAT10): clears session step, always works (details.md §15) ──
  bot.command("cancel", async (ctx) => {
    ctx.session.step = "idle";
    ctx.session.renameOld = undefined;
    ctx.session.renameNew = undefined;
    ctx.session.renameTargets = undefined;
    await ctx.reply("Cancelled.");
  });

  // ── feature installers (FEAT01..FEAT12) ──
  const commands = new Map<string, (ctx: Ctx, user: UserRecordLite) => Promise<void>>();
  const callbacks = new Map<string, (ctx: Ctx, data: string, user: UserRecordLite) => Promise<void>>();
  const states = new Map<string, (ctx: Ctx, text: string, user: UserRecordLite) => Promise<void>>();
  let textHandler: ((ctx: Ctx, text: string, user: UserRecordLite) => Promise<void>) | null = null;

  const app: BotApp = {
    store,
    onCommand: (name, fn) => commands.set(name, fn),
    onCallback: (ns, fn) => callbacks.set(ns, fn),
    onState: (ns, fn) => states.set(ns, fn),
    onText: (fn) => {
      textHandler = fn;
    },
  };
  for (const install of features) install(app);

  // ── feature commands (registered AFTER /cancel so features
  //    can override /start etc. if they really need to) ──
  for (const [name, fn] of commands) {
    bot.command(name, async (ctx) => {
      if (!ctx.from) return;
      const user = await store.upsertUser(ctx.from.id);
      await fn(ctx, user);
    });
  }

  // ── callback router (after features so their namespaces are
  //    known) (details.md §11) ──
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!ctx.from) return;
    const user = await store.upsertUser(ctx.from.id);
    const ns = data.split(":", 1)[0]!;
    const handler = callbacks.get(ns);
    if (handler) {
      await handler(ctx, data, user);
      return;
    }
    // Unknown callback: stop the spinner, do not edit the message.
    await ctx.answerCallbackQuery({ text: "Stale button" });
  });

  // ── text router: feature states, feature text handler, fallback ──
  bot.on("message:text", async (ctx) => {
    if (!ctx.from) return;
    const user = await store.upsertUser(ctx.from.id);
    const text = ctx.message.text.trim();
    const stateNs = ctx.session.step.split(":", 1)[0]!;
    const stateHandler = states.get(stateNs);
    if (stateHandler) {
      await stateHandler(ctx, text, user);
      return;
    }
    if (textHandler && ctx.session.step === "idle") {
      await textHandler(ctx, text, user);
      return;
    }
    // Stray text in idle with no text handler: ask for clarification.
    await ctx.reply("I didn't catch that. Try /help for the list of commands.");
  });

  // Silence "unused" lint about cfg (consumed by F03 once it lands).
  void cfg;
  return bot;
}

/** Minimal user shape the core routers touch. The full UserRecord
 *  comes from `await store.upsertUser(...)`; this is a local
 *  alias so the installer callback signatures stay readable. */
type UserRecordLite = import("./store.js").UserRecord;

/** Helper for `main.ts`: construct a MemoryStore + real config +
 *  default features, then return the bot. */
export function makeProductionBot(cfg: BotConfig, features: Feature[] = defaultFeatures): Bot<Ctx> {
  return buildBot(cfg.botToken, new MemoryStore(), cfg, features);
}
