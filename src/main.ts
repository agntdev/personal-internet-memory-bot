// Runtime entry. BOT_TOKEN and DATABASE_URL are injected at
// runtime by the deploy container — never baked into source.

import { makeProductionBot } from "./bot.js";
import { configFromEnv } from "./config.js";
import { startDigestCron } from "./scheduler/digest.js";
import { MemoryStore } from "./store.js";

const cfg = configFromEnv();
const store = new MemoryStore();
const bot = makeProductionBot(cfg);

// FEAT11: start the weekly digest cron (Sun 18:00 UTC). The
// teardown is intentionally not stored — the process owns the
// timer for its full lifetime.
startDigestCron(bot, store);

console.log("[pimb] starting long polling");
void bot.start();
