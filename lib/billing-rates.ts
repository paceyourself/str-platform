import type { SupabaseClient } from "@supabase/supabase-js";

export type BillingInterval = "monthly" | "annual";

export async function getTrialDays(
  supabase: SupabaseClient,
): Promise<number> {
  const { data, error } = await supabase.rpc("get_current_rate", {
    key: "owner_trial_days",
  });
  if (error) throw new Error(error.message);
  const n = Number(data);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("Invalid owner_trial_days from platform_pricing");
  }
  return Math.floor(n);
}

export async function getOwnerEssentialsMonthlyRate(
  supabase: SupabaseClient,
): Promise<number> {
  const { data, error } = await supabase.rpc("get_current_rate", {
    key: "owner_essentials_monthly",
  });
  if (error) throw new Error(error.message);
  const n = Number(data);
  if (!Number.isFinite(n)) {
    throw new Error("Invalid owner_essentials_monthly from platform_pricing");
  }
  return n;
}

export async function getOwnerEssentialsAnnualRate(
  supabase: SupabaseClient,
): Promise<number> {
  const { data, error } = await supabase.rpc("get_current_rate", {
    key: "owner_essentials_annual",
  });
  if (error) throw new Error(error.message);
  return Number(data);
}

export async function getRateSnapshot(
  supabase: SupabaseClient,
  interval: BillingInterval,
): Promise<number> {
  if (interval === "monthly") {
    return getOwnerEssentialsMonthlyRate(supabase);
  }
  return getOwnerEssentialsAnnualRate(supabase);
}

export async function hasFeatureAccess(
  supabase: SupabaseClient,
  userId: string,
  flagKey: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_feature_access", {
    p_user_id: userId,
    p_flag_key: flagKey,
  });
  if (error) {
    console.error("[has_feature_access]", flagKey, error.message);
    return false;
  }
  return data === true;
}
