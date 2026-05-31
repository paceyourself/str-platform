import type { PeriodStats } from "@/lib/period-stats";

export type PerformanceSummaryCardsProps = {
  current: PeriodStats;
  deltas: {
    grossRevenue: number | null;
    revpar: number | null;
    occ: number | null;
    avgNightly: number | null;
  };
  periodLabel: string;
  priorDeltaTooltip?: string;
  loading?: boolean;
};

function formatMoney(n: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatOcc(ratio: number) {
  return `${(ratio * 100).toFixed(1)}%`;
}

function DeltaBadge({
  pct,
  tooltip,
}: {
  pct: number | null;
  tooltip?: string;
}) {
  if (pct == null) return null;
  return (
    <p className="mt-0.5 text-xs" title={tooltip}>
      <span
        className={
          pct >= 0
            ? "text-emerald-700 dark:text-emerald-300"
            : "text-red-700 dark:text-red-300"
        }
      >
        {pct >= 0 ? "↑" : "↓"} {Math.abs(pct).toFixed(1)}%
      </span>
    </p>
  );
}

export function PerformanceSummaryCards({
  current,
  deltas,
  periodLabel,
  priorDeltaTooltip,
  loading,
}: PerformanceSummaryCardsProps) {
  if (loading) {
    return <p className="mt-3 text-sm text-zinc-500">Loading bookings…</p>;
  }

  return (
    <>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/50">
          <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Gross revenue
          </dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            {formatMoney(current.grossRevenue)}
          </dd>
          <DeltaBadge
            pct={deltas.grossRevenue}
            tooltip={priorDeltaTooltip}
          />
          <p className="mt-0.5 text-xs text-zinc-500">Guest bookings only</p>
        </div>
        <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/50">
          <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            RevPAR ({periodLabel})
          </dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            {current.revpar != null ? formatMoney(current.revpar) : "—"}
          </dd>
          <DeltaBadge pct={deltas.revpar} tooltip={priorDeltaTooltip} />
        </div>
        <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/50">
          <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Occ%
          </dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            {current.occ != null ? formatOcc(current.occ) : "—"}
          </dd>
          <DeltaBadge pct={deltas.occ} tooltip={priorDeltaTooltip} />
          <p className="mt-0.5 text-xs text-zinc-500">
            Guest nights ÷ available nights
          </p>
        </div>
        <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/50">
          <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            ADR
          </dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            {current.avgNightly != null ? formatMoney(current.avgNightly) : "—"}
          </dd>
          <DeltaBadge pct={deltas.avgNightly} tooltip={priorDeltaTooltip} />
          <p className="mt-0.5 text-xs text-zinc-500">
            Gross ÷ prorated nights (guest)
          </p>
        </div>
      </dl>
      {priorDeltaTooltip ? (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          {priorDeltaTooltip}
        </p>
      ) : null}
    </>
  );
}
