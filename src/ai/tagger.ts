// Local keyword-tagging impl. Cheap, deterministic, no network.
// The save pipeline short-circuits this for `kind = 'other'`
// (see details.md §3.3); the short-circuit lives in the
// pipeline, not here, so a future LLM-backed Tagger can't
// reintroduce tags for media-without-text.

import type { Tagger } from "./types.js";

/** Stopword list — short and conservative. Excludes the
 *  commonest English function words plus a handful of generic
 *  web-y tokens that aren't useful as tags. */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "has", "have", "he", "her", "his", "i", "in", "is", "it", "its",
  "of", "on", "or", "she", "that", "the", "this", "to", "was",
  "were", "we", "will", "with", "you", "your", "yours", "our",
  "they", "them", "their", "but", "if", "not", "so", "do", "does",
  "did", "can", "could", "would", "should", "may", "might", "shall",
  "about", "than", "then", "there", "these", "those", "what", "when",
  "where", "which", "who", "why", "how", "all", "any", "some",
  "one", "two", "three", "just", "also", "more", "most", "other",
  "into", "out", "up", "down", "over", "under", "again", "very",
  "http", "https", "www", "com", "net", "org", "io",
]);

const MAX_TAGS = 5;

export class LocalTagger implements Tagger {
  async tag(input: { text: string; kind: string }): Promise<string[]> {
    if (!input.text) return [];
    const counts = new Map<string, number>();
    // Lowercase, split on non-letter/digit, drop short + stopwords.
    const tokens = input.text.toLowerCase().split(/[^a-z0-9]+/g);
    for (const t of tokens) {
      if (t.length < 3) continue;
      if (STOPWORDS.has(t)) continue;
      // Skip pure numbers.
      if (/^\d+$/.test(t)) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    // Sort by count desc, then alphabetically for stable output.
    return [...counts.entries()]
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
      .slice(0, MAX_TAGS)
      .map(([word]) => word);
  }
}
