import type { SupabaseClient } from "@supabase/supabase-js";

export type BillingInterval = "monthly" | "annual";

function todayIsoLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Reads the current effective rate from platform_pricing — same semantics as
 * get_current_rate() in Postgres (latest row where effective_date <= today).
 */
async function readCurrentRateFromTable(
  supabase: SupabaseClient,
  rateKey: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from("platform_pricing")
    .select("value")
    .eq("rate_key", rateKey)
    .lte("effective_date", todayIsoLocal())
    .order("effective_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`[billing-rates] platform_pricing ${rateKey}:`, error.message);
    return null;
  }
  if (data?.value == null) return null;
  const n = Number(data.value);
  return Number.isFinite(n) ? n : null;
}

/**
 * get_current_rate(rate_key) via RPC, with table fallback if RPC returns null.
 * RPC arg must be `rate_key` (not `key`) to match the Postgres function signature.
 */
async function getCurrentRate(
  supabase: SupabaseClient,
  rateKey: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("get_current_rate", {
    rate_key: rateKey,
  });

  if (error) {
    console.warn(
      `[billing-rates] get_current_rate RPC ${rateKey}:`,
      error.message,
    );
  }

  let n = data != null ? Number(data) : Number.NaN;
  if (!Number.isFinite(n)) {
    const fromTable = await readCurrentRateFromTable(supabase, rateKey);
    if (fromTable == null) {
      throw new Error(
        `Missing or invalid ${rateKey} in platform_pricing (RPC and table read failed)`,
      );
    }
    n = fromTable;
  }

  return n;
}

export async function getTrialDays(
  supabase: SupabaseClient,
): Promise<number> {
  const n = await getCurrentRate(supabase, "owner_trial_days");
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("Invalid owner_trial_days from platform_pricing");
  }
  return Math.floor(n);
}

export async function getOwnerEssentialsMonthlyRate(
  supabase: SupabaseClient,
): Promise<number> {
  const n = await getCurrentRate(supabase, "owner_essentials_monthly");
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("Invalid owner_essentials_monthly from platform_pricing");
  }
  return n;
}

export async function getOwnerEssentialsAnnualRate(
  supabase: SupabaseClient,
): Promise<number> {
  const n = await getCurrentRate(supabase, "owner_essentials_annual");
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("Invalid owner_essentials_annual from platform_pricing");
  }
  return n;
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
