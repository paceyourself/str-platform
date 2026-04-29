-- Sprint 9 Row 113: Migrate tickets RLS policies from {public} to {authenticated}
-- No functional change for logged-in users — security hardening only

DROP POLICY "Owners can insert tickets" ON tickets;
DROP POLICY "Owners can manage their own tickets" ON tickets;
DROP POLICY "Owners can view their own tickets" ON tickets;
DROP POLICY "PMs can insert pm_to_owner tickets" ON tickets;
DROP POLICY "PMs can update tickets" ON tickets;
DROP POLICY "PMs can view tickets against them" ON tickets;

CREATE POLICY "Owners can insert tickets"
ON tickets FOR INSERT TO authenticated
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owners can manage their own tickets"
ON tickets FOR ALL TO authenticated
USING (auth.uid() = owner_id);

CREATE POLICY "Owners can view their own tickets"
ON tickets FOR SELECT TO authenticated
USING (auth.uid() = owner_id);

CREATE POLICY "PMs can insert pm_to_owner tickets"
ON tickets FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM pm_profiles p
    WHERE p.id = pm_id
    AND p.claimed_by_user_id = auth.uid()
  )
);

CREATE POLICY "PMs can update tickets"
ON tickets FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM pm_profiles p
    WHERE p.id = pm_id
    AND p.claimed_by_user_id = auth.uid()
  )
);

CREATE POLICY "PMs can view tickets against them"
ON tickets FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM pm_profiles p
    WHERE p.id = pm_id
    AND p.claimed_by_user_id = auth.uid()
  )
);