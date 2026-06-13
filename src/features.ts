// Feature installer pattern. F03 (save flow) and FEAT01..FEAT12
// each register their commands / callbacks / states on the
// BotApp. Core wires /start, /help, /cancel, the callback router
// and the text router AROUND them, so registration order is
// always correct: commands first, fallbacks last.

import type { Ctx } from "./session.js";
import type { Store, UserRecord } from "./store.js";

export type CallbackHandler = (ctx: Ctx, data: string, user: UserRecord) => Promise<void>;
export type CommandHandler = (ctx: Ctx, user: UserRecord) => Promise<void>;
export type StateHandler = (ctx: Ctx, text: string, user: UserRecord) => Promise<void>;
export type TextHandler = (ctx: Ctx, text: string, user: UserRecord) => Promise<void>;

export interface BotApp {
  store: Store;
  onCommand(name: string, fn: CommandHandler): void;
  onCallback(namespace: string, fn: CallbackHandler): void;
  onState(namespace: string, fn: StateHandler): void;
  onText(fn: TextHandler): void;
}

export type Feature = (app: BotApp) => void;

/** Empty default feature list. F03 + FEAT01..FEAT12 register
 *  themselves here as the implementation lands. */
export const defaultFeatures: Feature[] = [];
