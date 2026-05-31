export type CalendarMonth = { year: number; month: number };

export type BookingRow = {
  property_id: string | null;
  block_type: string | null;
  gross_revenue: number | string | null;
  check_in: string | null;
  check_out: string | null;
  status: string | null;
  is_planned_owner_stay: boolean | null;
};

export type PeriodStats = {
  revpar: number | null;
  grossRevenue: number;
  occ: number | null;
  avgNightly: number | null;
  guestBookings: number;
  ownerStays: number;
};

const GUEST_BLOCK_TYPES = new Set(["guest_ota", "guest_pm_direct"]);

function reducesAvailableDenominator(
  book: BookingRow,
  blockTypeNormalized: string,
): boolean {
  const bt = blockTypeNormalized.toLowerCase();
  if (bt === "owner_guest" || bt === "maintenance") return true;
  if (bt !== "owner_stay") return false;
  return book.is_planned_owner_stay !== false;
}

function daysInCalendarMonth(year: number, month1Based: number): number {
  return new Date(year, month1Based, 0).getDate();
}

function parseDateMidday(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const x = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso).trim());
  if (!x) return null;
  const y = Number(x[1]);
  const m = Number(x[2]);
  const d = Number(x[3]);
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== m - 1 ||
    dt.getDate() !== d
  ) {
    return null;
  }
  return dt;
}

function nightsIntersectCalendarMonthHalfOpenStay(
  checkInIso: string | null,
  checkOutIso: string | null,
  year: number,
  month: number,
): number {
  const ci = parseDateMidday(checkInIso);
  const co = parseDateMidday(checkOutIso);
  const first = new Date(year, month - 1, 1, 12, 0, 0);
  const monthEndExclusive = new Date(year, month, 1, 12, 0, 0);
  if (!ci || !co || !(co > ci)) return 0;
  if (!(ci.getTime() < monthEndExclusive.getTime() && co.getTime() > first.getTime())) {
    return 0;
  }
  const overlapStart =
    ci.getTime() > first.getTime()
      ? new Date(ci.getFullYear(), ci.getMonth(), ci.getDate(), 12)
      : first;
  const overlapEndExclusive =
    co.getTime() < monthEndExclusive.getTime() ? co : monthEndExclusive;
  if (!(overlapEndExclusive > overlapStart)) return 0;
  return Math.round(
    (overlapEndExclusive.getTime() - overlapStart.getTime()) / 86400000,
  );
}

function totalHalfOpenStayNights(
  checkInIso: string | null,
  checkOutIso: string | null,
): number {
  const ci = parseDateMidday(checkInIso);
  const co = parseDateMidday(checkOutIso);
  if (!ci || !co || !(co > ci)) return 0;
  return Math.round((co.getTime() - ci.getTime()) / 86400000);
}

function checkInStrictlyBeforeToday(
  checkInIso: string | null,
  now = new Date(),
): boolean {
  const ci = parseDateMidday(checkInIso);
  if (!ci) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  return ci.getTime() < today.getTime();
}

export function computePeriodStats(
  bookings: BookingRow[],
  months: CalendarMonth[],
): PeriodStats {
  let grossRevenue = 0;
  let guestBookedNights = 0;
  let availableNights = 0;
  const guestBookingKeys = new Set<string>();
  const ownerStayKeys = new Set<string>();

  const byProperty = new Map<string, BookingRow[]>();
  for (const b of bookings) {
    const pid = String(b.property_id ?? "").trim() || "__unknown__";
    const list = byProperty.get(pid) ?? [];
    list.push(b);
    byProperty.set(pid, list);
  }

  for (const ym of months) {
    const dim = daysInCalendarMonth(ym.year, ym.month);
    const availReductionByProperty = new Map<string, number>();

    for (const b of bookings) {
      if (String(b.status ?? "").toLowerCase() === "cancelled") continue;
      const bt = String(b.block_type ?? "").trim();
      const overlapDays = nightsIntersectCalendarMonthHalfOpenStay(
        b.check_in,
        b.check_out,
        ym.year,
        ym.month,
      );
      if (overlapDays <= 0) continue;

      const pid = String(b.property_id ?? "").trim() || "__unknown__";

      if (GUEST_BLOCK_TYPES.has(bt)) {
        if (!checkInStrictlyBeforeToday(b.check_in)) continue;
        const totalNights = totalHalfOpenStayNights(b.check_in, b.check_out);
        if (totalNights <= 0) continue;
        const gross = Number(b.gross_revenue != null ? b.gross_revenue : NaN) || 0;
        guestBookedNights += overlapDays;
        grossRevenue += (gross * overlapDays) / totalNights;
        guestBookingKeys.add(
          `${b.property_id}:${b.check_in}:${b.check_out}:${bt}`,
        );
      }

      if (reducesAvailableDenominator(b, bt)) {
        const cur = availReductionByProperty.get(pid) ?? 0;
        availReductionByProperty.set(pid, cur + overlapDays);
      }

      const btLower = bt.toLowerCase();
      if (btLower === "owner_stay" || btLower === "owner_guest") {
        ownerStayKeys.add(
          `${b.property_id}:${b.check_in}:${b.check_out}:${btLower}`,
        );
      }
    }

    // Each property gets its own calendar month; never apply one property's
    // owner/maintenance blocks to another property's available-nights denominator.
    for (const pid of byProperty.keys()) {
      const availReduction = Math.max(availReductionByProperty.get(pid) ?? 0, 0);
      availableNights += Math.max(0, dim - Math.min(availReduction, dim));
    }
  }

  return {
    revpar: availableNights > 0 ? grossRevenue / availableNights : null,
    grossRevenue,
    occ:
      availableNights > 0 ? guestBookedNights / availableNights : null,
    avgNightly: guestBookedNights > 0 ? grossRevenue / guestBookedNights : null,
    guestBookings: guestBookingKeys.size,
    ownerStays: ownerStayKeys.size,
  };
}

export function pctDelta(current: number | null, prior: number | null): number | null {
  if (current == null || prior == null || prior === 0) return null;
  return ((current - prior) / prior) * 100;
}
