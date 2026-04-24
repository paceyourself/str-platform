"use client";

import { createClient } from "@/lib/supabase";
import { useCallback, useEffect, useState } from "react";

type PropertyEmbed = {
  id: string;
  property_name: string | null;
  address_line1: string | null;
  city: string | null;
};

type PmGroup = {
  id: string;
  pm_id: string;
  start_date: string | null;
  company_name: string | null;
  properties: PropertyEmbed[];
};

export type PmSelection = {
  rel_id: string;
  pm_id: string;
  company_name: string | null;
  start_date: string | null;
};

type Props = {
  onSelect: (selection: PmSelection | null) => void;
};

function propertyLine(p: PropertyEmbed) {
  return p.property_name?.trim() || p.address_line1?.trim() || "Property";
}

export default function PmSelector({ onSelect }: Props) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [pmGroups, setPmGroups] = useState<PmGroup[]>([]);
  const [selectedPmId, setSelectedPmId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data: rels, error } = await supabase
      .from("owner_pm_relationships")
      .select("id, pm_id, start_date, property_id")
      .eq("owner_id", user.id)
      .eq("active", true)
      .order("start_date", { ascending: true, nullsFirst: false });

    if (error || !rels) {
      setLoading(false);
      return;
    }

    const pmIds = [...new Set(rels.map((r) => r.pm_id as string))];

    const { data: pmData } = await supabase
      .from("pm_profiles")
      .select("id, company_name")
      .in("id", pmIds);

    const propIds = [
      ...new Set(
        rels.map((r) => r.property_id as string).filter(Boolean)
      ),
    ];

    const { data: propData } = await supabase
      .from("properties")
      .select("id, property_name, address_line1, city")
      .in("id", propIds);

    const pmMap = new Map(
      (pmData ?? []).map((p) => [p.id as string, p.company_name as string | null])
    );
    const propMap = new Map(
      (propData ?? []).map((p) => [p.id as string, p as PropertyEmbed])
    );

    const byPm = new Map<string, PmGroup>();
    for (const r of rels) {
      const pmId = r.pm_id as string;
      const prop = r.property_id ? propMap.get(r.property_id as string) : undefined;
      if (!byPm.has(pmId)) {
        byPm.set(pmId, {
          id: r.id as string,
          pm_id: pmId,
          start_date: (r.start_date as string | null) ?? null,
          company_name: pmMap.get(pmId) ?? null,
          properties: prop ? [prop] : [],
        });
      } else {
        if (prop) byPm.get(pmId)!.properties.push(prop);
      }
    }

    setLoading(false);
    setPmGroups([...byPm.values()]);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleChange(pmId: string) {
    setSelectedPmId(pmId);
    if (!pmId) {
      onSelect(null);
      return;
    }
    const group = pmGroups.find((g) => g.pm_id === pmId);
    if (!group) {
      onSelect(null);
      return;
    }
    onSelect({
      rel_id: group.id,
      pm_id: group.pm_id,
      company_name: group.company_name,
      start_date: group.start_date,
    });
  }

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading…</p>;
  }

  if (pmGroups.length === 0) {
    return (
      <p className="text-sm text-amber-800 dark:text-amber-200">
        No active PM relationships found. Complete onboarding first.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <select
        value={selectedPmId}
        onChange={(e) => handleChange(e.target.value)}
        required
        className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
      >
        <option value="">Select a property manager…</option>
        {pmGroups.map((g) => (
          <option key={g.pm_id} value={g.pm_id}>
            {g.company_name ?? "Unknown PM"}
          </option>
        ))}
      </select>

      {selectedPmId && (
        <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            Properties managed
          </p>
          <ul className="mt-1 space-y-0.5">
            {pmGroups
              .find((g) => g.pm_id === selectedPmId)
              ?.properties.map((p) => (
                <li
                  key={p.id}
                  className="pl-3 text-sm text-zinc-600 dark:text-zinc-400"
                >
                  — {propertyLine(p)}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}