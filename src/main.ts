// Runtime entry. BOT_TOKEN and DATABASE_URL are injected at
// runtime by the deploy container — never baked into source.

import { makeProductionBot } from "./bot.js";
import { configFromEnv } from "./config.js";

const cfg = configFromEnv();
const bot = makeProductionBot(cfg);

console.log("[pimb] starting long polling");
void bot.start();
