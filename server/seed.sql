-- Seed data for the Votebook Management System (idempotent)
-- (users are seeded by seed.js so passwords can be bcrypt-hashed)

INSERT INTO stations (name, sub_vote) VALUES
  ('Mkoani', '2039'),
  ('Chakechake', '2039'),
  ('Makao Kusini Pemba', '2039'),
  ('Wete', '2040'),
  ('Micheweni', '2040'),
  ('Makao Kaskazini Pemba', '2040')
ON CONFLICT (name) DO UPDATE SET sub_vote = EXCLUDED.sub_vote;

INSERT INTO vote_items (vote, item, sub_item, code, description) VALUES
  ('28', 'C01C01', 'PK001', '22002101', 'Electricity'),
  ('28', 'E02C01', 'PK002', '22002102', 'Water Charges'),
  ('28', 'C01C01', 'PK001', '22003102', 'Diesel'),
  ('28', 'C01C01', 'PK001', '22003101', 'Petrol'),
  ('28', 'C01C01', 'PK001', '22003101B', 'Petrol - For Boats'),
  ('28', 'C04C01', 'PK002', '22003105', 'Lubricants'),
  ('28', 'C01C01', 'PK001', '22021108', 'Spare Parts'),
  ('28', 'E03C01', 'PK003', '21113101', 'Leave Travel'),
  ('28', 'C03C02', 'PK001', '22010105', 'Per Diem - Domestic'),
  ('28', 'E01C12', '—', '21113129', 'Moving Expenses'),
  ('28', 'C03C02', 'PK001', '22031107', 'Investigation Expenses'),
  ('28', 'C03C02', 'PK001', '22031107A', 'Investigation Exp - Intel'),
  ('28', 'C03C02', 'PK001', '22031107B', 'Investigation Exp - FB'),
  ('28', 'C02C02', 'RK001', '22010103', 'Water Transport'),
  ('28', 'E01C02', 'PK001', '22015107', 'Animal Feeds'),
  ('28', 'E01C01', 'PK001', '22001102', 'Computer Supplies & Accessories'),
  ('28', 'E02C01', 'PK002', '22001101', 'Office Consumables'),
  ('28', 'E01C01', 'PK001', '2201001', 'Ration food purchase'),
  ('28', 'E01C01', 'PK001', '22010102', 'Ground'),
  ('28', 'E01C01', 'PK001', '33181109', 'Deposit general')
ON CONFLICT (code) DO NOTHING;

-- Deposit general is restricted to the two Makao Kusini/Kaskazini stations.
INSERT INTO vote_item_stations (vote_code, station) VALUES
  ('33181109', 'Makao Kusini Pemba'),
  ('33181109', 'Makao Kaskazini Pemba')
ON CONFLICT DO NOTHING;