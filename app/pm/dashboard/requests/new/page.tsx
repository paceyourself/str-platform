"use client";

import { createClient } from "@/lib/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const REQUEST_TYPES = [
  { value: "maintenance_work_order", label: "Maintenance work order" },
  { value: "vendor_selection", label: "Vendor selection" },
  { value: "guest_decision", label: "Guest decision" },
  { value: "owner_action_required", label: "Owner action required" },
] as const;

type PropertyEmbed = {
  property_name: string | null;
  address_line1: string | null;
};

type RelOption = {
  id: string;
  owner_id: string;
  contract_maintenance_threshold: number | string | null;
  /** Merged from a separate `properties` query (embeds are often null under PM RLS). */
  properties: PropertyEmbed | null;
};

function propertyLine(p: PropertyEmbed | null) {
  if (!p) return "Property";
  return (
    p.property_name?.trim() ||
    p.address_line1?.trim() ||
    "Property"
  );
}

/** Tickets.queue is NOT NULL; pm_to_owner uses request_type for the real category. */
function defaultQueueForPmRequest(rt: string): string {
  switch (rt) {
    case "maintenance_work_order":
    case "vendor_selection":
      return "maintenance";
    case "guest_decision":
    case "owner_action_required":
      return "communication";
    default:
      return "communication";
  }
}

