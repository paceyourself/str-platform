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

type PropertyGroupRow = {
  id: string;
  group_name: string | null;
};

/** Resolves dashboard scope: `all`, `group:[id]`, or a property UUID. */
function propertyIdsForDashboardSelection(
  selection: string,
  properties: PropertyRow[],
  groupMap: Record<string, string[]>
): string[] {
  const ownerIds = new Set(properties.map((p) => p.id));
  if (selection === "all") {
    return properties.map((p) => p.id);
  }
  if (selection.startsWith("group:")) {
    const gid = selection.slice("group:".length);
    return (groupMap[gid] ?? []).filter((id) => ownerIds.has(id));
  }
  if (ownerIds.has(selection)) return [selection];
  return [];
}

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

const PM_REQUEST_TYPE_LABELS: Record<string, string> = {
  maintenance_work_order: "Maintenance work order",
  vendor_selection: "Vendor selection",
  guest_decision: "Guest decision",
  owner_action_required: "Owner action required",
};

/** Nested embed from PostgREST; fields optional so query rows align with Supabase client inference. */
type PmRequestPropertiesEmbed = {
  property_name?: string | null;
};

type PmRequestOwnerPmRelEmbed = {
  contract_maintenance_threshold?: number | string | null;
  properties?:
    | PmRequestPropertiesEmbed
    | PmRequestPropertiesEmbed[]
    | null;
};

/** Shape of `tickets` rows from loadPmRequests select (pm_to_owner). */
type PmRequestTicketRow = {
  id: string;
  request_type: string | null;
  title: string;
  description: string | null;
  dollar_amount: number | string | null;
  status: string;
  created_at: string;
  proposed_vendor: string | null;
  direction: string;
  owner_pm_relationships?:
    | PmRequestOwnerPmRelEmbed
    | PmRequestOwnerPmRelEmbed[]
    | null;
};

function pmRequestPropertyName(t: PmRequestTicketRow): string {
  const rel = t.owner_pm_relationships;
  const r = rel == null ? null : Array.isArray(rel) ? rel[0] : rel;
  const p = r?.properties;
  const prop = p == null ? null : Array.isArray(p) ? p[0] : p;
  return prop?.property_name?.trim() || "Property";
}

