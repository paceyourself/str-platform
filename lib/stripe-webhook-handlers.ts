import {
  getRateSnapshot,
  type BillingInterval,
} from "@/lib/billing-rates";
import {
  extractInvoicePeriod,
  extractSubscriptionPeriod,
  mapStripeBillingInterval,
  mapStripeSubscriptionStatus,
  stripeTimestampToIso,
  subscriptionIdFromInvoice,
  subscriptionIdFromRef,
} from "@/lib/stripe-subscription";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase-admin";
import type Stripe from "stripe";

async function subscriptionByStripeId(stripeSubscriptionId: string) {
  const admin = createAdminClient();
  return admin
    .from("subscriptions")
    .select("id")
    .eq("stripe_subscription_id", stripeSubscriptionId)
    .maybeSingle();
}

async function updateSubscriptionByStripeId(
  stripeSubscriptionId: string,
  patch: Record<string, unknown>,
) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("subscriptions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", stripeSubscriptionId);
  if (error) {
    throw new Error(error.message);
  }
}

function priceIntervalFromSubscription(
  subscription: Stripe.Subscription,
): BillingInterval {
  const item = subscription.items.data[0];
  return mapStripeBillingInterval(item?.price?.recurring?.interval);
}

export async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
) {
  const stripeSubscriptionId = subscriptionIdFromRef(session.subscription);
  if (!stripeSubscriptionId) {
    console.warn("[stripe webhook] checkout.session.completed without subscription");
    return;
  }

  const existing = await subscriptionByStripeId(stripeSubscriptionId);
  if (existing.data) return;

  const userId = session.metadata?.user_id;
  if (!userId) {
    throw new Error("checkout.session.completed missing metadata.user_id");
  }

  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const billingInterval = priceIntervalFromSubscription(subscription);
  const { periodStart, periodEnd } = extractSubscriptionPeriod(subscription);
  const admin = createAdminClient();
  const rateSnapshot = await getRateSnapshot(admin, billingInterval);

  const { error } = await admin.from("subscriptions").insert({
    user_id: userId,
    subscriber_type: "owner",
    tier: "essentials",
    billing_interval: billingInterval,
    status: "trialing",
    stripe_customer_id:
      typeof session.customer === "string"
        ? session.customer
        : session.customer?.id ?? null,
    stripe_subscription_id: stripeSubscriptionId,
    trial_ends_at: stripeTimestampToIso(subscription.trial_end),
    current_period_start: periodStart,
    current_period_end: periodEnd,
    rate_snapshot: rateSnapshot,
  });

  if (error) {
    if (error.code === "23505") {
      console.info(
        "[stripe webhook] duplicate subscription insert ignored",
        stripeSubscriptionId,
      );
      return;
    }
    throw new Error(error.message);
  }
}

export async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const stripeSubscriptionId = subscription.id;
  const existing = await subscriptionByStripeId(stripeSubscriptionId);
  if (!existing.data) {
    console.warn("[stripe webhook] subscription.updated for unknown row", stripeSubscriptionId);
    return;
  }

  const status = mapStripeSubscriptionStatus(subscription.status);
  if (!status) return;

  const { periodStart, periodEnd } = extractSubscriptionPeriod(subscription);

  await updateSubscriptionByStripeId(stripeSubscriptionId, {
    status,
    current_period_start: periodStart,
    current_period_end: periodEnd,
  });
}

export async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const stripeSubscriptionId = subscription.id;
  const existing = await subscriptionByStripeId(stripeSubscriptionId);
  if (!existing.data) return;

  await updateSubscriptionByStripeId(stripeSubscriptionId, {
    status: "canceled",
    canceled_at: new Date().toISOString(),
  });
}

export async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  const stripeSubscriptionId = subscriptionIdFromInvoice(invoice);
  if (!stripeSubscriptionId) return;

  const existing = await subscriptionByStripeId(stripeSubscriptionId);
  if (!existing.data) return;

  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const status = mapStripeSubscriptionStatus(subscription.status);
  const fromSubscription = extractSubscriptionPeriod(subscription);
  const fromInvoice = extractInvoicePeriod(invoice);

  await updateSubscriptionByStripeId(stripeSubscriptionId, {
    ...(status ? { status } : {}),
    current_period_start:
      fromSubscription.periodStart ?? fromInvoice.periodStart,
    current_period_end: fromSubscription.periodEnd ?? fromInvoice.periodEnd,
  });
}

export async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const stripeSubscriptionId = subscriptionIdFromInvoice(invoice);
  if (!stripeSubscriptionId) return;

  const existing = await subscriptionByStripeId(stripeSubscriptionId);
  if (!existing.data) return;

  await updateSubscriptionByStripeId(stripeSubscriptionId, {
    status: "past_due",
  });
}
