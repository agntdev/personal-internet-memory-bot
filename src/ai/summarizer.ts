// Local Summarizer impl. Enforces the 100..200 word contract
// from design.md §2.3. For text: take the first declarative
// sentences. For URLs: caller is expected to pre-fetch the page
// and pass the <meta description> in `text`; we do not fetch
// here. The Summarizer pads short sources with related user
// item summaries (prefixed "Related: "), or throws
// SummaryLengthError if the result is still < min.
//
// Pipeline: base → cap at MAX → pad to MIN → return.

import { SUMMARY_MAX_WORDS, SUMMARY_MIN_WORDS, SummaryLengthError, type Summarizer } from "./types.js";

/** Split text into sentences (rough heuristic — split on
 *  sentence-end punctuation followed by whitespace + capital,
 *  or newline). Good enough for the local impl. */
function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  // Normalize whitespace.
  const cleaned = trimmed.replace(/\s+/g, " ");
  // Split on . ! ? followed by space+letter or end. Keep the
  // punctuation with the sentence.
  const parts = cleaned.split(/(?<=[.!?])\s+(?=[A-ZА-ЯЁ0-9"'(\[])/g);
  return parts.filter((s) => s.trim().length > 0);
}

function countWords(s: string): number {
  const m = s.trim().match(/\S+/g);
  return m ? m.length : 0;
}

export class LocalSummarizer implements Summarizer {
  async summarize(input: {
    text: string;
    kind: string;
    relatedSummaries?: string[];
  }): Promise<string> {
    if (!input.text && (!input.relatedSummaries || input.relatedSummaries.length === 0)) {
      throw new SummaryLengthError("empty source", 0);
    }

    // Step 1: build the base.
    let base = "";
    if (input.text) {
      const sentences = splitSentences(input.text);
      base = sentences.join(" ");
    } else {
      base = "";
    }

    // Step 2: cap at MAX.
    if (countWords(base) > SUMMARY_MAX_WORDS) {
      const sentences = splitSentences(base);
      const capped: string[] = [];
      let wordCount = 0;
      for (const s of sentences) {
        const w = countWords(s);
        if (wordCount + w > SUMMARY_MAX_WORDS) break;
        capped.push(s);
        wordCount += w;
        if (wordCount >= SUMMARY_MAX_WORDS) break;
      }
      base = capped.join(" ");
    }

    // Step 3: pad to MIN with related items.
    if (countWords(base) < SUMMARY_MIN_WORDS) {
      const related = (input.relatedSummaries ?? []).flatMap((r) => splitSentences(r));
      for (const sentence of related) {
        if (countWords(base) >= SUMMARY_MIN_WORDS) break;
        // Take the first 1-2 sentences of each related item.
        const candidate = `Related: ${sentence}`;
        const candidateWords = countWords(candidate);
        if (countWords(base) + candidateWords > SUMMARY_MAX_WORDS) {
          // Last sentence would overshoot; stop padding.
          break;
        }
        base = base ? `${base} ${candidate}` : candidate;
      }
    }

    // Step 4: still < MIN? throw.
    const total = countWords(base);
    if (total < SUMMARY_MIN_WORDS) {
      throw new SummaryLengthError(
        `summary too short: ${total} < ${SUMMARY_MIN_WORDS} after padding`,
        total,
      );
    }

    return base;
  }
}
