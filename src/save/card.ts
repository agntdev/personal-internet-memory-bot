// Confirmation card builder (details.md §3.1).

import type { SavedItem } from "../store.js";

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function fmtTime(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const day = days[d.getDay()] ?? "?";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${hh}:${mm}`;
}

function fmtDate(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")}`;
}

export interface ConfirmationCard {
  text: string;
  reply_markup: {
    inline_keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>>;
  };
}

export function buildConfirmationCard(
  item: SavedItem,
  opts?: { dupNotice?: { id: number; createdAt: Date } },
): ConfirmationCard {
  const tagsLine = item.tags.length > 0 ? item.tags.join(", ") : "(no tags yet)";
  const title = truncate(item.summary, 60);
  let text =
    `⏳ saving…\n` +
    `✅ Saved (#${item.id})\n` +
    `Tags: ${tagsLine}\n` +
    `Summary: ${title}\n` +
    `Saved ${fmtTime(item.createdAt)}.`;
  if (opts?.dupNotice) {
    text += `\nAlready have this one (#${opts.dupNotice.id}, ${fmtDate(opts.dupNotice.createdAt)}) — saved as new entry #${item.id} too.`;
  }
  const buttons: Array<{ text: string; url?: string; callback_data?: string }> = [];
  if (item.sourceUrl) {
    buttons.push({ text: "Open", url: item.sourceUrl });
  }
  buttons.push({ text: "More like this", callback_data: `more:${item.id}` });
  buttons.push({ text: "Delete", callback_data: `del:${item.id}` });
  return { text, reply_markup: { inline_keyboard: [buttons] } };
}