export default function PmNewRequestPage() {
  const router = useRouter();
  const supabase = createClient();

  const [pmProfileId, setPmProfileId] = useState<string | null>(null);
  const [loadingPm, setLoadingPm] = useState(true);
  const [relationships, setRelationships] = useState<RelOption[]>([]);
  const [relId, setRelId] = useState("");
  const [requestType, setRequestType] = useState<string>(
    REQUEST_TYPES[0].value
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dollarAmount, setDollarAmount] = useState("");
  const [proposedVendor, setProposedVendor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedRel = useMemo(
    () => relationships.find((r) => r.id === relId) ?? null,
    [relationships, relId]
  );

  const showVendorFields =
    requestType === "vendor_selection" ||
    requestType === "maintenance_work_order";

  const thresholdWarning = useMemo(() => {
    if (!selectedRel) return null;
    const raw = dollarAmount.trim();
    if (!raw) return null;
    const amt = Number(raw.replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(amt) || amt <= 0) return null;
    const th = selectedRel.contract_maintenance_threshold;
    if (th == null) return null;
    const limit = typeof th === "number" ? th : Number(th);
    if (!Number.isFinite(limit)) return null;
    if (amt <= limit) return null;
    return limit;
  }, [selectedRel, dollarAmount]);

  const load = useCallback(async () => {
    setLoadingPm(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoadingPm(false);
      router.replace("/login");
      return;
    }

    const { data: profile, error: pErr } = await supabase
      .from("pm_profiles")
      .select("id, profile_claimed")
      .eq("claimed_by_user_id", user.id)
      .maybeSingle();

    if (pErr || !profile?.id || !profile.profile_claimed) {
      setLoadingPm(false);
      setPmProfileId(null);
      setRelationships([]);
      return;
    }

    setPmProfileId(profile.id as string);

    const { data: rels, error: rErr } = await supabase
      .from("owner_pm_relationships")
      .select("id, owner_id, property_id, contract_maintenance_threshold")
      .eq("pm_id", profile.id)
      .eq("active", true)
      .order("id", { ascending: true });

    if (rErr) {
      setLoadingPm(false);
      setError(rErr.message);
      setRelationships([]);
      return;
    }

    const relRows =
      (rels as {
        id: string;
        owner_id: string;
        property_id: string | null;
        contract_maintenance_threshold: number | string | null;
      }[]) ?? [];

    const propIds = [
      ...new Set(
        relRows.map((r) => r.property_id).filter((id): id is string => !!id)
      ),
    ];

    const propMap = new Map<string, PropertyEmbed>();
    if (propIds.length > 0) {
      const { data: props, error: pErr } = await supabase
        .from("properties")
        .select("id, property_name, address_line1")
        .in("id", propIds);

      if (pErr) {
        setLoadingPm(false);
        setError(pErr.message);
        setRelationships([]);
        return;
      }
      for (const row of props ?? []) {
        const id = row.id as string;
        propMap.set(id, {
          property_name: row.property_name as string | null,
          address_line1: row.address_line1 as string | null,
        });
      }
    }

    setLoadingPm(false);

    const list: RelOption[] = relRows.map((r) => ({
      id: r.id,
      owner_id: r.owner_id,
      contract_maintenance_threshold: r.contract_maintenance_threshold,
      properties: r.property_id ? propMap.get(r.property_id) ?? null : null,
    }));

    setRelationships(list);
    if (list.length === 1) setRelId(list[0].id);
  }, [router, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!pmProfileId || !selectedRel) {
      setError("Select a property / owner relationship.");
      return;
    }

    setSubmitting(true);

    const payload: Record<string, unknown> = {
      owner_id: selectedRel.owner_id,
      pm_id: pmProfileId,
      owner_pm_relationship_id: selectedRel.id,
      direction: "pm_to_owner",
      queue: defaultQueueForPmRequest(requestType),
      request_type: requestType,
      title: title.trim(),
      description: description.trim(),
      status: "open",
    };

    if (dollarAmount.trim()) {
      const n = Number(dollarAmount.replace(/[^0-9.-]/g, ""));
      if (Number.isFinite(n)) payload.dollar_amount = n;
    }
    if (showVendorFields && proposedVendor.trim()) {
      payload.proposed_vendor = proposedVendor.trim();
    }

    const { error: insErr } = await supabase.from("tickets").insert(payload);

    setSubmitting(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }

    router.push("/pm/dashboard");
    router.refresh();
  }

  if (loadingPm) {
    return <p className="text-sm text-zinc-500">Loading…</p>;
  }

  if (!pmProfileId) {
    return (
      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          You need an approved PM profile to submit requests.
        </p>
        <Link
          href="/pm/dashboard"
          className="mt-2 inline-block text-sm font-medium underline"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/pm/dashboard"
          className="text-sm font-medium text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
        >
          ← Back to dashboard
        </Link>
        <h1 className="mt-4 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Submit request to owner
        </h1>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
        >
          {error}
        </div>
      ) : null}

      {thresholdWarning != null ? (
        <div
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100"
        >
          This request exceeds your contract approval threshold of{" "}
          {new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0,
          }).format(thresholdWarning)}{" "}
          and requires owner approval.
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label
            htmlFor="rel"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Property / owner
          </label>
          <select
            id="rel"
            required
            value={relId}
            onChange={(e) => setRelId(e.target.value)}
            disabled={relationships.length === 0}
            className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
          >
            <option value="">Select…</option>
            {relationships.map((r) => (
              <option key={r.id} value={r.id}>
                {propertyLine(r.properties)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="req_type"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Request type
          </label>
          <select
            id="req_type"
            required
            value={requestType}
            onChange={(e) => setRequestType(e.target.value)}
            className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
          >
            {REQUEST_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="title"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Title <span className="text-red-600">*</span>
          </label>
          <input
            id="title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>

        <div>
          <label
            htmlFor="description"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Description <span className="text-red-600">*</span>
          </label>
          <textarea
            id="description"
            required
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>

        <div>
          <label
            htmlFor="dollar"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Dollar amount (optional)
          </label>
          <input
            id="dollar"
            type="number"
            min={0}
            step="0.01"
            value={dollarAmount}
            onChange={(e) => setDollarAmount(e.target.value)}
            className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>

        {showVendorFields ? (
          <div>
            <label
              htmlFor="vendor"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Proposed vendor (optional)
            </label>
            <input
              id="vendor"
              type="text"
              value={proposedVendor}
              onChange={(e) => setProposedVendor(e.target.value)}
              className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>
        ) : null}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting || !relId}
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {submitting ? "Submitting…" : "Submit request"}
          </button>
          <Link
            href="/pm/dashboard"
            className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium dark:border-zinc-600"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
