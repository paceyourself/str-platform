"use client";

import { createClient } from "@/lib/supabase";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PmManagerCard from "@/components/PmManagerCard";
import { PerformanceSummaryCards } from "@/components/performance-summary-cards";
import {
  coverageHoles,
  formatMonthHeading as formatCoverageMonthHeading,
  reEvaluateIncompleteCoverageMonths,
  staleIncompleteCoverageMonths,
  type CoverageBookingRow,
} from "@/lib/coverage-completeness";
import { resolveDefaultPeriodMode } from "@/lib/period-default";
import { computePeriodStats, pctDelta, type PeriodStats } from "@/lib/period-stats";
import {
  CartesianGrid,
  Line,
  LineChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type PropertyRow = {
  id: string;
  property_name: string | null;
  address_line1: string | null;
  city: string | null;
  market_id: string | null;
};

type PmProfileNested = { company_name: string | null };

type OwnerPmSummaryRow = {
  id: string;
  property_id: string;
  pm_id: string;
  start_date: string | null;
  pm_fee_pct: number | null;
  pm_monthly_fixed_fee: number | null;
  contract_maintenance_threshold: number | null;
  pm_profiles: PmProfileNested | PmProfileNested[] | null;
  properties:
    | { property_name: string | null; address_line1: string | null; city: string | null }
    | { property_name: string | null; address_line1: string | null; city: string | null }[]
    | null;
};

function pmProfileCompanyName(nested: PmProfileNested | PmProfileNested[] | null): string | null {
  if (nested == null) return null;
  const p = Array.isArray(nested) ? nested[0] : nested;
  return p?.company_name ?? null;
}

function pmSummaryPropertyName(row: OwnerPmSummaryRow): string {
  const p = row.properties == null ? null : Array.isArray(row.properties) ? row.properties[0] : row.properties;
  return p?.property_name?.trim() || p?.address_line1?.trim() || "Property";
}

type PropertyFeeSummary = {
  name: string;
  pm_fee_pct: number | null;
  pm_monthly_fixed_fee: number | null;
  contract_maintenance_threshold: number | null;
  relId: string;
};

type GroupedPmSummary = {
  pmId: string;
  companyName: string;
  profileClaimed: boolean;
  properties: PropertyFeeSummary[];
  contractStart: string | null;
};

type BookingRow = {
  property_id: string | null;
  block_type: string | null;
  gross_revenue: number | string | null;
  check_in: string | null;
  check_out: string | null;
  status: string | null;
  is_planned_owner_stay: boolean | null;
};

type PeriodMode = "cytd" | "ltm" | "lfy";

type CalendarMonth = { year: number; month: number };

type CoverageRow = {
  property_id: string;
  pm_id: string;
  coverage_year: number;
  coverage_month: number;
  data_complete: boolean;
  admin_override: boolean;
};

const PERIOD_TOGGLE_DEF: Record<
  PeriodMode,
  { label: string; shortLabel: string }
> = {
  cytd: { label: "CYTD vs PYTD", shortLabel: "CYTD" },
  ltm: { label: "LTM vs PLTM", shortLabel: "LTM" },
  lfy: { label: "LFY vs PLFY", shortLabel: "LFY" },
};

/** Expected columns: market_id, year, week_number, benchmark_revpar */
type BenchmarkRow = {
  year: number | null;
  week_number: number | null;
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

function monthKey(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}

function formatMonthHeading(y: number, m: number): string {
  return new Date(y, m - 1, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
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
  const months: CalendarMonth[] = [];
  for (let mo = 1; mo <= 12; mo++) months.push({ year: fullYear, month: mo });
  return months;
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

/** Formats a Postgres `date` or timestamptz string for display. Date-only `YYYY-MM-DD` is treated as a calendar day in the local timezone (avoids UTC midnight shifting the day). */
function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const s = iso.trim();
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]);
    const day = Number(ymd[3]);
    const d = new Date(y, m - 1, day);
    if (
      d.getFullYear() !== y ||
      d.getMonth() !== m - 1 ||
      d.getDate() !== day
    ) {
      return s;
    }
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatMoneyCompact(n: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

/** Month buckets for chart x-axis, oldest first. */
function monthsToChartBuckets(months: CalendarMonth[]): {
  monthKey: string;
  monthLabel: string;
  year: number;
  month: number;
}[] {
  return months.map(({ year, month }) => ({
    monthKey: monthKey(year, month),
    monthLabel: new Date(year, month - 1, 1).toLocaleDateString(undefined, {
      month: "short",
      year: "numeric",
    }),
    year,
    month,
  }));
}

function revparTrendSubtitle(mode: PeriodMode, lcm: CalendarMonth): string {
  const base =
    " — guest OTA / PM-direct revenue vs. nights available (calendar days minus planned owner stays, owner guest, and maintenance). Market benchmark shown only for months with complete uploads.";
  switch (mode) {
    case "cytd":
      return `Jan ${lcm.year} – ${formatMonthHeading(lcm.year, lcm.month)} vs prior year same months${base}`;
    case "ltm":
      return `Last 12 complete months vs prior 12 months${base}`;
    case "lfy":
      return `${lcm.year - 1} full calendar year${base}`;
  }
}

function daysInCalendarMonth(year: number, month1Based: number): number {
  return new Date(year, month1Based, 0).getDate();
}

/** ISO week start (Monday) → calendar month key for benchmark coverage guard. */
function getMonthKeyFromIsoWeekStart(isoYear: number, isoWeek: number): string {
  if (!Number.isFinite(isoYear) || !Number.isFinite(isoWeek)) return `${isoYear}-01`;
  const w = Math.min(53, Math.max(1, Math.floor(isoWeek)));
  const jan4 = new Date(isoYear, 0, 4, 12, 0, 0);
  const dow = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - dow);
  const monday = new Date(week1Monday);
  monday.setDate(week1Monday.getDate() + (w - 1) * 7);
  monday.setHours(12);
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}`;
}

function aggregateBenchmarkRevparByMonth(
  rows: BenchmarkRow[],
  allowedMonthKeys: Set<string>,
): Map<string, number> {
  const acc = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    if (r.year == null || r.week_number == null) continue;
    const v = Number(r.benchmark_revpar);
    if (!Number.isFinite(v)) continue;
    const mk = getMonthKeyFromIsoWeekStart(r.year, r.week_number);
    if (!allowedMonthKeys.has(mk)) continue;
    const b = acc.get(mk) ?? { sum: 0, n: 0 };
    b.sum += v;
    b.n += 1;
    acc.set(mk, b);
  }
  const out = new Map<string, number>();
  for (const [k, { sum, n }] of acc) {
    if (n > 0) out.set(k, sum / n);
  }
  return out;
}

function AttentionBadgeLink({
  count,
  label,
  href,
}: {
  count: number;
  label: string;
  href: string;
}) {
  const hot = count > 0;
  return (
    <Link
      href={href}
      className={[
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        hot
          ? "border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100 dark:hover:bg-amber-950/70"
          : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800",
      ].join(" ")}
    >
      <span
        className={[
          "inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums",
          hot
            ? "bg-amber-200 text-amber-950 dark:bg-amber-800 dark:text-amber-50"
            : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
        ].join(" ")}
      >
        {count}
      </span>
      <span>{label}</span>
    </Link>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const showSubscribedBanner = searchParams.get("subscribed") === "true";

  const [email, setEmail] = useState<string | null>(null);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [propertiesLoading, setPropertiesLoading] = useState(true);

  const [pmRows, setPmRows] = useState<OwnerPmSummaryRow[]>([]);
  const [pmLoading, setPmLoading] = useState(false);
  const [pmManagerExpanded, setPmManagerExpanded] = useState(false);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);

  const [benchmarkRows, setBenchmarkRows] = useState<BenchmarkRow[]>([]);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);

  const [periodMode, setPeriodMode] = useState<PeriodMode>("cytd");
  const [coverage, setCoverage] = useState<CoverageRow[]>([]);
  const [covLoading, setCovLoading] = useState(false);
  const [pmByProperty, setPmByProperty] = useState<Map<string, string>>(
    () => new Map(),
  );
  const periodDefaultedRef = useRef(false);

  const [surveyPendingCount, setSurveyPendingCount] = useState<number | null>(
    null
  );
  const [ticketsAwaitingCount, setTicketsAwaitingCount] = useState<
    number | null
  >(null);
  const [pmRequestsCount, setPmRequestsCount] = useState<number | null>(null);
  const [resolvedThisMonthCount, setResolvedThisMonthCount] = useState<
    number | null
  >(null);
  const [dataGapRows, setDataGapRows] = useState<PropertyRow[]>([]);
  const [dataGapsLoading, setDataGapsLoading] = useState(false);

  const currentYear = new Date().getFullYear();
  const lcm = useMemo(() => lastCompletedCalendarMonth(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data: relRows, error: relErr } = await supabase
        .from("owner_pm_relationships")
        .select("id")
        .eq("owner_id", user.id)
        .eq("active", true);

      if (cancelled) return;

      const relIds =
        relErr != null
          ? []
          : (relRows ?? [])
              .map((r) => r.id as string)
              .filter(Boolean);
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const [
        { count: surveyCount, error: surveyErr },
        { count: awaitingCount, error: awaitingErr },
        pmRequestsCountResult,
        resolvedCountResult,
      ] = await Promise.all([
        supabase
          .from("survey_responses")
          .select("*", { count: "exact", head: true })
          .eq("owner_id", user.id)
          .is("submitted_at", null),
        relIds.length === 0
          ? Promise.resolve({
              count: 0,
              error: null as { message: string } | null,
            })
          : supabase
              .from("tickets")
              .select("*", { count: "exact", head: true })
              .eq("owner_id", user.id)
              .eq("direction", "owner_to_pm")
              .eq("status", "open")
              .is("acknowledged_at", null)
              .in("owner_pm_relationship_id", relIds),
        relIds.length === 0
          ? Promise.resolve({
              count: 0,
              error: null as { message: string } | null,
            })
            :supabase
            .from("tickets")
            .select("*", { count: "exact", head: true })
            .eq("direction", "pm_to_owner")
            .eq("status", "open")
            .is("acknowledged_at", null)
            .in("owner_pm_relationship_id", relIds),
        relIds.length === 0
          ? Promise.resolve({
              count: 0,
              error: null as { message: string } | null,
            })
          : supabase
              .from("tickets")
              .select("*", { count: "exact", head: true })
              .in("owner_pm_relationship_id", relIds)
              .eq("status", "resolved")
              .gte("resolved_at", monthStart.toISOString()),
      ]);

      if (cancelled) return;

      if (surveyErr) {
        console.warn(surveyErr);
        setSurveyPendingCount(0);
      } else {
        setSurveyPendingCount(surveyCount ?? 0);
      }

      if (relErr) {
        console.warn(relErr);
        setTicketsAwaitingCount(0);
        setPmRequestsCount(0);
        setResolvedThisMonthCount(0);
      } else {
        if (awaitingErr) {
          console.warn(awaitingErr);
          setTicketsAwaitingCount(0);
        } else {
          setTicketsAwaitingCount(awaitingCount ?? 0);
        }
        if (pmRequestsCountResult.error) {
          console.warn(pmRequestsCountResult.error);
          setPmRequestsCount(0);
        } else {
          setPmRequestsCount(pmRequestsCountResult.count ?? 0);
        }
        if (resolvedCountResult.error) {
          console.warn(resolvedCountResult.error);
          setResolvedThisMonthCount(0);
        } else {
          setResolvedThisMonthCount(resolvedCountResult.count ?? 0);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data: ownerProfile, error: ownerErr } = await supabase
        .from("owner_profiles")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();
      if (ownerErr) {
        console.error(ownerErr);
        return;
      }
      if (cancelled || ownerProfile) return;

      const { data: pmRow, error: pmErr } = await supabase
        .from("pm_profiles")
        .select("id")
        .eq("claimed_by_user_id", user.id)
        .maybeSingle();
      if (pmErr) {
        console.error(pmErr);
        return;
      }
      if (pmRow) {
        router.replace("/pm/dashboard");
      } else {
        router.replace("/signup");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

  const loadProperties = useCallback(async () => {
    setPropertiesLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPropertiesLoading(false);
      return;
    }

    // Check deactivation — block data access if deactivated_at is set
    const { data: ownerProfile } = await supabase
      .from("owner_profiles")
      .select("deactivated_at")
      .eq("id", user.id)
      .single();
    if (ownerProfile?.deactivated_at) {
      await supabase.auth.signOut();
      router.push("/login?reason=deactivated");
      return;
    }

    setEmail(user.email ?? null);

    const propsRes = await supabase
      .from("properties")
      .select("id, property_name, address_line1, city, market_id")
      .eq("owner_id", user.id)
      .order("property_name", { ascending: true, nullsFirst: false })
      .order("address_line1", { ascending: true, nullsFirst: false });

    setPropertiesLoading(false);
    if (propsRes.error) {
      console.error(propsRes.error);
      setProperties([]);
      return;
    }
    const list = (propsRes.data as PropertyRow[]) ?? [];
    if (list.length === 0) {
      router.push("/onboarding");
      return;
    }
    setProperties(list);
  }, [router, supabase]);

  const loadPmAndBookings = useCallback(async () => {
    const propertyIds = properties.map((p) => p.id).filter(Boolean);
    if (propertyIds.length === 0) {
      setPmRows([]);
      setBookings([]);
      setBenchmarkRows([]);
      setCoverage([]);
      setPmByProperty(new Map());
      return;
    }

    setPmLoading(true);
    setBookingsLoading(true);
    setCovLoading(true);

    const [pmRes, bookRes, covRes] = await Promise.all([
      supabase
      .from("owner_pm_relationships")
      .select(
        `
        id,
        property_id,
        pm_id,
        start_date,
        pm_fee_pct,
        pm_monthly_fixed_fee,
        contract_maintenance_threshold,
        pm_profiles ( company_name, profile_claimed ),
        properties ( property_name, address_line1, city )
      `
      )
      .eq("active", true)
      .in("property_id", propertyIds)
      .order("start_date", { ascending: false, nullsFirst: false }),
      supabase
        .from("bookings")
        .select(
          "property_id, block_type, gross_revenue, check_in, check_out, status, is_planned_owner_stay",
        )
        .in("property_id", propertyIds),
      supabase
        .from("property_coverage_months")
        .select(
          "property_id, pm_id, coverage_year, coverage_month, data_complete, admin_override",
        )
        .in("property_id", propertyIds),
    ]);

    if (pmRes.error) {
      console.error(pmRes.error);
      setPmRows([]);
      setPmByProperty(new Map());
    } else {
      const latestByProperty = new Map<string, OwnerPmSummaryRow>();
      const pmMap = new Map<string, string>();
      for (const row of (pmRes.data ?? []) as OwnerPmSummaryRow[]) {
        const pid = String(row.property_id ?? "");
        if (!pid) continue;
        if (!pmMap.has(pid)) {
          pmMap.set(pid, String(row.pm_id ?? ""));
        }
        if (latestByProperty.has(pid)) continue;
        latestByProperty.set(pid, row);
      }
      setPmRows([...latestByProperty.values()]);
      setPmByProperty(pmMap);
    }
    setPmLoading(false);

    if (bookRes.error) {
      console.error(bookRes.error);
      setBookings([]);
    } else {
      setBookings((bookRes.data as BookingRow[]) ?? []);
    }
    setBookingsLoading(false);

    if (covRes.error) {
      console.error(covRes.error);
      setCoverage([]);
    } else {
      let coverageRows = (covRes.data as CoverageRow[]) ?? [];
      const { updated, error: reEvalErr } =
        await reEvaluateIncompleteCoverageMonths(
          supabase,
          coverageRows,
          (bookRes.data ?? []) as CoverageBookingRow[],
        );
      if (reEvalErr) {
        console.warn("[dashboard] coverage re-eval:", reEvalErr);
      } else if (updated > 0) {
        const { data: refreshed, error: refreshErr } = await supabase
          .from("property_coverage_months")
          .select(
            "property_id, pm_id, coverage_year, coverage_month, data_complete, admin_override",
          )
          .in("property_id", propertyIds);
        if (refreshErr) {
          console.warn("[dashboard] coverage refresh:", refreshErr);
        } else {
          coverageRows = (refreshed as CoverageRow[]) ?? coverageRows;
        }
      }
      setCoverage(coverageRows);
    }
    setCovLoading(false);
  }, [properties, supabase]);

  const loadBenchmarks = useCallback(async () => {
    const mid = properties.find((p) => (p.market_id ?? "").trim())?.market_id?.trim();
    if (!mid) {
      setBenchmarkRows([]);
      return;
    }
    setBenchmarkLoading(true);
    const { data, error } = await supabase
      .from("market_benchmarks")
      .select("year, week_number, benchmark_revpar")
      .eq("market_id", mid)
      .eq("source", "airdna_api");
    setBenchmarkLoading(false);
    if (error) {
      console.error(error);
      setBenchmarkRows([]);
      return;
    }
    setBenchmarkRows((data as BenchmarkRow[]) ?? []);
  }, [properties, supabase]);

  useEffect(() => {
    loadProperties();
  }, [loadProperties]);

  useEffect(() => {
    loadPmAndBookings();
  }, [loadPmAndBookings]);

  useEffect(() => {
    loadBenchmarks();
  }, [loadBenchmarks]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (properties.length === 0) {
        setDataGapRows([]);
        return;
      }
      setDataGapsLoading(true);
      const propertyIds = properties.map((p) => p.id).filter(Boolean);
      const { data, error } = await supabase
        .from("upload_batches")
        .select("property_id, created_at")
        .in("property_id", propertyIds);
      setDataGapsLoading(false);
      if (cancelled) return;
      if (error) {
        console.warn(error);
        setDataGapRows([]);
        return;
      }
      const latestByProperty = new Map<string, string>();
      for (const row of (data ?? []) as { property_id: string; created_at: string }[]) {
        const pid = String(row.property_id ?? "");
        const ts = String(row.created_at ?? "");
        if (!pid || !ts) continue;
        const cur = latestByProperty.get(pid);
        if (!cur || ts > cur) latestByProperty.set(pid, ts);
      }
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const gaps = properties.filter((p) => {
        const latest = latestByProperty.get(p.id);
        if (!latest) return true;
        const t = Date.parse(latest);
        return Number.isNaN(t) || t < cutoff;
      });
      setDataGapRows(gaps);
    })();
    return () => {
      cancelled = true;
    };
  }, [properties, supabase]);

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
    const unionRows: CoverageRow[] = [];
    for (const p of properties) {
      const pmId = pmByProperty.get(p.id) ?? "";
      if (!pmId) continue;
      unionRows.push(
        ...coverage.filter(
          (c) => c.property_id === p.id && c.pm_id === pmId,
        ),
      );
    }
    return buildCoverageMap(unionRows);
  }, [properties, coverage, pmByProperty]);

  const staleCoverageMonths = useMemo(
    () =>
      staleIncompleteCoverageMonths(
        coverage,
        properties.map((p) => p.id),
        pmByProperty,
      ),
    [coverage, properties, pmByProperty],
  );

  const coverageInclusionByMode = useMemo(() => {
    type Rec = {
      currIncluded: number;
      priorIncluded: number;
      incompleteMonthsPrior: CalendarMonth[];
    };
    const out: Record<PeriodMode, Rec> = {
      cytd: { currIncluded: 0, priorIncluded: 0, incompleteMonthsPrior: [] },
      ltm: { currIncluded: 0, priorIncluded: 0, incompleteMonthsPrior: [] },
      lfy: { currIncluded: 0, priorIncluded: 0, incompleteMonthsPrior: [] },
    };
    for (const mode of ["cytd", "ltm", "lfy"] as PeriodMode[]) {
      const { curr, prior } = periodWindows[mode];
      let currIncluded = 0;
      let priorIncluded = 0;
      for (const p of properties) {
        const pmId = pmByProperty.get(p.id) ?? "";
        if (!pmId) continue;
        if (propertyPeriodComplete(p.id, pmId, curr, coverage)) currIncluded++;
        if (propertyPeriodComplete(p.id, pmId, prior, coverage)) priorIncluded++;
      }
      out[mode] = {
        currIncluded,
        priorIncluded,
        incompleteMonthsPrior: coverageHoles(unionCoverageMap, prior),
      };
    }
    return out;
  }, [properties, coverage, periodWindows, pmByProperty, unionCoverageMap]);

  useEffect(() => {
    periodDefaultedRef.current = false;
  }, [properties.length]);

  useEffect(() => {
    if (covLoading || properties.length === 0) return;
    if (periodDefaultedRef.current) return;
    const ok = resolveDefaultPeriodMode({
      periodWindows,
      unionCoverageMap,
      coverageInclusionByMode,
    });
    if (ok) {
      periodDefaultedRef.current = true;
      setPeriodMode(ok);
    }
  }, [
    covLoading,
    properties.length,
    periodWindows,
    unionCoverageMap,
    coverageInclusionByMode,
  ]);

  const toggleDisabled = useCallback(
    (mode: PeriodMode): { locked: boolean; tooltip: string } => {
      const L = coverageInclusionByMode[mode];
      if (!properties.length) {
        return { locked: true, tooltip: "No properties on file." };
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
        return {
          locked: true,
          tooltip: "Waiting for uploaded months to be marked complete.",
        };
      }
      return { locked: false, tooltip: "" };
    },
    [
      coverageInclusionByMode,
      properties.length,
      periodWindows.cytd,
      unionCoverageMap,
      currentYear,
    ],
  );

  const inclusionNow = coverageInclusionByMode[periodMode];
  const priorPeriodComplete =
    coverageHoles(unionCoverageMap, periodWindows[periodMode].prior).length ===
    0;
  const priorDeltaTooltip =
    !priorPeriodComplete && inclusionNow.incompleteMonthsPrior[0]
      ? `Prior-year comparison hidden — ${formatMonthHeading(inclusionNow.incompleteMonthsPrior[0].year, inclusionNow.incompleteMonthsPrior[0].month)} data incomplete.`
      : !priorPeriodComplete
        ? "Prior-year comparison hidden — prior period data incomplete."
        : "";

  const dashboardPropertyIds = useMemo(
    () => properties.map((p) => p.id).filter(Boolean),
    [properties],
  );

  const dashboardMarketId = useMemo(
    () => properties.find((p) => (p.market_id ?? "").trim())?.market_id?.trim() ?? "",
    [properties],
  );

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

  useEffect(() => {
    let cancel = false;

    if (
      propertiesLoading ||
      bookingsLoading ||
      covLoading ||
      properties.length === 0 ||
      inclusionNow.currIncluded === 0 ||
      !dashboardMarketId
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
          bookings,
          curr,
          supabase,
          dashboardMarketId,
          dashboardPropertyIds,
        );
        const priorStats = await computePeriodStats(
          bookings,
          prior,
          supabase,
          dashboardMarketId,
          dashboardPropertyIds,
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
        console.error("[dashboard] performance summary", err);
        if (!cancel) setPerformanceSummary(null);
      } finally {
        if (!cancel) setPerformanceSummaryLoading(false);
      }
    })();

    return () => {
      cancel = true;
    };
  }, [
    bookings,
    periodMode,
    periodWindows,
    priorPeriodComplete,
    propertiesLoading,
    bookingsLoading,
    covLoading,
    properties.length,
    inclusionNow.currIncluded,
    dashboardMarketId,
    dashboardPropertyIds,
    supabase,
  ]);

  const benchmarkAllowedMonthKeys = useMemo(() => {
    const allowed = new Set<string>();
    for (const p of properties) {
      const pmId = pmByProperty.get(p.id) ?? "";
      if (!pmId) continue;
      for (const c of coverage) {
        if (c.property_id !== p.id || c.pm_id !== pmId) continue;
        if (!(c.data_complete || c.admin_override)) continue;
        allowed.add(
          monthKey(Number(c.coverage_year), Number(c.coverage_month)),
        );
      }
    }
    return allowed;
  }, [properties, coverage, pmByProperty]);

  const [revparChartData, setRevparChartData] = useState<
    {
      monthKey: string;
      monthLabel: string;
      propertyRevpar: number | null;
      priorPropertyRevpar: number | null;
      benchmarkRevpar: number | null;
    }[]
  >([]);
  const [revparChartLoading, setRevparChartLoading] = useState(false);

  useEffect(() => {
    let cancel = false;

    if (propertiesLoading || bookingsLoading || properties.length === 0) {
      setRevparChartData([]);
      setRevparChartLoading(false);
      return;
    }

    const { curr, prior } = periodWindows[periodMode];
    const chartBuckets = monthsToChartBuckets(curr);
    const periodMonthKeys = new Set(curr.map((m) => monthKey(m.year, m.month)));
    const benchmarkAllowedForPeriod = new Set(
      [...benchmarkAllowedMonthKeys].filter((k) => periodMonthKeys.has(k)),
    );
    const benchmarkByMonth = aggregateBenchmarkRevparByMonth(
      benchmarkRows,
      benchmarkAllowedForPeriod,
    );

    if (!dashboardMarketId) {
      setRevparChartData([]);
      setRevparChartLoading(false);
      return;
    }

    (async () => {
      setRevparChartLoading(true);
      try {
        const rows = await Promise.all(
          chartBuckets.map(async ({ monthKey: mk, monthLabel, year, month }, idx) => {
            const monthStats = await computePeriodStats(
              bookings,
              [{ year, month }],
              supabase,
              dashboardMarketId,
              dashboardPropertyIds,
            );
            const bench = benchmarkByMonth.get(mk);
            const monthAllowed = benchmarkAllowedForPeriod.has(mk);
            const benchmarkRevpar =
              monthAllowed && bench !== undefined && Number.isFinite(bench)
                ? bench
                : null;

            let priorPropertyRevpar: number | null = null;
            if (priorPeriodComplete && prior[idx]) {
              const priorMonth = prior[idx];
              const priorStats = await computePeriodStats(
                bookings,
                [priorMonth],
                supabase,
                dashboardMarketId,
                dashboardPropertyIds,
              );
              priorPropertyRevpar = priorStats.revpar;
            }

            return {
              monthKey: mk,
              monthLabel,
              propertyRevpar: monthStats.revpar,
              priorPropertyRevpar,
              benchmarkRevpar,
            };
          }),
        );
        if (!cancel) setRevparChartData(rows);
      } catch (err) {
        console.error("[dashboard] revpar chart", err);
        if (!cancel) setRevparChartData([]);
      } finally {
        if (!cancel) setRevparChartLoading(false);
      }
    })();

    return () => {
      cancel = true;
    };
  }, [
    benchmarkRows,
    bookings,
    benchmarkAllowedMonthKeys,
    periodMode,
    periodWindows,
    priorPeriodComplete,
    propertiesLoading,
    bookingsLoading,
    properties.length,
    dashboardMarketId,
    dashboardPropertyIds,
    supabase,
  ]);

  const hasPriorRevparSeries = useMemo(
    () =>
      priorPeriodComplete &&
      revparChartData.some((d) => d.priorPropertyRevpar != null),
    [revparChartData, priorPeriodComplete],
  );

  const groupedPmRows = useMemo<GroupedPmSummary[]>(() => {
    const byPm = new Map<string, GroupedPmSummary>();
    for (const row of pmRows) {
      const pmId = String(row.pm_id ?? "").trim();
      if (!pmId) continue;
      const propertyName = pmSummaryPropertyName(row);
      const companyName = pmProfileCompanyName(row.pm_profiles) ?? "—";
      const pm = row.pm_profiles;
      const profileClaimed = pm == null
        ? false
        : Array.isArray(pm)
          ? (pm[0] as { profile_claimed?: boolean })?.profile_claimed === true
          : (pm as { profile_claimed?: boolean })?.profile_claimed === true;

          const propEntry: PropertyFeeSummary = {
            name: propertyName,
            pm_fee_pct: row.pm_fee_pct ?? null,
            pm_monthly_fixed_fee: row.pm_monthly_fixed_fee ?? null,
            contract_maintenance_threshold: row.contract_maintenance_threshold ?? null,
            relId: row.id,
          };

      const existing = byPm.get(pmId);
      if (!existing) {
        byPm.set(pmId, {
          pmId,
          companyName,
          profileClaimed,
          properties: [propEntry],
          contractStart: row.start_date ?? null,
        });
        continue;
      }
      existing.properties.push(propEntry);
      const currStart = (row.start_date ?? "").trim();
      const prevStart = (existing.contractStart ?? "").trim();
      if (currStart && (!prevStart || currStart < prevStart)) {
        existing.contractStart = currStart;
      }
    }
    return [...byPm.values()].sort((a, b) =>
      a.companyName.localeCompare(b.companyName)
    );
  }, [pmRows]);

  const hasBenchmarkSeries = useMemo(
    () => revparChartData.some((d) => d.benchmarkRevpar != null),
    [revparChartData]
  );

  const propertyLabel = (p: PropertyRow) => {
    const primary =
      p.property_name?.trim() ||
      p.address_line1?.trim() ||
      "Property";
    return [primary, p.city].filter(Boolean).join(", ");
  };

  return (
    <div className="space-y-8">
      {showSubscribedBanner ? (
        <div
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
          role="status"
        >
          Your Essentials subscription is active. Analytics and benchmarking are
          now available.
        </div>
      ) : null}

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Welcome{email ? `, ${email}` : ""}
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Overview for your rental properties.
        </p>
      </div>

      {surveyPendingCount != null &&
      ticketsAwaitingCount != null &&
      pmRequestsCount != null ? (
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label="Action summary"
        >
          <AttentionBadgeLink
            count={surveyPendingCount}
            label="Pending surveys"
            href="/dashboard/surveys"
          />
          <AttentionBadgeLink
            count={ticketsAwaitingCount}
            label="Tickets awaiting PM response"
            href="/dashboard/tickets"
          />
          <AttentionBadgeLink
            count={pmRequestsCount}
            label="PM requests requiring action"
            href="/dashboard/tickets"
          />
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4">
      <section className="h-full rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-3 flex items-center justify-between">
        <button
 type="button"
  onClick={() => setPmManagerExpanded((e) => !e)}
  className="text-sm font-semibold uppercase tracking-wide text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
>
  MY PROPERTY MANAGERS {pmManagerExpanded ? "▲" : "▼"}
       </button>
          <Link
            href="/dashboard/properties"
            className="text-xs font-medium text-zinc-500 hover:underline dark:text-zinc-400"
          >
            Manage →
          </Link>
        </div>
        {pmManagerExpanded && (pmLoading ? (
  <p className="text-sm text-zinc-500">Loading…</p>
) : groupedPmRows.length === 0 ? (
  <p className="text-sm text-zinc-600 dark:text-zinc-400">No PM associated</p>
) : (
<PmManagerCard
  rows={groupedPmRows}
  onFeesUpdated={() => void loadPmAndBookings()}
/>
        ))}
      </section>

      <section className="h-full rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            MY TICKETS
          </h2>
          <Link
            href="/dashboard/tickets"
            className="text-xs font-medium text-zinc-500 hover:underline dark:text-zinc-400"
          >
            View all →
          </Link>
        </div>
        <div className="space-y-2 text-sm">
          <Link href="/dashboard/tickets" className="block hover:underline">
            <span className="font-semibold text-zinc-900 dark:text-zinc-50">
              {ticketsAwaitingCount ?? 0}
            </span>{" "}
            <span className="text-zinc-600 dark:text-zinc-400">awaiting PM response</span>
          </Link>
          <Link href="/dashboard/tickets" className="block hover:underline">
            <span className="font-semibold text-zinc-900 dark:text-zinc-50">
              {pmRequestsCount ?? 0}
            </span>{" "}
            <span className="text-zinc-600 dark:text-zinc-400">requiring your action</span>
          </Link>
          <Link href="/dashboard/tickets" className="block hover:underline">
            <span className="font-semibold text-zinc-900 dark:text-zinc-50">
              {resolvedThisMonthCount ?? 0}
            </span>{" "}
            <span className="text-zinc-600 dark:text-zinc-400">resolved this month</span>
          </Link>
        </div>
      </section>
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Performance Summary
          </h2>
          <Link
            href="/dashboard/analytics"
            className="text-xs font-medium text-zinc-500 hover:underline dark:text-zinc-400"
          >
            Analytics →
          </Link>
        </div>

        {staleCoverageMonths.length > 0 ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
            Booking data for{" "}
            {staleCoverageMonths
              .map((m) => formatCoverageMonthHeading(m.year, m.month))
              .join(", ")}{" "}
            may not be up to date — upload a new file to refresh.
          </div>
        ) : null}

        <div className="mt-4 inline-flex flex-wrap gap-2">
          {(Object.keys(PERIOD_TOGGLE_DEF) as PeriodMode[]).map((mode) => {
            const d = toggleDisabled(mode);
            const def = PERIOD_TOGGLE_DEF[mode];
            const selected = periodMode === mode;
            return (
              <span key={mode} title={d.locked ? d.tooltip : def.label}>
                <button
                  type="button"
                  disabled={d.locked}
                  onClick={() => {
                    if (!d.locked) setPeriodMode(mode);
                  }}
                  className={[
                    "rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide",
                    d.locked
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

        {properties.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">Loading properties…</p>
        ) : bookingsLoading || covLoading ? (
          <p className="mt-3 text-sm text-zinc-500">Loading bookings…</p>
        ) : inclusionNow.currIncluded === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            Upload complete statements to unlock performance metrics for{" "}
            {PERIOD_TOGGLE_DEF[periodMode].shortLabel}.
          </p>
        ) : performanceSummaryLoading || !performanceSummary ? (
          <p className="mt-4 text-sm text-zinc-500">Loading performance metrics…</p>
        ) : (
          <div className="mt-4">
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
          </div>
        )}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          RevPAR trend
        </h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {revparTrendSubtitle(periodMode, lcm)}
        </p>
        {properties.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">Loading properties…</p>
        ) : bookingsLoading || revparChartLoading ? (
          <p className="mt-3 text-sm text-zinc-500">Loading chart…</p>
        ) : (
          <>
            <div className="mt-4 h-[300px] w-full min-w-0 sm:h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={revparChartData}
                  margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
                >
                  <CartesianGrid
                    strokeDasharray="2 6"
                    stroke="#a1a1aa"
                    strokeOpacity={0.18}
                  />
                  <XAxis
                    dataKey="monthLabel"
                    tick={{ fontSize: 11, fill: "#71717a" }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#71717a" }}
                    width={64}
                    tickFormatter={(v) =>
                      new Intl.NumberFormat(undefined, {
                        style: "currency",
                        currency: "USD",
                        maximumFractionDigits: 0,
                      }).format(Number(v))
                    }
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0].payload as {
                        propertyRevpar: number | null;
                        priorPropertyRevpar: number | null;
                        benchmarkRevpar: number | null;
                      };
                      return (
                        <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-md dark:border-zinc-700 dark:bg-zinc-900">
                          <p className="font-medium text-zinc-900 dark:text-zinc-50">
                            {label}
                          </p>
                          <p className="mt-1 text-blue-600 dark:text-blue-400">
                            Current period:{" "}
                            {row.propertyRevpar != null
                              ? formatMoneyCompact(row.propertyRevpar)
                              : "—"}
                          </p>
                          {hasPriorRevparSeries ? (
                            <p className="mt-1 text-zinc-500 dark:text-zinc-400">
                              Prior period:{" "}
                              {row.priorPropertyRevpar != null
                                ? formatMoneyCompact(row.priorPropertyRevpar)
                                : "—"}
                            </p>
                          ) : null}
                          <p className="mt-1 text-zinc-500 dark:text-zinc-400">
                            Market benchmark:{" "}
                            {row.benchmarkRevpar != null
                              ? formatMoneyCompact(row.benchmarkRevpar)
                              : "—"}
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                  <Line
                    type="monotone"
                    dataKey="propertyRevpar"
                    name="Current period"
                    stroke="#2563eb"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: "#2563eb" }}
                    connectNulls={false}
                    legendType="line"
                  />
                  {hasPriorRevparSeries ? (
                    <Line
                      type="monotone"
                      dataKey="priorPropertyRevpar"
                      name="Prior period"
                      stroke="#94a3b8"
                      strokeWidth={1.5}
                      strokeDasharray="5 4"
                      dot={false}
                      connectNulls={false}
                    />
                  ) : null}
                  {hasBenchmarkSeries ? (
                    <Line
                      type="monotone"
                      dataKey="benchmarkRevpar"
                      name="Market benchmark"
                      stroke="#a1a1aa"
                      strokeWidth={1}
                      strokeDasharray="6 4"
                      dot={false}
                      connectNulls={false}
                    />
                  ) : null}
                </LineChart>
              </ResponsiveContainer>
            </div>
            {!hasBenchmarkSeries && !benchmarkLoading ? (
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                Benchmark data not yet loaded
              </p>
            ) : null}
            {benchmarkLoading ? (
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                Loading benchmark data…
              </p>
            ) : null}
          </>
        )}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            DATA GAPS
          </h2>
          <Link
            href="/dashboard/upload"
            className="text-xs font-medium text-zinc-500 hover:underline dark:text-zinc-400"
          >
            Go to Data Load →
          </Link>
        </div>
        {dataGapsLoading ? (
          <p className="text-sm text-zinc-500">Checking upload recency…</p>
        ) : dataGapRows.length === 0 ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-300">All properties up to date ✓</p>
        ) : (
          <ul className="space-y-2">
            {dataGapRows.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
              >
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-50">
                    {propertyLabel(p)}
                  </p>
                  <p className="text-zinc-600 dark:text-zinc-400">No upload in 30 days</p>
                </div>
                <Link
                  href="/dashboard/upload"
                  className="text-xs font-medium text-zinc-500 hover:underline dark:text-zinc-400"
                >
                  Upload now →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
