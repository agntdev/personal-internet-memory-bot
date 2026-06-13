# Personal Internet Memory Bot — Details Spec

> Per-command behavior contract. This is the **review gate** the
> LLM coverage reviewer validates against for the Details phase. It
> must stay consistent with [`docs/design.md`](./design.md) and
> [`docs/general.md`](./general.md). When they conflict,
> `general.md` wins (it's the source of truth from the General
> phase), then `design.md` clarifies, then this file pins the
> implementation behavior.

## Conventions

- **Chat scope:** all commands are **private-chat only**. Group
  chats return: "I work in private chats only — message me
  directly." and `ctx.answerCallbackQuery()` for callbacks.
- **Persistence:** Postgres (see schema in `design.md` §2.2).
- **Session:** in-memory `MemorySessionStorage` (v1). All multi-step
  flows clear their `session.step` on completion, error, or
  `/cancel`.
- **Markdown:** bot replies use Telegram Markdown only when the
  reply contains a code block, tag list, or summary card. Plain
  `/help` text is unformatted.
- **Errors:** every command replies with one of the messages in
  §10 on failure. Never throws to the user.
- **Tests:** every command has a matching `tests/specs/<cmd>.json`
  BotSpec. The `Tests` phase is the objective gate.

## 1. `/start`

- **Trigger:** `/start` in a private chat.
- **Behavior:** create the `users` row if missing (set
  `telegram_id = ctx.from.id`). Reply with the welcome text from
  `design.md` §4.1. No session changes.
- **Reply shape:**
  ```
  Welcome to your Personal Internet Memory 🧠
  Forward me anything — articles, tweets, links, notes.
  I'll tag, summarize, and resurface it weekly.

  Try /list, /search, or /tags to find stuff later.
  ```
- **Edge:** re-`/start` from an existing user is idempotent (no
  duplicate `users` row, reply is the same).

## 2. `/help`

- **Trigger:** `/help` in a private chat.
- **Behavior:** reply with the command table (one line per command,
  matches `design.md` §3). No session changes.
- **Reply shape:** single Markdown message, one command per line.

## 3. Forwarded message → save (slash-free)

- **Trigger:** any non-command message in a private chat when
  `session.step === "idle"`.
- **Behavior:**
  1. Detect `kind`:
     - `link` if `text` contains a URL OR the message is a
       forwarded web-page preview (`entities` has `text_link` or
       `url`).
     - `text` if there's a non-empty `text` and no URL.
     - `image` / `video` / `audio` / `voice` / `document` if those
       `message` fields are present (use the first that matches).
     - `other` otherwise.
  2. Build `raw_text`:
     - `link` → the URL.
     - `text` → the message text.
     - media → `caption` if present, else a label like
       `"[image]"`, `"[video 1:42]"` (using the `duration` field
       if present, else omitted).
  3. Generate `tags` via `Tagger.tag({ text: raw_text, kind })`.
  4. Generate `summary` via `Summarizer.summarize({ text: raw_text, kind })`.
  5. Insert into `items` (with `telegram_message_id =
     ctx.message.message_id`, `created_at = now()`), then
     `tags` (upsert by `(user_id, name)`), then `item_tags`.
  6. **Auto-collection creation** — for each tag on the new item,
     if `count(items with that tag) >= 3` AND no
     `kind = 'auto'` collection exists with that name for the
     user, create one and attach the new item. See §9.1.1 for
     the full lifecycle. (This is what makes `/collections` show
     auto groupings.)
  7. Reply with the confirmation card (§3.1).

### 3.1 Confirmation card

```
⏳ saving…
✅ Saved (#<id>)
Tags: <comma-separated, max 5, or "(no tags yet)">
Summary: <summary>
Saved <weekday> <HH:MM>.
[Open]  [More like this]  [Delete]
```

- `[Open]` → `url` button. For `link` kind, points at the source
  URL. For other kinds, points at the Telegram message permalink
  built from the bot's username and the message id (fall back to
  no button if username is unknown).
- `[More like this]` → `callback_data = "more:<item_id>"`. Handler
  in §11.4.
