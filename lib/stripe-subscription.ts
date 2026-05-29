import type { BillingInterval } from "@/lib/billing-rates";
import type Stripe from "stripe";

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "paused";

type SubscriptionWithLegacyPeriod = Stripe.Subscription & {
  current_period_start?: number;
  current_period_end?: number;
};

type LegacyInvoice = Stripe.Invoice & {
  subscription?: string | Stripe.Subscription | null;
};

export function mapStripeBillingInterval(
  interval: string | null | undefined,
): BillingInterval {
  return interval === "year" ? "annual" : "monthly";
}

export function mapStripeSubscriptionStatus(
  status: string | null | undefined,
): SubscriptionStatus | null {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
      return "canceled";
    case "paused":
      return "paused";
    case "unpaid":
      return "past_due";
    default:
      return null;
  }
}

export function stripeTimestampToIso(
  unixSeconds: number | null | undefined,
): string | null {
  if (unixSeconds == null) return null;
  return new Date(unixSeconds * 1000).toISOString();
}

export function subscriptionIdFromRef(
  ref: string | Stripe.Subscription | null | undefined,
): string | null {
  if (ref == null) return null;
  return typeof ref === "string" ? ref : ref.id;
}

export function subscriptionIdFromInvoice(
  invoice: Stripe.Invoice,
): string | null {
  const legacy = invoice as LegacyInvoice;
  const fromLegacy = subscriptionIdFromRef(legacy.subscription);
  if (fromLegacy) return fromLegacy;

  const details = invoice.parent?.subscription_details;
  return subscriptionIdFromRef(details?.subscription);
}

/** Stripe v22 removed top-level period fields; support legacy payloads and billing_schedules. */
export function extractSubscriptionPeriod(subscription: Stripe.Subscription): {
  periodStart: string | null;
  periodEnd: string | null;
} {
  const legacy = subscription as SubscriptionWithLegacyPeriod;
  if (
    legacy.current_period_start != null &&
    legacy.current_period_end != null
  ) {
    return {
      periodStart: stripeTimestampToIso(legacy.current_period_start),
      periodEnd: stripeTimestampToIso(legacy.current_period_end),
    };
  }

  const schedule = subscription.billing_schedules?.[0];
  const periodEndTs =
    schedule?.bill_until?.computed_timestamp ??
    schedule?.bill_until?.timestamp ??
    null;
  const periodStartTs =
    subscription.billing_cycle_anchor ?? subscription.start_date ?? null;

  return {
    periodStart: stripeTimestampToIso(periodStartTs),
    periodEnd: stripeTimestampToIso(periodEndTs),
  };
}

export function extractInvoicePeriod(invoice: Stripe.Invoice): {
  periodStart: string | null;
  periodEnd: string | null;
} {
  return {
    periodStart: stripeTimestampToIso(invoice.period_start),
    periodEnd: stripeTimestampToIso(invoice.period_end),
  };
}
