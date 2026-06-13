// Runtime entry. BOT_TOKEN and DATABASE_URL are injected at
// runtime by the deploy container — never baked into source.

import { makeProductionBot } from "./bot.js";
import { configFromEnv } from "./config.js";
import { startWeeklyDigest } from "./scheduler.js";

const cfg = configFromEnv();
const { bot, store } = makeProductionBot(cfg);

startWeeklyDigest(bot, store);

console.log("[pimb] starting long polling");
void bot.start();
