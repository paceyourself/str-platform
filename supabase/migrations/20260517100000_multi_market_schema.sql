-- Sprint 11: Multi-market schema foundation + AirDNA columns
-- Rows 139, 140, 116, 117
-- Correct order: drop constraint first, migrate data, add new constraint

-- ── Row 139 — Broaden str_leads.lead_source CHECK constraint ─────────────
-- Step 1: Drop old constraint first
ALTER TABLE str_leads 
DROP CONSTRAINT str_leads_lead_source_check;

-- Step 2: Migrate existing data
UPDATE str_leads 
SET lead_source = 'foia_county_registry' 
WHERE lead_source = 'walton_county_foia';

-- Step 3: Add new constraint with broadened vocabulary
ALTER TABLE str_leads 
ADD CONSTRAINT str_leads_lead_source_check
  CHECK (lead_source IN ('foia_county_registry','manual','referral','state_registry'));

-- ── Row 140 — Add str_lead_data_status to markets ────────────────────────
ALTER TABLE markets 
ADD COLUMN IF NOT EXISTS str_lead_data_status text
  NOT NULL DEFAULT 'not_started'
  CHECK (str_lead_data_status IN ('not_started','foia_filed','foia_received','enrichment_in_progress','seeded'));

-- Set Walton County / 30A to seeded immediately
UPDATE markets 
SET str_lead_data_status = 'seeded' 
WHERE id = '30a';

-- ── Rows 116 + 117 — AirDNA columns ──────────────────────────────────────
-- airdna_market_id stores AirDNA submarket ID — NOT the platform market ID
ALTER TABLE markets 
ADD COLUMN IF NOT EXISTS airdna_market_id text;

ALTER TABLE market_benchmarks 
ADD COLUMN IF NOT EXISTS granularity text
  NOT NULL DEFAULT 'monthly_prorated'
  CHECK (granularity IN ('weekly','monthly','monthly_prorated'));
