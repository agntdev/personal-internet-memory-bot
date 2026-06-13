# Personal Internet Memory Bot — Design

> Architecture, full command set, and conversation/UX flows for the
> bot described in [`docs/general.md`](./general.md). Implementation
> details are deliberately simple. The "AI" pieces are local
> heuristics (extractive summary + keyword tags) so the bot has no
> paid-API dependency in v1; they live behind a `Tagger`/`Summarizer`
> interface so they can be swapped for an LLM later.

## 1. Goals and Non-Goals (recap)

From `general.md`:

- **In:** forward anything (text, links, images, videos) → tag →
  summarize → store → resurface weekly → search.
- **Out:** public sharing, real-time collab, manual tag/summary
  editing, integrations beyond Telegram, custom SR intervals.

Every design decision below is justified against this list.

## 2. Architecture

```
┌──────────────┐    long-poll / webhook     ┌──────────────────┐
│  Telegram    │ ─────────────────────────▶ │  grammY bot      │
│  (private    │ ◀───────────────────────── │  (Node + TS)     │
│   chat)      │   sendMessage / edits /    │  src/index.ts    │
└──────────────┘   answerCallbackQuery       └────────┬─────────┘
                                                       │
                                ┌──────────────────────┼─────────────────────┐
                                ▼                      ▼                     ▼
                         ┌────────────┐        ┌─────────────┐      ┌────────────┐
                         │  Postgres  │        │  AI layer   │      │  Scheduler │
                         │  (items,   │        │  tagger +   │      │  (node-cron│
                         │  tags,     │        │  summarizer)│      │   weekly)  │
                         │  users,    │        └─────────────┘      └────────────┘
                         │  srs)      │                ▲                     │
                         └────────────┘                │                     │
                                                        └──────── nightly job ───┘
```

### 2.1 Runtime

- **Language:** TypeScript on Node 20+.
- **Bot framework:** grammY, wrapped by `@agntdev/bot-toolkit`'s
  `createBot()` for session + error defaults.
- **Project shape:**
  ```
  src/
    index.ts          # makeBot() factory
    commands/         # one file per command
    flows/            # multi-step dialogs (save, search, browse)
    db/               # postgres pool + queries
    ai/               # Tagger + Summarizer (interfaces + local impls)
    scheduler/        # weekly resurfacing cron
  tests/
    specs/            # BotSpec JSON, one per command flow
  ```

### 2.2 Persistence (Postgres)

Five tables, all keyed by `telegram_user_id`:

| Table | Columns | Notes |
|---|---|---|
| `users` | `id PK, telegram_id UNIQUE, created_at` | one row per Telegram user |
| `items` | `id PK, user_id FK, kind, raw_text, source_url, telegram_message_id, created_at` | one row per forwarded thing |
| `tags` | `id PK, user_id FK, name` | unique per user |
| `item_tags` | `item_id FK, tag_id FK, PRIMARY KEY (item_id, tag_id)` | N:N |
| `collections` | `id PK, user_id FK, name, kind ('auto'|'manual')` | auto = grouped by tag overlap |
| `collection_items` | `collection_id FK, item_id FK, PRIMARY KEY (collection_id, item_id)` | N:N |
| `srs_state` | `item_id PK FK, last_shown_at, times_shown, next_show_at` | driven by `next_show_at` |

The "spaced repetition" in v1 is just a fixed weekly cadence (a single
`next_show_at` value). No SM-2 / Leitner / etc. — the spec explicitly
forbids custom intervals.

### 2.3 AI layer (interfaces, swappable impls)

```ts
export interface Tagger {
  tag(input: { text: string; kind: ItemKind }): Promise<string[]>;
}

export interface Summarizer {
  summarize(input: { text: string; kind: ItemKind }): Promise<string>;
}
```

**Local impl (v1, ships in the repo):**

- **Tagger** — strip stopwords, take top 3–5 most-frequent remaining
  tokens by TF, lowercase, dedupe. Cheap, deterministic, no network.
- **Summarizer** — for text, take the first sentences of the
  source. For URLs, fetch the page and use the
  `<meta name="description">` (or `<og:description>`); fall back
  to the URL itself if neither is present. The output **must be
  100–200 words** as required by `general.md`. If the source is
  shorter than 100 words, the summarizer pads with the first
  1–2 sentences of related user-saved items that share a tag
  (so the summary has substance, not filler). If the source is
  longer than 200 words, it is condensed to the first
  declarative sentences up to 200 words. The word count is
  enforced in the `Summarizer` impl, not in callers, so the
  contract is global.

Both are 50-line files. They are NOT a permanent solution; they're
the v1 implementation behind a stable interface. The LLM version is
a v2 concern (post-launch, per the non-goals).

### 2.4 Scheduler

A single `node-cron` job inside the bot process, registered at
`makeBot()` start, that fires **every Sunday 18:00 in the user's
local timezone** (Telegram doesn't give us TZ, so v1 uses UTC; a
`/settings tz` command can override per-user in a later version —
but per the non-goals, v1 stays UTC-only).

