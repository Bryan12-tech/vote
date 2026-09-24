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

CREATE TABLE IF NOT EXISTS vote_item_stations (
  vote_code TEXT NOT NULL REFERENCES vote_items(code) ON DELETE CASCADE,
  station TEXT NOT NULL REFERENCES stations(name) ON DELETE CASCADE,
  PRIMARY KEY (vote_code, station)
);

CREATE TABLE IF NOT EXISTS accounting_periods (
  id SERIAL PRIMARY KEY,
  period_key TEXT UNIQUE NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  opening_bank_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
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

-- Vote cashbook: allocations transfer general bank funds to a station. Vote items
-- are selected only when those station funds are utilized in stage 2.
CREATE TABLE IF NOT EXISTS vote_allocations (
  id SERIAL PRIMARY KEY,
  allocation_ref TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  station TEXT NOT NULL REFERENCES stations(name),
  sub_vote TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  reference TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  officer TEXT NOT NULL,
  officer_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vote_expenditures (
  id SERIAL PRIMARY KEY,
  expenditure_ref TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  allocation_id INTEGER NOT NULL REFERENCES vote_allocations(id),
  station TEXT NOT NULL REFERENCES stations(name),
  sub_vote TEXT NOT NULL,
  vote_code TEXT NOT NULL REFERENCES vote_items(code),
  vote_description TEXT NOT NULL,
  payee TEXT NOT NULL,
  purpose TEXT NOT NULL,
  voucher_no TEXT NOT NULL DEFAULT '',
  receipt_no TEXT NOT NULL DEFAULT '',
  cashbook_ref TEXT NOT NULL DEFAULT '',
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  officer TEXT NOT NULL,
  officer_name TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vote_allocations_station
  ON vote_allocations (station);
CREATE INDEX IF NOT EXISTS idx_vote_expenditures_allocation
  ON vote_expenditures (allocation_id);

ALTER TABLE cashbook_entries ADD COLUMN IF NOT EXISTS period_id INTEGER REFERENCES accounting_periods(id);
ALTER TABLE vote_allocations ADD COLUMN IF NOT EXISTS period_id INTEGER REFERENCES accounting_periods(id);
ALTER TABLE vote_expenditures ADD COLUMN IF NOT EXISTS period_id INTEGER REFERENCES accounting_periods(id);
ALTER TABLE vote_expenditures ADD COLUMN IF NOT EXISTS voucher_no TEXT NOT NULL DEFAULT '';

INSERT INTO accounting_periods (period_key, starts_on, ends_on, status, opening_bank_balance)
VALUES (to_char(current_date, 'YYYY-MM'), date_trunc('month', current_date)::date,
  (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 'open', 0)
ON CONFLICT (period_key) DO NOTHING;

UPDATE cashbook_entries SET period_id = (SELECT id FROM accounting_periods WHERE status = 'open' ORDER BY id DESC LIMIT 1)
WHERE period_id IS NULL;
UPDATE vote_allocations SET period_id = (SELECT id FROM accounting_periods WHERE status = 'open' ORDER BY id DESC LIMIT 1)
WHERE period_id IS NULL;
UPDATE vote_expenditures SET period_id = (SELECT id FROM accounting_periods WHERE status = 'open' ORDER BY id DESC LIMIT 1)
WHERE period_id IS NULL;

ALTER TABLE cashbook_entries ALTER COLUMN period_id SET NOT NULL;
ALTER TABLE vote_allocations ALTER COLUMN period_id SET NOT NULL;
ALTER TABLE vote_expenditures ALTER COLUMN period_id SET NOT NULL;

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

-- Allocations are station-level. Remove the briefly added allocation-level vote
-- fields so a vote item is introduced only by a utilization.
ALTER TABLE vote_allocations DROP COLUMN IF EXISTS vote_code;
ALTER TABLE vote_allocations DROP COLUMN IF EXISTS vote_description;

-- ── Reservation layer: utilize → release ───────────────────────────────────
--
-- A votebook entry is no longer the final spend. The votebook now works in
-- three stages, and only the last one moves money out of the bank:
--
--   1. allocate — funds a station (money the station holds, still in the bank)
--   2. utilize  — earmarks part of those station funds against a vote item
--   3. release  — the actual payment; this is what debits Cash in Bank
--
-- `vote_utilizations` is stage 2. `vote_expenditures` stays the ledger of real
-- payments (stage 3) and now points at the utilization it discharges.
CREATE TABLE IF NOT EXISTS vote_utilizations (
  id SERIAL PRIMARY KEY,
  utilization_ref TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  period_id INTEGER NOT NULL REFERENCES accounting_periods(id),
  station TEXT NOT NULL REFERENCES stations(name),
  sub_vote TEXT NOT NULL DEFAULT '',
  vote_code TEXT NOT NULL REFERENCES vote_items(code),
  vote_description TEXT NOT NULL DEFAULT '',
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL DEFAULT '',
  officer TEXT NOT NULL,
  officer_name TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vote_utilizations_station ON vote_utilizations (station);
CREATE INDEX IF NOT EXISTS idx_vote_utilizations_period ON vote_utilizations (period_id);

ALTER TABLE vote_expenditures
  ADD COLUMN IF NOT EXISTS utilization_id INTEGER REFERENCES vote_utilizations(id);
ALTER TABLE cashbook_entries
  ADD COLUMN IF NOT EXISTS utilization_ref TEXT NOT NULL DEFAULT '';

-- A release draws on the station's pooled funds (oldest allocation first), so
-- the per-allocation link is derived rather than required.
ALTER TABLE vote_expenditures ALTER COLUMN allocation_id DROP NOT NULL;

-- Backfill: entries posted before the reservation layer existed become released
-- payments against a matching utilization, so old vouchers keep their history.
INSERT INTO vote_utilizations
  (utilization_ref, period_id, station, sub_vote, vote_code, vote_description,
   amount, description, officer, officer_name, created_at)
SELECT 'VU-LEGACY-' || e.id, e.period_id, e.station, e.sub_vote, e.vote_code,
       e.vote_description, e.amount, 'Released before the utilization step existed',
       e.officer, e.officer_name, e.created_at
FROM vote_expenditures e
WHERE e.utilization_id IS NULL
ON CONFLICT (utilization_ref) DO NOTHING;

UPDATE vote_expenditures e
   SET utilization_id = u.id
  FROM vote_utilizations u
 WHERE u.utilization_ref = 'VU-LEGACY-' || e.id
   AND e.utilization_id IS NULL;