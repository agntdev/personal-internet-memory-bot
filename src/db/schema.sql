-- Personal Internet Memory Bot — schema (F01)
-- See docs/design.md §2.2 and docs/details.md §16 for the
-- authoritative column / table definitions.

CREATE TABLE IF NOT EXISTS users (
  id           SERIAL PRIMARY KEY,
  telegram_id  BIGINT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id                   SERIAL PRIMARY KEY,
  user_id              INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind                 TEXT NOT NULL CHECK (kind IN (
                         'link', 'text', 'image', 'video',
                         'audio', 'voice', 'document', 'other'
                       )),
  raw_text             TEXT NOT NULL DEFAULT '',
  source_url           TEXT,
  telegram_message_id  BIGINT,
  summary              TEXT NOT NULL DEFAULT '',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS items_user_id_created_at_idx
  ON items (user_id, created_at DESC);

-- Full-text search on raw_text for /search (details.md §6).
CREATE INDEX IF NOT EXISTS items_raw_text_tsv_idx
  ON items USING GIN (to_tsvector('simple', raw_text));

CREATE TABLE IF NOT EXISTS tags (
  id       SERIAL PRIMARY KEY,
  user_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS item_tags (
  item_id  INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id   INT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);

CREATE INDEX IF NOT EXISTS item_tags_tag_id_idx ON item_tags (tag_id);

CREATE TABLE IF NOT EXISTS collections (
  id       SERIAL PRIMARY KEY,
  user_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('auto', 'manual'))
);

-- Manual collections: name must be unique per user.
-- Auto collections: name can repeat (in practice tag-derived so
-- they don't, but the spec doesn't constrain it). See details.md
-- §9.1.1.
CREATE UNIQUE INDEX IF NOT EXISTS collections_user_id_name_manual_uniq
  ON collections (user_id, name)
  WHERE kind = 'manual';

CREATE INDEX IF NOT EXISTS collections_user_id_kind_name_idx
  ON collections (user_id, kind, name);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id  INT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  item_id        INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, item_id)
);

CREATE INDEX IF NOT EXISTS collection_items_item_id_idx
  ON collection_items (item_id);

CREATE TABLE IF NOT EXISTS srs_state (
  item_id          INT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  last_shown_at    TIMESTAMPTZ,
  times_shown      INT NOT NULL DEFAULT 0 CHECK (times_shown >= 0),
  next_show_at     TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days'
);

CREATE INDEX IF NOT EXISTS srs_state_due_idx
  ON srs_state (next_show_at)
  WHERE times_shown < 5;
