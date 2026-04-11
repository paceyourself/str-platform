-- Public PM directory: reviews, contact fields, aggregate RPCs (no raw relationship rows to anon).

ALTER TABLE public.pm_profiles
  ADD COLUMN IF NOT EXISTS website_url text,
  ADD COLUMN IF NOT EXISTS phone text;

CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pm_id uuid NOT NULL REFERENCES public.pm_profiles (id) ON DELETE CASCADE,
  owner_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  overall_rating numeric NOT NULL CHECK (
    overall_rating >= 1
    AND overall_rating <= 5
  ),
  review_text text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('visible', 'hidden', 'pending')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reviews_pm_id_idx ON public.reviews (pm_id);
CREATE INDEX IF NOT EXISTS reviews_pm_status_idx ON public.reviews (pm_id, status);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reviews_select_visible" ON public.reviews;
CREATE POLICY "reviews_select_visible"
ON public.reviews
FOR SELECT
TO anon, authenticated
USING (status = 'visible');

-- Aggregates only; callable by anon without exposing owner_pm_relationships rows.
CREATE OR REPLACE FUNCTION public.rpc_pm_directory_contract_stats ()
RETURNS TABLE (
  pm_id uuid,
  rel_count bigint,
  avg_notice_days numeric,
  pct_etf numeric,
  pct_listing_transfer numeric,
  avg_payment_timeline_days numeric,
  avg_maintenance_threshold numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.pm_id,
    COUNT(*)::bigint AS rel_count,
    AVG(r.contract_notice_days)::numeric AS avg_notice_days,
    (100.0 * COUNT(*) FILTER (WHERE r.contract_etf_exists IS TRUE)
      / NULLIF(COUNT(*), 0))::numeric AS pct_etf,
    (100.0 * COUNT(*) FILTER (WHERE r.contract_listing_transfer IS TRUE)
      / NULLIF(COUNT(*), 0))::numeric AS pct_listing_transfer,
    AVG(r.contract_payment_timeline_days)::numeric AS avg_payment_timeline_days,
    AVG(r.contract_maintenance_threshold)::numeric AS avg_maintenance_threshold
  FROM public.owner_pm_relationships r
  WHERE r.active IS TRUE
  GROUP BY r.pm_id;
$$;

CREATE OR REPLACE FUNCTION public.rpc_pm_directory_ticket_stats ()
RETURNS TABLE (
  pm_id uuid,
  total bigint,
  acknowledged_count bigint,
  resolved_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.pm_id,
    COUNT(*)::bigint AS total,
    COUNT(*) FILTER (WHERE t.acknowledged_at IS NOT NULL)::bigint AS acknowledged_count,
    COUNT(*) FILTER (WHERE t.status = 'resolved')::bigint AS resolved_count
  FROM public.tickets t
  WHERE t.direction = 'owner_to_pm'
  GROUP BY t.pm_id;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_pm_directory_contract_stats () TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_pm_directory_ticket_stats () TO anon, authenticated;

-- Anonymous directory: 30A PMs (expects `markets` as text[]; if jsonb, use:
-- USING (markets @> '["30a"]'::jsonb)
DROP POLICY IF EXISTS "pm_profiles_anon_30a_directory" ON public.pm_profiles;
CREATE POLICY "pm_profiles_anon_30a_directory"
ON public.pm_profiles
FOR SELECT
TO anon
USING ('30a' = ANY (markets));