Job: pick up to 10 items per user whose `next_show_at <= now()` and
`times_shown < 5`, mark them shown, DM the user a digest.

## 3. Command Set

All commands are private-chat only in v1 (Telegram groups are out
of scope per the non-goals).

| Command | Purpose |
|---|---|
| `/start` | Greet + one-line overview. |
| `/help` | List every command with one-line description. |
| `/save` | Manual save: bot asks for text/link, then tags + summarizes. |
| `/list [n]` | Most recent N items (default 10, max 50). |
| `/search <query>` | Natural-language search. |
| `/tag <name>` | Show all items with that tag. |
| `/tags` | List all the user's tags with item counts. |
| `/collections` | List collections. |
| `/collection <name|id>` | Show items in a collection. |
| `/deletecollection <name|id>` | Delete a manual collection (with inline confirm). Auto-collections cannot be deleted — they ungroup themselves when their items are reassigned or when the last item is removed. |
| `/rename <old> <new>` | Rename a tag or manual collection. |
| `/delete <id>` | Delete an item (with inline confirm). |
| `/digest` | Manually trigger this week's digest (preview). |
| `/stats` | Dashboard: total items, top tags, next digest. |
| `/cancel` | Abort any in-flight multi-step flow. |

Slash-free entry points:

| Trigger | Behavior |
|---|---|
| Forwarded message (any kind) | Save → tag → summarize → confirm. |
| Plain text outside a flow | Treated as `/search <text>` only if it looks like a query (has 2+ words). Otherwise just stored as an item. |
| Callback `tag:more:<name>` | Extend `/tag <name>` results. |

## 4. Conversation / UX Flows

### 4.1 Onboarding — `/start`

```
User: /start
Bot:  Welcome to your Personal Internet Memory 🧠
      Forward me anything — articles, tweets, links, notes.
      I'll tag, summarize, and resurface it weekly.

      Try /list, /search, or /tags to find stuff later.
```

No deep onboarding. The first forwarded message is the
"onboarding-by-doing".

### 4.2 Save — forwarded message (the happy path)

```
User: [forwards a Telegram message containing a link]
Bot:  ⏳ saving…
Bot:  ✅ Saved (#42)
      Tags: go, architecture, performance
      Summary: The post argues that Go's goroutine scheduler…
      Saved Sun 13:30.
      [Open]  [More like this]  [Delete]
```

Behind the scenes:

1. Extract kind (`text` | `link` | `image` | `video` | `other`) from
   the forwarded message.
2. Extract text: for `link`, store the URL; for `text`, store body;
   for media, store `caption || file_id` and a short label
   (e.g. `"[video 1:42]"`).
3. Run Tagger + Summarizer.
4. Persist `items`, `tags` (new rows if unseen), `item_tags`.
5. Reply with confirmation card.

### 4.3 Save — manual `/save`

```
User: /save
Bot:  Send me the text or link to save.
User: https://example.com/golang-scheduler
Bot:  ⏳ saving…
Bot:  ✅ Saved (#42) — same card as 4.2
```

The "send me the text" prompt sets a session flag
(`session.awaiting = "save_input"`) so the next inbound text/URL
goes into the save flow rather than being treated as a new save on
its own.

### 4.4 Search — `/search`

```
User: /search article about go architecture from march
Bot:  🔎 "go architecture march" — 3 results
      1. #42  Mar 03  "Go's scheduler…"  go, architecture
      2. #31  Mar 09  "Notes on Go 1.22…"  go, release-notes
      3. #18  Mar 21  "CGO pitfalls"  go, cgo
      [Show more]
```

Matching is a `tsvector` full-text search on `items.raw_text` plus
`ILIKE` on tags, ordered by recency. The natural-language phrasing
is handled by tokenizing the query and running the same SQL —
we are not actually doing NL parsing in v1 (that's the v2 LLM
piece). The "natural" feel comes from the bot's confirmation copy.

### 4.5 List — `/list`

```
User: /list
Bot:  🗂 Your last 10 items
      1. #42  Mar 03  Go scheduler            go, architecture
      2. #41  Mar 02  Yoga routine            health, routine
      …
      [« Prev]  [Next »]
```

Paginated with the toolkit's `paginate()` helper.

### 4.6 Tag filter — `/tag`

```
User: /tag go
Bot:  #tag go — 14 items
      1. #42  Mar 03  Go scheduler
      2. #31  Mar 09  Go 1.22 release
      …
      [« Prev]  [Next »]
```

### 4.7 Collections — `/collections` and `/collection`

```
User: /collections
Bot:  📁 Your collections
      Auto:
        • "go" (8 items)
        • "health" (3 items)
      Manual:
        • "thesis-notes" (12 items)
      [go]  [health]  [thesis-notes]

User: /deletecollection thesis-notes
Bot:  Delete collection "thesis-notes" (12 items)?
      Items are kept — they just leave this collection.
      [✅ Yes]  [❌ No]
User: [taps Yes]
Bot:  Deleted collection "thesis-notes". 12 items preserved. ✅
```

