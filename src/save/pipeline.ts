// Save flow pipeline. The "happy path" of §3 + the kind=other
// short-circuit + the dedupe-notice behavior of §3.2.
//
// Tagger short-circuits for kind=other (per details.md §3.3 +
// design.md §6). Summarizer also short-circuits for kind=other
// (summary becomes the literal "[media]"). The pipeline owns
// these gates; AI impls can't reintroduce tags / summaries for
// media-without-caption.

import { LocalTagger } from "../ai/tagger.js";
import { LocalSummarizer } from "../ai/summarizer.js";
import { type Summarizer, type Tagger, type ItemKind, SummaryLengthError } from "../ai/types.js";
import type { SavedItem, Store, UserRecord } from "../store.js";

const DUPE_NOTICE_THRESHOLD = 1;

export interface SaveResult {
  item: SavedItem;
  /** True if the same URL was already saved by this user. */
  duplicateOf?: SavedItem;
}

/** Construct the pipeline with the given AI impls. Defaults to
 *  the local keyword-tagging + sentence-condensing impls. */
export function makeSavePipeline(
  store: Store,
  tagger: Tagger = new LocalTagger(),
  summarizer: Summarizer = new LocalSummarizer(),
) {
  return {
    async save(input: {
      user: UserRecord;
      kind: ItemKind;
      rawText: string;
      sourceUrl?: string | null;
      telegramMessageId?: number | null;
    }): Promise<SaveResult> {
      // Step 1: kind=other short-circuit (no tags, summary="[media]").
      // Anything else: run Tagger + Summarizer.
      let tags: string[];
      let summary: string;
      if (input.kind === "other") {
        tags = [];
        summary = "[media]";
      } else {
        try {
          tags = await tagger.tag({ text: input.rawText, kind: input.kind });
        } catch {
          // Tagger failure is non-fatal — fall back to no tags.
          tags = [];
        }
        try {
          summary = await summarizer.summarize({ text: input.rawText, kind: input.kind });
        } catch (err) {
          if (err instanceof SummaryLengthError) {
            // Re-throw so the caller can reply with the
            // "couldn't summarize" error and skip the insert.
            throw err;
          }
          // Any other Summarizer failure: fall back to the raw
          // text truncated to the max.
          summary = input.rawText.slice(0, 500);
        }
      }

      // Step 2: dedupe-notice check (link kind only, by sourceUrl).
      let duplicateOf: SavedItem | undefined;
      if (input.kind === "link" && input.sourceUrl) {
        duplicateOf = await store.findItemByUrl(input.user.id, input.sourceUrl);
      }

      // Step 3: insert the item (in production this also seeds
      // srs_state and runs auto-collection creation — see
      // db/queries.ts ensureAutoCollection).
      const item = await store.saveItem({
        userId: input.user.id,
        kind: input.kind,
        rawText: input.rawText,
        sourceUrl: input.sourceUrl ?? null,
        telegramMessageId: input.telegramMessageId ?? null,
        summary,
        tags,
      });

      return { item, duplicateOf };
    },
  };
}

export type SavePipeline = ReturnType<typeof makeSavePipeline>;
export { DUPE_NOTICE_THRESHOLD };
