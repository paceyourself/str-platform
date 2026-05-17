-- Sprint 11: Fix pm_field_mappings RLS policies
-- Drop incorrect existing policy and replace with clean set

-- Drop the existing malformed SELECT policy
DROP POLICY IF EXISTS "Owners can view field mappings" ON pm_field_mappings;

-- Authenticated users can read all field mappings
-- Required for upload pipeline to fetch mapping by pm_id
CREATE POLICY "Authenticated users can read pm_field_mappings"
  ON pm_field_mappings FOR SELECT
  TO authenticated
  USING (true);

-- Admins can insert pm_field_mappings
CREATE POLICY "Admins can insert pm_field_mappings"
  ON pm_field_mappings FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));

-- Admins can update pm_field_mappings
CREATE POLICY "Admins can update pm_field_mappings"
  ON pm_field_mappings FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));
