import type { SupabaseClient } from "@supabase/supabase-js";

/** Fields needed from a pm_forecast_commitments row (or equivalent input). */
export type PmForecastCommitmentInput = {
  property_id: string;
  date_committed: string; // YYYY-MM-DD
  target_date: string; // YYYY-MM-DD
  committed_incremental_amount: number | string;
};

/** Map Postgres / PostgREST errors to owner-facing copy (never raw SQL). */
export function formatPmForecastCommitmentDbError(
  error: { code?: string; message?: string } | null | undefined,
): string {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  if (
    code === "23514" ||
    /same_year_check/i.test(message) ||
    (/check constraint/i.test(message) && /same_year/i.test(message))
  ) {
    return "Target date must be in the same calendar year as the commitment date.";
  }
  if (message.trim()) {
    // Strip common Postgres prefix noise; keep a short readable line.
    const cleaned = message
      .replace(/^.*violates check constraint\s+"[^"]+"\s*/i, "")
      .replace(/^ERROR:\s*/i, "")
      .trim();
    if (/same_year|year/i.test(message)) {
      return "Target date must be in the same calendar year as the commitment date.";
    }
    return cleaned || "Could not save commitment. Please try again.";
  }
  return "Could not save commitment. Please try again.";
}

export type PmForecastCommitmentMetrics = {
  baseline: number;
  actual_incremental: number;
  /** null when committed_incremental_amount is 0 (undefined miss). */
  miss_pct: number | null;
};

export type CommitmentBookingRow = {
  booked_date: string | null;
  check_out: string | null;
  cancelled_at: string | null;
  gross_revenue: number | string | null;
};

function toFiniteNumber(value: number | string | null | undefined): number {
  const n = Number(value != null ? value : NaN);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Pure live metrics from booking rows — never persisted.
 *
 * baseline: booked_date < date_committed AND check_out <= target_date AND not cancelled
 * actual_incremental: booked_date >= date_committed AND check_out <= target_date AND not cancelled
 * miss_pct: (committed_incremental_amount - actual_incremental) / committed_incremental_amount
 */
export function computePmForecastCommitmentMetricsFromBookings(
  bookings: CommitmentBookingRow[],
  commitment: PmForecastCommitmentInput,
): PmForecastCommitmentMetrics {
  const dateCommitted = commitment.date_committed;
  const targetDate = commitment.target_date;
  let baseline = 0;
  let actualIncremental = 0;

  for (const b of bookings) {
    if (b.cancelled_at != null) continue;
    if (b.booked_date == null || b.check_out == null) continue;
    if (b.check_out > targetDate) continue;

    const revenue = toFiniteNumber(b.gross_revenue);
    if (b.booked_date < dateCommitted) {
      baseline += revenue;
    } else {
      // booked_date >= date_committed
      actualIncremental += revenue;
    }
  }

  const committed = toFiniteNumber(commitment.committed_incremental_amount);
  const missPct =
    committed === 0 ? null : (committed - actualIncremental) / committed;

  return {
    baseline,
    actual_incremental: actualIncremental,
    miss_pct: missPct,
  };
}

/**
 * Live compute for a pm_forecast_commitments row.
 * baseline / actual_incremental / miss_pct are never stored — always derived on read.
 */
export async function computePmForecastCommitmentMetrics(
  supabase: SupabaseClient,
  commitment: PmForecastCommitmentInput,
): Promise<PmForecastCommitmentMetrics> {
  const { data, error } = await supabase
    .from("bookings")
    .select("booked_date, check_out, cancelled_at, gross_revenue")
    .eq("property_id", commitment.property_id)
    .lte("check_out", commitment.target_date)
    .not("booked_date", "is", null);

  if (error) {
    throw new Error(
      `[pm-forecast-commitments] bookings query failed: ${error.message}`,
    );
  }

  return computePmForecastCommitmentMetricsFromBookings(
    (data ?? []) as CommitmentBookingRow[],
    commitment,
  );
}
