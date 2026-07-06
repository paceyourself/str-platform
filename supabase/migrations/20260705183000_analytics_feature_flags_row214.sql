-- Row 214: Split analytics_benchmarking into two independent flags
-- analytics_page_access: gates access to the analytics page
-- analytics_benchmark_display: gates benchmark overlay + Index card value (renamed from analytics_benchmarking)

INSERT INTO public.feature_flags (flag_key, active, owner_tiers, pm_tiers)
SELECT 'analytics_page_access', true, ARRAY['essentials','portfolio','investor'], ARRAY[]::text[]
WHERE NOT EXISTS (
  SELECT 1 FROM public.feature_flags WHERE flag_key = 'analytics_page_access'
);

UPDATE public.feature_flags
SET flag_key = 'analytics_benchmark_display'
WHERE flag_key = 'analytics_benchmarking';