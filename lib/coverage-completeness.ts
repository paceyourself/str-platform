import type { SupabaseClient } from "@supabase/supabase-js";

export type CoverageBookingRow = {
  property_id: string | null;
  check_in: string | null;
  check_out: string | null;
  status?: string | null;
};

export type CalendarMonth = { year: number; month: number };

export type IncompleteCoverageRow = {
  property_id: string;
  pm_id: string;
  coverage_year: number;
  coverage_month: number;
  data_complete: boolean;
  admin_override: boolean;
};

/** Local date at noon — avoids TZ drift parsing YYYY-MM-DD. */
export function parseDateOnlyLocal(isoPrefix: string): Date | null {
  const ymd =
    /^(\d{4})-(\d{2})-(\d{2})(?:[^\d]|$)/.exec(String(isoPrefix).trim());
  if (!ymd) return null;
  const y = Number(ymd[1]);
  const mo = Number(ymd[2]);
  const d = Number(ymd[3]);
  const dt = new Date(y, mo - 1, d, 12, 0, 0);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== mo - 1 ||
    dt.getDate() !== d
  ) {
    return null;
  }
  return dt;
}

/**
 * Months strictly before the calendar month containing `now`.
 * Completed months only (never the current partial month).
 */
export function isCalendarMonthFullyClosedBeforeNow(
  coverageYear: number,
  coverageMonth: number,
  now = new Date(),
): boolean {
  const cy = now.getFullYear();
  const cm = now.getMonth() + 1;
  return coverageYear < cy || (coverageYear === cy && coverageMonth < cm);
}

/** CURRENT_DATE >= first day of the month following the coverage month. */
export function isOnOrAfterFirstDayOfFollowingMonth(
  coverageYear: number,
  coverageMonth: number,
  now = new Date(),
): boolean {
  let fy = coverageYear;
  let fm = coverageMonth + 1;
  if (fm > 12) {
    fm = 1;
    fy += 1;
  }
  const firstFollowing = new Date(fy, fm - 1, 1, 12, 0, 0);
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    12,
    0,
    0,
  );
  return today.getTime() >= firstFollowing.getTime();
}

export function bookingOverlapsCoverageMonth(
  checkInIso: string | null | undefined,
  checkOutIso: string | null | undefined,
  coverageYear: number,
  coverageMonth: number,
): boolean {
  const ci = parseDateOnlyLocal(String(checkInIso ?? ""));
  const co = parseDateOnlyLocal(String(checkOutIso ?? ""));
  if (!ci || !co || !(co > ci)) return false;
  const monthStart = new Date(coverageYear, coverageMonth - 1, 1, 12, 0, 0);
  const monthEndExclusive = new Date(coverageYear, coverageMonth, 1, 12, 0, 0);
  return (
    ci.getTime() < monthEndExclusive.getTime() &&
    co.getTime() > monthStart.getTime()
  );
}

/**
 * Case 1 / Case 2 coverage completeness — evaluated per property.
 * uploadDate is the upload timestamp (on re-eval, pass `now`).
 */
export function computeDataCompleteForMonth(
  propertyId: string,
  coverageYear: number,
  coverageMonth: number,
  bookings: CoverageBookingRow[],
  uploadDate: Date,
  now = new Date(),
): boolean {
  if (!isCalendarMonthFullyClosedBeforeNow(coverageYear, coverageMonth, now)) {
    return false;
  }

  const active = bookings.filter((b) => {
    if (String(b.property_id ?? "").trim() !== propertyId) return false;
    if (String(b.status ?? "").trim().toLowerCase() === "cancelled") return false;
    return bookingOverlapsCoverageMonth(
      b.check_in,
      b.check_out,
      coverageYear,
      coverageMonth,
    );
  });

  if (active.length === 0) {
    return true;
  }

  let lastBooking = active[0];
  let maxCo = parseDateOnlyLocal(String(lastBooking.check_out ?? ""));
  for (const b of active) {
    const co = parseDateOnlyLocal(String(b.check_out ?? ""));
    if (co && maxCo && co > maxCo) {
      maxCo = co;
      lastBooking = b;
    } else if (co && !maxCo) {
      maxCo = co;
      lastBooking = b;
    }
  }

  const monthEnd = new Date(coverageYear, coverageMonth, 0, 12, 0, 0);
  const checkout = parseDateOnlyLocal(String(lastBooking.check_out ?? ""));
  const checkin = parseDateOnlyLocal(String(lastBooking.check_in ?? ""));
  const uploadDay = new Date(
    uploadDate.getFullYear(),
    uploadDate.getMonth(),
    uploadDate.getDate(),
    12,
    0,
    0,
  );

  if (!checkout || !checkin) {
    return isOnOrAfterFirstDayOfFollowingMonth(coverageYear, coverageMonth, now);
  }

  const checkoutInFutureMonth = checkout.getTime() > monthEnd.getTime();

  if (!checkoutInFutureMonth) {
    return isOnOrAfterFirstDayOfFollowingMonth(coverageYear, coverageMonth, now);
  }

  if (uploadDay.getTime() >= checkin.getTime()) {
    return true;
  }

  return isOnOrAfterFirstDayOfFollowingMonth(coverageYear, coverageMonth, now);
}

