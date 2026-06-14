// Runtime entry. BOT_TOKEN and DATABASE_URL are injected at
// runtime by the deploy container — never baked into source.

import { buildBot } from "./bot.js";
import { configFromEnv } from "./config.js";
import { MemoryStore } from "./store.js";
import { startWeeklyDigestScheduler } from "./scheduler.js";

const cfg = configFromEnv();
const store = new MemoryStore();
const bot = buildBot(cfg.botToken, store, cfg);

console.log("[pimb] starting long polling");
void bot.start();

console.log("[pimb] scheduling weekly digest (Sun 18:00 UTC)");
startWeeklyDigestScheduler(bot, store);
