import type { SupabaseClient } from "@supabase/supabase-js";

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
  benchmarkRevPAR: number | null;
  guestBookings: number;
  ownerStays: number;
};

type CoverageRow = {
  property_id: string;
  coverage_year: number;
  coverage_month: number;
  data_complete: boolean;
  admin_override?: boolean;
};

type BenchmarkRow = {
  market_id: string;
  year: number;
  week_number: number;
  benchmark_revpar: number | string | null;
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

/** ISO week Monday from year + week_number (matches Postgres IYYY-IW). */
function isoWeekMonday(isoWeekYear: number, isoWeek: number): Date {
  const jan4 = new Date(isoWeekYear, 0, 4, 12, 0, 0);
  const dow = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - dow);
  const monday = new Date(week1Monday);
  monday.setDate(week1Monday.getDate() + (Math.min(53, Math.max(1, isoWeek)) - 1) * 7);
  monday.setHours(12, 0, 0, 0);
  return monday;
}

function periodBoundsExclusive(months: CalendarMonth[]): {
  start: Date;
  endExclusive: Date;
} | null {
  if (months.length === 0) return null;
  const sorted = [...months].sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month,
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const start = new Date(first.year, first.month - 1, 1, 12, 0, 0);
  const endExclusive = new Date(last.year, last.month, 1, 12, 0, 0);
  return { start, endExclusive };
}

function overlapDaysWeekAndPeriod(
  weekStart: Date,
  periodStart: Date,
  periodEndExclusive: Date,
): number {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  weekEnd.setHours(12, 0, 0, 0);
  if (!(weekStart.getTime() < periodEndExclusive.getTime() && weekEnd.getTime() > periodStart.getTime())) {
    return 0;
  }
  const overlapStart = new Date(
    Math.max(weekStart.getTime(), periodStart.getTime()),
  );
  const overlapEnd = new Date(
    Math.min(weekEnd.getTime(), periodEndExclusive.getTime()),
  );
  if (!(overlapEnd > overlapStart)) return 0;
  return Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 86400000);
}

function isCoverageCompleteForWeek(
  propertyId: string,
  weekStartMonday: Date,
  coverageRows: CoverageRow[],
): boolean {
  const y = weekStartMonday.getFullYear();
  const m = weekStartMonday.getMonth() + 1;
  return coverageRows.some(
    (c) =>
      c.property_id === propertyId &&
      Number(c.coverage_year) === y &&
      Number(c.coverage_month) === m &&
      (c.data_complete || c.admin_override),
  );
}

function weightedBenchmarkRevparForProperty(
  propertyId: string,
  marketId: string,
  periodStart: Date,
  periodEndExclusive: Date,
  benchmarkRows: BenchmarkRow[],
  coverageRows: CoverageRow[],
): number | null {
  let weightedSum = 0;
  let totalDays = 0;

  for (const row of benchmarkRows) {
    if (row.market_id !== marketId) continue;
    if (row.year == null || row.week_number == null) continue;
    const revpar = Number(row.benchmark_revpar);
    if (!Number.isFinite(revpar)) continue;

    const weekStart = isoWeekMonday(Number(row.year), Number(row.week_number));
    const overlapDays = overlapDaysWeekAndPeriod(
      weekStart,
      periodStart,
      periodEndExclusive,
    );
    if (overlapDays <= 0) continue;
    if (!isCoverageCompleteForWeek(propertyId, weekStart, coverageRows)) {
      continue;
    }

    weightedSum += revpar * overlapDays;
    totalDays += overlapDays;
  }

  return totalDays > 0 ? weightedSum / totalDays : null;
}

async function resolvePropertyMarkets(
  supabase: SupabaseClient,
  propertyIds: string[],
  fallbackMarketId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (propertyIds.length === 0) return map;

  const { data, error } = await supabase
    .from("properties")
    .select("id, market_id")
    .in("id", propertyIds);

  if (error) {
    console.error("[period-stats] properties market_id", error.message);
    for (const id of propertyIds) {
      if (fallbackMarketId) map.set(id, fallbackMarketId);
    }
    return map;
  }

  for (const row of data ?? []) {
    const id = String(row.id ?? "").trim();
    const mid = String(row.market_id ?? "").trim() || fallbackMarketId;
    if (id && mid) map.set(id, mid);
  }

  for (const id of propertyIds) {
    if (!map.has(id) && fallbackMarketId) map.set(id, fallbackMarketId);
  }

  return map;
}

