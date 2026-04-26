-- Sprint 8 RLS Security Audit
-- Drops anon full-read policies on sensitive tables
-- Fixes owner_pm_fee_history INSERT WITH CHECK

-- Critical fix 1: Remove anon full read on owner_pm_relationships
-- Exposed contract terms, fee data, owner_signal to unauthenticated users
DROP POLICY IF EXISTS "Public read owner_pm_relationships" ON owner_pm_relationships;

-- Critical fix 2: Remove anon full read on tickets
-- Exposed ticket content, dollar amounts, resolution notes to unauthenticated users
DROP POLICY IF EXISTS "Public read tickets" ON tickets;

-- Critical fix 3: Fix owner_pm_fee_history INSERT WITH CHECK
-- Previous policy had null qual — any authenticated user could insert for any relationship
DROP POLICY IF EXISTS "owner_pm_fee_history_insert_own" ON owner_pm_fee_history;

CREATE POLICY "owner_pm_fee_history_insert_own"
ON owner_pm_fee_history
FOR INSERT
TO authenticated
WITH CHECK (
  owner_pm_relationship_id IN (
    SELECT id FROM owner_pm_relationships
    WHERE owner_id = auth.uid()
  )
);