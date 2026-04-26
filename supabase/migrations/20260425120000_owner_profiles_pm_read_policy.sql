CREATE POLICY "PMs can view owner profiles for their relationships"
ON owner_profiles
FOR SELECT
TO authenticated
USING (
  id IN (
    SELECT owner_id
    FROM owner_pm_relationships
    WHERE pm_id IN (
      SELECT id FROM pm_profiles WHERE claimed_by_user_id = auth.uid()
    )
    AND active = true
  )
);