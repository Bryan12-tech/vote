-- Votebook Management System — schema (idempotent)

CREATE TABLE IF NOT EXISTS stations (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'officer'))
);

CREATE TABLE IF NOT EXISTS vote_items (
  id SERIAL PRIMARY KEY,
  vote TEXT NOT NULL,
  year TEXT NOT NULL,
  subvote TEXT NOT NULL,
  pk TEXT NOT NULL,
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
  vote_subvote TEXT NOT NULL DEFAULT '',
  vote_pk TEXT NOT NULL DEFAULT '',
  vote_year TEXT NOT NULL DEFAULT '',
  payee TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  receipt_no TEXT NOT NULL DEFAULT '',
  cashbook_ref TEXT NOT NULL DEFAULT '',
  debit NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cashbook_entries_id ON cashbook_entries (id);

INSERT INTO cashbook_settings (id, opening_balance) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;