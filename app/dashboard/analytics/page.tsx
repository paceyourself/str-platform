"use client";

/**
 * Owner analytics KPI block (Phase 1).
 *
 * STR_Analytics_Framework_Spec_Current.docx (v1.2) — not present in this repo.
 * Implemented from sprint ticket rules + shared dashboard KPI conventions.
 */

import Link from "next/link";
import { createClient } from "@/lib/supabase";
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

type PeriodMode = "qtr" | "ltm" | "lfy";

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
  qtr: { label: "Qtr vs PYQtr", shortLabel: "Quarter" },
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
  const { first, last } = boundsOfCalendarMonth(year, month);
  const monthEndExclusive = new Date(year, month, 1, 12, 0, 0);
  if (!ci || !co) return 0;
  if (!(co > ci)) return 0;
  const overlapStart =
    ci.getTime() > first.getTime()
      ? new Date(ci.getFullYear(), ci.getMonth(), ci.getDate(), 12)
      : first;
  const overlapEndExclusive =
    co.getTime() < monthEndExclusive.getTime() ? co : monthEndExclusive;
  if (!(overlapEndExclusive > overlapStart)) return 0;
  return Math.round((overlapEndExclusive.getTime() - overlapStart.getTime()) / 86400000);
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

/** Last fiscal quarter FULLY CLOSED BEFORE today (months end Mar/Jun/Sep/Dec only). */
function lastClosedQuarterEndingMonth(lcm: CalendarMonth): CalendarMonth {
  let { year, month } = lcm;
  while (![3, 6, 9, 12].includes(month)) {
    if (month === 1) {
      month = 12;
      year -= 1;
    } else {
      month -= 1;
    }
  }
  return { year, month };
}

function quarterMonthsForEnd(end: CalendarMonth): CalendarMonth[] {
  const months: CalendarMonth[] = [];
  let { year, month } = end;
  for (let k = 0; k < 3; k++) {
    months.push({ year, month });
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
  }
  return months.reverse();
}

