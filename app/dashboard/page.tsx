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

type OwnerPmRow = {
  start_date: string | null;
  contract_notice_days: number | null;
  contract_etf_exists: boolean | null;
  contract_listing_transfer: boolean | null;
  contract_maintenance_threshold: number | string | null;
  /** PostgREST may return one object or an array for embedded relations */
  pm_profiles: PmProfileNested | PmProfileNested[] | null;
};

function pmProfileCompanyName(
  nested: OwnerPmRow["pm_profiles"]
): string | null {
  if (nested == null) return null;
  const p = Array.isArray(nested) ? nested[0] : nested;
  return p?.company_name ?? null;
}

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

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
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

function formatMaintenanceThreshold(
  value: number | string | null | undefined
): string {
  if (value == null) return "Not specified";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "Not specified";
  return formatMoney(n);
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

export default function DashboardPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState<string | null>(null);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [propertiesLoading, setPropertiesLoading] = useState(true);

  const [pmRow, setPmRow] = useState<OwnerPmRow | null>(null);
  const [pmLoading, setPmLoading] = useState(false);

  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);

  const [benchmarkRows, setBenchmarkRows] = useState<BenchmarkRow[]>([]);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);

  const [timeRange, setTimeRange] = useState<"year" | "all">("year");

  const currentYear = new Date().getFullYear();

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

    const { data, error } = await supabase
      .from("properties")
      .select("id, property_name, address_line1, city, market_id")
      .eq("owner_id", user.id)
      .order("property_name", { ascending: true, nullsFirst: false })
      .order("address_line1", { ascending: true, nullsFirst: false });

    setPropertiesLoading(false);
    if (error) {
      console.error(error);
      setProperties([]);
      return;
    }
    const list = data ?? [];
    if (list.length === 0) {
      router.push("/onboarding");
      return;
    }
    setProperties(list);
    setSelectedPropertyId((prev) => {
      if (prev && list.some((p) => p.id === prev)) return prev;
      return list[0]?.id ?? "";
    });
  }, [router, supabase]);

  const loadPmAndBookings = useCallback(async () => {
    if (!selectedPropertyId) {
      setPmRow(null);
      setBookings([]);
      setBenchmarkRows([]);
      return;
    }

    setPmLoading(true);
    setBookingsLoading(true);

    const pmRes = await supabase
      .from("owner_pm_relationships")
      .select(
        `
        start_date,
        contract_notice_days,
        contract_etf_exists,
        contract_listing_transfer,
        contract_maintenance_threshold,
        pm_profiles ( company_name )
      `
      )
      .eq("property_id", selectedPropertyId)
      .eq("active", true)
      .limit(1);

    if (pmRes.error) {
      console.error(pmRes.error);
      setPmRow(null);
    } else {
      const first = pmRes.data?.[0];
      setPmRow(
        first != null ? (first as unknown as OwnerPmRow) : null
      );
    }
    setPmLoading(false);

    const bookRes = await supabase
      .from("bookings")
      .select("block_type, net_owner_revenue, nights, check_in, check_out")
      .eq("property_id", selectedPropertyId);

    if (bookRes.error) {
      console.error(bookRes.error);
      setBookings([]);
    } else {
      const bookings = (bookRes.data as BookingRow[]) ?? [];
      console.log(
        "Block types found:",
        [...new Set(bookings.map((b) => b.block_type))]
      );
      setBookings(bookings);
    }
    setBookingsLoading(false);
  }, [selectedPropertyId, supabase]);

  const loadBenchmarks = useCallback(async () => {
    if (!selectedPropertyId) {
      setBenchmarkRows([]);
      return;
    }
    const prop = properties.find((p) => p.id === selectedPropertyId);
    const mid = prop?.market_id?.trim();
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
  }, [properties, selectedPropertyId, supabase]);

  useEffect(() => {
    loadProperties();
  }, [loadProperties]);

  useEffect(() => {
    loadPmAndBookings();
  }, [loadPmAndBookings]);

  useEffect(() => {
    loadBenchmarks();
  }, [loadBenchmarks]);

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

      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Property
        </h2>
        {propertiesLoading ? (
          <p className="mt-3 text-sm text-zinc-500">Loading properties…</p>
        ) : properties.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            No properties yet. Complete onboarding to add one.
          </p>
        ) : properties.length === 1 ? (
          <p className="mt-3 text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {propertyLabel(properties[0])}
          </p>
        ) : (
          <div className="mt-3">
            <label
              htmlFor="property-select"
              className="sr-only"
            >
              Select property
            </label>
            <select
              id="property-select"
              value={selectedPropertyId}
              onChange={(e) => setSelectedPropertyId(e.target.value)}
              className="block w-full max-w-md rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {propertyLabel(p)}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Current property manager
        </h2>
        {!selectedPropertyId ? (
          <p className="mt-3 text-sm text-zinc-500">Select a property.</p>
        ) : pmLoading ? (
          <p className="mt-3 text-sm text-zinc-500">Loading…</p>
        ) : !pmRow ? (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            No PM associated
          </p>
        ) : (
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Company</dt>
              <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                {pmProfileCompanyName(pmRow.pm_profiles) ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">
                Contract start
              </dt>
              <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                {formatDate(pmRow.start_date)}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">
                Notice period (days)
              </dt>
              <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                {pmRow.contract_notice_days ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">
                Early termination fee
              </dt>
              <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                {pmRow.contract_etf_exists === true
                  ? "Yes"
                  : pmRow.contract_etf_exists === false
                    ? "No"
                    : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">
                Maintenance approval threshold
              </dt>
              <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                {formatMaintenanceThreshold(
                  pmRow.contract_maintenance_threshold
                )}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-zinc-500 dark:text-zinc-400">
                Listing transfer on exit
              </dt>
              <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                {pmRow.contract_listing_transfer === true
                  ? "Yes"
                  : pmRow.contract_listing_transfer === false
                    ? "No"
                    : "—"}
              </dd>
            </div>
          </dl>
        )}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Booking summary
          </h2>
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

        {!selectedPropertyId ? (
          <p className="mt-3 text-sm text-zinc-500">Select a property.</p>
        ) : bookingsLoading ? (
          <p className="mt-3 text-sm text-zinc-500">Loading bookings…</p>
        ) : (
          <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
        {!selectedPropertyId ? (
          <p className="mt-3 text-sm text-zinc-500">Select a property.</p>
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
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Quick actions
        </h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/dashboard/upload"
            className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Upload bookings
          </Link>
          <button
            type="button"
            disabled
            className="inline-flex cursor-not-allowed items-center justify-center rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-400 dark:border-zinc-700 dark:text-zinc-500"
            title="Coming soon"
          >
            File a ticket
          </button>
          <button
            type="button"
            disabled
            className="inline-flex cursor-not-allowed items-center justify-center rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-400 dark:border-zinc-700 dark:text-zinc-500"
            title="Coming soon"
          >
            Upload PM statement
          </button>
        </div>
      </section>
    </div>
  );
}
