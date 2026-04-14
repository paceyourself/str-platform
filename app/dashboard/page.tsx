"use client";

import { createClient } from "@/lib/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
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

type GroupedPmSummary = {
  pmId: string;
  companyName: string;
  propertyNames: string[];
  contractStart: string | null;
};

type BookingRow = {
  block_type: string | null;
  net_owner_revenue: number | string | null;
  nights: number | string | null;
  check_in: string | null;
  check_out: string | null;
};

/** Expected columns: market_id, year, week_number, benchmark_revpar */
type BenchmarkRow = {
  year: number | null;
  week_number: number | null;
  benchmark_revpar: number | string | null;
};

const GUEST_BLOCK_TYPES = new Set(["guest_ota", "guest_pm_direct"]);

function isGuestBooking(blockType: string | null | undefined) {
  return blockType != null && GUEST_BLOCK_TYPES.has(blockType);
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

function formatMoney(n: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatMoneyCompact(n: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

/** Last 12 calendar months ending at current month, oldest first. */
function getLast12MonthBuckets(): {
  monthKey: string;
  monthLabel: string;
  year: number;
  month: number;
}[] {
  const out: {
    monthKey: string;
    monthLabel: string;
    year: number;
    month: number;
  }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const monthKey = `${year}-${String(month).padStart(2, "0")}`;
    const monthLabel = d.toLocaleDateString(undefined, {
      month: "short",
      year: "numeric",
    });
    out.push({ monthKey, monthLabel, year, month });
  }
  return out;
}

function daysInCalendarMonth(year: number, month1Based: number): number {
  return new Date(year, month1Based, 0).getDate();
}

function monthKeyFromCheckIn(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})/.exec(iso.trim());
  return m ? `${m[1]}-${m[2]}` : null;
}

