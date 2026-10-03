/**
 * Row 157 — Pacing view vs. PM forecast (Sprint 23 Amendment 1 §3.5).
 *
 * On-the-books(M) and Plan(M) use nightsIntersectHalfOpenWindow only.
 * Documented exception: check_in < CURRENT_DATE exclusion does NOT apply here.
 * Cancelled bookings: cancelled_at IS NOT NULL (do not use status).
 */

import { nightsIntersectHalfOpenWindow } from "./period-stats";

export type PacingBooking = {
  property_id: string | null;
  check_in: string | null;
  check_out: string | null;
  gross_revenue: number | string | null;
  cancelled_at: string | null;
};

export type PacingForecastWeek = {
  property_id: string;
  week_start_date: string;
  projected_nightly_rate: number | string;
  projected_nights: number | string;
};

export type PacingMonthWindow = {
  year: number;
  /** 1–12 */
  month: number;
  windowStart: Date;
  windowEndExclusive: Date;
  label: string;
};

export type PacingMonthRow = {
  year: number;
  month: number;
  label: string;
  onTheBooks: number;
  /** null = property/scope has no owner-selected forecast (not zero). */
  plan: number | null;
};

function parseIsoNoon(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
}

/** Calendar-date add — not overlap arithmetic. */
export function addCalendarDaysIso(isoDate: string, days: number): string {
  const base = parseIsoNoon(isoDate);
  if (!base) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }
  const dt = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + days,
    12,
    0,
    0,
  );
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function shortMonth(d: Date): string {
  return d.toLocaleString("en-US", { month: "short" });
}

/**
 * Remaining months of the current calendar year with M_end > today.
 * Window W = [max(M_start, today), M_end). Night of today counts as remaining.
 */
export function remainingMonthWindows(asOf: Date = new Date()): PacingMonthWindow[] {
  const y = asOf.getFullYear();
  const today = new Date(y, asOf.getMonth(), asOf.getDate(), 12, 0, 0);
  const out: PacingMonthWindow[] = [];

  for (let monthIndex = asOf.getMonth(); monthIndex < 12; monthIndex++) {
    const mStart = new Date(y, monthIndex, 1, 12, 0, 0);
    const mEnd = new Date(y, monthIndex + 1, 1, 12, 0, 0);
    if (!(mEnd.getTime() > today.getTime())) continue;

    const windowStart =
      mStart.getTime() > today.getTime() ? mStart : today;
    const monthName = shortMonth(mStart);
    const isCurrentMonth = monthIndex === asOf.getMonth();
    const label = isCurrentMonth
      ? `${monthName} (from ${monthName} ${asOf.getDate()})`
      : monthName;

    out.push({
      year: y,
      month: monthIndex + 1,
      windowStart,
      windowEndExclusive: mEnd,
      label,
    });
  }

  return out;
}

/** Full stay nights via the shared primitive (stay ∩ itself). */
function stayTotalNights(
  checkInIso: string | null,
  checkOutIso: string | null,
): number {
  const ci = parseIsoNoon(checkInIso);
  const co = parseIsoNoon(checkOutIso);
  if (!ci || !co) return 0;
  return nightsIntersectHalfOpenWindow(checkInIso, checkOutIso, ci, co);
}

/**
 * On-the-books(M) = Σ gross_revenue × overlap(stay, W) / stay_nights
 * over non-cancelled bookings. No check_in < today filter.
 */
export function onTheBooksRevenueForWindow(
  bookings: PacingBooking[],
  windowStart: Date,
  windowEndExclusive: Date,
): number {
  let sum = 0;
  for (const b of bookings) {
    if (b.cancelled_at != null) continue;
    const totalNights = stayTotalNights(b.check_in, b.check_out);
    if (totalNights <= 0) continue;
    const overlap = nightsIntersectHalfOpenWindow(
      b.check_in,
      b.check_out,
      windowStart,
      windowEndExclusive,
    );
    if (overlap <= 0) continue;
    const gross = Number(b.gross_revenue != null ? b.gross_revenue : NaN) || 0;
    sum += (gross * overlap) / totalNights;
  }
  return sum;
}

/**
 * Plan(M) = Σ rate × nights × overlap(week [start, start+7), W) / 7
 * Even-spread within each forecast week (§5 / §3.5).
 */
export function planRevenueForWindow(
  weeks: PacingForecastWeek[],
  windowStart: Date,
  windowEndExclusive: Date,
): number {
  let sum = 0;
  for (const w of weeks) {
    const start = String(w.week_start_date).slice(0, 10);
    const endExclusive = addCalendarDaysIso(start, 7);
    const overlap = nightsIntersectHalfOpenWindow(
      start,
      endExclusive,
      windowStart,
      windowEndExclusive,
    );
    if (overlap <= 0) continue;
    const rate = Number(w.projected_nightly_rate) || 0;
    const nights = Number(w.projected_nights) || 0;
    sum += (rate * nights * overlap) / 7;
  }
  return sum;
}

export function computePacingMonthRows(args: {
  bookings: PacingBooking[];
  /** Weeks for owner-selected headers in scope. Empty → plan is null. */
  forecastWeeks: PacingForecastWeek[];
  hasOwnerSelectedForecast: boolean;
  asOf?: Date;
}): PacingMonthRow[] {
  const asOf = args.asOf ?? new Date();
  const windows = remainingMonthWindows(asOf);
  return windows.map((w) => ({
    year: w.year,
    month: w.month,
    label: w.label,
    onTheBooks: onTheBooksRevenueForWindow(
      args.bookings,
      w.windowStart,
      w.windowEndExclusive,
    ),
    plan: args.hasOwnerSelectedForecast
      ? planRevenueForWindow(
          args.forecastWeeks,
          w.windowStart,
          w.windowEndExclusive,
        )
      : null,
  }));
}

export function formatPacingCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatBookingsAsOf(uploadedAt: string | null): string | null {
  if (!uploadedAt) return null;
  const d = new Date(uploadedAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
