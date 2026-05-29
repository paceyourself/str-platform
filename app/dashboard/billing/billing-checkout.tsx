"use client";

import { useState } from "react";

type ExistingSubscription = {
  status: string;
  tier: string;
  billing_interval: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
};

type Props = {
  monthlyRate: number;
  annualRate: number;
  trialDays: number;
  existingSubscription: ExistingSubscription | null;
  userEmail: string;
};

function formatUsd(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function statusLabel(status: string): string {
  switch (status) {
    case "trialing":
      return "Free trial";
    case "active":
      return "Active";
    case "past_due":
      return "Past due";
    default:
      return status;
  }
}

export function BillingCheckout({
  monthlyRate,
  annualRate,
  trialDays,
  existingSubscription,
  userEmail,
}: Props) {
  const [loadingInterval, setLoadingInterval] = useState<
    "monthly" | "annual" | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(interval: "monthly" | "annual") {
    setLoadingInterval(interval);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval }),
      });
      const payload = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !payload.url) {
        setError(payload.error ?? "Could not start checkout. Please try again.");
        return;
      }
      window.location.href = payload.url;
    } catch {
      setError("Could not start checkout. Please try again.");
    } finally {
      setLoadingInterval(null);
    }
  }

  if (existingSubscription) {
    const renewal =
      formatDate(existingSubscription.current_period_end) ??
      formatDate(existingSubscription.trial_ends_at);

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Subscription
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Your Essentials plan is {statusLabel(existingSubscription.status).toLowerCase()}.
          </p>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Plan</dt>
              <dd className="font-medium capitalize text-zinc-900 dark:text-zinc-100">
                Essentials ({existingSubscription.billing_interval})
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Status</dt>
              <dd className="font-medium text-zinc-900 dark:text-zinc-100">
                {statusLabel(existingSubscription.status)}
              </dd>
            </div>
            {renewal ? (
              <div className="sm:col-span-2">
                <dt className="text-zinc-500 dark:text-zinc-400">
                  {existingSubscription.status === "trialing"
                    ? "Trial ends"
                    : "Current period ends"}
                </dt>
                <dd className="font-medium text-zinc-900 dark:text-zinc-100">
                  {renewal}
                </dd>
              </div>
            ) : null}
          </dl>

          {existingSubscription.status === "past_due" ? (
            <p className="mt-4 text-sm text-amber-800 dark:text-amber-200">
              Your payment is past due. Analytics access is paused until billing is
              resolved. Contact support@verostr.com if you need help.
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Subscribe to Essentials
        </h1>
        <p className="mt-2 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
          Unlock owner analytics and benchmarking. Start with a {trialDays}-day free
          trial — no charge until the trial ends.
          {userEmail ? (
            <>
              {" "}
              Checkout will use <span className="font-medium">{userEmail}</span>.
            </>
          ) : null}
        </p>
      </div>

      {error ? (
        <p
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <PlanCard
          title="Monthly"
          price={formatUsd(monthlyRate)}
          cadence="/ month"
          detail={`${trialDays}-day free trial, then ${formatUsd(monthlyRate)}/mo`}
          loading={loadingInterval === "monthly"}
          disabled={loadingInterval !== null}
          onSelect={() => startCheckout("monthly")}
        />
        <PlanCard
          title="Annual"
          price={formatUsd(annualRate)}
          cadence="/ year"
          detail={`${trialDays}-day free trial, then ${formatUsd(annualRate)}/yr`}
          badge="Best value"
          loading={loadingInterval === "annual"}
          disabled={loadingInterval !== null}
          onSelect={() => startCheckout("annual")}
        />
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Secure payment via Stripe. You will be redirected to Stripe Checkout to
        complete your subscription.
      </p>
    </div>
  );
}

function PlanCard({
  title,
  price,
  cadence,
  detail,
  badge,
  loading,
  disabled,
  onSelect,
}: {
  title: string;
  price: string;
  cadence: string;
  detail: string;
  badge?: string;
  loading: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <div className="flex flex-col rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {title}
        </h2>
        {badge ? (
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100">
            {badge}
          </span>
        ) : null}
      </div>
      <p className="mt-3">
        <span className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {price}
        </span>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">{cadence}</span>
      </p>
      <p className="mt-2 flex-1 text-sm text-zinc-600 dark:text-zinc-400">{detail}</p>
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Redirecting…" : "Continue to checkout"}
      </button>
    </div>
  );
}