function parseYMD(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** Count owner_stay / owner_guest nights that fall on a calendar date inside `monthKey` (YYYY-MM). */
function countOwnerNightsInMonth(
  checkIn: string | null,
  checkOut: string | null,
  nightsFallback: number,
  monthKey: string
): number {
  const start = parseYMD(checkIn ?? "");
  if (!start) return 0;

  let endUtc: Date;
  const co = checkOut ? parseYMD(checkOut) : null;
  if (co) {
    endUtc = new Date(Date.UTC(co.y, co.m - 1, co.d));
  } else {
    const n = Math.max(0, Math.floor(Number(nightsFallback) || 0));
    endUtc = new Date(Date.UTC(start.y, start.m - 1, start.d));
    endUtc.setUTCDate(endUtc.getUTCDate() + Math.max(1, n));
  }

  const cur = new Date(Date.UTC(start.y, start.m - 1, start.d));
  let count = 0;
  while (cur < endUtc) {
    const mk = `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}`;
    if (mk === monthKey) count += 1;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

/** Map ISO week to calendar month (month of that week's Thursday). */
function getMonthKeyFromIsoWeek(isoYear: number, isoWeek: number): string {
  if (!Number.isFinite(isoYear) || !Number.isFinite(isoWeek)) return `${isoYear}-01`;
  const w = Math.min(53, Math.max(1, Math.floor(isoWeek)));
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - day + 1);
  const targetMonday = new Date(week1Monday);
  targetMonday.setUTCDate(week1Monday.getUTCDate() + (w - 1) * 7);
  const thursday = new Date(targetMonday);
  thursday.setUTCDate(targetMonday.getUTCDate() + 3);
  const y = thursday.getUTCFullYear();
  const mo = thursday.getUTCMonth() + 1;
  return `${y}-${String(mo).padStart(2, "0")}`;
}

function aggregateBenchmarkRevparByMonth(
  rows: BenchmarkRow[],
  allowedMonthKeys: Set<string>
): Map<string, number> {
  const acc = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    if (r.year == null || r.week_number == null) continue;
    const v = Number(r.benchmark_revpar);
    if (!Number.isFinite(v)) continue;
    const mk = getMonthKeyFromIsoWeek(r.year, r.week_number);
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
  const supabase = createClient();

  const [email, setEmail] = useState<string | null>(null);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [propertiesLoading, setPropertiesLoading] = useState(true);

  const [pmRows, setPmRows] = useState<OwnerPmSummaryRow[]>([]);
  const [pmLoading, setPmLoading] = useState(false);

  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);

  const [benchmarkRows, setBenchmarkRows] = useState<BenchmarkRow[]>([]);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);

  const [timeRange, setTimeRange] = useState<"year" | "all">("year");

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
          : supabase
              .from("tickets")
              .select("*", { count: "exact", head: true })
              .eq("direction", "pm_to_owner")
              .in("status", ["open", "acknowledged"])
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
      return;
    }

    setPmLoading(true);
    setBookingsLoading(true);

    const [pmRes, bookRes] = await Promise.all([
      supabase
        .from("owner_pm_relationships")
        .select(
          `
          id,
          property_id,
          pm_id,
          start_date,
          pm_profiles ( company_name ),
          properties ( property_name, address_line1, city )
        `
        )
        .eq("active", true)
        .in("property_id", propertyIds)
        .order("start_date", { ascending: false, nullsFirst: false }),
      supabase
        .from("bookings")
        .select("block_type, net_owner_revenue, nights, check_in, check_out")
        .in("property_id", propertyIds),
    ]);

    if (pmRes.error) {
      console.error(pmRes.error);
      setPmRows([]);
    } else {
      const latestByProperty = new Map<string, OwnerPmSummaryRow>();
      for (const row of (pmRes.data ?? []) as OwnerPmSummaryRow[]) {
        const pid = String(row.property_id ?? "");
        if (!pid || latestByProperty.has(pid)) continue;
        latestByProperty.set(pid, row);
      }
      setPmRows([...latestByProperty.values()]);
    }
    setPmLoading(false);

    if (bookRes.error) {
      console.error(bookRes.error);
      setBookings([]);
    } else {
      setBookings((bookRes.data as BookingRow[]) ?? []);
    }
    setBookingsLoading(false);
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
      .eq("market_id", mid);
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

  const filteredBookings = useMemo(() => {
    if (timeRange === "all") return bookings;
    return bookings.filter((b) => {
      if (!b.check_in) return false;
      const y = new Date(b.check_in).getFullYear();
      return y === currentYear;
    });
  }, [bookings, timeRange, currentYear]);

  const bookingStats = useMemo(() => {
    const guest = filteredBookings.filter((b) => isGuestBooking(b.block_type));
    const totalGuestBookings = guest.length;
    const totalRevenue = guest.reduce(
      (s, b) => s + (Number(b.net_owner_revenue) || 0),
      0
    );
    const totalNights = guest.reduce(
      (s, b) => s + (Number(b.nights) || 0),
      0
    );
    const avgNightly =
      totalNights > 0 ? totalRevenue / totalNights : null;
    const ownerStays = filteredBookings.filter((b) => {
      const t = (b.block_type ?? "").trim().toLowerCase();
      return t === "owner_stay" || t === "owner_guest";
    }).length;

    return {
      totalGuestBookings,
      totalRevenue,
      totalNights,
      avgNightly,
      ownerStays,
    };
  }, [filteredBookings]);

  const performanceRevpar = useMemo(() => {
    const now = new Date();
    const curMonths: { key: string; year: number; month: number }[] = [];
    const prevMonths: { key: string; year: number; month: number }[] = [];
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      curMonths.push({
        key: `${year}-${String(month).padStart(2, "0")}`,
        year,
        month,
      });
      const pd = new Date(year - 1, month - 1, 1);
      prevMonths.push({
        key: `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, "0")}`,
        year: pd.getFullYear(),
        month: pd.getMonth() + 1,
      });
    }

    const guestBookings = bookings.filter((b) => isGuestBooking(b.block_type));
    const ownerBlocks = bookings.filter((b) => {
      const t = (b.block_type ?? "").trim().toLowerCase();
      return t === "owner_stay" || t === "owner_guest";
    });

    function revparFor(months: { key: string; year: number; month: number }[]) {
      let guestRevenue = 0;
      let availableNights = 0;
      for (const m of months) {
        for (const b of guestBookings) {
          if (monthKeyFromCheckIn(b.check_in) === m.key) {
            guestRevenue += Number(b.net_owner_revenue) || 0;
          }
        }
        let ownerNights = 0;
        for (const b of ownerBlocks) {
          ownerNights += countOwnerNightsInMonth(
            b.check_in,
            b.check_out,
            Number(b.nights) || 0,
            m.key
          );
        }
        const dim = daysInCalendarMonth(m.year, m.month);
        availableNights += Math.max(0, dim - ownerNights);
      }
      return availableNights > 0 ? guestRevenue / availableNights : null;
    }

    const currentRevpar = revparFor(curMonths);
    const priorRevpar = revparFor(prevMonths);
    const priorKeySet = new Set(prevMonths.map((m) => m.key));
    const priorMonthsWithData = new Set(
      bookings
        .map((b) => monthKeyFromCheckIn(b.check_in))
        .filter((k): k is string => Boolean(k && priorKeySet.has(k)))
    ).size;
    const hasPriorData = priorMonthsWithData > 0 && priorRevpar != null;
    const pct =
      hasPriorData && priorRevpar !== 0 && currentRevpar != null
        ? ((currentRevpar - priorRevpar) / priorRevpar) * 100
        : null;
    const estimated = hasPriorData && priorMonthsWithData < 6;
    return {
      currentRevpar,
      pct,
      estimated,
      hasPriorData,
    };
  }, [bookings]);

  const groupedPmRows = useMemo<GroupedPmSummary[]>(() => {
    const byPm = new Map<string, GroupedPmSummary>();
    for (const row of pmRows) {
      const pmId = String(row.pm_id ?? "").trim();
      if (!pmId) continue;
      const propertyName = pmSummaryPropertyName(row);
      const companyName = pmProfileCompanyName(row.pm_profiles) ?? "—";
      const existing = byPm.get(pmId);
      if (!existing) {
        byPm.set(pmId, {
          pmId,
          companyName,
          propertyNames: [propertyName],
          contractStart: row.start_date ?? null,
        });
        continue;
      }
      if (!existing.propertyNames.includes(propertyName)) {
        existing.propertyNames.push(propertyName);
      }
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

  const revparChartData = useMemo(() => {
    const buckets = getLast12MonthBuckets();
    const keySet = new Set(buckets.map((b) => b.monthKey));
    const benchmarkByMonth = aggregateBenchmarkRevparByMonth(
      benchmarkRows,
      keySet
    );

    const guestBookings = bookings.filter((b) => isGuestBooking(b.block_type));
    const ownerBlocks = bookings.filter((b) => {
      const t = (b.block_type ?? "").trim().toLowerCase();
      return t === "owner_stay" || t === "owner_guest";
    });

    return buckets.map(({ monthKey, monthLabel, year, month }) => {
      let guestRevenue = 0;
      for (const b of guestBookings) {
        if (monthKeyFromCheckIn(b.check_in) === monthKey) {
          guestRevenue += Number(b.net_owner_revenue) || 0;
        }
      }

      let ownerNightsInMonth = 0;
      for (const b of ownerBlocks) {
        ownerNightsInMonth += countOwnerNightsInMonth(
          b.check_in,
          b.check_out,
          Number(b.nights) || 0,
          monthKey
        );
      }

      const dim = daysInCalendarMonth(year, month);
      const availableNights = Math.max(0, dim - ownerNightsInMonth);
      const propertyRevpar =
        availableNights > 0 ? guestRevenue / availableNights : null;

      const bench = benchmarkByMonth.get(monthKey);
      const benchmarkRevpar =
        bench !== undefined && Number.isFinite(bench) ? bench : null;

      return {
        monthKey,
        monthLabel,
        propertyRevpar,
        benchmarkRevpar,
      };
    });
  }, [benchmarkRows, bookings]);

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
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            MY PROPERTY MANAGERS
          </h2>
          <Link
            href="/dashboard/properties"
            className="text-xs font-medium text-zinc-500 hover:underline dark:text-zinc-400"
          >
            Manage →
          </Link>
        </div>
        {pmLoading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : groupedPmRows.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No PM associated</p>
        ) : (
          <ul className="space-y-2">
            {groupedPmRows.map((row) => (
              <li
                key={row.pmId}
                className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
              >
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-50">
                    {row.companyName}
                  </p>
                  <p className="text-zinc-600 dark:text-zinc-400">
                    Properties: {row.propertyNames.join(", ")}
                  </p>
                  <p className="text-zinc-600 dark:text-zinc-400">
                    Contract start: {formatDate(row.contractStart)}
                  </p>
                  <p className="mt-1">
                    <Link
                      href="/dashboard/tickets"
                      className="text-xs font-medium text-zinc-500 hover:underline dark:text-zinc-400"
                    >
                      View tickets →
                    </Link>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
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
          <div className="inline-flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
            <button
              type="button"
              onClick={() => setTimeRange("year")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                timeRange === "year"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {currentYear}
            </button>
            <button
              type="button"
              onClick={() => setTimeRange("all")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                timeRange === "all"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              All time
            </button>
          </div>
        </div>

        {properties.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">Loading properties…</p>
        ) : bookingsLoading ? (
          <p className="mt-3 text-sm text-zinc-500">Loading bookings…</p>
        ) : (
          <>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/50">
              <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                RevPAR (trailing 12m)
              </dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {performanceRevpar.currentRevpar != null
                  ? formatMoney(performanceRevpar.currentRevpar)
                  : "—"}
              </dd>
              {performanceRevpar.pct != null ? (
                <p className="mt-0.5 text-xs">
                  {performanceRevpar.estimated ? (
                    <span className="text-zinc-500">~ </span>
                  ) : null}
                  <span
                    className={
                      performanceRevpar.pct >= 0
                        ? "text-emerald-700 dark:text-emerald-300"
                        : "text-red-700 dark:text-red-300"
                    }
                  >
                    {performanceRevpar.pct >= 0 ? "↑" : "↓"}{" "}
                    {Math.abs(performanceRevpar.pct).toFixed(1)}%
                  </span>
                </p>
              ) : null}
            </div>
            <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/50">
              <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Guest bookings
              </dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {bookingStats.totalGuestBookings}
              </dd>
              <p className="mt-0.5 text-xs text-zinc-500">
                OTA / PM-direct stays
              </p>
            </div>
            <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/50">
              <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Net owner revenue
              </dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {formatMoney(bookingStats.totalRevenue)}
              </dd>
              <p className="mt-0.5 text-xs text-zinc-500">Guest bookings only</p>
            </div>
            <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/50">
              <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Avg nightly rate
              </dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {bookingStats.avgNightly != null
                  ? formatMoney(bookingStats.avgNightly)
                  : "—"}
              </dd>
              <p className="mt-0.5 text-xs text-zinc-500">
                Revenue ÷ nights (guest)
              </p>
            </div>
            <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/50">
              <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Owner & Guest Stays
              </dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {bookingStats.ownerStays}
              </dd>
              <p className="mt-0.5 text-xs text-zinc-500">
                Personal-use and owner guest blocks
              </p>
            </div>
          </dl>
          {performanceRevpar.estimated ? (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              ~ Estimated from partial prior year data
            </p>
          ) : null}
          </>
        )}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          RevPAR trend
        </h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Last 12 months — guest OTA / PM-direct revenue vs. nights available
          (calendar days minus owner stay and owner guest nights).
        </p>
        {properties.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">Loading properties…</p>
        ) : bookingsLoading ? (
          <p className="mt-3 text-sm text-zinc-500">Loading bookings…</p>
        ) : (
          <>
            <div className="mt-4 h-[300px] w-full min-w-0 sm:h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={revparChartData}
                  margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
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
                        benchmarkRevpar: number | null;
                      };
                      return (
                        <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-md dark:border-zinc-700 dark:bg-zinc-900">
                          <p className="font-medium text-zinc-900 dark:text-zinc-50">
                            {label}
                          </p>
                          <p className="mt-1 text-blue-600 dark:text-blue-400">
                            Property RevPAR:{" "}
                            {row.propertyRevpar != null
                              ? formatMoneyCompact(row.propertyRevpar)
                              : "—"}
                          </p>
                          {hasBenchmarkSeries ? (
                            <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                              Market benchmark:{" "}
                              {row.benchmarkRevpar != null
                                ? formatMoneyCompact(row.benchmarkRevpar)
                                : "—"}
                            </p>
                          ) : null}
                        </div>
                      );
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="propertyRevpar"
                    name="Property RevPAR"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "#2563eb" }}
                    connectNulls={false}
                  />
                  {hasBenchmarkSeries ? (
                    <Line
                      type="monotone"
                      dataKey="benchmarkRevpar"
                      name="Market benchmark"
                      stroke="#a1a1aa"
                      strokeWidth={2}
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
