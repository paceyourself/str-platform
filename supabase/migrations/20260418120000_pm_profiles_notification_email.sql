-- Admin-populated contact email for unclaimed PMs (public company email).
-- Separate from email_domain (claim verification). Overridden by claimed user's auth email post-claim.
ALTER TABLE pm_profiles ADD COLUMN IF NOT EXISTS notification_email text;
