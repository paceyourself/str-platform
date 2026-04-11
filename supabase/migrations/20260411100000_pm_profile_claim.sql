-- PM signup: link auth user to a catalog row pending admin approval.
ALTER TABLE public.pm_profiles
  ADD COLUMN IF NOT EXISTS claimed_by_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS profile_claimed boolean NOT NULL DEFAULT true;

ALTER TABLE public.pm_profiles ENABLE ROW LEVEL SECURITY;

-- PM users can read their own profile row (pending or approved).
DROP POLICY IF EXISTS "pm_profiles_pm_read_own" ON public.pm_profiles;
CREATE POLICY "pm_profiles_pm_read_own"
ON public.pm_profiles
FOR SELECT
TO authenticated
USING (claimed_by_user_id = auth.uid());

-- Owner app: list PM companies while signed in (catalog).
DROP POLICY IF EXISTS "pm_profiles_authenticated_select_catalog" ON public.pm_profiles;
CREATE POLICY "pm_profiles_authenticated_select_catalog"
ON public.pm_profiles
FOR SELECT
TO authenticated
USING (true);

-- Pre-auth PM signup: search companies not yet linked to a claiming user.
DROP POLICY IF EXISTS "pm_profiles_anon_select_unclaimed" ON public.pm_profiles;
CREATE POLICY "pm_profiles_anon_select_unclaimed"
ON public.pm_profiles
FOR SELECT
TO anon
USING (claimed_by_user_id IS NULL);

-- Attach signed-in user to an unclaimed catalog row; marks pending admin review.
DROP POLICY IF EXISTS "pm_profiles_authenticated_claim_update" ON public.pm_profiles;
CREATE POLICY "pm_profiles_authenticated_claim_update"
ON public.pm_profiles
FOR UPDATE
TO authenticated
USING (claimed_by_user_id IS NULL)
WITH CHECK (
  claimed_by_user_id = auth.uid()
  AND profile_claimed = false
);
