// TOKENLESS factory for the replay harness. The harness imports
// this file and calls makeBot() once per spec, getting a fresh
// bot + fresh in-memory store. No top-level side effects, no
// .start() call. We also pre-populate botInfo so grammY
// commands that reference `ctx.me` don't trigger a getMe call.

import type { Bot } from "grammy";
import { buildBot } from "./bot.js";
import { type Ctx } from "./session.js";
import { MemoryStore } from "./store.js";

export function makeBot(): Bot<Ctx> {
  const bot = buildBot("0:harness-tokenless", new MemoryStore(), {
    botToken: "0:harness-tokenless",
    databaseUrl: "postgres://harness:harness@localhost:0/harness",
    harnessDefaultUserId: 1,
  });
  bot.botInfo = {
    id: 1,
    is_bot: true,
    first_name: "PIMB-Test",
    username: "pimb_test_bot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
  } as never;
  return bot;
}

export default makeBot;
