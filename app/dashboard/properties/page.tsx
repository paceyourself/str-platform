"use client";

import { createClient } from "@/lib/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  beachProximityLabel,
  propertyTypeLabel,
} from "./property-form-shared";

type PropertyRow = {
  id: string;
  property_name: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  bedroom_count: number | string | null;
  property_type: string | null;
  beach_proximity: string | null;
};

export default function PropertiesListPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [pmByPropertyId, setPmByPropertyId] = useState<
    Map<string, string | null>
  >(new Map());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      router.replace("/login");
      return;
    }

    const { data: rows, error: qErr } = await supabase
      .from("properties")
      .select(
        "id, property_name, address_line1, city, state, bedroom_count, property_type, beach_proximity"
      )
      .eq("owner_id", user.id)
      .is("deleted_at", null)
      .order("property_name", { ascending: true, nullsFirst: false });

    setLoading(false);
    if (qErr) {
      setError(qErr.message);
      setProperties([]);
      setPmByPropertyId(new Map());
      return;
    }

    const list = (rows as PropertyRow[]) ?? [];
    setProperties(list);

    const ids = list.map((p) => p.id).filter(Boolean);
    const pmMap = new Map<string, string | null>();
    if (ids.length === 0) {
      setPmByPropertyId(pmMap);
      return;
    }

    const { data: rels, error: relErr } = await supabase
      .from("owner_pm_relationships")
      .select(
        `
        property_id,
        start_date,
        pm_profiles ( company_name )
      `
      )
      .in("property_id", ids)
      .eq("owner_id", user.id)
      .eq("active", true)
      .order("start_date", { ascending: false, nullsFirst: false });

    if (relErr) {
      console.warn(relErr);
      setPmByPropertyId(pmMap);
      return;
    }

    type RelQ = {
      property_id: string;
      pm_profiles:
        | { company_name: string | null }
        | { company_name: string | null }[]
        | null;
    };

    for (const r of (rels as RelQ[]) ?? []) {
      const pid = r.property_id;
      if (pmMap.has(pid)) continue;
      const pm = r.pm_profiles;
      const name =
        pm == null
          ? null
          : Array.isArray(pm)
            ? (pm[0]?.company_name ?? null)
            : (pm.company_name ?? null);
      pmMap.set(pid, name?.trim() || null);
    }
    setPmByPropertyId(pmMap);
  }, [router, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const empty = useMemo(() => !loading && properties.length === 0, [
    loading,
    properties.length,
  ]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            <Link href="/dashboard" className="hover:underline">
              Dashboard
            </Link>
            <span className="mx-2">/</span>
            Properties
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            My Properties
          </h1>
        </div>
        <Link
          href="/dashboard/properties/new"
          className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Add another property
        </Link>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-zinc-500">Loading properties…</p>
      ) : empty ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            You don&apos;t have any properties yet.
          </p>
          <Link
            href="/dashboard/properties/new"
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Add a property
          </Link>
        </div>
      ) : (
        <ul className="space-y-4">
          {properties.map((p) => {
            const pmName = pmByPropertyId.get(p.id);
            const beds = Number(p.bedroom_count);
            const bedLabel = Number.isFinite(beds) ? String(beds) : "—";
            return (
              <li
                key={p.id}
                className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
              >
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  {p.property_name?.trim() || "Unnamed property"}
                </h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {[p.address_line1?.trim(), p.city?.trim(), p.state?.trim()]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </p>
                <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-zinc-500 dark:text-zinc-400">
                      Bedrooms
                    </dt>
                    <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                      {bedLabel}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500 dark:text-zinc-400">Type</dt>
                    <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                      {propertyTypeLabel(p.property_type)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500 dark:text-zinc-400">Beach</dt>
                    <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                      {beachProximityLabel(p.beach_proximity)}
                    </dd>
                  </div>
                </dl>
                <p className="mt-4 text-sm">
                  <span className="text-zinc-500 dark:text-zinc-400">
                    Current PM:{" "}
                  </span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    {pmName ?? "None"}
                  </span>
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href={`/dashboard/properties/${p.id}/edit`}
                    className="inline-flex items-center justify-center rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    Edit
                  </Link>
                  <Link
                    href={`/dashboard/properties/${p.id}/pm`}
                    className="inline-flex items-center justify-center rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    {pmName ? "Update PM" : "Add PM"}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
