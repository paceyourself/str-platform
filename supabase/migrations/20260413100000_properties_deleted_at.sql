-- Soft delete for owner-managed properties (dashboard list filters on deleted_at).

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS properties_owner_active_idx
  ON public.properties (owner_id)
  WHERE deleted_at IS NULL;
