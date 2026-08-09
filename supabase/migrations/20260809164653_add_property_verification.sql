ALTER TABLE properties ADD COLUMN verification_status text NOT NULL DEFAULT 'unverified';
ALTER TABLE properties ADD COLUMN owner_type text;
ALTER TABLE properties ADD COLUMN entity_relationship text;
ALTER TABLE properties ADD COLUMN verification_document_url text;
ALTER TABLE properties ADD COLUMN verification_reviewed_by uuid REFERENCES auth.users(id);
ALTER TABLE properties ADD COLUMN verification_reviewed_at timestamptz;

CREATE OR REPLACE FUNCTION reset_verification_on_owner_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    NEW.verification_status := 'unverified';
    NEW.verification_document_url := NULL;
    NEW.verification_reviewed_by := NULL;
    NEW.verification_reviewed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reset_verification_on_owner_change
BEFORE UPDATE ON properties
FOR EACH ROW EXECUTE FUNCTION reset_verification_on_owner_change();

-- Prompt referenced reviews.property_id, which does not exist on public.reviews.
-- Reviews link to a property via owner_pm_relationships.property_id.
-- AS RESTRICTIVE is required so this gate ANDs with existing permissive INSERT policies
-- (otherwise OR semantics would still allow unverified inserts).
CREATE POLICY reviews_insert_requires_verified_property
ON reviews
AS RESTRICTIVE
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM owner_pm_relationships opr
    JOIN properties ON properties.id = opr.property_id
    WHERE opr.id = reviews.owner_pm_relationship_id
      AND properties.verification_status = 'verified'
  )
);
