-- Ticketing: owner ↔ PM. Run after bookings / owner_pm_relationships exist.
-- If `tickets` already exists, apply only the ALTER for `direction` in the SQL Editor.

CREATE TABLE IF NOT EXISTS public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  pm_id uuid NOT NULL REFERENCES public.pm_profiles (id) ON DELETE CASCADE,
  owner_pm_relationship_id uuid REFERENCES public.owner_pm_relationships (id) ON DELETE SET NULL,
  queue text,
  title text NOT NULL,
  description text NOT NULL,
  incident_date date,
  related_booking_id uuid REFERENCES public.bookings (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved', 'disputed')),
  direction text NOT NULL DEFAULT 'owner_to_pm'
    CHECK (direction IN ('owner_to_pm', 'pm_to_owner')),
  request_type text,
  dollar_amount numeric,
  proposed_vendor text,
  resolution_note text,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tickets_owner_id_idx ON public.tickets (owner_id);
CREATE INDEX IF NOT EXISTS tickets_pm_id_idx ON public.tickets (pm_id);
CREATE INDEX IF NOT EXISTS tickets_owner_pm_rel_idx ON public.tickets (owner_pm_relationship_id);
CREATE INDEX IF NOT EXISTS tickets_direction_idx ON public.tickets (direction);

-- If `tickets` already existed with fewer columns, add missing pieces:
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS direction text;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS request_type text;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS dollar_amount numeric;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS proposed_vendor text;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS resolution_note text;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

-- Enforce direction check when column exists (run once in SQL editor if needed):
-- ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_direction_check;
-- ALTER TABLE public.tickets ADD CONSTRAINT tickets_direction_check
--   CHECK (direction IN ('owner_to_pm', 'pm_to_owner'));
