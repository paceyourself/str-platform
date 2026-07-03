import { BillingCheckout } from "@/app/dashboard/billing/billing-checkout";
import {
  getOwnerEssentialsAnnualRate,
  getOwnerEssentialsMonthlyRate,
  getTrialDays,
} from "@/lib/billing-rates";
import { createClient } from "@/lib/supabase-server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Billing",
};

const ACTIVE_STATUSES = ["trialing", "active", "past_due"] as const;

export default async function BillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: checkoutFlag } = await supabase
    .from("feature_flags")
    .select("active")
    .eq("flag_key", "stripe_checkout_enabled")
    .maybeSingle();

  if (!checkoutFlag?.active) {
    redirect("/dashboard");
  }

  const { data: existingSub } = await supabase
    .from("subscriptions")
    .select("status, tier, billing_interval, trial_ends_at, current_period_end")
    .eq("user_id", user.id)
    .eq("subscriber_type", "owner")
    .in("status", [...ACTIVE_STATUSES])
    .maybeSingle();

  let monthlyRate = 0;
  let annualRate = 0;
  let trialDays = 0;
  let ratesError: string | null = null;

  try {
    [monthlyRate, annualRate, trialDays] = await Promise.all([
      getOwnerEssentialsMonthlyRate(supabase),
      getOwnerEssentialsAnnualRate(supabase),
      getTrialDays(supabase),
    ]);
  } catch (err) {
    console.error("[billing] rate load:", err);
    ratesError =
      "Billing rates could not be loaded. Please contact support@verostr.com.";
  }

  return (
    <BillingCheckout
      monthlyRate={monthlyRate}
      annualRate={annualRate}
      trialDays={trialDays}
      existingSubscription={existingSub}
      userEmail={user.email ?? ""}
      ratesError={ratesError}
    />
  );
}
