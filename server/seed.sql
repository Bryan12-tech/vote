-- Seed data for the Votebook Management System (idempotent)
-- (users are seeded by seed.js so passwords can be bcrypt-hashed)

INSERT INTO stations (name) VALUES
  ('Mkoani'),
  ('Chakechake'),
  ('Makao Kusini Pemba'),
  ('Wete'),
  ('Micheweni'),
  ('Makao Kaskazini Pemba')
ON CONFLICT (name) DO NOTHING;

INSERT INTO vote_items (vote, year, subvote, pk, code, description) VALUES
  ('28', '2039', 'C01C01', 'PK001', '22002101', 'Electricity'),
  ('28', '2039', 'E02C01', 'PK002', '22002102', 'Water Charges'),
  ('28', '2039', 'C01C01', 'PK001', '22003102', 'Diesel'),
  ('28', '2039', 'C01C01', 'PK001', '22003101', 'Petrol'),
  ('28', '2039', 'C01C01', 'PK001', '22003101B', 'Petrol - For Boats'),
  ('28', '2039', 'C04C01', 'PK002', '22003105', 'Lubricants'),
  ('28', '2039', 'C01C01', 'PK001', '22021108', 'Spare Parts'),
  ('28', '2039', 'E03C01', 'PK003', '21113101', 'Leave Travel'),
  ('28', '2039', 'C03C02', 'PK001', '22010105', 'Per Diem - Domestic'),
  ('28', '1001', 'E01C12', '—', '21113129', 'Moving Expenses'),
  ('28', '2039', 'C03C02', 'PK001', '22031107', 'Investigation Expenses'),
  ('28', '2039', 'C03C02', 'PK001', '22031107A', 'Investigation Exp - Intel'),
  ('28', '2039', 'C03C02', 'PK001', '22031107B', 'Investigation Exp - FB'),
  ('28', '2039', 'C02C02', 'RK001', '22010103', 'Water Transport'),
  ('28', '2039', 'E01C02', 'PK001', '22015107', 'Animal Feeds'),
  ('28', '2039', 'E01C01', 'PK001', '22001102', 'Computer Supplies & Accessories'),
  ('28', '2039', 'E02C01', 'PK002', '22001101', 'Office Consumables')
ON CONFLICT (code) DO NOTHING;