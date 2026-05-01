CREATE POLICY "Admins can read all tickets"
  ON tickets FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));
