/**
 * Row 236 — CFY vs Prior-Year Pacing (Sprint 23 Amendment 1 §4).
 *
 * Four segments; cancelled_at IS NOT NULL excluded from all.
 * Overlap via nightsIntersectHalfOpenWindow only.
 * No check_in < CURRENT_DATE filter (documented exception).
 */

import { nightsIntersectHalfOpenWindow } from "./period-stats";

export type CfyMetric = "revenue" | "nights";

export type CfyBooking = {
  property_id: string | null;
  check_in: string | null;
  check_out: string | null;
  booked_date: string | null;
  gross_revenue: number | string | null;
  cancelled_at: string | null;
};

export type CfyMonthRow = {
  year: number;
  month: number;
  label: string;
  cySegA: number;
  cySegB: number;
  pySegA: number;
  pySegB: number;
  /** Elapsed month with incomplete coverage in either year — hatch, never zero. */
  incomplete: boolean;
};

/** Locked legend colors (Amendment §4.5, founder-confirmed). */
export const CFY_PACING_COLORS = {
  cySegA: "#1F4E79",
  cySegB: "#9DC3E6",
  pySegA: "#595959",
  pySegB: "#BFBFBF",
} as const;

function parseIsoNoon(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
}

function stayTotalNights(
  checkInIso: string | null,
  checkOutIso: string | null,
): number {
  const ci = parseIsoNoon(checkInIso);
  const co = parseIsoNoon(checkOutIso);
  if (!ci || !co) return 0;
  return nightsIntersectHalfOpenWindow(checkInIso, checkOutIso, ci, co);
}

/** Snapshot = today minus one calendar year; Feb 29 → Feb 28. */
export function snapshotDateOneYearAgo(asOf: Date = new Date()): Date {
  const y = asOf.getFullYear() - 1;
  const m = asOf.getMonth();
  const d = asOf.getDate();
  const lastDay = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(d, lastDay), 12, 0, 0);
}

function monthShort(monthIndex0: number): string {
  return new Date(2000, monthIndex0, 1).toLocaleString("en-US", {
    month: "short",
  });
}

function contributionInWindow(
  b: CfyBooking,
  windowStart: Date,
  windowEndExclusive: Date,
  metric: CfyMetric,
): number {
  if (b.cancelled_at != null) return 0;
  const overlap = nightsIntersectHalfOpenWindow(
    b.check_in,
    b.check_out,
    windowStart,
    windowEndExclusive,
  );
  if (overlap <= 0) return 0;
  if (metric === "nights") return overlap;
  const total = stayTotalNights(b.check_in, b.check_out);
  if (total <= 0) return 0;
  const gross = Number(b.gross_revenue != null ? b.gross_revenue : NaN) || 0;
  return (gross * overlap) / total;
}

function bookedDateNoon(b: CfyBooking): Date | null {
  return parseIsoNoon(b.booked_date);
}

/**
 * Build Jan–Dec CFY pacing rows for `asOf`'s calendar year.
 * Prior-year months are the same month numbers in year-1.
 */
export function computeCfyPacingMonths(args: {
  bookings: CfyBooking[];
  metric: CfyMetric;
  asOf?: Date;
  /**
   * coverage key `${propertyId}:${year}:${month}` → data_complete.
   * Incomplete if any in-scope property is false for that month (either year).
   * Current month never marked incomplete.
   */
  isMonthIncomplete?: (year: number, month: number) => boolean;
}): CfyMonthRow[] {
  const asOf = args.asOf ?? new Date();
  const today = new Date(
    asOf.getFullYear(),
    asOf.getMonth(),
    asOf.getDate(),
    12,
    0,
    0,
  );
  const snapshot = snapshotDateOneYearAgo(asOf);
  const cy = asOf.getFullYear();
  const py = cy - 1;
  const metric = args.metric;
  const rows: CfyMonthRow[] = [];

  for (let month = 1; month <= 12; month++) {
    const cyStart = new Date(cy, month - 1, 1, 12, 0, 0);
    const cyEnd = new Date(cy, month, 1, 12, 0, 0);
    const pyStart = new Date(py, month - 1, 1, 12, 0, 0);
    const pyEnd = new Date(py, month, 1, 12, 0, 0);

    // Current-year Segment A / B windows
    let cyAStart: Date | null = null;
    let cyAEnd: Date | null = null;
    let cyBStart: Date | null = null;
    let cyBEnd: Date | null = null;

    if (cyEnd.getTime() <= today.getTime()) {
      // Fully elapsed → Segment A only
      cyAStart = cyStart;
      cyAEnd = cyEnd;
    } else if (cyStart.getTime() >= today.getTime()) {
      // Future → Segment B only
      cyBStart = cyStart;
      cyBEnd = cyEnd;
    } else {
      // Current month: A = [start, today), B = [today, end)
      cyAStart = cyStart;
      cyAEnd = today;
      cyBStart = today;
      cyBEnd = cyEnd;
    }

    let cySegA = 0;
    let cySegB = 0;
    let pySegA = 0;
    let pySegB = 0;

    for (const b of args.bookings) {
      if (b.cancelled_at != null) continue;

      if (cyAStart && cyAEnd) {
        cySegA += contributionInWindow(b, cyAStart, cyAEnd, metric);
      }
      if (cyBStart && cyBEnd) {
        cySegB += contributionInWindow(b, cyBStart, cyBEnd, metric);
      }

      const monthOverlap = nightsIntersectHalfOpenWindow(
        b.check_in,
        b.check_out,
        pyStart,
        pyEnd,
      );
      if (monthOverlap <= 0) continue;

      const booked = bookedDateNoon(b);
      if (!booked) continue;

      const priorContribution =
        metric === "nights"
          ? monthOverlap
          : (() => {
              const total = stayTotalNights(b.check_in, b.check_out);
              if (total <= 0) return 0;
              const gross =
                Number(b.gross_revenue != null ? b.gross_revenue : NaN) || 0;
              return (gross * monthOverlap) / total;
            })();

      if (booked.getTime() <= snapshot.getTime()) {
        pySegA += priorContribution;
      } else {
        pySegB += priorContribution;
      }
    }

    const isCurrentMonth =
      month === asOf.getMonth() + 1 && cy === asOf.getFullYear();
    const cyElapsed =
      !isCurrentMonth && cyEnd.getTime() <= today.getTime();
    // Prior-year counterpart month is always fully closed when viewing CFY of the next year.
    const pyElapsed = !isCurrentMonth;
    const incomplete =
      !isCurrentMonth &&
      ((cyElapsed && args.isMonthIncomplete?.(cy, month) === true) ||
        (pyElapsed && args.isMonthIncomplete?.(py, month) === true));

    rows.push({
      year: cy,
      month,
      label: monthShort(month - 1),
      cySegA,
      cySegB,
      pySegA,
      pySegB,
      incomplete,
    });
  }

  return rows;
}
