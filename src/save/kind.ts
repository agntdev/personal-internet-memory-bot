// Detect the kind + raw text from an incoming Telegram message.
// Implements details.md §3 step 1: media kind only when the
// media field is present AND a non-empty caption exists;
// otherwise the message falls to `other` (per design.md §6:
// "Forwarded message with no text and no caption → kind=other,
// no tags").
//
// `entities` parsing for URLs follows Telegram's standard:
// text_link, url, and the text itself may all carry URLs.

import type { ItemKind } from "../ai/types.js";

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/i;

export interface DetectionResult {
  kind: ItemKind;
  rawText: string;
  sourceUrl: string | null;
}

interface AnyMessage {
  text?: string;
  caption?: string;
  entities?: Array<{ type: string; offset: number; length: number; url?: string }>;
  caption_entities?: Array<{ type: string; offset: number; length: number; url?: string }>;
  photo?: unknown;
  video?: unknown;
  audio?: unknown;
  voice?: unknown;
  document?: unknown;
  sticker?: unknown;
  contact?: unknown;
  location?: unknown;
  dice?: unknown;
  // ... Telegram defines many more; we only care about presence.
}

function findUrl(text: string, entities: AnyMessage["entities"]): string | null {
  if (!text) return null;
  // 1. Scan text for a URL substring.
  const direct = text.match(URL_RE);
  if (direct) return direct[0];
  // 2. text_link entities carry a URL.
  for (const e of entities ?? []) {
    if ((e.type === "text_link" || e.type === "url") && e.url) {
      return e.url;
    }
  }
  return null;
}

export function detectMessageKind(msg: AnyMessage): DetectionResult {
  const text = msg.text ?? "";
  const caption = msg.caption ?? "";
  const url = findUrl(text, msg.entities) ?? findUrl(caption, msg.caption_entities);

  // Link kind: text or caption contains a URL.
  if (url) {
    return { kind: "link", rawText: url, sourceUrl: url };
  }
  // Text kind: non-empty text, no URL, no media.
  if (text && !msg.photo && !msg.video && !msg.audio && !msg.voice && !msg.document) {
    return { kind: "text", rawText: text, sourceUrl: null };
  }
  // Media kind ONLY when the media field is present AND the
  // message has a non-empty caption (per details.md §3 step 1 +
  // design.md §6). Media without caption → kind=other below.
  if (caption) {
    if (msg.photo) return { kind: "image", rawText: caption, sourceUrl: null };
    if (msg.video) return { kind: "video", rawText: caption, sourceUrl: null };
    if (msg.audio) return { kind: "audio", rawText: caption, sourceUrl: null };
    if (msg.voice) return { kind: "voice", rawText: caption, sourceUrl: null };
    if (msg.document) return { kind: "document", rawText: caption, sourceUrl: null };
  }
  // Everything else: no text + no caption, or media without
  // caption, or unrecognized message type → kind=other, raw="".
  return { kind: "other", rawText: "", sourceUrl: null };
}
