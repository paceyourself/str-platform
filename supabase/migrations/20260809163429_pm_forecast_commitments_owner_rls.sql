-- Owner RLS for pm_forecast_commitments (Type 2 incremental commitments).
-- Table was created with RLS on and no policies — owners could not read/write.

ALTER TABLE public.pm_forecast_commitments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can read commitments for owned properties"
  ON public.pm_forecast_commitments FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.properties pr
    WHERE pr.id = pm_forecast_commitments.property_id
      AND pr.owner_id = auth.uid()
      AND pr.deleted_at IS NULL
  ));

CREATE POLICY "Owners can insert commitments for owned properties"
  ON public.pm_forecast_commitments FOR INSERT
  TO authenticated
  WITH CHECK (
    entered_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.properties pr
      WHERE pr.id = pm_forecast_commitments.property_id
        AND pr.owner_id = auth.uid()
        AND pr.deleted_at IS NULL
    )
  );

CREATE POLICY "Admins can read all pm_forecast_commitments"
  ON public.pm_forecast_commitments FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid()
  ));
