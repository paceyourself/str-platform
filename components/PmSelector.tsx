"use client";

import { createClient } from "@/lib/supabase";
import { useCallback, useEffect, useState } from "react";

type RelOption = {
  rel_id: string;
  pm_id: string;
  start_date: string | null;
  company_name: string | null;
  property_id: string | null;
  property_label: string;
};

export type PmSelection = {
  rel_id: string;
  pm_id: string;
  company_name: string | null;
  start_date: string | null;
  property_id?: string | null;
};

type Props = {
  onSelect: (selection: PmSelection | null) => void;
};

function propertyLine(p: {
  property_name: string | null;
  address_line1: string | null;
}) {
  return p.property_name?.trim() || p.address_line1?.trim() || "Property";
}

export default function PmSelector({ onSelect }: Props) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<RelOption[]>([]);
  const [selectedRelId, setSelectedRelId] = useState("");

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
        rels.map((r) => r.property_id as string).filter(Boolean),
      ),
    ];

    const { data: propData } = await supabase
      .from("properties")
      .select("id, property_name, address_line1, city")
      .in("id", propIds);

    const pmMap = new Map(
      (pmData ?? []).map((p) => [
        p.id as string,
        p.company_name as string | null,
      ]),
    );
    const propMap = new Map(
      (propData ?? []).map((p) => [p.id as string, p]),
    );

    // One option per relationship so mixed verification states are selectable.
    const next: RelOption[] = rels.map((r) => {
      const prop = r.property_id
        ? propMap.get(r.property_id as string)
        : undefined;
      return {
        rel_id: r.id as string,
        pm_id: r.pm_id as string,
        start_date: (r.start_date as string | null) ?? null,
        company_name: pmMap.get(r.pm_id as string) ?? null,
        property_id: (r.property_id as string | null) ?? null,
        property_label: prop
          ? propertyLine(
              prop as {
                property_name: string | null;
                address_line1: string | null;
              },
            )
          : "Property",
      };
    });

    setLoading(false);
    setOptions(next);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleChange(relId: string) {
    setSelectedRelId(relId);
    if (!relId) {
      onSelect(null);
      return;
    }
    const opt = options.find((o) => o.rel_id === relId);
    if (!opt) {
      onSelect(null);
      return;
    }
    onSelect({
      rel_id: opt.rel_id,
      pm_id: opt.pm_id,
      company_name: opt.company_name,
      start_date: opt.start_date,
      property_id: opt.property_id,
    });
  }

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading…</p>;
  }

  if (options.length === 0) {
    return (
      <p className="text-sm text-amber-800 dark:text-amber-200">
        No active PM relationships found. Complete onboarding first.
      </p>
    );
  }

  const selected = options.find((o) => o.rel_id === selectedRelId);

  return (
    <div className="space-y-2">
      <select
        value={selectedRelId}
        onChange={(e) => handleChange(e.target.value)}
        required
        className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
      >
        <option value="">Select a property / PM…</option>
        {options.map((o) => (
          <option key={o.rel_id} value={o.rel_id}>
            {o.property_label} — {o.company_name ?? "Unknown PM"}
          </option>
        ))}
      </select>

      {selected ? (
        <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            Selected
          </p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {selected.property_label} · {selected.company_name ?? "Unknown PM"}
          </p>
        </div>
      ) : null}
    </div>
  );
}
