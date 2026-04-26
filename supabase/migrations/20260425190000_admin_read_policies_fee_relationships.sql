-- Allow admin users to read all owner_pm_relationships
-- Required for admin fee setup view (row 53)
CREATE POLICY "Admins can read all owner_pm_relationships"
ON owner_pm_relationships
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM admin_users
    WHERE admin_users.user_id = auth.uid()
  )
);

-- Allow admin users to read all owner_pm_fee_history
-- Required for admin fee setup view (row 53)
CREATE POLICY "Admins can read all owner_pm_fee_history"
ON owner_pm_fee_history
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM admin_users
    WHERE admin_users.user_id = auth.uid()
  )
);

-- Allow admin users to update owner_pm_relationships (for fee override)
CREATE POLICY "Admins can update owner_pm_relationships"
ON owner_pm_relationships
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM admin_users
    WHERE admin_users.user_id = auth.uid()
  )
);

-- Allow admin users to insert owner_pm_fee_history (for fee override audit trail)
CREATE POLICY "Admins can insert owner_pm_fee_history"
ON owner_pm_fee_history
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM admin_users
    WHERE admin_users.user_id = auth.uid()
  )
);