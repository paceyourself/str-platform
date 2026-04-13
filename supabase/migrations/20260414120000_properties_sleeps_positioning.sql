-- Optional guest capacity and marketing copy for owner property forms.

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS positioning_statement text;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS sleeps integer;

COMMENT ON COLUMN public.properties.sleeps IS 'Max guests the property accommodates (optional).';
COMMENT ON COLUMN public.properties.positioning_statement IS 'Short owner-written positioning / uniqueness (optional, max 500 chars in app).';
