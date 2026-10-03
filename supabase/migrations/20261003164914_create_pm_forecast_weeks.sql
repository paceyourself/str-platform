CREATE TABLE public.pm_forecast_weeks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pm_forecast_id uuid NOT NULL REFERENCES public.pm_forecasts(id) ON DELETE RESTRICT,
  week_start_date date NOT NULL CHECK (EXTRACT(DOW FROM week_start_date) = 6),
  projected_nightly_rate numeric(10,2) NOT NULL CHECK (projected_nightly_rate >= 0),
  projected_nights smallint NOT NULL DEFAULT 0 CHECK (projected_nights BETWEEN 0 AND 7),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pm_forecast_id, week_start_date)
);

ALTER TABLE public.pm_forecast_weeks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can read weeks for own forecasts"
  ON public.pm_forecast_weeks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pm_forecasts f
      WHERE f.id = pm_forecast_weeks.pm_forecast_id
        AND f.owner_id = auth.uid()
    )
  );

CREATE POLICY "Admins can read all pm_forecast_weeks"
  ON public.pm_forecast_weeks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.user_id = auth.uid()
    )
  );
