-- Allow admin users to read all bookings
-- Required for admin booking purge tool
CREATE POLICY "Admins can read all bookings"
ON bookings
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM admin_users
    WHERE admin_users.user_id = auth.uid()
  )
);