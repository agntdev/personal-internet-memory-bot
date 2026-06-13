// FEAT10 — /cancel. Clears session.step and any flow-specific
// fields, replies "Cancelled.". Always works (even mid-flow).

import type { Feature } from "../features.js";
import type { Ctx } from "../session.js";

export const cancelFeature: Feature = (app) => {
  app.onCommand("cancel", async (ctx: Ctx) => {
    ctx.session.step = "idle";
    ctx.session.renameOld = undefined;
    ctx.session.renameNew = undefined;
    ctx.session.renameTargets = undefined;
    await ctx.reply("Cancelled.");
  });
};