- `[Delete]` → `callback_data = "del:<item_id>"`. Handler in
  §11.5.

### 3.2 Edges

- **Tagger returns []:** confirm card says "Tags: (no tags yet)".
- **Summarizer throws `SummaryLengthError`:** bot replies with
  "⚠️ I couldn't summarize this — try `/save` with a longer text
  or pick a richer source." and does **not** insert the row.
  (The item is not half-saved.)
- **Postgres unreachable:** "⚠️ Couldn't save right now, try again
  in a moment." No row inserted.
- **Duplicate URL (same user):** save anyway; confirm card adds a
  second line: "Already have this one (#N, <date>) — saved as
  new entry #M too." No de-dup in v1.

## 4. `/save` — manual save

- **Trigger:** `/save` in a private chat.
- **Behavior:** set `session.step = "awaiting_save_input"`, reply:
  "Send me the text or link to save." The next inbound text/link
  routes through §3's save pipeline (kind, tag, summarize,
  store). On success, clear `session.step`. On error (from §3.2),
  keep `session.step` so the user can retry by sending another
  message — but if the user sends a `/command` while in
  `awaiting_save_input`, the `/command` wins and the step is
  cleared.

## 5. `/list [n]`

- **Trigger:** `/list` or `/list <n>` in a private chat.
- **Behavior:** `SELECT * FROM items WHERE user_id = $1 ORDER BY
  created_at DESC LIMIT $2`. `n` defaults to 10, capped at 50.
  Reply with the paginated card (§5.1). On empty: "No items
  saved yet — forward something to start."

### 5.1 List card

```
🗂 Your last <N> items
1. #<id>  <Mon DD>  <truncated title>
2. #<id>  <Mon DD>  <truncated title>
…
[« Prev]  [Next »]
```

- Title truncation: first 40 chars of `summary` (one line).
- If more than `n` items exist, the page is `pg:next:0` and
  `pg:prev:0` callbacks trigger a re-query with `OFFSET`.
  Pagination uses the toolkit's `paginate()` helper against the
  full count, not a fetched-everything list.

## 6. `/search <query>`

- **Trigger:** `/search <query>` or `/search` (no query).
- **Behavior:** if no query, reply "Usage: `/search <query>`. Try
  `/search go architecture march`." with no results.
  Otherwise:
  1. Tokenize the query: lowercase, split on whitespace, drop
     tokens of length < 2.
  2. SQL: `SELECT items.* FROM items LEFT JOIN item_tags ON ...
     LEFT JOIN tags ON ... WHERE items.user_id = $1 AND
     (items.raw_text_tsv @@ websearch_to_tsquery('simple', $2)
     OR items.raw_text ILIKE '%' || $2 || '%' OR tags.name ILIKE
     '%' || $2 || '%') ORDER BY items.created_at DESC LIMIT 25`.
  3. Reply with a results card (§6.1). If 0 rows: "No matches for
     '<query>'." and offer a `[Try /tags]` button.
- **Edge:** query shorter than 2 tokens (e.g. `/search a`) returns
  0 results with the same empty-state card.

### 6.1 Results card

```
🔎 "<query>" — <N> results
1. #<id>  <Mon DD>  <truncated title>  <tag1>, <tag2>
2. #<id>  <Mon DD>  <truncated title>  <tag1>
…
[Show more]
```

`[Show more]` is hidden when `N <= 5`. Tap → same handler with
`LIMIT 50`.

## 7. `/tag <name>`

- **Trigger:** `/tag <name>` in a private chat.
- **Behavior:** if no name, reply "Usage: `/tag <name>`. Try
  `/tags` to see what's in your memory." Otherwise query
  `item_tags` joined with `items`, filter `tags.name = $name`,
  order by `items.created_at DESC`, paginate to 10 per page.
  Reply with the tag-results card (§7.1).

### 7.1 Tag-results card

```
#tag <name> — <N> items
1. #<id>  <Mon DD>  <truncated title>
…
[« Prev]  [Next »]
```

