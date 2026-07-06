import { getAppBaseUrl } from "@/lib/app-url";
import { getTrialDays, type BillingInterval } from "@/lib/billing-rates";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

const ACTIVE_STATUSES = ["trialing", "active", "past_due"] as const;
const TOS_VERSION = "v1_direct_20260629";

function priceIdForInterval(interval: BillingInterval): string {
  const envKey =
    interval === "monthly"
      ? "STRIPE_PRICE_OWNER_ESSENTIALS_MONTHLY"
      : "STRIPE_PRICE_OWNER_ESSENTIALS_ANNUAL";
  const priceId = process.env[envKey]?.trim();
  if (!priceId) {
    throw new Error(`Missing ${envKey}`);
  }
  return priceId;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: checkoutFlag } = await supabase
    .from("feature_flags")
    .select("active")
    .eq("flag_key", "stripe_checkout_enabled")
    .maybeSingle();

  if (!checkoutFlag?.active) {
    return NextResponse.json({ error: "Checkout unavailable" }, { status: 403 });
  }

  let interval: BillingInterval;
  try {
    const body = (await request.json()) as { interval?: string };
    if (body.interval !== "monthly" && body.interval !== "annual") {
      return NextResponse.json({ error: "Invalid billing interval" }, { status: 400 });
    }
    interval = body.interval;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { data: existingSub } = await supabase
    .from("subscriptions")
    .select("id, status")
    .eq("user_id", user.id)
    .eq("subscriber_type", "owner")
    .in("status", [...ACTIVE_STATUSES])
    .maybeSingle();

  if (existingSub) {
    return NextResponse.json(
      { error: "You already have an active subscription." },
      { status: 409 },
    );
  }

  let stripePriceId: string;
  let trialDays: number;
  try {
    stripePriceId = priceIdForInterval(interval);
    trialDays = await getTrialDays(supabase);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Billing configuration error";
    console.error("[billing/checkout]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const baseUrl = getAppBaseUrl();
  const stripe = getStripe();

  try {
    const email = user.email?.trim();
    let customerId: string | undefined;

    if (email) {
      const existing = await stripe.customers.search({
        query: `email:'${email.replace(/'/g, "\\'")}'`,
      });
      customerId =
        existing.data.length > 0 ? existing.data[0].id : undefined;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...(customerId
        ? { customer: customerId }
        : { customer_email: email ?? undefined }),
      line_items: [{ price: stripePriceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: trialDays,
        metadata: {
          user_id: user.id,
          subscriber_type: "owner",
          tier: "essentials",
        },
      },
      metadata: {
        user_id: user.id,
        tos_version: TOS_VERSION,
        subscriber_type: "owner",
        tier: "essentials",
      },
      success_url: `${baseUrl}/dashboard?subscribed=true`,
      cancel_url: `${baseUrl}/dashboard/billing`,
    });

    if (!session.url) {
      return NextResponse.json(
        { error: "Stripe did not return a checkout URL" },
        { status: 500 },
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Checkout failed";
    console.error("[billing/checkout]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
