-- Sprint 9: User deactivation schema
-- Adds deactivated_at to owner_profiles and pm_profiles
-- NULL = active, non-null = deactivated
-- Follows same nullable timestamp pattern as deleted_at on properties
-- NOTE: deactivation does NOT ban Supabase Auth JWT
-- Application must check deactivated_at IS NULL before serving sensitive data

ALTER TABLE owner_profiles 
ADD COLUMN IF NOT EXISTS deactivated_at timestamptz NULL;

ALTER TABLE pm_profiles 
ADD COLUMN IF NOT EXISTS deactivated_at timestamptz NULL;