function buildQuarterWindows(lcm: CalendarMonth): {
  current: CalendarMonth[];
  prior: CalendarMonth[];
} {
  const end = lastClosedQuarterEndingMonth(lcm);
  const current = quarterMonthsForEnd(end);
  const priorAnchor = shiftMonths(end.year, end.month, -12);
  const prior = quarterMonthsForEnd(priorAnchor);
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

type KpiTab = "revenue" | "revpar" | "occ" | "adr" | "index";

export default function AnalyticsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [propsLoading, setPropsLoading] = useState(true);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [covLoading, setCovLoading] = useState(false);
  const [coverage, setCoverage] = useState<CoverageRow[]>([]);
  const [benchmarkRows, setBenchmarkRows] = useState<BenchmarkRow[]>([]);
  const [pmByProperty, setPmByProperty] = useState<Map<string, string>>(
    () => new Map(),
  );

  const [periodMode, setPeriodMode] = useState<PeriodMode>("ltm");
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
      if (keep) return cur!;
      return list.length === 1 ? list[0].id : "";
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

  const selectedProperty = useMemo(
    () => properties.find((p) => p.id === selectedPropertyId) ?? null,
    [properties, selectedPropertyId],
  );

  const activePmId = selectedProperty?.id
    ? pmByProperty.get(selectedProperty.id) ?? ""
    : "";

  const marketId = (selectedProperty?.market_id ?? "").trim();

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!selectedPropertyId || !marketId || !activePmId) {
        setCoverage([]);
        setBenchmarkRows([]);
        return;
      }
      setCovLoading(true);
      const [covRes, bmRes] = await Promise.all([
        supabase
          .from("property_coverage_months")
          .select(
            "property_id, pm_id, coverage_year, coverage_month, data_complete, admin_override",
          )
          .eq("property_id", selectedPropertyId)
          .eq("pm_id", activePmId),
        supabase
          .from("market_benchmarks")
          .select("year, week_number, benchmark_revpar, benchmark_adr, benchmark_occ")
          .eq("market_id", marketId)
          .eq("source", "airdna_api")
          .eq("granularity", "monthly_prorated"),
      ]);
      if (cancel) return;
      setCovLoading(false);

      if (covRes.error) {
        console.error(covRes.error);
        setCoverage([]);
      } else {
        setCoverage((covRes.data as CoverageRow[]) ?? []);
      }

      if (bmRes.error) {
        console.error(bmRes.error);
        setBenchmarkRows([]);
      } else {
        setBenchmarkRows((bmRes.data as BenchmarkRow[]) ?? []);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [supabase, selectedPropertyId, activePmId, marketId]);

  const lcm = useMemo(() => lastCompletedCalendarMonth(), []);

  const covMap = useMemo(() => {
    const m = new Map<string, CoverageRow>();
    for (const c of coverage) {
      const k = monthKey(Number(c.coverage_year), Number(c.coverage_month));
      m.set(k, c);
    }
    return m;
  }, [coverage]);

  const periodWindows = useMemo(() => {
    const qw = buildQuarterWindows(lcm);
    const lw = buildLtmWindows(lcm);
    const lfyCurr = fiscalYearMonths(lcm.year - 1);
    const lfyPrior = fiscalYearMonths(lcm.year - 2);
    return {
      qtr: { curr: qw.current, prior: qw.prior },
      ltm: { curr: lw.current, prior: lw.prior },
      lfy: { curr: lfyCurr, prior: lfyPrior },
    } as Record<PeriodMode, { curr: CalendarMonth[]; prior: CalendarMonth[] }>;
  }, [lcm]);

  const coverageLocks = useMemo(() => {
    type Rec = {
      currComplete: boolean;
      priorComplete: boolean;
      incompleteMonthsCurr: CalendarMonth[];
      incompleteMonthsPrior: CalendarMonth[];
    };
    const out: Record<PeriodMode, Rec> = {
      qtr: {
        currComplete: false,
        priorComplete: false,
        incompleteMonthsCurr: [],
        incompleteMonthsPrior: [],
      },
      ltm: {
        currComplete: false,
        priorComplete: false,
        incompleteMonthsCurr: [],
        incompleteMonthsPrior: [],
      },
      lfy: {
        currComplete: false,
        priorComplete: false,
        incompleteMonthsCurr: [],
        incompleteMonthsPrior: [],
      },
    };
    const modes: PeriodMode[] = ["qtr", "ltm", "lfy"];

    function holes(months: CalendarMonth[]): CalendarMonth[] {
      return months.filter((mk) => {
        const r = covMap.get(monthKey(mk.year, mk.month));
        return !(r?.data_complete || r?.admin_override);
      });
    }

    for (const mode of modes) {
      const { curr, prior } = periodWindows[mode];
      const hC = holes(curr);
      const hP = holes(prior);
      out[mode] = {
        currComplete: hC.length === 0,
        priorComplete: hP.length === 0,
        incompleteMonthsCurr: hC,
        incompleteMonthsPrior: hP,
      };
    }

    return out;
  }, [covMap, periodWindows]);

  useEffect(() => {
    periodDefaultedRef.current = false;
  }, [selectedPropertyId]);

  useEffect(() => {
    if (!selectedPropertyId || covLoading) return;
    if (periodDefaultedRef.current) return;
    periodDefaultedRef.current = true;
    const order: PeriodMode[] = ["qtr", "ltm", "lfy"];
    const ok = order.find((m) => coverageLocks[m]?.currComplete);
    if (ok) setPeriodMode(ok);
  }, [selectedPropertyId, covLoading, coverageLocks]);

  const propertyBookingsFiltered = useMemo(() => {
    if (!selectedPropertyId) return [];
    return bookings.filter(
      (b) =>
        String(b.property_id) === selectedPropertyId &&
        String(b.status ?? "").toLowerCase() !== "cancelled",
    );
  }, [bookings, selectedPropertyId]);

  const metricsByMonthPack = useCallback(
    (months: CalendarMonth[]) => {
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

        const dim = daysInCalendarMonth(ym.year, ym.month);

        for (const b of propertyBookingsFiltered) {
          const bt = String(b.block_type ?? "").trim();
          const n = nightsIntersectCalendarMonthHalfOpenStay(
            b.check_in,
            b.check_out,
            ym.year,
            ym.month,
          );
          if (n <= 0) continue;
          if (GUEST_BLOCK_TYPES.has(bt)) {
            series[k].guestBookedNights += n;
            series[k].guestRevenue +=
              Number(b.gross_revenue != null ? b.gross_revenue : NaN) || 0;
          }
          if (reducesAvailableDenominator(b, bt)) {
            series[k].availDenominatorReduction += n;
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
        let revbarM: number | null = null,
          adrM: number | null = null,
          occM: number | null = null,
          idx: number | null = null;

        const br = bm.benchmark_revpar;
        const ba = bm.benchmark_adr;
        const bo = bm.benchmark_occ;

        if (br !== null && br > 0 && revparProp != null) idx = (revparProp / br) * 100;

        revbarM = br;
        adrM = ba;
        occM = bo;

        const labelShort = `${ym.year}-${String(ym.month).padStart(2, "0")}`;

        return {
          ymKey: k,
          labelShort,
          monthLabel: `${String(ym.month).padStart(2, "0")}/${String(ym.year).slice(-2)}`,
          grossRevenue: g.guestRevenue,
          availableNights,
          guestBookedNights: g.guestBookedNights,
          revparProp,
          occPct,
          adrProp: adr,
          benchmark_revpar: revbarM,
          benchmark_adr: adrM,
          benchmark_occ: occM,
          indexValue: idx,
        };
      });
    },
    [propertyBookingsFiltered, benchmarkRows],
  );

  const { currCombined, benchmarkAvailable } = useMemo(() => {
    const modeUsed = periodMode;
    const { curr, prior } = periodWindows[modeUsed];
    const curS = metricsByMonthPack(curr);
    const priS = metricsByMonthPack(prior);
    const bmAvail = benchmarkRows.some(
      (r) =>
        r.benchmark_revpar != null &&
        Number.isFinite(Number(r.benchmark_revpar)),
    );

    const rows = curr.map((ym, idx) => {
      const ck = monthKey(ym.year, ym.month);
      const c = curS.find((x) => x.ymKey === ck) ?? null;
      const pk = prior[idx]
        ? monthKey(prior[idx].year, prior[idx].month)
        : null;
      const p =
        pk == null ? null : priS.find((x) => x.ymKey === pk) ?? null;

      return {
        label: curS[idx]?.monthLabel ?? monthKey(ym.year, ym.month),
        ymKey: ck,
        current: c,
        prior: p,
      };
    });

    return { currCombined: rows, benchmarkAvailable: bmAvail };
  }, [periodMode, metricsByMonthPack, periodWindows, benchmarkRows]);

  const hideBenchmarkSeries =
    !benchmarkAvailable ||
    benchmarkRows.filter((r) => r.benchmark_revpar != null).length === 0;

  /** Multi-PM heuristic: conflicting PM identifiers on overlapping bookings skipped for brevity. */
  const pmTransitionWarning = false;

  const toggleDisabled = (
    mode: PeriodMode,
  ): { locked: boolean; tooltip: string } => {
    const L = coverageLocks[mode];
    if (!selectedProperty || !activePmId) {
      return { locked: true, tooltip: "Select a property." };
    }
    if (!L.currComplete) {
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
          KPI comparisons use completed calendar months after your statements
          are marked complete (
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">
            property_coverage_months
          </code>
          ).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Property
          </label>
          {properties.length === 1 ? (
            <div className="mt-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50">
              {properties[0].property_name ??
                properties[0].address_line1 ??
                "Property"}
            </div>
          ) : (
            <select
              className="mt-2 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
              value={selectedPropertyId}
              onChange={(e) => setSelectedPropertyId(e.target.value)}
            >
              <option value="">Choose a property…</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.property_name ?? p.address_line1 ?? p.id.slice(0, 8)}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Period comparison
          </p>
          <div className="flex flex-wrap gap-2">
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
                      "rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-wide",
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
          {periodMode === "ltm" &&
          coverageLocks.ltm.currComplete &&
          !coverageLocks.ltm.priorComplete ? (
            <p className="text-xs text-amber-800 dark:text-amber-300">
              LTM comparison pending — uploads still incomplete for the prior 12‑month mirror window
              {coverageLocks.ltm.incompleteMonthsPrior[0]
                ? ` (earliest gap: ${formatMonthHeading(coverageLocks.ltm.incompleteMonthsPrior[0].year, coverageLocks.ltm.incompleteMonthsPrior[0].month)})`
                : ""}
              .
            </p>
          ) : null}
        </div>
      </div>

      {!selectedPropertyId ? (
        <EmptySelectProperty />
      ) : !activePmId ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          No active property manager assignment found for analytics coverage.
          Contact support to link your PM relationship.
        </div>
      ) : propertyBookingsFiltered.length === 0 && !bookingsLoading ? (
        <UploadFirstEmpty />
      ) : pmTransitionWarning ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950/30">
          PM transition — comparative data unavailable for this period.
        </div>
      ) : (
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

            <div className="mt-4 h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartDatum}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-60" />
                  <XAxis dataKey="name" stroke="#71717a" fontSize={12} />
                  <YAxis
                    stroke="#71717a"
                    fontSize={11}
                    domain={
                      activeKpiTab === "index" ? [0, "auto"] : undefined
                    }
                  />

                  {activeKpiTab === "index" ? (
                    <>
                      <ReferenceArea
                        y1={105}
                        y2={220}
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
                    <Bar dataKey="priorRev" name="Prior rev" fill="#a1a1aa55" radius={[4, 4, 0, 0]} />
                  ) : null}
                  {showRevenueBars ? (
                    <Bar dataKey="currentRev" name="Current rev" fill="#059669aa" radius={[4, 4, 0, 0]} />
                  ) : (
                    <>
                      <Line type="monotone" dataKey="primary" name="Current" stroke="#18181b" strokeWidth={2} dot={false}
                        connectNulls
                      />
                      <Line type="monotone" dataKey="prior" name="Prior" stroke="#a1a1aa" strokeWidth={2}
                        strokeDasharray="6 5" dot={false} connectNulls
                      />
                      {!hideBenchmarkSeries &&
                      ["revpar", "occ", "adr"].includes(activeKpiTab) ? (
                        <Line type="monotone" dataKey="benchmark" name="Market ben."
                          stroke="#6366f1" strokeDasharray="3 6" strokeWidth={2}
                          dot={false} connectNulls
                        />
                      ) : null}
                    </>
                  )}

                  <Tooltip
                    formatter={(v: number | undefined) =>
                      typeof v === "number" ? v.toFixed(2) : "—"}
                  />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function EmptySelectProperty() {
  return (
    <div className="rounded-lg border border-zinc-200 px-4 py-6 text-center text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-300">
      Select a property to load analytics KPIs.
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
    revenue:
      "Gross Revenue — SUM(guest gross_revenue) by month. PM forecast suppressed in Phase 1.",
    revpar:
      "RevPAR — guest gross_revenue ÷ Available Nights where Available = calendar nights minus owner / maintenance block nights per spec.",
    occ:
      "Occupancy % — booked guest nights ÷ Available Nights × 100.",
    adr: "ADR — guest gross_revenue ÷ booked guest nights.",
    index:
      "RevPAR Index — (property RevPAR ÷ benchmark RevPAR)×100 vs market baseline 100.",
  };
  return (
    <p className="text-xs text-zinc-600 dark:text-zinc-400">{lines[active]}</p>
  );
}
