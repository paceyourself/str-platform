-- Allow admin users to read all owner profiles
-- Required for admin user management page
CREATE POLICY "Admins can read all owner profiles"
ON owner_profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM admin_users
    WHERE admin_users.user_id = auth.uid()
  )
);