// Per-chat session shape. Authoritative conversation state lives in
// Postgres (see design.md §5 / details.md §16); this session is
// scratch space for in-flight multi-step flows only.
//
// Sessions are private-chat only and use the toolkit's
// MemorySessionStorage by default (swappable to SQLite later).

import type { SessionFlavor } from "grammy";
import type { BotContext } from "@agntdev/bot-toolkit";

export interface Session {
  /** Current dialog step. "idle" is the resting state. */
  step: "idle" | "awaiting_save_input" | "awaiting_rename_target";
  /** Rename-disambiguation flow data (set when step is
   *  "awaiting_rename_target" and both a tag and a manual
   *  collection match the old name). */
  renameOld?: string;
  renameNew?: string;
  renameTargets?: Array<"tag" | "collection">;
}

/** Typed context = grammY Context + SessionFlavor<Session>. */
export type Ctx = BotContext<Session>;

/** Initial session for fresh chats. */
export const initialSession = (): Session => ({ step: "idle" });
