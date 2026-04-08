"use client";

import { createClient } from "@/lib/supabase";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type PropertyRow = {
  id: string;
  property_name: string | null;
  address_line1: string | null;
  city: string | null;
};

type PmProfileNested = { company_name: string | null };

type OwnerPmRow = {
  start_date: string | null;
  contract_notice_days: number | null;
  contract_etf_exists: boolean | null;
  contract_listing_transfer: boolean | null;
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

export default function DashboardPage() {
  const supabase = useMemo(() => createClient(), []);

  const [email, setEmail] = useState<string | null>(null);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [propertiesLoading, setPropertiesLoading] = useState(true);

  const [pmRow, setPmRow] = useState<OwnerPmRow | null>(null);
  const [pmLoading, setPmLoading] = useState(false);

  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);

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
      .select("id, property_name, address_line1, city")
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
    setProperties(list);
    setSelectedPropertyId((prev) => {
      if (prev && list.some((p) => p.id === prev)) return prev;
      return list[0]?.id ?? "";
    });
  }, [supabase]);

  const loadPmAndBookings = useCallback(async () => {
    if (!selectedPropertyId) {
      setPmRow(null);
      setBookings([]);
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
      .select("block_type, net_owner_revenue, nights, check_in")
      .eq("property_id", selectedPropertyId);

    if (bookRes.error) {
      console.error(bookRes.error);
      setBookings([]);
    } else {
      setBookings((bookRes.data as BookingRow[]) ?? []);
    }
    setBookingsLoading(false);
  }, [selectedPropertyId, supabase]);

  useEffect(() => {
    loadProperties();
  }, [loadProperties]);

  useEffect(() => {
    loadPmAndBookings();
  }, [loadPmAndBookings]);

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
    const ownerStays = filteredBookings.filter(
      (b) => b.block_type === "owner_stay"
    ).length;

    return {
      totalGuestBookings,
      totalRevenue,
      totalNights,
      avgNightly,
      ownerStays,
    };
  }, [filteredBookings]);

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
                Owner stays
              </dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {bookingStats.ownerStays}
              </dd>
              <p className="mt-0.5 text-xs text-zinc-500">
                <code className="text-[11px]">owner_stay</code>
              </p>
            </div>
          </dl>
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