async function fetchBenchmarkRowsByMarkets(
  supabase: SupabaseClient,
  marketIds: string[],
): Promise<BenchmarkRow[]> {
  if (marketIds.length === 0) return [];

  const { data, error } = await supabase
    .from("market_benchmarks")
    .select("market_id, year, week_number, benchmark_revpar")
    .in("market_id", marketIds)
    .eq("source", "airdna_api");

  if (error) {
    console.error("[period-stats] market_benchmarks", error.message);
    return [];
  }

  return (data ?? []) as BenchmarkRow[];
}

async function fetchCoverageForProperties(
  supabase: SupabaseClient,
  propertyIds: string[],
): Promise<CoverageRow[]> {
  if (propertyIds.length === 0) return [];

  const { data, error } = await supabase
    .from("property_coverage_months")
    .select(
      "property_id, coverage_year, coverage_month, data_complete, admin_override",
    )
    .in("property_id", propertyIds);

  if (error) {
    console.error("[period-stats] property_coverage_months", error.message);
    return [];
  }

  return (data ?? []) as CoverageRow[];
}

async function computeBenchmarkRevPAR(
  supabase: SupabaseClient,
  months: CalendarMonth[],
  marketId: string,
  propertyIds: string[],
  availableNightsByProperty: Map<string, number>,
): Promise<number | null> {
  const bounds = periodBoundsExclusive(months);
  if (!bounds || propertyIds.length === 0) return null;

  const propertyMarkets = await resolvePropertyMarkets(
    supabase,
    propertyIds,
    marketId,
  );
  const marketIds = [
    ...new Set([...propertyMarkets.values()].filter(Boolean)),
  ];
  if (marketIds.length === 0) return null;

  const [benchmarkRows, coverageRows] = await Promise.all([
    fetchBenchmarkRowsByMarkets(supabase, marketIds),
    fetchCoverageForProperties(supabase, propertyIds),
  ]);

  let blendWeighted = 0;
  let blendAvail = 0;

  for (const propertyId of propertyIds) {
    const propMarket = propertyMarkets.get(propertyId);
    if (!propMarket) continue;

    const propBenchmark = weightedBenchmarkRevparForProperty(
      propertyId,
      propMarket,
      bounds.start,
      bounds.endExclusive,
      benchmarkRows,
      coverageRows,
    );
    const avail = availableNightsByProperty.get(propertyId) ?? 0;

    if (propBenchmark != null && avail > 0) {
      blendWeighted += propBenchmark * avail;
      blendAvail += avail;
    }
  }

  if (blendAvail > 0) return blendWeighted / blendAvail;

  if (propertyIds.length === 1) {
    const pid = propertyIds[0];
    const propMarket = propertyMarkets.get(pid);
    if (!propMarket) return null;
    return weightedBenchmarkRevparForProperty(
      pid,
      propMarket,
      bounds.start,
      bounds.endExclusive,
      benchmarkRows,
      coverageRows,
    );
  }

  return null;
}

export async function computePeriodStats(
  bookings: BookingRow[],
  months: CalendarMonth[],
  supabase: SupabaseClient,
  marketId: string,
  propertyIds: string[],
): Promise<PeriodStats> {
  let grossRevenue = 0;
  let guestBookedNights = 0;
  let availableNights = 0;
  const guestBookingKeys = new Set<string>();
  const ownerStayKeys = new Set<string>();
  const availableNightsByProperty = new Map<string, number>();

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

    for (const pid of byProperty.keys()) {
      const availReduction = Math.max(
        availReductionByProperty.get(pid) ?? 0,
        0,
      );
      const monthAvail = Math.max(0, dim - Math.min(availReduction, dim));
      availableNights += monthAvail;
      availableNightsByProperty.set(
        pid,
        (availableNightsByProperty.get(pid) ?? 0) + monthAvail,
      );
    }
  }

  const benchmarkRevPAR = await computeBenchmarkRevPAR(
    supabase,
    months,
    marketId,
    propertyIds,
    availableNightsByProperty,
  );

  return {
    revpar: availableNights > 0 ? grossRevenue / availableNights : null,
    grossRevenue,
    occ:
      availableNights > 0 ? guestBookedNights / availableNights : null,
    avgNightly: guestBookedNights > 0 ? grossRevenue / guestBookedNights : null,
    benchmarkRevPAR,
    guestBookings: guestBookingKeys.size,
    ownerStays: ownerStayKeys.size,
  };
}

export function pctDelta(current: number | null, prior: number | null): number | null {
  if (current == null || prior == null || prior === 0) return null;
  return ((current - prior) / prior) * 100;
}
