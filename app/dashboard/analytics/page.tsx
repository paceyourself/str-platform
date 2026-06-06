"use client";

/**
 * Owner analytics KPI block (Phase 1).
 *
 * STR_Analytics_Framework_Spec_Current.docx (v1.2) — not present in this repo.
 * Implemented from sprint ticket rules + shared dashboard KPI conventions.
 */

import Link from "next/link";
import { PerformanceSummaryCards } from "@/components/performance-summary-cards";
import {
  coverageHoles,
  formatMonthHeading as formatCoverageMonthHeading,
  reEvaluateIncompleteCoverageMonths,
  staleIncompleteCoverageMonths,
  type CoverageBookingRow,
} from "@/lib/coverage-completeness";
import { createClient } from "@/lib/supabase";
import { computePeriodStats, pctDelta, type PeriodStats } from "@/lib/period-stats";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
} from "recharts";

type PropertyRow = {
  id: string;
  property_name: string | null;
  address_line1: string | null;
  market_id: string | null;
};

type BookingRow = {
  property_id: string | null;
  block_type: string | null;
  gross_revenue: number | string | null;
  check_in: string | null;
  check_out: string | null;
  status: string | null;
  /** Planned owner stays reduce denominator; explicit false (last-minute) does not. */
  is_planned_owner_stay: boolean | null;
};

type PmRelRow = {
  property_id: string;
  pm_id: string;
  start_date: string | null;
};

type CoverageRow = {
  property_id: string;
  pm_id: string;
  coverage_year: number;
  coverage_month: number;
  data_complete: boolean;
  admin_override: boolean;
};

type BenchmarkRow = {
  year: number;
  week_number: number;
  benchmark_revpar: number | string | null;
  benchmark_adr: number | string | null;
  benchmark_occ: number | string | null;
};

type PeriodMode = "cytd" | "ltm" | "lfy";

type CalendarMonth = { year: number; month: number };

const GUEST_BLOCK_TYPES = new Set(["guest_ota", "guest_pm_direct"]);

/** Spec: subtract owner_guest + maintenance always; subtract owner_stay only when planned. */
function reducesAvailableDenominator(book: BookingRow, blockTypeNormalized: string): boolean {
  const bt = blockTypeNormalized.toLowerCase();
  if (bt === "owner_guest" || bt === "maintenance") return true;
  if (bt !== "owner_stay") return false;
  /* Treat null/undefined as planned (backward compat until row is explicit). */
  return book.is_planned_owner_stay !== false;
}

const PERIOD_TOGGLE_DEF: Record<
  PeriodMode,
  { label: string; shortLabel: string }
> = {
  cytd: { label: "CYTD vs PYTD", shortLabel: "CYTD" },
  ltm: { label: "LTM vs PLTM", shortLabel: "LTM" },
  lfy: { label: "LFY vs PLFY", shortLabel: "LFY" },
};

function monthKey(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}