If `N = 0`: "No items tagged `<name>`." with a `[Show all tags]`
button (callback `tags:list`).

## 8. `/tags`

- **Trigger:** `/tags` in a private chat.
- **Behavior:** `SELECT name, COUNT(*) FROM tags JOIN item_tags ...
  WHERE user_id = $1 GROUP BY name ORDER BY count DESC, name ASC
  LIMIT 100`. Reply with a list card (§8.1). Empty: "No tags yet
  — forward a few things and I'll start tagging."

### 8.1 Tag-list card

```
🏷 Your tags (<N>)
1. <name>  (<count>)
2. <name>  (<count>)
…
[« Prev]  [Next »]
```

Each row is a `callback_data = "tag:<name>"` button that
re-runs `/tag <name>`.

## 9. `/collections` and `/collection <name|id>`

### 9.1 `/collections`

- **Trigger:** `/collections`.
- **Behavior:** query `collections WHERE user_id = $1 ORDER BY
  kind, name`. Reply with the collections card (§9.1.1).

#### 9.1.1 Collections card

```
📁 Your collections (<N>)

Auto:
  • <name> (<count> items)
  • …

Manual:
  • <name> (<count> items)
  • …
```

Each name is a `callback_data = "coll:<id>"` button.

### 9.1.1 Auto-collection creation

Auto-collections are created as a side effect of the save flow
(§3). After the `items` / `tags` / `item_tags` rows are inserted
for a newly-saved item, run:

1. For each tag on the new item, count items with that tag for
   the same user:
   `SELECT COUNT(*) FROM item_tags WHERE tag_id = $tagId`.
2. If count `>= 3` AND no `collections` row exists with
   `name = $tagName AND kind = 'auto'` for the user, insert one:
   `INSERT INTO collections (user_id, name, kind) VALUES ($1,
   $tagName, 'auto') RETURNING id`. Then `INSERT INTO
   collection_items (collection_id, item_id) VALUES
   ($newCollId, $newItemId)`.
3. If the auto-collection already exists, still add the new
   item to it: `INSERT INTO collection_items ... ON CONFLICT
   DO NOTHING`.

**Lifecycle:**

- An auto-collection persists as long as its source tag has
  ≥ 3 items.
- It ungroups itself automatically when the source tag drops
  below 3 items: e.g. when an item is deleted (and was the
  last item carrying that tag), or when a `/rename` of the
  source tag moves the items out (and the count falls below 3
  for the new tag name). The ungroup step is a single
  `DELETE FROM collections WHERE id = $id AND kind = 'auto'
  AND (SELECT COUNT(*) FROM item_tags WHERE tag_id = ...) < 3`.
  This runs in the same transaction as the delete / rename
  that triggered it.
- Auto-collections are never user-deletable (see §9.3).

**Tag → collection name:** the auto-collection's `name` is
identical to the tag's `name` (lowercase, as produced by the
Tagger). The `collections.name` column is unique per user only
for `kind = 'manual'`; multiple `kind = 'auto'` rows could in
principle share a name, but since names are tag-derived and
tags are deduped per user, this is a non-issue in practice.

### 9.2 `/collection <name|id>`

- **Trigger:** `/collection <name|id>`.
- **Behavior:** resolve to a `collections.id` (try `id` first as
  integer, then `name` lookup). Reply with the collection-items
  card (§9.2.1).
- **Edge:** unknown name/id → "No collection `<arg>`." and a
  `[Show collections]` button.

#### 9.2.1 Collection-items card

```
📁 <name> — <N> items  [<kind>]
1. #<id>  <Mon DD>  <truncated title>
…
[« Prev]  [Next »]  [Delete collection]
```

`[Delete collection]` only shows for `kind = 'manual'`.

### 9.2.1 Auto-collection note

Auto-collections are **not created by `/collection`** — they are
created by the save flow (see §3 step 6 and §9.1.1). `/collection
<name>` only displays an existing collection's items; it never
materializes a new one. Users who want a brand-new empty
collection must save 3+ items with the same tag first, or use a
`/collection <new-name>` to create a **manual** collection
(implicit create-on-first-lookup, also documented in
`design.md` §4.7).

