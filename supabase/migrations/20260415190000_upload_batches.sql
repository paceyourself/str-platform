-- One row per completed booking CSV import per property (for first-upload / survey gating).
CREATE TABLE IF NOT EXISTS public.upload_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties (id) ON DELETE CASCADE,
  pm_id uuid NOT NULL REFERENCES public.pm_profiles (id) ON DELETE CASCADE,
  source_file_id uuid REFERENCES public.upload_files (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS upload_batches_owner_property_idx
  ON public.upload_batches (owner_id, property_id);

CREATE INDEX IF NOT EXISTS upload_batches_owner_pm_idx
  ON public.upload_batches (owner_id, pm_id);

ALTER TABLE public.upload_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "upload_batches_select_own" ON public.upload_batches;
CREATE POLICY "upload_batches_select_own"
ON public.upload_batches FOR SELECT TO authenticated
USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "upload_batches_insert_own" ON public.upload_batches;
CREATE POLICY "upload_batches_insert_own"
ON public.upload_batches FOR INSERT TO authenticated
WITH CHECK (owner_id = auth.uid());
