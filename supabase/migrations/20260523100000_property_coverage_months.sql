-- Domain 8: Analytics Coverage
-- property_coverage_months tracks data completeness per property per month per PM
-- data_complete = true is the gate for all analytics queries
-- Set automatically on upload batch completion for closed months only

CREATE TABLE property_coverage_months (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       uuid        NOT NULL REFERENCES properties(id),
  pm_id             uuid        NOT NULL REFERENCES pm_profiles(id),
  coverage_year     smallint    NOT NULL,
  coverage_month    smallint    NOT NULL CHECK (coverage_month BETWEEN 1 AND 12),
  data_complete     boolean     NOT NULL DEFAULT false,
  upload_batch_id   uuid        REFERENCES upload_batches(id),
  admin_override    boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, pm_id, coverage_year, coverage_month)
);

-- Partial / reporting index (unique constraint above already indexes the 4-column key)
CREATE INDEX ON property_coverage_months (property_id, data_complete);

ALTER TABLE property_coverage_months ENABLE ROW LEVEL SECURITY;

-- Owners can read their own coverage months
CREATE POLICY "Owners can read own coverage months"
  ON property_coverage_months FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM properties pr
    WHERE pr.id = property_coverage_months.property_id
      AND pr.owner_id = auth.uid()
  ));

-- Owners can upsert their own rows (dashboard upload completes as the owner JWT)
CREATE POLICY "Owners can insert coverage for owned properties"
  ON property_coverage_months FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM properties pr
    WHERE pr.id = property_coverage_months.property_id
      AND pr.owner_id = auth.uid()
  ));

CREATE POLICY "Owners can update coverage for owned properties"
  ON property_coverage_months FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM properties pr
    WHERE pr.id = property_coverage_months.property_id
      AND pr.owner_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM properties pr
    WHERE pr.id = property_coverage_months.property_id
      AND pr.owner_id = auth.uid()
  ));

-- Admins full access
CREATE POLICY "Admins can read all coverage months"
  ON property_coverage_months FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));

CREATE POLICY "Admins can insert coverage months"
  ON property_coverage_months FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));

CREATE POLICY "Admins can update coverage months"
  ON property_coverage_months FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));
