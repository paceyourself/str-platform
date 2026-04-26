-- Allow admin users to read all properties
-- Required for admin booking purge tool and future admin pages
CREATE POLICY "Admins can read all properties"
ON properties
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM admin_users
    WHERE admin_users.user_id = auth.uid()
  )
);