-- Votebook Management System — schema (idempotent)

CREATE TABLE IF NOT EXISTS stations (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  sub_vote TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'officer')),
  station TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vote_items (
  id SERIAL PRIMARY KEY,
  vote TEXT NOT NULL,
  item TEXT NOT NULL,
  sub_item TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cashbook_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cashbook_entries (
  id SERIAL PRIMARY KEY,
  entry_ref TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  type TEXT NOT NULL CHECK (type IN ('payment', 'receipt')),
  description TEXT NOT NULL,
  station TEXT NOT NULL,
  officer TEXT NOT NULL,
  officer_name TEXT NOT NULL,
  vote_code TEXT NOT NULL DEFAULT '',
  vote_description TEXT NOT NULL DEFAULT '',
  vote_sub_vote TEXT NOT NULL DEFAULT '',
  vote_item TEXT NOT NULL DEFAULT '',
  vote_sub_item TEXT NOT NULL DEFAULT '',
  payee TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  receipt_no TEXT NOT NULL DEFAULT '',
  cashbook_ref TEXT NOT NULL DEFAULT '',
  debit NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cashbook_entries_id ON cashbook_entries (id);

-- Migration for databases created before users carried a station column.
-- Postgres supports IF NOT EXISTS for ADD COLUMN, so this is safe on both.
ALTER TABLE users ADD COLUMN IF NOT EXISTS station TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Migration for databases created before the vote item column names matched the
-- source document headers (Vote | Sub-Vote | Item | Sub-Item | Description).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vote_items' AND column_name = 'year') THEN
    ALTER TABLE vote_items RENAME COLUMN year TO sub_vote;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vote_items' AND column_name = 'subvote') THEN
    ALTER TABLE vote_items RENAME COLUMN subvote TO item;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vote_items' AND column_name = 'pk') THEN
    ALTER TABLE vote_items RENAME COLUMN pk TO sub_item;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cashbook_entries' AND column_name = 'vote_year') THEN
    ALTER TABLE cashbook_entries RENAME COLUMN vote_year TO vote_sub_vote;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cashbook_entries' AND column_name = 'vote_subvote') THEN
    ALTER TABLE cashbook_entries RENAME COLUMN vote_subvote TO vote_item;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cashbook_entries' AND column_name = 'vote_pk') THEN
    ALTER TABLE cashbook_entries RENAME COLUMN vote_pk TO vote_sub_item;
  END IF;
END $$;

INSERT INTO cashbook_settings (id, opening_balance) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

-- Migration: each station carries its fiscal sub-vote (2039 for Mkoani /
-- Chakechake / Makao Kusini Pemba, 2040 for Wete / Micheweni / Makao Kaskazini
-- Pemba). The shared vote-item master list is sub-vote agnostic — the station
-- determines which sub-vote an entry is booked under.
ALTER TABLE stations ADD COLUMN IF NOT EXISTS sub_vote TEXT NOT NULL DEFAULT '';
UPDATE stations SET sub_vote = CASE name
  WHEN 'Mkoani' THEN '2039'
  WHEN 'Chakechake' THEN '2039'
  WHEN 'Makao Kusini Pemba' THEN '2039'
  WHEN 'Wete' THEN '2040'
  WHEN 'Micheweni' THEN '2040'
  WHEN 'Makao Kaskazini Pemba' THEN '2040'
  ELSE sub_vote
END;
ALTER TABLE vote_items DROP COLUMN IF EXISTS sub_vote;