function formatMonthHeading(y: number, m: number): string {
  return new Date(y, m - 1, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function daysInCalendarMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function lastCompletedCalendarMonth(now = new Date()): CalendarMonth {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function ymToMonthIndex(y: number, m: number): number {
  return y * 12 + m - 1;
}

function shiftMonths(y: number, m: number, delta: number): CalendarMonth {
  const idx = ymToMonthIndex(y, m) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/** First / last inclusive calendar dates for a calendar month */
function boundsOfCalendarMonth(
  year: number,
  month: number,
): { first: Date; last: Date } {
  const first = new Date(year, month - 1, 1, 12, 0, 0);
  const dim = daysInCalendarMonth(year, month);
  const last = new Date(year, month - 1, dim, 12, 0, 0);
  return { first, last };
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
  const { first } = boundsOfCalendarMonth(year, month);
  const monthEndExclusive = new Date(year, month, 1, 12, 0, 0);
  if (!ci || !co) return 0;
  if (!(co > ci)) return 0;
  /* Spec §3.7: check_in < month_end AND check_out > month_start (half-open stay). */
  if (!(ci.getTime() < monthEndExclusive.getTime() && co.getTime() > first.getTime())) {
    return 0;
  }
  /* overlap_days = LEAST(check_out, month_end) − GREATEST(check_in, month_start) */
  const overlapStart =
    ci.getTime() > first.getTime()
      ? new Date(ci.getFullYear(), ci.getMonth(), ci.getDate(), 12)
      : first;
  const overlapEndExclusive =
    co.getTime() < monthEndExclusive.getTime() ? co : monthEndExclusive;
  if (!(overlapEndExclusive > overlapStart)) return 0;
  return Math.round((overlapEndExclusive.getTime() - overlapStart.getTime()) / 86400000);
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

/** Closed-period analytics exclude guest rows with check_in on or after today. */
function checkInStrictlyBeforeToday(
  checkInIso: string | null,
  now = new Date(),
): boolean {
  const ci = parseDateMidday(checkInIso);
  if (!ci) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  return ci.getTime() < today.getTime();
}

function isoWeekMonday(isoWeekYear: number, isoWeek: number): Date {
  const jan4 = new Date(isoWeekYear, 0, 4, 12, 0, 0);
  const dow = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - dow);
  const monday = new Date(week1Monday);
  monday.setDate(week1Monday.getDate() + (isoWeek - 1) * 7);
  monday.setHours(12);
  return monday;
}

function overlapDaysBetweenIsoWeekAndMonth(
  isoWeekYear: number,
  isoWeek: number,
  monthYear: number,
  monthMonth: number,
): number {
  const { first, last } = boundsOfCalendarMonth(monthYear, monthMonth);
  const monday = isoWeekMonday(isoWeekYear, isoWeek);
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    d.setHours(12);
    if (d.getTime() >= first.getTime() && d.getTime() <= last.getTime()) n += 1;
  }
  return n;
}

function sumBenchmarkMonthlyForMarket(
  rows: BenchmarkRow[],
  ym: CalendarMonth,
): {
  benchmark_revpar: number | null;
  benchmark_adr: number | null;
  benchmark_occ: number | null;
} {
  let rWeighted = 0;
  let aWeighted = 0;
  let oWeighted = 0;
  let rDays = 0;
  let aDays = 0;
  let oDays = 0;

  for (const bw of rows) {
    const d = overlapDaysBetweenIsoWeekAndMonth(
      Number(bw.year),
      Number(bw.week_number),
      ym.year,
      ym.month,
    );
    if (d < 4) continue;

    const rr =
      bw.benchmark_revpar != null ? Number(bw.benchmark_revpar) : Number.NaN;
    const aa = bw.benchmark_adr != null ? Number(bw.benchmark_adr) : Number.NaN;
    const oo = bw.benchmark_occ != null ? Number(bw.benchmark_occ) : Number.NaN;

    if (Number.isFinite(rr)) {
      rWeighted += rr * d;
      rDays += d;
    }
    if (Number.isFinite(aa)) {
      aWeighted += aa * d;
      aDays += d;
    }
    if (Number.isFinite(oo)) {
      oWeighted += oo * d;
      oDays += d;
    }
  }

  return {
    benchmark_revpar: rDays > 0 ? rWeighted / rDays : null,
    benchmark_adr: aDays > 0 ? aWeighted / aDays : null,
    benchmark_occ: oDays > 0 ? oWeighted / oDays : null,
  };
}

function buildCytdWindows(
  lcm: CalendarMonth,
  now = new Date(),
): { current: CalendarMonth[]; prior: CalendarMonth[] } {
  const currentYear = now.getFullYear();
  if (lcm.year !== currentYear || lcm.month < 1) {
    return { current: [], prior: [] };
  }
  const current: CalendarMonth[] = [];
  for (let m = 1; m <= lcm.month; m++) {
    current.push({ year: currentYear, month: m });
  }
  const prior = current.map(({ month }) => ({
    year: currentYear - 1,
    month,
  }));
  return { current, prior };
}

function rollingTwelveEnding(lcm: CalendarMonth): CalendarMonth[] {
  const out: CalendarMonth[] = [];
  let y = lcm.year;
  let m = lcm.month;
  for (let i = 0; i < 12; i++) {
    out.push({ year: y, month: m });
    const prev = shiftMonths(y, m, -1);
    y = prev.year;
    m = prev.month;
  }
  return out.reverse();
}

function precedingRollingTwelve(beforeMonth: CalendarMonth): CalendarMonth[] {
  const anchor = shiftMonths(beforeMonth.year, beforeMonth.month, -12);
  return rollingTwelveEnding(anchor);
}

function buildLtmWindows(lcm: CalendarMonth): {
  current: CalendarMonth[];
  prior: CalendarMonth[];
} {
  const current = rollingTwelveEnding(lcm);
  const priorStartMinus = shiftMonths(current[0].year, current[0].month, -1);
  const prior = rollingTwelveEnding(priorStartMinus);
  return { current, prior };
}

function fiscalYearMonths(fullYear: number): CalendarMonth[] {
  const m: CalendarMonth[] = [];
  for (let mo = 1; mo <= 12; mo++) m.push({ year: fullYear, month: mo });
  return m;
}

type MonthMetrics = {
  ymKey: string;
  labelShort: string;
  monthLabel: string;
  grossRevenue: number;
  availableNights: number;
  guestBookedNights: number;
  revparProp: number | null;
  occPct: number | null;
  adrProp: number | null;
  benchmark_revpar: number | null;
  benchmark_adr: number | null;
  benchmark_occ: number | null;
  indexValue: number | null;
};

type ViewLevel = "portfolio" | "market" | "pm" | "property";

function formatMarketLabel(marketId: string, name?: string | null): string {
  const n = (name ?? "").trim();
  if (n) return n;
  return marketId.toUpperCase();
}

function buildCoverageMap(rows: CoverageRow[]): Map<string, CoverageRow> {
  const m = new Map<string, CoverageRow>();
  for (const c of rows) {
    m.set(monthKey(Number(c.coverage_year), Number(c.coverage_month)), c);
  }
  return m;
}

function propertyPeriodComplete(
  propertyId: string,
  pmId: string,
  months: CalendarMonth[],
  allCoverage: CoverageRow[],
): boolean {
  const rows = allCoverage.filter(
    (c) => c.property_id === propertyId && c.pm_id === pmId,
  );
  return coverageHoles(buildCoverageMap(rows), months).length === 0;
}

function computePropertyMonthMetrics(
  bookingsForProperty: BookingRow[],
  months: CalendarMonth[],
  benchmarkRows: BenchmarkRow[],
): MonthMetrics[] {
  const series: Record<
    string,
    {
      guestRevenue: number;
      guestBookedNights: number;
      availDenominatorReduction: number;
    }
  > = {};

  for (const ym of months) {
    const k = monthKey(ym.year, ym.month);
    series[k] = {
      guestRevenue: 0,
      guestBookedNights: 0,
      availDenominatorReduction: 0,
    };

    for (const b of bookingsForProperty) {
      const bt = String(b.block_type ?? "").trim();
      const overlapDays = nightsIntersectCalendarMonthHalfOpenStay(
        b.check_in,
        b.check_out,
        ym.year,
        ym.month,
      );
      if (overlapDays <= 0) continue;

      if (GUEST_BLOCK_TYPES.has(bt)) {
        if (!checkInStrictlyBeforeToday(b.check_in)) continue;
        const totalNights = totalHalfOpenStayNights(b.check_in, b.check_out);
        if (totalNights <= 0) continue;
        const gross =
          Number(b.gross_revenue != null ? b.gross_revenue : NaN) || 0;
        series[k].guestBookedNights += overlapDays;
        series[k].guestRevenue += (gross * overlapDays) / totalNights;
      }
      if (reducesAvailableDenominator(b, bt)) {
        series[k].availDenominatorReduction += overlapDays;
      }
    }
  }

  for (const ym of months) {
    const k = monthKey(ym.year, ym.month);
    const dim = daysInCalendarMonth(ym.year, ym.month);
    series[k].availDenominatorReduction = Math.min(
      series[k].availDenominatorReduction,
      dim,
    );
  }

  return months.map((ym) => {
    const k = monthKey(ym.year, ym.month);
    const dim = daysInCalendarMonth(ym.year, ym.month);
    const g = series[k];
    const availableNights = Math.max(dim - g.availDenominatorReduction, 0);
    const revparProp =
      availableNights > 0 ? g.guestRevenue / availableNights : null;
    const occPct =
      availableNights > 0
        ? (g.guestBookedNights / availableNights) * 100
        : null;
    const adr =
      g.guestBookedNights > 0 ? g.guestRevenue / g.guestBookedNights : null;
    const bm = sumBenchmarkMonthlyForMarket(benchmarkRows, ym);

    const br = bm.benchmark_revpar;
    const idx =
      br !== null && br > 0 && revparProp != null
        ? (revparProp / br) * 100
        : null;

    return {
      ymKey: k,
      labelShort: `${ym.year}-${String(ym.month).padStart(2, "0")}`,
      monthLabel: `${String(ym.month).padStart(2, "0")}/${String(ym.year).slice(-2)}`,
      grossRevenue: g.guestRevenue,
      availableNights,
      guestBookedNights: g.guestBookedNights,
      revparProp,
      occPct,
      adrProp: adr,
      benchmark_revpar: bm.benchmark_revpar,
      benchmark_adr: bm.benchmark_adr,
      benchmark_occ: bm.benchmark_occ,
      indexValue: idx,
    };
  });
}

function aggregateMonthMetrics(
  entries: { propertyId: string; marketId: string; metrics: MonthMetrics[] }[],
  months: CalendarMonth[],
  benchmarkByMarket: Map<string, BenchmarkRow[]>,
  level: ViewLevel,
  singleMarketId?: string,
): MonthMetrics[] {
  return months.map((ym, idx) => {
    const k = monthKey(ym.year, ym.month);
    let grossRevenue = 0;
    let availableNights = 0;
    let guestBookedNights = 0;

    const availByMarket = new Map<string, number>();

    for (const entry of entries) {
      const row = entry.metrics[idx];
      if (!row) continue;
      grossRevenue += row.grossRevenue;
      availableNights += row.availableNights;
      guestBookedNights += row.guestBookedNights;
      availByMarket.set(
        entry.marketId,
        (availByMarket.get(entry.marketId) ?? 0) + row.availableNights,
      );
    }

    const revparProp =
      availableNights > 0 ? grossRevenue / availableNights : null;
    const occPct =
      availableNights > 0
        ? (guestBookedNights / availableNights) * 100
        : null;
    const adrProp =
      guestBookedNights > 0 ? grossRevenue / guestBookedNights : null;

    let benchmark_revpar: number | null = null;
    let benchmark_adr: number | null = null;
    let benchmark_occ: number | null = null;

    if (level === "portfolio") {
      let rWeighted = 0;
      let rDays = 0;
      let aWeighted = 0;
      let aDays = 0;
      let oWeighted = 0;
      let oDays = 0;
      for (const [mid, avail] of availByMarket) {
        if (avail <= 0) continue;
        const bm = sumBenchmarkMonthlyForMarket(
          benchmarkByMarket.get(mid) ?? [],
          ym,
        );
        if (bm.benchmark_revpar != null) {
          rWeighted += bm.benchmark_revpar * avail;
          rDays += avail;
        }
        if (bm.benchmark_adr != null) {
          aWeighted += bm.benchmark_adr * avail;
          aDays += avail;
        }
        if (bm.benchmark_occ != null) {
          oWeighted += bm.benchmark_occ * avail;
          oDays += avail;
        }
      }
      benchmark_revpar = rDays > 0 ? rWeighted / rDays : null;
      benchmark_adr = aDays > 0 ? aWeighted / aDays : null;
      benchmark_occ = oDays > 0 ? oWeighted / oDays : null;
    } else {
      const mid =
        singleMarketId ?? entries[0]?.marketId ?? "";
      const bm = sumBenchmarkMonthlyForMarket(
        benchmarkByMarket.get(mid) ?? [],
        ym,
      );
      benchmark_revpar = bm.benchmark_revpar;
      benchmark_adr = bm.benchmark_adr;
      benchmark_occ = bm.benchmark_occ;
    }

    const indexValue =
      benchmark_revpar != null &&
      benchmark_revpar > 0 &&
      revparProp != null
        ? (revparProp / benchmark_revpar) * 100
        : null;

    return {
      ymKey: k,
      labelShort: `${ym.year}-${String(ym.month).padStart(2, "0")}`,
      monthLabel: `${String(ym.month).padStart(2, "0")}/${String(ym.year).slice(-2)}`,
      grossRevenue,
      availableNights,
      guestBookedNights,
      revparProp,
      occPct,
      adrProp,
      benchmark_revpar,
      benchmark_adr,
      benchmark_occ,
      indexValue,
    };
  });
}

type KpiTab = "revenue" | "revpar" | "occ" | "adr" | "index";

export default function AnalyticsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [propsLoading, setPropsLoading] = useState(true);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [viewLevel, setViewLevel] = useState<ViewLevel>("portfolio");
  const [selectedMarketId, setSelectedMarketId] = useState("");
  const [selectedPmIdView, setSelectedPmIdView] = useState("");
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [covLoading, setCovLoading] = useState(false);
  const [coverage, setCoverage] = useState<CoverageRow[]>([]);
  const [benchmarkByMarket, setBenchmarkByMarket] = useState<
    Map<string, BenchmarkRow[]>
  >(() => new Map());
  const [marketLabels, setMarketLabels] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [pmLabels, setPmLabels] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [pmByProperty, setPmByProperty] = useState<Map<string, string>>(
    () => new Map(),
  );

  const [periodMode, setPeriodMode] = useState<PeriodMode>("cytd");
  const [activeKpiTab, setActiveKpiTab] = useState<KpiTab>("revenue");
  const periodDefaultedRef = useRef(false);


  const loadPropertiesChain = useCallback(async () => {
    setPropsLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPropsLoading(false);
      return;
    }
    const [{ data: propData, error: pe }, { data: relData, error: re }] =
      await Promise.all([
        supabase
          .from("properties")
          .select("id, property_name, address_line1, market_id")
          .eq("owner_id", user.id)
          .order("property_name", { ascending: true, nullsFirst: false })
          .order("address_line1", { ascending: true, nullsFirst: false }),
        supabase
          .from("owner_pm_relationships")
          .select("property_id, pm_id, start_date")
          .eq("owner_id", user.id)
          .eq("active", true),
      ]);

    setPropsLoading(false);

    const pmMap = new Map<string, string>();
    const relSorted = [...(relData ?? [])].sort((a: PmRelRow, b: PmRelRow) =>
      String(b.start_date ?? "").localeCompare(String(a.start_date ?? "")),
    );
    for (const r of relSorted) {
      const pid = String((r as PmRelRow).property_id ?? "");
      if (!pid || pmMap.has(pid)) continue;
      pmMap.set(pid, String((r as PmRelRow).pm_id ?? ""));
    }
    setPmByProperty(pmMap);

    if (pe) {
      console.error(pe);
      setProperties([]);
      return;
    }
    const list = (propData ?? []) as PropertyRow[];
    setProperties(list);

    setSelectedPropertyId((cur) => {
      if (!list.length) return "";
      const keep = cur && list.some((p) => p.id === cur);
      return keep ? cur! : "";
    });

    if (re) console.error(re);
  }, [supabase]);

  useEffect(() => {
    loadPropertiesChain();
  }, [loadPropertiesChain]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!properties.length || !properties.some((p) => p.id)) {
        setBookings([]);
        return;
      }
      setBookingsLoading(true);
      const ids = properties.map((p) => p.id);
      const { data, error } = await supabase
        .from("bookings")
        .select(
          "property_id, block_type, gross_revenue, check_in, check_out, status, is_planned_owner_stay",
        )
        .in("property_id", ids);
      if (cancel) return;
      setBookingsLoading(false);
      if (error) {
        console.error(error);
        setBookings([]);
        return;
      }
      setBookings((data as BookingRow[]) ?? []);
    })();
    return () => {
      cancel = true;
    };
  }, [properties, supabase]);

  const scopedProperties = useMemo(() => {
    if (viewLevel === "portfolio") return properties;
    if (viewLevel === "market") {
      return properties.filter(
        (p) => (p.market_id ?? "").trim() === selectedMarketId,
      );
    }
    if (viewLevel === "pm") {
      return properties.filter(
        (p) =>
          (p.market_id ?? "").trim() === selectedMarketId &&
          pmByProperty.get(p.id) === selectedPmIdView,
      );
    }
    const p = properties.find((x) => x.id === selectedPropertyId);
    return p ? [p] : [];
  }, [
    properties,
    viewLevel,
    selectedMarketId,
    selectedPmIdView,
    selectedPropertyId,
    pmByProperty,
  ]);

  const hierarchyMarkets = useMemo(() => {
    const ids = [
      ...new Set(
        properties.map((p) => (p.market_id ?? "").trim()).filter(Boolean),
      ),
    ].sort();
    return ids.map((id) => ({
      id,
      label: formatMarketLabel(id, marketLabels.get(id)),
    }));
  }, [properties, marketLabels]);

  const hierarchyPmsForMarket = useMemo(() => {
    if (!selectedMarketId) return [];
    const pmIds = [
      ...new Set(
        properties
          .filter((p) => (p.market_id ?? "").trim() === selectedMarketId)
          .map((p) => pmByProperty.get(p.id))
          .filter(Boolean) as string[],
      ),
    ].sort((a, b) =>
      (pmLabels.get(a) ?? a).localeCompare(pmLabels.get(b) ?? b),
    );
    return pmIds.map((id) => ({
      id,
      label: pmLabels.get(id) ?? id.slice(0, 8),
    }));
  }, [properties, selectedMarketId, pmByProperty, pmLabels]);

  const hierarchyPropertiesForPm = useMemo(() => {
    if (!selectedMarketId || !selectedPmIdView) return [];
    return properties.filter(
      (p) =>
        (p.market_id ?? "").trim() === selectedMarketId &&
        pmByProperty.get(p.id) === selectedPmIdView,
    );
  }, [properties, selectedMarketId, selectedPmIdView, pmByProperty]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!properties.length) {
        setCoverage([]);
        setBenchmarkByMarket(new Map());
        setMarketLabels(new Map());
        setPmLabels(new Map());
        return;
      }
      const propertyIds = properties.map((p) => p.id);
      const marketIds = [
        ...new Set(
          properties.map((p) => (p.market_id ?? "").trim()).filter(Boolean),
        ),
      ];
      const pmIds = [
        ...new Set(
          [...pmByProperty.values()].filter(Boolean),
        ),
      ];

      setCovLoading(true);
      const [covRes, bookResForCov, bmRes, marketRes, pmRes] = await Promise.all([
        supabase
          .from("property_coverage_months")
          .select(
            "property_id, pm_id, coverage_year, coverage_month, data_complete, admin_override",
          )
          .in("property_id", propertyIds),
        supabase
          .from("bookings")
          .select("property_id, check_in, check_out, status")
          .in("property_id", propertyIds),
        marketIds.length
          ? supabase
              .from("market_benchmarks")
              .select(
                "market_id, year, week_number, benchmark_revpar, benchmark_adr, benchmark_occ",
              )
              .in("market_id", marketIds)
              .eq("source", "airdna_api")
              .eq("granularity", "monthly_prorated")
          : Promise.resolve({ data: [], error: null }),
        marketIds.length
          ? supabase.from("markets").select("id, name").in("id", marketIds)
          : Promise.resolve({ data: [], error: null }),
        pmIds.length
          ? supabase
              .from("pm_profiles")
              .select("id, company_name")
              .in("id", pmIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (cancel) return;
      setCovLoading(false);

      if (covRes.error) {
        console.error(covRes.error);
        setCoverage([]);
      } else {
        let coverageRows = (covRes.data as CoverageRow[]) ?? [];
        const bookingRows = (bookResForCov.data ?? []) as CoverageBookingRow[];
        const { updated, error: reEvalErr } =
          await reEvaluateIncompleteCoverageMonths(
            supabase,
            coverageRows,
            bookingRows,
          );
        if (reEvalErr) {
          console.warn("[analytics] coverage re-eval:", reEvalErr);
        } else if (updated > 0) {
          const { data: refreshed, error: refreshErr } = await supabase
            .from("property_coverage_months")
            .select(
              "property_id, pm_id, coverage_year, coverage_month, data_complete, admin_override",
            )
            .in("property_id", propertyIds);
          if (refreshErr) {
            console.warn("[analytics] coverage refresh:", refreshErr);
          } else {
            coverageRows = (refreshed as CoverageRow[]) ?? coverageRows;
          }
        }
        setCoverage(coverageRows);
      }

      if (bmRes.error) {
        console.error(bmRes.error);
        setBenchmarkByMarket(new Map());
      } else {
        const bmMap = new Map<string, BenchmarkRow[]>();
        for (const row of (bmRes.data ?? []) as (BenchmarkRow & {
          market_id?: string;
        })[]) {
          const mid = String(row.market_id ?? "").trim();
          if (!mid) continue;
          const list = bmMap.get(mid) ?? [];
          list.push(row);
          bmMap.set(mid, list);
        }
        setBenchmarkByMarket(bmMap);
      }

      if (!marketRes.error && marketRes.data) {
        const ml = new Map<string, string>();
        for (const row of marketRes.data as { id: string; name?: string | null }[]) {
          ml.set(row.id, row.name ?? "");
        }
        setMarketLabels(ml);
      }

      if (!pmRes.error && pmRes.data) {
        const pl = new Map<string, string>();
        for (const row of pmRes.data as {
          id: string;
          company_name?: string | null;
        }[]) {
          pl.set(row.id, row.company_name ?? "");
        }
        setPmLabels(pl);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [properties, pmByProperty, supabase]);

  const lcm = useMemo(() => lastCompletedCalendarMonth(), []);

  const periodWindows = useMemo(() => {
    const cytd = buildCytdWindows(lcm);
    const lw = buildLtmWindows(lcm);
    const lfyCurr = fiscalYearMonths(lcm.year - 1);
    const lfyPrior = fiscalYearMonths(lcm.year - 2);
    return {
      cytd: { curr: cytd.current, prior: cytd.prior },
      ltm: { curr: lw.current, prior: lw.prior },
      lfy: { curr: lfyCurr, prior: lfyPrior },
    } as Record<PeriodMode, { curr: CalendarMonth[]; prior: CalendarMonth[] }>;
  }, [lcm]);

  const unionCoverageMap = useMemo(() => {
    const unionCovRows: CoverageRow[] = [];
    for (const p of scopedProperties) {
      const pmId = pmByProperty.get(p.id) ?? "";
      if (!pmId) continue;
      unionCovRows.push(
        ...coverage.filter(
          (c) => c.property_id === p.id && c.pm_id === pmId,
        ),
      );
    }
    return buildCoverageMap(unionCovRows);
  }, [scopedProperties, coverage, pmByProperty]);

  const staleCoverageMonths = useMemo(() => {
    if (viewLevel !== "portfolio") return [];
    return staleIncompleteCoverageMonths(
      coverage,
      properties.map((p) => p.id),
      pmByProperty,
    );
  }, [viewLevel, coverage, properties, pmByProperty]);

  const bookingsByProperty = useMemo(() => {
    const m = new Map<string, BookingRow[]>();
    for (const b of bookings) {
      if (String(b.status ?? "").toLowerCase() === "cancelled") continue;
      const pid = String(b.property_id ?? "");
      if (!pid) continue;
      const list = m.get(pid) ?? [];
      list.push(b);
      m.set(pid, list);
    }
    return m;
  }, [bookings]);

  const coverageInclusionByMode = useMemo(() => {
    type Rec = {
      currIncluded: number;
      priorIncluded: number;
      total: number;
      currInsufficient: number;
      incompleteMonthsCurr: CalendarMonth[];
      incompleteMonthsPrior: CalendarMonth[];
    };
    const out: Record<PeriodMode, Rec> = {
      cytd: {
        currIncluded: 0,
        priorIncluded: 0,
        total: 0,
        currInsufficient: 0,
        incompleteMonthsCurr: [],
        incompleteMonthsPrior: [],
      },
      ltm: {
        currIncluded: 0,
        priorIncluded: 0,
        total: 0,
        currInsufficient: 0,
        incompleteMonthsCurr: [],
        incompleteMonthsPrior: [],
      },
      lfy: {
        currIncluded: 0,
        priorIncluded: 0,
        total: 0,
        currInsufficient: 0,
        incompleteMonthsCurr: [],
        incompleteMonthsPrior: [],
      },
    };

    for (const mode of ["cytd", "ltm", "lfy"] as PeriodMode[]) {
      const { curr, prior } = periodWindows[mode];
      const total = scopedProperties.length;
      let currIncluded = 0;
      let priorIncluded = 0;

      for (const p of scopedProperties) {
        const pmId = pmByProperty.get(p.id) ?? "";
        if (!pmId) continue;
        if (propertyPeriodComplete(p.id, pmId, curr, coverage)) currIncluded++;
        if (propertyPeriodComplete(p.id, pmId, prior, coverage)) priorIncluded++;
      }

      const unionCovRows: CoverageRow[] = [];
      for (const p of scopedProperties) {
        const pmId = pmByProperty.get(p.id) ?? "";
        if (!pmId) continue;
        unionCovRows.push(
          ...coverage.filter(
            (c) => c.property_id === p.id && c.pm_id === pmId,
          ),
        );
      }
      const unionMap = buildCoverageMap(unionCovRows);

      out[mode] = {
        currIncluded,
        priorIncluded,
        total,
        currInsufficient: total - currIncluded,
        incompleteMonthsCurr: coverageHoles(unionMap, curr),
        incompleteMonthsPrior: coverageHoles(unionMap, prior),
      };
    }

    return out;
  }, [scopedProperties, coverage, periodWindows, pmByProperty]);

  const computeScopedMetrics = useCallback(
    (months: CalendarMonth[]) => {
      const entries: {
        propertyId: string;
        marketId: string;
        metrics: MonthMetrics[];
      }[] = [];

      for (const p of scopedProperties) {
        const pmId = pmByProperty.get(p.id) ?? "";
        if (!pmId) continue;
        if (!propertyPeriodComplete(p.id, pmId, months, coverage)) continue;

        const marketId = (p.market_id ?? "").trim();
        const propBookings = bookingsByProperty.get(p.id) ?? [];
        const bmRows = benchmarkByMarket.get(marketId) ?? [];
        const metrics = computePropertyMonthMetrics(
          propBookings,
          months,
          bmRows,
        );
        entries.push({ propertyId: p.id, marketId, metrics });
      }

      const included = entries.length;
      const total = scopedProperties.length;
      const insufficient = total - included;

      if (included === 0) {
        const empty = months.map((ym) => {
          const k = monthKey(ym.year, ym.month);
          return {
            ymKey: k,
            labelShort: `${ym.year}-${String(ym.month).padStart(2, "0")}`,
            monthLabel: `${String(ym.month).padStart(2, "0")}/${String(ym.year).slice(-2)}`,
            grossRevenue: 0,
            availableNights: 0,
            guestBookedNights: 0,
            revparProp: null,
            occPct: null,
            adrProp: null,
            benchmark_revpar: null,
            benchmark_adr: null,
            benchmark_occ: null,
            indexValue: null,
          };
        });
        return { series: empty, included, total, insufficient };
      }

      if (viewLevel === "property" && entries.length === 1) {
        return {
          series: entries[0].metrics,
          included,
          total,
          insufficient,
        };
      }

      const singleMarketId =
        viewLevel === "market" || viewLevel === "pm"
          ? selectedMarketId
          : undefined;

      return {
        series: aggregateMonthMetrics(
          entries,
          months,
          benchmarkByMarket,
          viewLevel,
          singleMarketId,
        ),
        included,
        total,
        insufficient,
      };
    },
    [
      scopedProperties,
      pmByProperty,
      coverage,
      bookingsByProperty,
      benchmarkByMarket,
      viewLevel,
      selectedMarketId,
    ],
  );

  useEffect(() => {
    periodDefaultedRef.current = false;
  }, [viewLevel, selectedMarketId, selectedPmIdView, selectedPropertyId]);

  useEffect(() => {
    if (covLoading || !scopedProperties.length) return;
    if (periodDefaultedRef.current) return;
    periodDefaultedRef.current = true;
    const order: PeriodMode[] = ["cytd", "ltm", "lfy"];
    const ok = order.find((m) => {
      if (m === "cytd") {
        const { curr, prior } = periodWindows.cytd;
        const currentYear = new Date().getFullYear();
        if (curr.length === 0) return false;
        const anyCompleteCurr = curr.some((mo) => {
          const r = unionCoverageMap.get(monthKey(mo.year, mo.month));
          return r?.data_complete || r?.admin_override;
        });
        if (!anyCompleteCurr) return false;
        return coverageHoles(unionCoverageMap, prior).length === 0;
      }
      return coverageInclusionByMode[m].currIncluded > 0;
    });
    if (ok) setPeriodMode(ok);
  }, [
    viewLevel,
    selectedMarketId,
    selectedPmIdView,
    selectedPropertyId,
    covLoading,
    coverageInclusionByMode,
    scopedProperties.length,
    periodWindows.cytd,
    unionCoverageMap,
  ]);

  useEffect(() => {
    if (viewLevel === "market" && !selectedMarketId && hierarchyMarkets.length) {
      setSelectedMarketId(hierarchyMarkets[0].id);
    }
  }, [viewLevel, selectedMarketId, hierarchyMarkets]);

  useEffect(() => {
    if (
      (viewLevel === "pm" || viewLevel === "property") &&
      selectedMarketId &&
      !selectedPmIdView &&
      hierarchyPmsForMarket.length
    ) {
      setSelectedPmIdView(hierarchyPmsForMarket[0].id);
    }
  }, [viewLevel, selectedMarketId, selectedPmIdView, hierarchyPmsForMarket]);

  useEffect(() => {
    if (
      viewLevel === "property" &&
      selectedMarketId &&
      selectedPmIdView &&
      !selectedPropertyId &&
      hierarchyPropertiesForPm.length
    ) {
      setSelectedPropertyId(hierarchyPropertiesForPm[0].id);
    }
  }, [
    viewLevel,
    selectedMarketId,
    selectedPmIdView,
    selectedPropertyId,
    hierarchyPropertiesForPm,
  ]);

  const periodPack = useMemo(() => {
    const { curr, prior } = periodWindows[periodMode];
    const curPack = computeScopedMetrics(curr);
    const priPack = computeScopedMetrics(prior);

    const rows = curr.map((ym, idx) => {
      const ck = monthKey(ym.year, ym.month);
      const c = curPack.series.find((x) => x.ymKey === ck) ?? null;
      const pk = prior[idx]
        ? monthKey(prior[idx].year, prior[idx].month)
        : null;
      const p =
        pk == null ? null : priPack.series.find((x) => x.ymKey === pk) ?? null;

      return {
        label: curPack.series[idx]?.monthLabel ?? monthKey(ym.year, ym.month),
        ymKey: ck,
        current: c,
        prior: p,
      };
    });

    return {
      currCombined: rows,
      currIncluded: curPack.included,
      currTotal: curPack.total,
      currInsufficient: curPack.insufficient,
      priorIncluded: priPack.included,
    };
  }, [periodMode, periodWindows, computeScopedMetrics]);

  const { currCombined, currIncluded, currTotal, currInsufficient } =
    periodPack;

  const benchmarkAvailable = useMemo(() => {
    const marketIds = new Set<string>();
    for (const p of scopedProperties) {
      const mid = (p.market_id ?? "").trim();
      if (mid) marketIds.add(mid);
    }
    for (const mid of marketIds) {
      const rows = benchmarkByMarket.get(mid) ?? [];
      if (
        rows.some(
          (r) =>
            r.benchmark_revpar != null &&
            Number.isFinite(Number(r.benchmark_revpar)),
        )
      ) {
        return true;
      }
    }
    return false;
  }, [scopedProperties, benchmarkByMarket]);

  const hideBenchmarkSeries = !benchmarkAvailable;

  const inclusionNow = coverageInclusionByMode[periodMode];
  const locksNow = {
    currComplete: inclusionNow.currIncluded > 0,
    priorComplete: inclusionNow.priorIncluded > 0,
    incompleteMonthsCurr: inclusionNow.incompleteMonthsCurr,
    incompleteMonthsPrior: inclusionNow.incompleteMonthsPrior,
  };

  const scopedBookingsFlat = useMemo(() => {
    const ids = new Set(scopedProperties.map((p) => p.id));
    return bookings.filter((b) => ids.has(String(b.property_id ?? "")));
  }, [bookings, scopedProperties]);

  const priorPeriodComplete =
    coverageHoles(unionCoverageMap, periodWindows[periodMode].prior).length ===
    0;

  const priorDeltaTooltip =
    !priorPeriodComplete && inclusionNow.incompleteMonthsPrior[0]
      ? `Prior-year comparison hidden — ${formatMonthHeading(inclusionNow.incompleteMonthsPrior[0].year, inclusionNow.incompleteMonthsPrior[0].month)} data incomplete.`
      : !priorPeriodComplete
        ? "Prior-year comparison hidden — prior period data incomplete."
        : "";

  const summaryPropertyIds = useMemo(
    () => scopedProperties.map((p) => p.id).filter(Boolean),
    [scopedProperties],
  );

  const summaryMarketId = useMemo(() => {
    const fromSelection = selectedMarketId.trim();
    if (fromSelection) return fromSelection;
    return (
      scopedProperties.find((p) => (p.market_id ?? "").trim())?.market_id?.trim() ??
      ""
    );
  }, [selectedMarketId, scopedProperties]);

  type PerformanceSummaryState = {
    current: PeriodStats;
    deltas: {
      grossRevenue: number | null;
      revpar: number | null;
      occ: number | null;
      avgNightly: number | null;
    };
  };

  const [performanceSummary, setPerformanceSummary] =
    useState<PerformanceSummaryState | null>(null);
  const [performanceSummaryLoading, setPerformanceSummaryLoading] =
    useState(false);

  const pmTransitionWarning = false;

  const toggleDisabled = (
    mode: PeriodMode,
  ): { locked: boolean; tooltip: string } => {
    const L = coverageInclusionByMode[mode];
    const currentYear = new Date().getFullYear();
    if (!scopedProperties.length) {
      return { locked: true, tooltip: "No properties in this view." };
    }
    if (mode === "cytd") {
      const { curr, prior } = periodWindows.cytd;
      if (curr.length === 0) {
        return {
          locked: true,
          tooltip: `No data yet for ${currentYear}. Upload your first statement to unlock.`,
        };
      }
      const anyCompleteCurr = curr.some((m) => {
        const r = unionCoverageMap.get(monthKey(m.year, m.month));
        return r?.data_complete || r?.admin_override;
      });
      if (!anyCompleteCurr) {
        return {
          locked: true,
          tooltip: `No data yet for ${currentYear}. Upload your first statement to unlock.`,
        };
      }
      const priorHoles = coverageHoles(unionCoverageMap, prior);
      if (priorHoles.length > 0) {
        const g = priorHoles[0];
        return {
          locked: true,
          tooltip: `${formatMonthHeading(g.year, g.month)} data needed to compare. Upload historical statements to unlock.`,
        };
      }
    }
    if (L.currIncluded === 0) {
      const m = L.incompleteMonthsCurr[0];
      return {
        locked: true,
        tooltip: m
          ? `Missing complete uploads — ${formatMonthHeading(m.year, m.month)}.`
          : "Waiting for uploaded months to be marked complete.",
      };
    }
    return {
      locked: false,
      tooltip: "",
    };
  };

  const viewScopeLabel = useMemo(() => {
    if (viewLevel === "portfolio") return "Portfolio";
    if (viewLevel === "market") {
      return formatMarketLabel(
        selectedMarketId,
        marketLabels.get(selectedMarketId),
      );
    }
    if (viewLevel === "pm") {
      const pm = pmLabels.get(selectedPmIdView) ?? selectedPmIdView.slice(0, 8);
      const mkt = formatMarketLabel(
        selectedMarketId,
        marketLabels.get(selectedMarketId),
      );
      return `${mkt} · ${pm}`;
    }
    const prop = properties.find((p) => p.id === selectedPropertyId);
    return (
      prop?.property_name ?? prop?.address_line1 ?? "Property"
    );
  }, [
    viewLevel,
    selectedMarketId,
    selectedPmIdView,
    selectedPropertyId,
    marketLabels,
    pmLabels,
    properties,
  ]);

  const scopedHasBookings = useMemo(() => {
    return scopedProperties.some(
      (p) => (bookingsByProperty.get(p.id)?.length ?? 0) > 0,
    );
  }, [scopedProperties, bookingsByProperty]);

  const hasAnyPmAssignment = useMemo(
    () => properties.some((p) => Boolean(pmByProperty.get(p.id))),
    [properties, pmByProperty],
  );

  const showAnalytics =
    locksNow.currComplete &&
    (viewLevel !== "property" || scopedHasBookings || bookingsLoading);

  useEffect(() => {
    let cancel = false;

    if (
      bookingsLoading ||
      covLoading ||
      !showAnalytics ||
      scopedProperties.length === 0 ||
      !summaryMarketId
    ) {
      setPerformanceSummary(null);
      setPerformanceSummaryLoading(false);
      return;
    }

    (async () => {
      setPerformanceSummaryLoading(true);
      const { curr, prior } = periodWindows[periodMode];
      try {
        const current = await computePeriodStats(
          scopedBookingsFlat,
          curr,
          supabase,
          summaryMarketId,
          summaryPropertyIds,
        );
        const priorStats = await computePeriodStats(
          scopedBookingsFlat,
          prior,
          supabase,
          summaryMarketId,
          summaryPropertyIds,
        );
        if (cancel) return;
        setPerformanceSummary({
          current,
          deltas: {
            grossRevenue: priorPeriodComplete
              ? pctDelta(current.grossRevenue, priorStats.grossRevenue)
              : null,
            revpar: priorPeriodComplete
              ? pctDelta(current.revpar, priorStats.revpar)
              : null,
            occ: priorPeriodComplete
              ? pctDelta(current.occ, priorStats.occ)
              : null,
            avgNightly: priorPeriodComplete
              ? pctDelta(current.avgNightly, priorStats.avgNightly)
              : null,
          },
        });
      } catch (err) {
        console.error("[analytics] performance summary", err);
        if (!cancel) setPerformanceSummary(null);
      } finally {
        if (!cancel) setPerformanceSummaryLoading(false);
      }
    })();

    return () => {
      cancel = true;
    };
  }, [
    scopedBookingsFlat,
    periodMode,
    periodWindows,
    priorPeriodComplete,
    bookingsLoading,
    covLoading,
    showAnalytics,
    scopedProperties.length,
    summaryMarketId,
    summaryPropertyIds,
    supabase,
  ]);

  /** Chart rows with dual series for Recharts — current solid, prior muted dashed. */
  const chartDatum = currCombined.map((r) => {
    const primary =
      activeKpiTab === "revenue"
        ? r.current?.grossRevenue ?? null
        : activeKpiTab === "revpar"
          ? r.current?.revparProp ?? null
          : activeKpiTab === "occ"
            ? r.current?.occPct ?? null
            : activeKpiTab === "adr"
              ? r.current?.adrProp ?? null
              : r.current?.indexValue ?? null;

    let bench: number | null = null;
    if (!hideBenchmarkSeries) {
      if (activeKpiTab === "revpar") bench = r.current?.benchmark_revpar ?? null;
      else if (activeKpiTab === "occ") bench = r.current?.benchmark_occ ?? null;
      else if (activeKpiTab === "adr") bench = r.current?.benchmark_adr ?? null;
    }

    let priorVal: number | null = null;
    if (locksNow?.priorComplete) {
      if (activeKpiTab === "revenue") priorVal = r.prior?.grossRevenue ?? null;
      else if (activeKpiTab === "revpar")
        priorVal = r.prior?.revparProp ?? null;
      else if (activeKpiTab === "occ") priorVal = r.prior?.occPct ?? null;
      else if (activeKpiTab === "adr") priorVal = r.prior?.adrProp ?? null;
      else priorVal = r.prior?.indexValue ?? null;
    }

    const priorRevenue = r.prior?.grossRevenue ?? null;
    const currentRevenue = r.current?.grossRevenue ?? null;

    return {
      name: r.label,
      ymKey: r.ymKey,
      primary: primary != null ? Number(primary) : null,
      benchmark: bench != null ? Number(bench) : null,
      prior:
        ["revenue", "revpar", "occ", "adr"].includes(activeKpiTab)
          ? priorVal != null
            ? Number(priorVal)
            : null
          : priorVal != null
            ? Number(priorVal)
            : null,
      priorRev: priorRevenue != null ? Number(priorRevenue) : null,
      currentRev: currentRevenue != null ? Number(currentRevenue) : null,
    };
  });

  /** Revenue tab uses BAR overlay for prior-period revenue dashed line alternative */
  const showRevenueBars = activeKpiTab === "revenue";

  const indexChartYMax = useMemo(() => {
    if (activeKpiTab !== "index") return 150;
    const peak = chartDatum.reduce(
      (max, row) => Math.max(max, row.primary ?? 0),
      0,
    );
    return Math.max(peak, 150);
  }, [activeKpiTab, chartDatum]);

  const kpiTabs: KpiTab[] = [
    "revenue",
    "revpar",
    "occ",
    "adr",
    "index",
  ];

  if (propsLoading && !properties.length) {
    return (
      <div className="text-sm text-zinc-600 dark:text-zinc-400">Loading…</div>
    );
  }

  if (!properties.length) {
    return (
      <div className="rounded-lg border border-zinc-200 px-4 py-6 dark:border-zinc-800 dark:bg-zinc-950/60">
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          No properties found yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Analytics
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          KPI comparisons use completed months from your uploaded statements.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-3">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            View
          </p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["portfolio", "Portfolio"],
                ["market", "Market"],
                ["pm", "PM"],
                ["property", "Property"],
              ] as const
            ).map(([level, label]) => {
              const selected = viewLevel === level;
              const disabled =
                level === "market"
                  ? hierarchyMarkets.length === 0
                  : level === "pm"
                    ? hierarchyMarkets.length === 0 || !hasAnyPmAssignment
                    : level === "property"
                      ? properties.length === 0
                      : false;
              return (
                <button
                  key={level}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    setViewLevel(level);
                    if (level === "portfolio") {
                      setSelectedMarketId("");
                      setSelectedPmIdView("");
                      setSelectedPropertyId("");
                    } else if (level === "market" && hierarchyMarkets.length) {
                      setSelectedMarketId((cur) =>
                        cur && hierarchyMarkets.some((m) => m.id === cur)
                          ? cur
                          : hierarchyMarkets[0].id,
                      );
                      setSelectedPmIdView("");
                      setSelectedPropertyId("");
                    } else if (level === "pm" && hierarchyMarkets.length) {
                      const mkt =
                        selectedMarketId &&
                        hierarchyMarkets.some((m) => m.id === selectedMarketId)
                          ? selectedMarketId
                          : hierarchyMarkets[0].id;
                      setSelectedMarketId(mkt);
                      setSelectedPmIdView("");
                      setSelectedPropertyId("");
                    } else if (level === "property" && hierarchyMarkets.length) {
                      const mkt =
                        selectedMarketId &&
                        hierarchyMarkets.some((m) => m.id === selectedMarketId)
                          ? selectedMarketId
                          : hierarchyMarkets[0].id;
                      setSelectedMarketId(mkt);
                      setSelectedPmIdView("");
                      setSelectedPropertyId("");
                    }
                  }}
                  className={[
                    "rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-wide",
                    disabled
                      ? "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400 opacity-70 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-500"
                      : selected
                        ? "border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-600"
                        : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-900",
                  ].join(" ")}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {viewLevel !== "portfolio" ? (
            <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-700 dark:bg-zinc-900/40">
              <div>
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Market
                </label>
                <select
                  className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
                  value={selectedMarketId}
                  onChange={(e) => {
                    setSelectedMarketId(e.target.value);
                    setSelectedPmIdView("");
                    setSelectedPropertyId("");
                  }}
                >
                  {hierarchyMarkets.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              {viewLevel === "pm" || viewLevel === "property" ? (
                <div>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Property manager
                  </label>
                  <select
                    className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
                    value={selectedPmIdView}
                    onChange={(e) => {
                      setSelectedPmIdView(e.target.value);
                      setSelectedPropertyId("");
                    }}
                  >
                    {hierarchyPmsForMarket.map((pm) => (
                      <option key={pm.id} value={pm.id}>
                        {pm.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {viewLevel === "property" ? (
                <div>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Property
                  </label>
                  {hierarchyPropertiesForPm.length === 1 ? (
                    <div className="mt-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50">
                      {hierarchyPropertiesForPm[0].property_name ??
                        hierarchyPropertiesForPm[0].address_line1 ??
                        "Property"}
                    </div>
                  ) : (
                    <select
                      className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
                      value={selectedPropertyId}
                      onChange={(e) => setSelectedPropertyId(e.target.value)}
                    >
                      {hierarchyPropertiesForPm.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.property_name ?? p.address_line1 ?? p.id.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Showing: <span className="font-medium text-zinc-700 dark:text-zinc-300">{viewScopeLabel}</span>
          </p>
        </div>
      </div>

      {!locksNow.currComplete ? (
        <CoverageLockedEmpty
          viewLabel={viewScopeLabel}
          earliestGap={inclusionNow.incompleteMonthsCurr[0]}
        />
      ) : viewLevel === "property" &&
        !scopedHasBookings &&
        !bookingsLoading ? (
        <UploadFirstEmpty />
      ) : pmTransitionWarning ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950/30">
          PM transition — comparative data unavailable for this period.
        </div>
      ) : showAnalytics ? (
        <>
          {covLoading ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading coverage…</p>
          ) : null}

          {locksNow &&
          locksNow.currComplete &&
          !locksNow.priorComplete ? (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950/60 dark:text-zinc-300">
              Comparative overlay hidden — uploads still incomplete for:&nbsp;
              {locksNow.incompleteMonthsPrior
                .slice(0, 6)
                .map((mk) =>
                  `${String(mk.month).padStart(2, "0")}/${mk.year}`
                ).join(", ")}
              {(locksNow.incompleteMonthsPrior?.length ?? 0) > 6 ? "…" : ""}
            </div>
          ) : null}

          {hideBenchmarkSeries && activeKpiTab !== "revenue" ? (
            <BenchmarkMissingBanner />
          ) : null}

          {staleCoverageMonths.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
              Booking data for{" "}
              {staleCoverageMonths
                .map((m) => formatCoverageMonthHeading(m.year, m.month))
                .join(", ")}{" "}
              may not be up to date — upload a new file to refresh.
            </div>
          ) : null}

          <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Performance Summary
            </h2>

            <div className="mt-4 inline-flex flex-wrap gap-2">
              {(Object.keys(PERIOD_TOGGLE_DEF) as PeriodMode[]).map((mode) => {
                const d = toggleDisabled(mode);
                const def = PERIOD_TOGGLE_DEF[mode];
                const selected = periodMode === mode;
                const disabled = d.locked;
                return (
                  <span key={mode} title={disabled ? d.tooltip : def.label}>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-disabled={disabled}
                      onClick={() => {
                        if (!disabled) setPeriodMode(mode);
                      }}
                      className={[
                        "rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide",
                        disabled
                          ? "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400 opacity-70 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-500"
                          : selected
                            ? "border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-600"
                            : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-900",
                      ].join(" ")}
                    >
                      {def.shortLabel}
                    </button>
                  </span>
                );
              })}
            </div>
            {(periodMode === "ltm" || periodMode === "cytd") &&
            locksNow.currComplete &&
            !locksNow.priorComplete ? (
              <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">
                {periodMode === "ltm" ? "LTM" : "CYTD"} comparison pending — uploads still incomplete for the prior mirror window
                {locksNow.incompleteMonthsPrior[0]
                  ? ` (earliest gap: ${formatMonthHeading(locksNow.incompleteMonthsPrior[0].year, locksNow.incompleteMonthsPrior[0].month)})`
                  : ""}
                .
              </p>
            ) : null}

            <div className="mt-4">
            {performanceSummaryLoading || !performanceSummary ? (
              <p className="text-sm text-zinc-500">Loading performance metrics…</p>
            ) : (
            <PerformanceSummaryCards
              current={performanceSummary.current}
              deltas={performanceSummary.deltas}
              periodLabel={PERIOD_TOGGLE_DEF[periodMode].shortLabel}
              priorDeltaTooltip={
                !priorPeriodComplete && priorDeltaTooltip
                  ? priorDeltaTooltip
                  : undefined
              }
            />
            )}
            </div>
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
            <div className="mb-4 flex flex-wrap gap-2 border-b border-zinc-200 pb-4 dark:border-zinc-700">
              {kpiTabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveKpiTab(tab)}
                  className={`rounded-full px-3 py-1.5 text-sm font-semibold capitalize ${
                    activeKpiTab === tab
                      ? "bg-emerald-600 text-white dark:bg-emerald-600"
                      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  }`}
                >
                  {tab === "index" ? "Index" : tab}
                </button>
              ))}
            </div>

            <KpiExplanation active={activeKpiTab} />

            {chartDatum.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
                Loading chart data…
              </p>
            ) : (
            <div className="mt-4 h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartDatum}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-60" />
                  <XAxis dataKey="name" stroke="#71717a" fontSize={12} />
                  <YAxis
                    stroke="#71717a"
                    fontSize={11}
                    domain={
                      activeKpiTab === "index"
                        ? [0, indexChartYMax]
                        : undefined
                    }
                  />

                  {activeKpiTab === "index" ? (
                    <>
                      <ReferenceArea
                        y1={105}
                        y2={indexChartYMax}
                        fill="#22c55e"
                        fillOpacity={0.12}
                      />
                      <ReferenceArea y1={95} y2={105} fillOpacity={0.08} />
                      <ReferenceArea
                        y1={85}
                        y2={95}
                        fill="#f59e0b"
                        fillOpacity={0.12}
                      />
                      <ReferenceArea y1={0} y2={85} fill="#fb7185" fillOpacity={0.12} />
                      <ReferenceLine y={100} stroke="#a1a1aa" strokeDasharray="4 3" />
                    </>
                  ) : null}

                  {showRevenueBars && locksNow?.priorComplete ? (
                    <Bar dataKey="priorRev" name="Prior rev" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                  ) : null}
                  {showRevenueBars ? (
                    <Bar dataKey="currentRev" name="Current rev" fill="#059669aa" radius={[4, 4, 0, 0]} />
                  ) : (
                    <>
                      <Line
                        type="monotone"
                        dataKey="primary"
                        name="Current"
                        stroke="#2563eb"
                        strokeWidth={2.5}
                        dot={false}
                        connectNulls
                      />
                      {locksNow?.priorComplete ? (
                        <Line
                          type="monotone"
                          dataKey="prior"
                          name="Prior"
                          stroke="#2563eb"
                          strokeWidth={1.5}
                          strokeDasharray="5 4"
                          dot={false}
                          connectNulls
                        />
                      ) : null}
                      {!hideBenchmarkSeries &&
                      ["revpar", "occ", "adr"].includes(activeKpiTab) ? (
                        <Line
                          type="monotone"
                          dataKey="benchmark"
                          name="Market ben."
                          stroke="#a1a1aa"
                          strokeWidth={1}
                          strokeDasharray="6 4"
                          dot={false}
                          connectNulls
                        />
                      ) : null}
                    </>
                  )}

                  <Tooltip
                    formatter={(v) =>
                      typeof v === "number" ? v.toFixed(2) : "—"}
                  />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            )}

            {viewLevel !== "property" && currTotal > 0 ? (
              <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                {currIncluded} of {currTotal} properties included
                {currInsufficient > 0
                  ? ` — ${currInsufficient} ${currInsufficient === 1 ? "property has" : "properties have"} insufficient data for this period.`
                  : "."}
              </p>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

function CoverageLockedEmpty({
  viewLabel,
  earliestGap,
}: {
  viewLabel: string;
  earliestGap?: CalendarMonth;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 px-4 py-6 text-center text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-300">
      <p className="font-medium text-zinc-900 dark:text-zinc-50">
        Analytics locked for {viewLabel}
      </p>
      <p className="mt-2">
        No properties in this view have complete uploads for the selected period.
        {earliestGap
          ? ` Earliest gap: ${formatMonthHeading(earliestGap.year, earliestGap.month)}.`
          : ""}
      </p>
    </div>
  );
}

function UploadFirstEmpty() {
  return (
    <div className="rounded-lg border border-zinc-200 px-6 py-10 text-center dark:border-zinc-800 dark:bg-zinc-950/50">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
        Upload your first statement to see your property&apos;s performance.
      </p>
      <Link
        href="/dashboard/upload"
        className="mt-3 inline-flex text-sm font-semibold text-emerald-700 underline decoration-emerald-400 hover:text-emerald-800 dark:text-emerald-400"
      >
        Go to Data Load
      </Link>
    </div>
  );
}

function BenchmarkMissingBanner() {
  return (
    <div className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-300">
      Market benchmark not available for this period.
    </div>
  );
}

function KpiExplanation({ active }: { active: KpiTab }) {
  const lines: Record<KpiTab, string> = {
    revenue: "Monthly gross revenue from guest bookings.",
    revpar:
      "Revenue per available night — your property vs. the 30A market.",
    occ: "Percentage of available nights booked by guests.",
    adr: "Average nightly rate from guest bookings.",
    index:
      "Your RevPAR as a percentage of the market benchmark. 100 = at market.",
  };
  return (
    <p className="text-xs text-zinc-600 dark:text-zinc-400">{lines[active]}</p>
  );
}
