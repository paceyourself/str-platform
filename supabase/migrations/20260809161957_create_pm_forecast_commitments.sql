CREATE TABLE pm_forecast_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  date_committed date NOT NULL,
  target_date date NOT NULL,
  committed_incremental_amount numeric NOT NULL,
  entered_by uuid REFERENCES auth.users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT same_year_check CHECK (
    EXTRACT(YEAR FROM target_date) = EXTRACT(YEAR FROM date_committed)
  )
);
