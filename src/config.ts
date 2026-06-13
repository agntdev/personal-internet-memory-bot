// Environment configuration. All values are injected at runtime by
// the deploy container — never baked into source.

export interface BotConfig {
  /** Telegram bot token (required). */
  botToken: string;
  /** Postgres connection URL (required in v1; F01 wires the pool). */
  databaseUrl: string;
  /** Default Telegram user id used by the harness specs (e.g. send
   *  with userId: 1). */
  harnessDefaultUserId: number;
}

/** Read config from process.env. Throws on missing required values
 *  so the bot never starts in a half-configured state. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const botToken = env["BOT_TOKEN"];
  if (!botToken) throw new Error("[pimb] BOT_TOKEN is required");

  const databaseUrl = env["DATABASE_URL"];
  if (!databaseUrl) throw new Error("[pimb] DATABASE_URL is required");

  const harnessDefaultUserId = Number(env["HARNESS_DEFAULT_USER_ID"] ?? "1");
  if (!Number.isFinite(harnessDefaultUserId)) {
    throw new Error("[pimb] HARNESS_DEFAULT_USER_ID must be a number");
  }

  return { botToken, databaseUrl, harnessDefaultUserId };
}
