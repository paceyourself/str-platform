-- Migration: 20260605000000_submarket_zip_codes_v019.sql
-- Schema v0.18 → v0.19

-- 1. New table: submarket_zip_codes
CREATE TABLE submarket_zip_codes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id      text NOT NULL REFERENCES markets(id),
  submarket_id   text NOT NULL,   -- AirDNA submarket ID e.g. 'airdna-2116'
  submarket_name text NOT NULL,   -- e.g. 'Rosemary Beach / 30A'
  zip_code       text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submarket_id, zip_code)
);

CREATE INDEX submarket_zip_codes_market_zip_idx
  ON submarket_zip_codes (market_id, zip_code);

ALTER TABLE submarket_zip_codes ENABLE ROW LEVEL SECURITY;

-- Admin: read + write (matches admin_users pattern used elsewhere)
CREATE POLICY "Admins can read submarket_zip_codes"
  ON submarket_zip_codes FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));

CREATE POLICY "Admins can insert submarket_zip_codes"
  ON submarket_zip_codes FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));

CREATE POLICY "Admins can update submarket_zip_codes"
  ON submarket_zip_codes FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));

CREATE POLICY "Admins can delete submarket_zip_codes"
  ON submarket_zip_codes FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));

-- Authenticated: read only (property creation zip lookup)
CREATE POLICY "Authenticated read submarket_zip_codes"
  ON submarket_zip_codes FOR SELECT
  TO authenticated
  USING (true);

-- 2. New column: properties.airdna_submarket_id
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS airdna_submarket_id text NULL;
-- NULL = submarket not yet resolved.
-- Falls back to market-level benchmark. Acceptable for existing properties
-- until zip codes are seeded.

-- 3. New column: market_benchmarks.submarket_id
ALTER TABLE market_benchmarks
  ADD COLUMN IF NOT EXISTS submarket_id text NULL;
-- NULL = market-level benchmark row (all existing rows stay NULL — no data change)
-- Non-null = submarket-level benchmark row

-- 4. Seed submarket_zip_codes for 30A
-- NOTE: Only confirmed zip codes seeded. Additional zips pending
-- AirDNA API access for full submarket boundary confirmation.
INSERT INTO submarket_zip_codes (market_id, submarket_id, submarket_name, zip_code)
VALUES
  ('30a', 'airdna-2116', 'Rosemary Beach / 30A', '32461'),
  -- 32461 covers Inlet Beach and Rosemary Beach corridor
  -- INCOMPLETE: additional 30A premium corridor zips TBD when AirDNA API active
  ('30a', 'airdna-136',  'Santa Rosa Beach / 30A', '32459');
  -- 32459 covers Santa Rosa Beach
  -- INCOMPLETE: additional Santa Rosa / 30A corridor zips TBD when AirDNA API active

-- 5. Backfill properties.airdna_submarket_id for existing four properties
-- Uses zip lookup via submarket_zip_codes (properties.zip column)
UPDATE properties p
SET airdna_submarket_id = szc.submarket_id
FROM submarket_zip_codes szc
WHERE szc.market_id = p.market_id
  AND szc.zip_code  = p.zip
  AND p.airdna_submarket_id IS NULL;
-- Properties with no matching zip remain NULL — fallback to market benchmark.