function pmRequestExceedsThreshold(t: PmRequestTicketRow): boolean {
  const raw = t.dollar_amount;
  if (raw == null || raw === "") return false;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return false;
  const rel = t.owner_pm_relationships;
  const r = rel == null ? null : Array.isArray(rel) ? rel[0] : rel;
  const th = r?.contract_maintenance_threshold;
  if (th == null) return false;
  const limit = typeof th === "number" ? th : Number(th);
  if (!Number.isFinite(limit)) return false;
  return n > limit;
}

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
  const [propertyGroups, setPropertyGroups] = useState<PropertyGroupRow[]>([]);
  const [groupPropertyIds, setGroupPropertyIds] = useState<
    Record<string, string[]>
  >({});
  const [selectedScope, setSelectedScope] = useState("");
  const [propertiesLoading, setPropertiesLoading] = useState(true);

  const [pmRow, setPmRow] = useState<OwnerPmRow | null>(null);
  const [pmLoading, setPmLoading] = useState(false);

  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);

  const [benchmarkRows, setBenchmarkRows] = useState<BenchmarkRow[]>([]);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);

  const [timeRange, setTimeRange] = useState<"year" | "all">("year");

  const [pmRequests, setPmRequests] = useState<PmRequestTicketRow[]>([]);
  const [pmRequestsLoading, setPmRequestsLoading] = useState(false);
  const [pmRequestsError, setPmRequestsError] = useState<string | null>(null);
  const [pmRequestActionId, setPmRequestActionId] = useState<string | null>(
    null
  );
  const [pmContractExpanded, setPmContractExpanded] = useState(false);

  const [surveyPendingCount, setSurveyPendingCount] = useState<number | null>(
    null
  );
  const [ticketsAwaitingCount, setTicketsAwaitingCount] = useState<
    number | null
  >(null);
  const [pmRequestsCount, setPmRequestsCount] = useState<number | null>(null);

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

      const [
        { count: surveyCount, error: surveyErr },
        { count: awaitingCount, error: awaitingErr },
        pmRequestsCountResult,
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

    const [propsRes, groupsRes] = await Promise.all([
      supabase
        .from("properties")
        .select("id, property_name, address_line1, city, market_id")
        .eq("owner_id", user.id)
        .order("property_name", { ascending: true, nullsFirst: false })
        .order("address_line1", { ascending: true, nullsFirst: false }),
      supabase
        .from("property_groups")
        .select("id, group_name")
        .eq("owner_id", user.id),
    ]);

    setPropertiesLoading(false);
    if (propsRes.error) {
      console.error(propsRes.error);
      setProperties([]);
      setPropertyGroups([]);
      setGroupPropertyIds({});
      return;
    }
    const list = (propsRes.data as PropertyRow[]) ?? [];
    if (list.length === 0) {
      router.push("/onboarding");
      return;
    }
    setProperties(list);

    let groupsList: PropertyGroupRow[] = [];
    const nextGroupMap: Record<string, string[]> = {};
    if (groupsRes.error) {
      console.warn(groupsRes.error);
      setPropertyGroups([]);
      setGroupPropertyIds({});
    } else {
      groupsList = (groupsRes.data as PropertyGroupRow[]) ?? [];
      setPropertyGroups(groupsList);
      const gids = groupsList.map((g) => g.id).filter(Boolean);
      if (gids.length > 0) {
        const { data: memRows, error: memErr } = await supabase
          .from("property_group_members")
          .select("group_id, property_id")
          .in("group_id", gids);
        if (memErr) {
          console.warn(memErr);
        } else {
          for (const row of (memRows ?? []) as {
            group_id: string;
            property_id: string;
          }[]) {
            const gid = row.group_id;
            const pid = row.property_id;
            if (!gid || !pid) continue;
            if (!nextGroupMap[gid]) nextGroupMap[gid] = [];
            nextGroupMap[gid].push(pid);
          }
        }
      }
      setGroupPropertyIds(nextGroupMap);
    }

    const showTieredSelect =
      list.length >= 1;
    setSelectedScope((prev) => {
      if (showTieredSelect) {
        if (prev === "all") return "all";
        if (prev.startsWith("group:")) {
          const gid = prev.slice("group:".length);
          if (groupsList.some((g) => g.id === gid)) return prev;
        }
        if (list.some((p) => p.id === prev)) return prev;
        return "all";
      }
      if (prev && list.some((p) => p.id === prev)) return prev;
      return list[0]?.id ?? "";
    });
  }, [router, supabase]);

  const loadPmAndBookings = useCallback(async () => {
    const scopeIds = propertyIdsForDashboardSelection(
      selectedScope,
      properties,
      groupPropertyIds
    );
    if (scopeIds.length === 0) {
      setPmRow(null);
      setBookings([]);
      setBenchmarkRows([]);
      return;
    }

    setPmLoading(true);
    setBookingsLoading(true);

    if (scopeIds.length === 1) {
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
        .eq("property_id", scopeIds[0])
        .eq("active", true)
        .order("start_date", { ascending: false, nullsFirst: false })
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
    } else {
      setPmRow(null);
    }
    setPmLoading(false);

    const bookRes =
      scopeIds.length === 1
        ? await supabase
            .from("bookings")
            .select(
              "block_type, net_owner_revenue, nights, check_in, check_out"
            )
            .eq("property_id", scopeIds[0])
        : await supabase
            .from("bookings")
            .select(
              "block_type, net_owner_revenue, nights, check_in, check_out"
            )
            .in("property_id", scopeIds);

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
  }, [groupPropertyIds, properties, selectedScope, supabase]);

  const loadBenchmarks = useCallback(async () => {
    const scopeIds = propertyIdsForDashboardSelection(
      selectedScope,
      properties,
      groupPropertyIds
    );
    if (scopeIds.length === 0) {
      setBenchmarkRows([]);
      return;
    }
    let mid: string | undefined;
    for (const id of scopeIds) {
      const prop = properties.find((p) => p.id === id);
      const m = prop?.market_id?.trim();
      if (m) {
        mid = m;
        break;
      }
    }
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
  }, [groupPropertyIds, properties, selectedScope, supabase]);

  useEffect(() => {
    loadProperties();
  }, [loadProperties]);

  useEffect(() => {
    loadPmAndBookings();
  }, [loadPmAndBookings]);

  useEffect(() => {
    loadBenchmarks();
  }, [loadBenchmarks]);

  const selectedPropertyIds = useMemo(
    () =>
      propertyIdsForDashboardSelection(
        selectedScope,
        properties,
        groupPropertyIds
      ),
    [groupPropertyIds, properties, selectedScope]
  );

  const loadPmRequests = useCallback(async () => {
    setPmRequestsLoading(true);
    setPmRequestsError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPmRequestsLoading(false);
      setPmRequests([]);
      return;
    }

    const { data: rels, error: relErr } = await supabase
      .from("owner_pm_relationships")
      .select("id")
      .eq("owner_id", user.id)
      .eq("active", true);

    if (relErr) {
      setPmRequestsLoading(false);
      setPmRequestsError(relErr.message);
      setPmRequests([]);
      return;
    }

    const relIds = (rels ?? []).map((r) => r.id as string).filter(Boolean);
    if (relIds.length === 0) {
      setPmRequestsLoading(false);
      setPmRequests([]);
      return;
    }

    const { data: tickets, error: tErr } = await supabase
      .from("tickets")
      .select(
        `
        id,
        request_type,
        title,
        description,
        dollar_amount,
        status,
        created_at,
        proposed_vendor,
        direction,
        owner_pm_relationships (
          contract_maintenance_threshold,
          properties ( property_name )
        )
      `
      )
      .eq("direction", "pm_to_owner")
      .in("owner_pm_relationship_id", relIds)
      .order("created_at", { ascending: false });

    setPmRequestsLoading(false);
    if (tErr) {
      setPmRequestsError(tErr.message);
      setPmRequests([]);
      return;
    }
    setPmRequests((tickets as PmRequestTicketRow[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    loadPmRequests();
  }, [loadPmRequests]);

  const approvePmRequest = async (id: string) => {
    setPmRequestActionId(id);
    const { error } = await supabase
      .from("tickets")
      .update({
        status: "acknowledged",
        acknowledged_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "open");
    setPmRequestActionId(null);
    if (error) {
      alert(error.message);
      return;
    }
    loadPmRequests();
  };

  const declinePmRequest = async (id: string) => {
    setPmRequestActionId(id);
    const { error } = await supabase
      .from("tickets")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolution_note: "Declined by owner",
      })
      .eq("id", id)
      .eq("status", "open");
    setPmRequestActionId(null);
    if (error) {
      alert(error.message);
      return;
    }
    loadPmRequests();
  };

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
          Quick actions
        </h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/dashboard/upload"
            className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Upload bookings
          </Link>
          <Link
            href="/dashboard/tickets/new"
            className="inline-flex items-center justify-center rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            File a ticket
          </Link>
          <Link
            href="/dashboard/reviews/new"
            className="inline-flex items-center justify-center rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Write a review
          </Link>
          <Link
            href="/dashboard/properties"
            className="inline-flex items-center justify-center rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Manage properties
          </Link>
          <Link
            href="/dashboard/statements/new"
            className="inline-flex items-center justify-center rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Upload statement
          </Link>
        </div>
      </section>

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
        ) : properties.length === 1 && propertyGroups.length === 0 ? (
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
              value={selectedScope}
              onChange={(e) => setSelectedScope(e.target.value)}
              className="block w-full max-w-md rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
            >
              <option value="all">All properties</option>
              {propertyGroups.length > 0 ? (
                <optgroup label="Groups">
                  {propertyGroups.map((g) => (
                    <option key={g.id} value={`group:${g.id}`}>
                      {g.group_name?.trim() || "Unnamed group"}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label="Properties">
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {propertyLabel(p)}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Current property manager
        </h2>
        {selectedPropertyIds.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">Select a property.</p>
        ) : selectedPropertyIds.length > 1 ? (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            Select a single property to view PM contract details.
          </p>
        ) : pmLoading ? (
          <p className="mt-3 text-sm text-zinc-500">Loading…</p>
        ) : !pmRow ? (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            No PM associated
          </p>
        ) : (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setPmContractExpanded((v) => !v)}
              aria-expanded={pmContractExpanded}
              className="flex w-full items-center gap-2 rounded-lg text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-50">
                    {pmProfileCompanyName(pmRow.pm_profiles) ?? "—"}
                  </span>
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    Contract start{" "}
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                      {formatDate(pmRow.start_date)}
                    </span>
                  </span>
                </div>
              </div>
              <svg
                className={`size-5 shrink-0 text-zinc-500 transition-transform dark:text-zinc-400 ${
                  pmContractExpanded ? "rotate-180" : ""
                }`}
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            {pmContractExpanded ? (
              <dl className="mt-3 grid gap-3 border-t border-zinc-200 pt-3 text-sm sm:grid-cols-2 dark:border-zinc-700">
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
            ) : null}
          </div>
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

        {selectedPropertyIds.length === 0 ? (
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
        {selectedPropertyIds.length === 0 ? (
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
    </div>
  );
}
