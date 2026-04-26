-- Sprint 8 RLS duplicate policy cleanup
-- Removes redundant {public} policies where {authenticated} equivalents exist

-- Notifications
DROP POLICY IF EXISTS "Owners can insert notifications" ON notifications;
DROP POLICY IF EXISTS "Owners can view their own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can view their own notifications" ON notifications;

-- pm_statements
DROP POLICY IF EXISTS "Owners can insert pm statements" ON pm_statements;
DROP POLICY IF EXISTS "Owners can manage their own statements" ON pm_statements;
DROP POLICY IF EXISTS "Owners can view their own pm statements" ON pm_statements;

-- review_ticket_tags
DROP POLICY IF EXISTS "Owners can insert review ticket tags" ON review_ticket_tags;
DROP POLICY IF EXISTS "Owners can manage their own review ticket tags" ON review_ticket_tags;
DROP POLICY IF EXISTS "Owners can view their own review ticket tags" ON review_ticket_tags;

-- upload_batches
DROP POLICY IF EXISTS "Owners can insert their own upload batches" ON upload_batches;
DROP POLICY IF EXISTS "Owners can view their own upload batches" ON upload_batches;

-- tickets: duplicate PM policies
DROP POLICY IF EXISTS "PMs can view and update tickets filed against them" ON tickets;
DROP POLICY IF EXISTS "PMs can update ticket status" ON tickets;

-- NOTE: reviews table intentionally excluded
-- anon read on status='visible' reviews must be preserved for Phase 2 PM directory
-- NOTE: tickets owner policies remain on {public} role — migrate to {authenticated} in cleanup sprint
-- NOTE: Find a PM page currently broken (redirects to dashboard) — fix required before Phase 2