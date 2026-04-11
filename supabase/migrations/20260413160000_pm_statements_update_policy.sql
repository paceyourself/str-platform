-- Allow owners to update their own PM statements (upsert on duplicate period).

DROP POLICY IF EXISTS "pm_statements_update_own" ON public.pm_statements;
CREATE POLICY "pm_statements_update_own"
ON public.pm_statements FOR UPDATE TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());
