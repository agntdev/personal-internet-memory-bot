// AI layer interfaces + length contract. Both Tagger and
// Summarizer are swappable behind stable interfaces; the local
// implementations in ./tagger.ts and ./summarizer.ts are the
// v1 default. A future LLM-backed implementation drops in
// without touching call sites.
//
// See docs/design.md §2.3 and docs/details.md §3.2 for the
// contracts these types pin.

/** Item kinds — mirrored by the schema's CHECK constraint
 *  (src/db/schema.sql). F01's queries.ts uses the same union
 *  for its `ItemKind` type. Keep in sync. */
export type ItemKind =
  | "link"
  | "text"
  | "image"
  | "video"
  | "audio"
  | "voice"
  | "document"
  | "other";

/** Length contract — the only place these numbers live. */
export const SUMMARY_MIN_WORDS = 100;
export const SUMMARY_MAX_WORDS = 200;

/** Thrown by Summarizer when the source + related-item padding
 *  still cannot reach SUMMARY_MIN_WORDS. The save flow catches
 *  this and replies with the "couldn't summarize" error. */
export class SummaryLengthError extends Error {
  constructor(
    message: string,
    public readonly gotWords: number,
    public readonly minWords: number = SUMMARY_MIN_WORDS,
  ) {
    super(message);
    this.name = "SummaryLengthError";
  }
}

export interface Tagger {
  /** Return 0-5 tag names. Lowercase, deduped, no stopwords. */
  tag(input: { text: string; kind: ItemKind }): Promise<string[]>;
}

export interface Summarizer {
  /** Always returns a string of **SUMMARY_MIN_WORDS..SUMMARY_MAX_WORDS**
   *  words. Implementations MUST enforce the bounds; callers
   *  MUST NOT truncate. Throws SummaryLengthError if the source
   *  (after padding with related user items) is still < min. */
  summarize(input: {
    text: string;
    kind: ItemKind;
    /** Optional: summaries of related user items to use for
     *  padding when `text` is shorter than the min. The
     *  implementation picks the first 1-2 sentences from
     *  these (recency-then-tag-overlap order, decided by
     *  the caller) and prefixes them with "Related: ". */
    relatedSummaries?: string[];
  }): Promise<string>;
}
