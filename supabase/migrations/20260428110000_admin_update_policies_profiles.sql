-- Sprint 9: Admin UPDATE policies on owner_profiles and pm_profiles
-- Required for user deactivation/reactivation from admin user management page

CREATE POLICY "Admins can update owner profiles"
ON owner_profiles
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM admin_users
    WHERE admin_users.user_id = auth.uid()
  )
);

CREATE POLICY "Admins can update pm profiles"
ON pm_profiles
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM admin_users
    WHERE admin_users.user_id = auth.uid()
  )
);