### 9.3 `/deletecollection <name|id>`

- **Trigger:** `/deletecollection <name|id>`.
- **Behavior:** resolve to a `collections.id`. If `kind = 'auto'`,
  reply: "Auto-collections can't be deleted — they ungroup
  themselves when their source tag drops below 3 items." with a
  `[Show collection]` button. If `kind = 'manual'`, reply with
  the delete-confirm card (§9.3.1).

#### 9.3.1 Delete-confirm card

```
Delete collection "<name>" (<N> items)?
Items are kept — they just leave this collection.
[✅ Yes]  [❌ No]
```

Tapping **Yes** (`coll:del:<id>:yes`):
- `DELETE FROM collection_items WHERE collection_id = $id`.
- `DELETE FROM collections WHERE id = $id`.
- Edit the message: "Deleted collection \"<name>\". <N> items
  preserved. ✅"
- Items and tags remain in the database.

Tapping **No** (`coll:del:<id>:no`): edit message: "Cancelled."

## 10. `/rename <old> <new>`

- **Trigger:** `/rename <old> <new>` (exactly two args).
- **Behavior:** apply rename to whichever of these is unique per
  user: a `tags.name` matching `<old>`, **or** a manual
  `collections.name` matching `<old>`. If both exist, the bot
  asks the user to disambiguate (reply with two buttons: one
  per target, each with its own `rename:<kind>:<old>:<new>`
  callback). If neither exists, reply: "Nothing called `<old>`
  to rename."
- On success, reply: "Renamed `<old>` → `<new>` across <N>
  items. ✅"
- **Edge:** `<new>` is already taken by another tag/collection
  (per user, per kind). Reply: "`<new>` is already in use. Try
  a different name." and do nothing.

## 11. `/delete <id>`

- **Trigger:** `/delete <id>`.
- **Behavior:** if the item doesn't exist for the user, reply
  "No item #<id>." If it exists, reply with the delete-confirm
  card (§11.1).

### 11.1 Delete-confirm card

```
Delete #<id> ("<truncated title>")? This can't be undone.
[✅ Yes]  [❌ No]
```

- **Yes** (`del:<id>:yes`): delete the item and its `item_tags`
  rows. Edit the message: "Deleted #<id>. ✅"
- **No** (`del:<id>:no`): edit: "Cancelled."

### 11.4 `more:<item_id>` callback

- **Trigger:** `[More like this]` on a confirmation card.
- **Behavior:** find up to 5 other items by the same user that
  share at least one tag with this one, ordered by overlap count
  desc then recency desc. Edit the message to a "more like this"
  card with the same shape as the list card (§5.1). If 0 results,
  edit: "No similar items yet — keep saving!"

### 11.5 `del:<item_id>` callback

This is the **shortcut** delete from a confirmation card; same
handler as `del:<id>:yes` (§11.1) but skips the confirm step
because the user just clicked the save flow's own delete button.
Tapping it deletes the item immediately and edits the message to
"Deleted #<id>. ✅"

## 12. `/digest`

- **Trigger:** `/digest`.
- **Behavior:** run the same query the Sunday cron runs (§13),
  scoped to the calling user. Reply with the digest card (§12.1).

### 12.1 Digest card

```
📚 This week's resurfacing (<N> items)
1. #<id>  <Mon DD>  <truncated title>  <tag1>, <tag2>
2. …
…
[Snooze all]
```

If `N < 5` (the lower bound), reply instead with: "Not enough
items due yet — your next digest is when 5+ items are ready.
You have <N> due so far. Use /list to see everything."
`[Snooze all]` is hidden in that case.

Tapping **Snooze all** (`digest:snooze`): set `srs.next_show_at =
now() + 7 days` for every item currently in the digest reply.
Edit message: "Snoozed for 7 days. ✅"

## 13. Weekly digest — scheduler-driven

- **Trigger:** `node-cron` at Sunday 18:00 UTC, in the bot
  process, started inside `makeBot()`.
