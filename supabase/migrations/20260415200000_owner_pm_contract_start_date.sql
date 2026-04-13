-- Explicit contract start for survey gating (upload flow). App falls back to start_date when null.
ALTER TABLE public.owner_pm_relationships
  ADD COLUMN IF NOT EXISTS contract_start_date date;

UPDATE public.owner_pm_relationships
SET contract_start_date = start_date::date
WHERE contract_start_date IS NULL
  AND start_date IS NOT NULL;
