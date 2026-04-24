CREATE TABLE IF NOT EXISTS public.owner_pm_fee_history (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_pm_relationship_id  uuid NOT NULL REFERENCES public.owner_pm_relationships(id),
  pm_fee_pct                numeric,
  pm_monthly_fixed_fee      numeric,
  approval_threshold        numeric,
  effective_date            date NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.owner_pm_fee_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_pm_fee_history_select_own"
  ON public.owner_pm_fee_history
  FOR SELECT
  USING (
    owner_pm_relationship_id IN (
      SELECT id FROM public.owner_pm_relationships
      WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "owner_pm_fee_history_insert_own"
  ON public.owner_pm_fee_history
  FOR INSERT
  WITH CHECK (
    owner_pm_relationship_id IN (
      SELECT id FROM public.owner_pm_relationships
      WHERE owner_id = auth.uid()
    )
  );