- **Behavior:** for each user in `users`, run:
  ```sql
  SELECT items.* FROM items
  JOIN srs_state ON srs_state.item_id = items.id
  WHERE items.user_id = $1
    AND srs_state.times_shown < 5
    AND srs_state.next_show_at <= now()
  ORDER BY srs_state.next_show_at ASC
  LIMIT 10
  ```
  If `0 ≤ rowCount < 5`: skip. Else if `rowCount ≤ 10`: send
  digest (§12.1) and bump each item's `times_shown` and set
  `next_show_at = now() + 7 days`. Else: send the oldest 10
  (`LIMIT 10` covers it), bump those 10, leave the rest for
  next week.
- **Idempotency:** the bump is done in a single `UPDATE ... WHERE
  id = ANY($ids)` after the message is sent, so a bot crash
  between SELECT and UPDATE re-sends the same items the next
  week (acceptable per the non-goals; manual snooze is the
  workaround).

## 14. `/stats`

- **Trigger:** `/stats`.
- **Behavior:** query totals, top tags, next-digest status.
  Reply with the stats card (§14.1).

### 14.1 Stats card

```
📊 Your memory
Items: <N>  ·  Tags: <N>  ·  Collections: <N>
Top tags: <name> (<count>), <name> (<count>), <name> (<count>)
Next digest: <Sun 18:00 UTC | "when 5+ items are due">
[Run digest now]
```

`[Run digest now]` is `callback_data = "digest:run"` and runs
the same code path as `/digest`.

## 15. `/cancel`

- **Trigger:** `/cancel` in any state.
- **Behavior:** clear `session.step` and `session.<flow-specific
  fields>`. Reply: "Cancelled."

## 16. `session` shape

```ts
interface Session {
  step: "idle" | "awaiting_save_input" | "awaiting_delete_confirm"
      | "awaiting_rename_target";
  // Flow data:
  renameOld?: string;
  renameNew?: string;
  renameTargets?: Array<"tag" | "collection">;
}
```

`SessionFlavor<Session>` typed via `BotContext<Session>` from
`@agntdev/bot-toolkit`.

## 17. Error / edge summary

| Case | Reply |
|---|---|
| Command in a group chat | "I work in private chats only — message me directly." |
| Unknown command | "Unknown command. Try /help for the list." |
| `/search` with no query | "Usage: `/search <query>`." |
| `/tag` with no name | "Usage: `/tag <name>`. Try /tags." |
| `/rename` with wrong arg count | "Usage: `/rename <old> <new>`." |
| `/deletecollection` on an auto collection | See §9.3. |
| Callback for a deleted item | "That item is gone." + `answerCallbackQuery`. |
| Postgres unreachable on any operation | "⚠️ Database is busy, try again in a moment." |
| `Summarizer` throws `SummaryLengthError` | See §3.2. |

## 18. Tests

Every command above has a matching `tests/specs/<name>.json` with
at least one `send` step exercising the command and a non-empty
`expect[]`. The harness gate (`GATE:<nonce>:{"ok":true,...}`) is
the binding review gate for the Tests phase.

| Spec | Covers |
|---|---|
| `start.json` | `/start` |
| `help.json` | `/help` |
| `save.json` | `/save` two-step + confirm card |
| `list.json` | `/list` + pagination |
| `search.json` | `/search` happy + empty + no-query |
| `tag.json` | `/tag` + `[Show all tags]` |
| `tags.json` | `/tags` list + tag-row button |
| `collections.json` | `/collections` + `/collection` + `/deletecollection` |
| `rename.json` | `/rename` + disambiguation |
| `delete.json` | `/delete` + confirm callbacks |
| `digest.json` | `/digest` + snooze callback + 5-item floor |
| `stats.json` | `/stats` + run-digest callback |
| `cancel.json` | `/cancel` clears step |
| `forward.json` | forwarded-message save (text, link, image) |
| `edge_already_saved.json` | duplicate URL handling |
| `edge_no_text.json` | media-only forward |

Total: 16 specs, covering all 15 commands and the slash-free
forwarded-message path.