Auto-collections are generated whenever a new item is saved: any
tag that has ≥ 3 items becomes a collection. Manual collections are
created implicitly when the user types `/collection new-name` —
the bot creates it, empty, and the next 3+ items saved with the
same name get attached (handled by a simple tag-name match — not a
real grouping algorithm; that's the "tag similarity" the spec asks
for, at the simplest possible interpretation).

**Deletion semantics:** only **manual** collections are
user-deletable. Deleting a manual collection removes the
`collections` row and its `collection_items` rows but **leaves the
underlying `items` and their tags intact** (so they stay searchable
and the next weekly digest still surfaces them). Auto-collections
have no delete command — they ungroup themselves automatically when
their source tag drops below 3 items (item deleted, tag renamed
away, or tag re-assigned via `/rename`).

### 4.8 Rename / delete

```
User: /rename go golang
Bot:  Renamed tag "go" → "golang" across 14 items. ✅

User: /delete 42
Bot:  Delete #42 ("Go scheduler…")? This can't be undone.
      [✅ Yes]  [❌ No]
User: [taps Yes]
Bot:  Deleted #42. ✅
```

### 4.9 Weekly digest — scheduler-driven

The Sunday job picks up to 10 oldest-unseen items and DMs:

```
Bot:  📚 This week's resurfacing (5 of 10)
      1. #18  Mar 21  CGO pitfalls
      2. #12  Mar 15  Postgres isolation levels
      3. #09  Mar 10  Vim macro you forgot
      …
      [Show all 10]  [Snooze all]
```

`/digest` returns the same content on demand, used in tests as the
deterministic view of "what the scheduler would send".

### 4.10 Stats — `/stats`

```
User: /stats
Bot:  📊 Your memory
      Items: 87  ·  Tags: 42  ·  Collections: 6
      Top tags: go (14), health (9), books (7)
      Next digest: Sun 18:00 UTC
      [Run digest now]
```

### 4.11 Cancel

```
User: /cancel
Bot:  Cancelled.  (clears session.awaiting, no matter what flow was active)
```

## 5. Session Shape

```ts
interface Session {
  step: "idle" | "awaiting_save_input" | "awaiting_search_query"
      | "awaiting_delete_confirm" | "awaiting_rename_target";
  lastSavedItemId?: number;
  lastQuery?: string;
  lastQueryPage?: number;
}
```

Sessions are private-chat only. Memory in v1, swappable to SQLite
later. No state beyond what's needed to make the multi-step
dialogs work — most "state" lives in Postgres, not in the session.

## 6. Error / Edge Cases

| Case | Behavior |
|---|---|
| Forwarded message with no text and no caption | Save with `kind=other`, summary `"[media]"`, no tags. Confirm card still sent. |
| Tagger produces 0 tags | Save with empty tag list, confirm card says "Saved (no tags yet)". |
| URL that's already been saved by the same user | Save anyway, but confirm card says "Already have this one (#38, Mar 03) — saved as a new entry #87 too." |
| Postgres unreachable on save | Reply: "⚠️ Couldn't save right now, try again in a moment." Do not crash. |
| User sends `/search` with no query | Reply with usage hint, not an error. |
| Callback data for an item the user deleted | Reply "That item is gone." and `answerCallbackQuery()`. |
| Bot restart mid-flow | Session is in memory, so flow restarts. User re-sends; not a problem. |

## 7. Testing Strategy

BotSpec JSON, one file per command flow. The harness gate is the
objective review gate; every declared command must have at least
one spec with a non-empty `expect[]` (see `telegram-test-specs`
skill).

Planned specs:

- `start.json` — `/start` greets.
- `save.json` — `/save` two-step flow + tag/summary appear in
  confirm card.
- `list.json` — `/list` shows recent items, paginates.
- `search.json` — `/search <query>` returns matching items.
- `tag.json` — `/tag <name>` filters by tag.
- `collections.json` — `/collections` + `/collection <name>`.
- `rename.json` — `/rename` flows.
- `delete.json` — `/delete` + inline confirm.
- `digest.json` — `/digest` returns the scheduler's view.
- `stats.json` — `/stats` dashboard.
- `cancel.json` — `/cancel` clears session.
- `forward.json` — forwarded-message path → confirm card.
- `edge_already_saved.json` — duplicate URL handling.
- `edge_no_text.json` — media-only forward.

## 8. Open Questions (non-blocking for v1)

These are deferred per the non-goals, listed so they aren't lost:

1. Custom spaced-repetition intervals (spec forbids in v1).
2. Manual tag/summary editing (spec forbids in v1).
3. Real LLM-based tagging / summarization (interface is ready;
   impl is a v2 swap).
4. Per-user timezone for the weekly digest (spec implies "weekly",
   not "user-local weekly").
5. Group-chat support (spec implies private only).

## 9. Out of Scope (explicit)

- Public sharing of saved items.
- Real-time collaboration.
- Manual tag / summary editing.
- Non-Telegram integrations.
- Custom SR intervals.
