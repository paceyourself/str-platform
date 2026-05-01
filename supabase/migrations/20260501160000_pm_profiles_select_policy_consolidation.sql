-- Drop redundant and insecure SELECT policies
DROP POLICY IF EXISTS "Public read access to pm_profiles" ON pm_profiles;
DROP POLICY IF EXISTS "Public read all pm_profiles" ON pm_profiles;
DROP POLICY IF EXISTS "pm_profiles_anon_30a_directory" ON pm_profiles;
DROP POLICY IF EXISTS "pm_profiles_anon_select_unclaimed" ON pm_profiles;
