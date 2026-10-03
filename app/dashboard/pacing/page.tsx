"use client";

/**
 * Row 157 — Pacing view vs. PM forecast.
 * Spec: Sprint 23 Amendment 1 §§3.5–3.6.
 */

import {
  computePacingMonthRows,
  formatBookingsAsOf,
  formatPacingCurrency,
  type PacingBooking,
  type PacingForecastWeek,
} from "@/lib/pacing";
import { createClient } from "@/lib/supabase";
import { useEffect, useMemo, useState } from "react";

type PropertyRow = {
  id: string;
  property_name: string | null;
  address_line1: string | null;
  market_id: string | null;
};

type PmRelRow = {
  property_id: string;
  pm_id: string;
};

type ViewLevel = "portfolio" | "market" | "pm" | "property";

function propertyLabel(p: PropertyRow): string {
  return p.property_name?.trim() || p.address_line1?.trim() || "Property";
}

function formatMarketLabel(id: string, displayName?: string | null): string {
  const name = displayName?.trim();
  return name || id;
}

export default function PacingPage() {
  const supabase = useMemo(() => createClient(), []);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [bookings, setBookings] = useState<PacingBooking[]>([]);
  const [forecastWeeks, setForecastWeeks] = useState<PacingForecastWeek[]>([]);
  const [propertiesWithForecast, setPropertiesWithForecast] = useState<
    Set<string>
  >(new Set());
  const [pmByProperty, setPmByProperty] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [pmLabels, setPmLabels] = useState<Map<string, string>>(() => new Map());
  const [marketLabels, setMarketLabels] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [latestUploadAt, setLatestUploadAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [viewLevel, setViewLevel] = useState<ViewLevel>("portfolio");
  const [selectedMarketId, setSelectedMarketId] = useState("");
  const [selectedPmIdView, setSelectedPmIdView] = useState("");
  const [selectedPropertyId, setSelectedPropertyId] = useState("");

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      setError(null);

      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();
      if (cancel) return;
      if (userErr || !user) {
        setError("Not signed in");
        setLoading(false);
        return;
      }

      const { data: props, error: propErr } = await supabase
        .from("properties")
        .select("id, property_name, address_line1, market_id")
        .eq("owner_id", user.id)
        .is("deleted_at", null)
        .order("property_name");
      if (cancel) return;
      if (propErr) {
        setError(propErr.message);
        setLoading(false);
        return;
      }
      const propertyRows = (props ?? []) as PropertyRow[];
      setProperties(propertyRows);
      const propertyIds = propertyRows.map((p) => p.id);
      if (propertyIds.length === 0) {
        setBookings([]);
        setForecastWeeks([]);
        setPropertiesWithForecast(new Set());
        setLatestUploadAt(null);
        setLoading(false);
        return;
      }

      const marketIds = [
        ...new Set(
          propertyRows.map((p) => (p.market_id ?? "").trim()).filter(Boolean),
        ),
      ];

      const [bookRes, relRes, forecastRes, uploadRes, marketRes] =
        await Promise.all([
          supabase
            .from("bookings")
            .select(
              "property_id, check_in, check_out, gross_revenue, cancelled_at",
            )
            .in("property_id", propertyIds),
          supabase
            .from("owner_pm_relationships")
            .select("property_id, pm_id")
            .in("property_id", propertyIds)
            .is("end_date", null),
          supabase
            .from("pm_forecasts")
            .select(
              "id, property_id, is_owner_selected, pm_forecast_weeks(week_start_date, projected_nightly_rate, projected_nights)",
            )
            .in("property_id", propertyIds)
            .eq("is_owner_selected", true),
          supabase
            .from("upload_batches")
            .select("uploaded_at")
            .in("property_id", propertyIds)
            .order("uploaded_at", { ascending: false })
            .limit(1),
          marketIds.length === 1
            ? supabase
                .from("markets")
                .select("id, display_name")
                .eq("id", marketIds[0])
            : marketIds.length > 1
              ? supabase
                  .from("markets")
                  .select("id, display_name")
                  .in("id", marketIds)
              : Promise.resolve({ data: [], error: null }),
        ]);

      if (cancel) return;

      if (bookRes.error) {
        setError(bookRes.error.message);
        setLoading(false);
        return;
      }
      setBookings((bookRes.data as PacingBooking[]) ?? []);

      const rels = (relRes.data ?? []) as PmRelRow[];
      const pmMap = new Map<string, string>();
      for (const r of rels) {
        if (r.property_id && r.pm_id) pmMap.set(r.property_id, r.pm_id);
      }
      setPmByProperty(pmMap);

      const pmIds = [...new Set([...pmMap.values()])];
      if (pmIds.length > 0) {
        const { data: pms } = await supabase
          .from("pm_profiles")
          .select("id, company_name")
          .in("id", pmIds);
        if (!cancel) {
          const labels = new Map<string, string>();
          for (const pm of pms ?? []) {
            const row = pm as {
              id: string;
              company_name: string | null;
            };
            labels.set(
              row.id,
              row.company_name?.trim() || row.id.slice(0, 8),
            );
          }
          setPmLabels(labels);
        }
      }

      const mLabels = new Map<string, string>();
      for (const m of (marketRes.data ?? []) as {
        id: string;
        display_name: string | null;
      }[]) {
        mLabels.set(m.id, m.display_name?.trim() || m.id);
      }
      setMarketLabels(mLabels);

      const withForecast = new Set<string>();
      const weeks: PacingForecastWeek[] = [];
      type ForecastJoin = {
        id: string;
        property_id: string;
        is_owner_selected: boolean;
        pm_forecast_weeks:
          | {
              week_start_date: string;
              projected_nightly_rate: number | string;
              projected_nights: number | string;
            }[]
          | null;
      };
      for (const f of (forecastRes.data ?? []) as ForecastJoin[]) {
        if (!f.is_owner_selected || !f.property_id) continue;
        withForecast.add(f.property_id);
        for (const w of f.pm_forecast_weeks ?? []) {
          weeks.push({
            property_id: f.property_id,
            week_start_date: w.week_start_date,
            projected_nightly_rate: w.projected_nightly_rate,
            projected_nights: w.projected_nights,
          });
        }
      }
      setPropertiesWithForecast(withForecast);
      setForecastWeeks(weeks);

      const uploadRow = (uploadRes.data ?? [])[0] as
        | { uploaded_at: string }
        | undefined;
      setLatestUploadAt(uploadRow?.uploaded_at ?? null);
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [supabase]);

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

  const hasAnyPmAssignment = pmByProperty.size > 0;

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
    return properties
      .filter(
        (p) =>
          (p.market_id ?? "").trim() === selectedMarketId &&
          pmByProperty.get(p.id) === selectedPmIdView,
      )
      .sort((a, b) => propertyLabel(a).localeCompare(propertyLabel(b)));
  }, [properties, selectedMarketId, selectedPmIdView, pmByProperty]);

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

  const scopedIds = useMemo(
    () => new Set(scopedProperties.map((p) => p.id)),
    [scopedProperties],
  );

  const scopedBookings = useMemo(
    () => bookings.filter((b) => b.property_id && scopedIds.has(b.property_id)),
    [bookings, scopedIds],
  );

  const scopedWeeks = useMemo(
    () => forecastWeeks.filter((w) => scopedIds.has(w.property_id)),
    [forecastWeeks, scopedIds],
  );

  const hasOwnerSelectedForecast = useMemo(() => {
    if (scopedProperties.length === 0) return false;
    if (viewLevel === "property") {
      return (
        !!selectedPropertyId && propertiesWithForecast.has(selectedPropertyId)
      );
    }
    return scopedProperties.some((p) => propertiesWithForecast.has(p.id));
  }, [
    scopedProperties,
    viewLevel,
    selectedPropertyId,
    propertiesWithForecast,
  ]);

  const showNoForecastEmpty =
    viewLevel === "property" &&
    !!selectedPropertyId &&
    !propertiesWithForecast.has(selectedPropertyId);

  const rows = useMemo(
    () =>
      computePacingMonthRows({
        bookings: scopedBookings,
        forecastWeeks: scopedWeeks,
        hasOwnerSelectedForecast,
      }),
    [scopedBookings, scopedWeeks, hasOwnerSelectedForecast],
  );

  const bookingsAsOf = formatBookingsAsOf(latestUploadAt);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Pacing
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          On-the-books bookings versus the owner-selected PM forecast for the
          rest of the year.
        </p>
        {bookingsAsOf ? (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Bookings as of {bookingsAsOf}
          </p>
        ) : null}
      </div>

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
                <select
                  className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
                  value={selectedPropertyId}
                  onChange={(e) => setSelectedPropertyId(e.target.value)}
                >
                  {hierarchyPropertiesForPm.map((p) => (
                    <option key={p.id} value={p.id}>
                      {propertyLabel(p)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">Loading pacing…</p>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : properties.length === 0 ? (
        <p className="text-sm text-zinc-500">No properties on file.</p>
      ) : viewLevel === "property" && !selectedPropertyId ? (
        <p className="text-sm text-zinc-500">Select a property to view pacing.</p>
      ) : (
        <div className="space-y-3">
          {showNoForecastEmpty ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
              No PM forecast on file
            </p>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-3">Month</th>
                  <th className="px-4 py-3 text-right">On the books</th>
                  <th className="px-4 py-3 text-right">Plan</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={`${row.year}-${row.month}`}
                    className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                  >
                    <td className="px-4 py-3 text-zinc-900 dark:text-zinc-50">
                      {row.label}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-900 dark:text-zinc-50">
                      {formatPacingCurrency(row.onTheBooks)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-900 dark:text-zinc-50">
                      {row.plan == null
                        ? "—"
                        : formatPacingCurrency(row.plan)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Plan nights are spread evenly within each week.
          </p>
        </div>
      )}
    </div>
  );
}
