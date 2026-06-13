// Feature installer pattern. F03 (save flow) and FEAT01..FEAT12
// each register their commands / callbacks / states on the
// BotApp. Core wires /cancel, the callback router and the text
// router AROUND them, so registration order is always correct:
// commands first, fallbacks last. The default feature set lives
// in ./features/index.ts (aggregates the per-feature installers).

import type { Ctx } from "./session.js";
import type { Store, UserRecord } from "./store.js";

export type CallbackHandler = (ctx: Ctx, data: string, user: UserRecord) => Promise<void>;
export type CommandHandler = (ctx: Ctx, user: UserRecord) => Promise<void>;
export type StateHandler = (ctx: Ctx, text: string, user: UserRecord) => Promise<void>;
export type TextHandler = (ctx: Ctx, text: string, user: UserRecord) => Promise<void>;

export type MessageHandler = (ctx: Ctx, user: UserRecord) => Promise<void>;

export interface BotApp {
  store: Store;
  onCommand(name: string, fn: CommandHandler): void;
  onCallback(namespace: string, fn: CallbackHandler): void;
  onState(namespace: string, fn: StateHandler): void;
  onText(fn: TextHandler): void;
  /** Handler for non-text messages (photo, video, audio, voice,
   *  document, sticker, etc.) when session.step is idle. */
  onMessage(fn: MessageHandler): void;
}

export type Feature = (app: BotApp) => void;

// Re-export for back-compat with F00 callers; the canonical list
// lives in ./features/index.ts.
export { defaultFeatures } from "./features/index.js";
