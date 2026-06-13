// TOKENLESS factory for the replay harness. The harness imports
// this file and calls makeBot() once per spec, getting a fresh
// bot + fresh in-memory store. No top-level side effects, no
// .start() call.

import type { Bot } from "grammy";
import { buildBot } from "./bot.js";
import { type Ctx } from "./session.js";
import { MemoryStore } from "./store.js";

export function makeBot(): Bot<Ctx> {
  return buildBot("0:harness-tokenless", new MemoryStore(), {
    botToken: "0:harness-tokenless",
    databaseUrl: "postgres://harness:harness@localhost:0/harness",
    harnessDefaultUserId: 1,
  });
}

export default makeBot;
