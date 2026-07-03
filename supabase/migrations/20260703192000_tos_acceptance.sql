ALTER TABLE subscriptions
  ADD COLUMN tos_version_accepted text,
  ADD COLUMN tos_accepted_at timestamptz;
