-- Versioned platform pricing: append-only rows; latest effective row wins per rate_key.

CREATE TABLE IF NOT EXISTS public.platform_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_key text NOT NULL,
  description text NOT NULL DEFAULT '',
  value numeric NOT NULL,
  visible_to text NOT NULL DEFAULT 'all',
  effective_date date NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_pricing_rate_key_effective_idx
  ON public.platform_pricing (rate_key, effective_date DESC, created_at DESC);

ALTER TABLE public.platform_pricing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_pricing_admin_select" ON public.platform_pricing;
CREATE POLICY "platform_pricing_admin_select"
ON public.platform_pricing FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "platform_pricing_admin_insert" ON public.platform_pricing;
CREATE POLICY "platform_pricing_admin_insert"
ON public.platform_pricing FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = auth.uid()
  )
);

COMMENT ON TABLE public.platform_pricing IS 'Append-only pricing parameters; use effective_date for version selection.';
COMMENT ON COLUMN public.platform_pricing.rate_key IS 'Stable key; suffix _pct indicates percentage display.';
COMMENT ON COLUMN public.platform_pricing.value IS 'Currency amount (USD) or percentage points (e.g. 12.5 for 12.5%) when rate_key ends with _pct.';