/** Inclusive calendar months from the month containing minDate through maxDate. */
export function calendarMonthsInclusiveInFileSpan(
  minDate: Date,
  maxDate: Date,
): CalendarMonth[] {
  const startY = minDate.getFullYear();
  const startM = minDate.getMonth() + 1;
  const endY = maxDate.getFullYear();
  const endM = maxDate.getMonth() + 1;
  const out: CalendarMonth[] = [];
  let y = startY;
  let m = startM;
  while (y < endY || (y === endY && m <= endM)) {
    out.push({ year: y, month: m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Coverage holes for period locking — calendar-closed months with stale
 * data_complete=false do not block rendering (soft note instead).
 */
export function coverageHoles(
  covMap: Map<string, { data_complete?: boolean; admin_override?: boolean }>,
  months: CalendarMonth[],
  now = new Date(),
): CalendarMonth[] {
  return months.filter((mk) => {
    const r = covMap.get(monthKey(mk.year, mk.month));
    if (r?.data_complete || r?.admin_override) return false;
    if (isOnOrAfterFirstDayOfFollowingMonth(mk.year, mk.month, now)) return false;
    return true;
  });
}

export function monthKey(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function formatMonthHeading(y: number, m: number): string {
  return new Date(y, m - 1, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
}

/** Portfolio-level stale-data months for the soft upload reminder. */
export function staleIncompleteCoverageMonths(
  coverageRows: IncompleteCoverageRow[],
  propertyIds: string[],
  pmByProperty: Map<string, string>,
  now = new Date(),
): CalendarMonth[] {
  const seen = new Set<string>();
  const out: CalendarMonth[] = [];

  for (const pid of propertyIds) {
    const pmId = pmByProperty.get(pid) ?? "";
    if (!pmId) continue;
    for (const c of coverageRows) {
      if (c.property_id !== pid || c.pm_id !== pmId) continue;
      if (c.data_complete || c.admin_override) continue;
      if (
        !isOnOrAfterFirstDayOfFollowingMonth(
          c.coverage_year,
          c.coverage_month,
          now,
        )
      ) {
        continue;
      }
      const key = monthKey(c.coverage_year, c.coverage_month);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ year: c.coverage_year, month: c.coverage_month });
    }
  }

  return out.sort(
    (a, b) => a.year - b.year || a.month - b.month,
  );
}

/**
 * Re-evaluate incomplete coverage rows once the calendar has closed the month.
 * Called on dashboard load so Case 2 months flip without re-upload.
 */
export async function reEvaluateIncompleteCoverageMonths(
  supabase: SupabaseClient,
  coverageRows: IncompleteCoverageRow[],
  bookings: CoverageBookingRow[],
  now = new Date(),
): Promise<{ updated: number; error: string | null }> {
  const candidates = coverageRows.filter(
    (c) =>
      !c.data_complete &&
      !c.admin_override &&
      isOnOrAfterFirstDayOfFollowingMonth(
        c.coverage_year,
        c.coverage_month,
        now,
      ),
  );

  if (candidates.length === 0) {
    return { updated: 0, error: null };
  }

  const updates: Record<string, unknown>[] = [];
  for (const row of candidates) {
    const complete = computeDataCompleteForMonth(
      row.property_id,
      row.coverage_year,
      row.coverage_month,
      bookings,
      now,
      now,
    );
    if (!complete) continue;
    updates.push({
      property_id: row.property_id,
      pm_id: row.pm_id,
      coverage_year: row.coverage_year,
      coverage_month: row.coverage_month,
      data_complete: true,
      updated_at: now.toISOString(),
    });
  }

  if (updates.length === 0) {
    return { updated: 0, error: null };
  }

  const chunkSize = 100;
  for (let i = 0; i < updates.length; i += chunkSize) {
    const slice = updates.slice(i, i + chunkSize);
    const { error } = await supabase.from("property_coverage_months").upsert(slice, {
      onConflict: "property_id,pm_id,coverage_year,coverage_month",
    });
    if (error) {
      console.error("[coverage re-eval] upsert failed:", error);
      return { updated: 0, error: error.message };
    }
  }

  return { updated: updates.length, error: null };
}
