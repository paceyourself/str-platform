-- County folio/parcel number as a stable government-issued property identifier.
-- Enables the property to persist as a permanent entity across ownership changes.
-- Tier 2: OCR from Florida county tax bills (Phase 2).
ALTER TABLE properties ADD COLUMN IF NOT EXISTS parcel_id text;
