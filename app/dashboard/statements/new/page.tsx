"use client";

import { createClient } from "@/lib/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

type PmProfileEmbed = { company_name: string | null };
type PropertyEmbed = {
  property_name: string | null;
  address_line1: string | null;
  city: string | null;
};

type RelRow = {
  id: string;
  pm_id: string;
  property_id: string;
  pm_profiles: PmProfileEmbed | PmProfileEmbed[] | null;
  properties: PropertyEmbed | PropertyEmbed[] | null;
};

function firstNested<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

type PropertyRow = {
  id: string;
  property_name: string | null;
  address_line1: string | null;
};

function propertyCheckboxLabel(p: PropertyRow | null | undefined): string {
  if (!p) return "Property";
  const name = p.property_name?.trim() || p.address_line1?.trim() || "Property";
  return name;
}

function propertyRowToEmbed(p: PropertyRow): PropertyEmbed {
  return {
    property_name: p.property_name,
    address_line1: p.address_line1,
    city: null,
  };
}

const PM_STATEMENTS_CONFLICT =
  "owner_pm_relationship_id,statement_period_start" as const;

function ScopeSelectedCheckIcon() {
  return (
    <svg
      className="h-3 w-3"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 6l2.5 2.5L9.5 3" />
    </svg>
  );
}

async function notificationExistsForStatement(
  supabase: ReturnType<typeof createClient>,
  ownerId: string,
  statementId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id")
    .eq("recipient_user_id", ownerId)
    .eq("notification_type", "survey_post_statement")
    .eq("reference_id", statementId)
    .limit(1);
  if (error) {
    console.warn("[statement upload] notification duplicate check:", error);
    return true;
  }
  return (data?.length ?? 0) > 0;
}

async function surveyExistsForStatement(
  supabase: ReturnType<typeof createClient>,
  ownerId: string,
  statementId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("survey_responses")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("trigger_type", "post_statement")
    .eq("trigger_reference_id", statementId)
    .limit(1);
  if (error) {
    console.warn("[statement upload] survey duplicate check:", error);
    return true;
  }
  return (data?.length ?? 0) > 0;
}

async function triggerPostStatementSurvey(
  supabase: ReturnType<typeof createClient>,
  user: { id: string },
  anchorRel: RelRow,
  anchorStatementId: string
): Promise<{ triggered: boolean; error: string | null }> {
  const notifDup = await notificationExistsForStatement(
    supabase,
    user.id,
    anchorStatementId
  );
  const surveyDup = await surveyExistsForStatement(
    supabase,
    user.id,
    anchorStatementId
  );

  if (notifDup || surveyDup) {
    return { triggered: false, error: null };
  }

  const { error: surErr } = await supabase.from("survey_responses").insert({
    owner_pm_relationship_id: anchorRel.id,
    owner_id: user.id,
    pm_id: anchorRel.pm_id,
    property_id: anchorRel.property_id,
    trigger_type: "post_statement",
    trigger_reference_id: anchorStatementId,
    sent_at: new Date().toISOString(),
  });

  if (surErr) {
    return {
      triggered: false,
      error: `Statements saved but survey could not be created: ${surErr.message}`,
    };
  }

  const { error: nErr } = await supabase.from("notifications").insert({
    recipient_user_id: user.id,
    notification_type: "survey_post_statement",
    reference_id: anchorStatementId,
    channel: "in_app",
  });

  if (nErr) {
    return {
      triggered: false,
      error: `Statements saved but notification failed: ${nErr.message}`,
    };
  }

  return { triggered: true, error: null };
}

export default function NewStatementPage() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [pmOptions, setPmOptions] = useState<{ id: string; name: string }[]>(
    []
  );
  const [selectedPmId, setSelectedPmId] = useState("");
  const [scopedRels, setScopedRels] = useState<
    { id: string; property_id: string }[]
  >([]);
  const [scopedProperties, setScopedProperties] = useState<
    Map<string, PropertyRow>
  >(new Map());
  const [pmScopedLoading, setPmScopedLoading] = useState(false);
  const [scope, setScope] = useState<"all" | "property">("all");
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([]);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [duplicateInfo, setDuplicateInfo] = useState<{
    relIds: string[];
    labels: string[];
  } | null>(null);

  const loadPmOptions = useCallback(async () => {
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

    const { data, error: qErr } = await supabase
      .from("owner_pm_relationships")
      .select(
        `
        pm_id,
        pm_profiles ( company_name )
      `
      )
      .eq("owner_id", user.id)
      .eq("active", true);

    setLoading(false);
    if (qErr) {
      setError(qErr.message);
      setPmOptions([]);
      return;
    }

    const map = new Map<string, string>();
    for (const row of data ?? []) {
      const r = row as {
        pm_id: string;
        pm_profiles: PmProfileEmbed | PmProfileEmbed[] | null;
      };
      if (!map.has(r.pm_id)) {
        const p = firstNested(r.pm_profiles);
        map.set(r.pm_id, p?.company_name?.trim() || "PM");
      }
    }
    setPmOptions(
      [...map.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
  }, [router, supabase]);

  useEffect(() => {
    void loadPmOptions();
  }, [loadPmOptions]);

  useEffect(() => {
    if (!selectedPmId) {
      setScopedRels([]);
      setScopedProperties(new Map());
      setPmScopedLoading(false);
      return;
    }

    let cancelled = false;

    setScopedRels([]);
    setScopedProperties(new Map());
    setPmScopedLoading(true);

    async function loadScopedForPm() {
      setError(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) {
          setPmScopedLoading(false);
          router.replace("/login");
        }
        return;
      }

      const { data: relRows, error: relErr } = await supabase
        .from("owner_pm_relationships")
        .select("id, property_id")
        .eq("owner_id", user.id)
        .eq("pm_id", selectedPmId)
        .eq("active", true);

      if (cancelled) return;

      if (relErr) {
        setPmScopedLoading(false);
        setError(relErr.message);
        setScopedRels([]);
        setScopedProperties(new Map());
        return;
      }

      const relList = (relRows ?? []) as { id: string; property_id: string }[];
      const propertyIds = [...new Set(relList.map((r) => r.property_id))];

      let propMap = new Map<string, PropertyRow>();
      if (propertyIds.length > 0) {
        const { data: propRows, error: propErr } = await supabase
          .from("properties")
          .select("id, property_name, address_line1")
          .in("id", propertyIds);

        if (cancelled) return;

        if (propErr) {
          setPmScopedLoading(false);
          setError(propErr.message);
          setScopedRels([]);
          setScopedProperties(new Map());
          return;
        }
        for (const p of (propRows ?? []) as PropertyRow[]) {
          propMap.set(p.id, p);
        }
      }

      if (!cancelled) {
        setScopedRels(relList);
        setScopedProperties(propMap);
        setPmScopedLoading(false);
      }
    }

    void loadScopedForPm();

    return () => {
      cancelled = true;
    };
  }, [selectedPmId, supabase, router]);

  const sortedRelsForPm = useMemo((): RelRow[] => {
    const rows: RelRow[] = scopedRels.map((r) => ({
      id: r.id,
      pm_id: selectedPmId,
      property_id: r.property_id,
      pm_profiles: null,
      properties: scopedProperties.has(r.property_id)
        ? propertyRowToEmbed(scopedProperties.get(r.property_id)!)
        : null,
    }));
    return rows.sort((a, b) =>
      propertyCheckboxLabel(
        scopedProperties.get(a.property_id) ?? null
      ).localeCompare(
        propertyCheckboxLabel(scopedProperties.get(b.property_id) ?? null)
      )
    );
  }, [scopedRels, scopedProperties, selectedPmId]);

  const propertyOptions = useMemo(() => {
    const byProp = new Map<
      string,
      { propertyId: string; label: string; relId: string }
    >();
    for (const r of scopedRels) {
      if (byProp.has(r.property_id)) continue;
      const p = scopedProperties.get(r.property_id);
      byProp.set(r.property_id, {
        propertyId: r.property_id,
        label: propertyCheckboxLabel(p),
        relId: r.id,
      });
    }
    return [...byProp.values()].sort((a, b) =>
      a.label.localeCompare(b.label)
    );
  }, [scopedRels, scopedProperties]);

  useEffect(() => {
    setSelectedPropertyIds([]);
    setDuplicateInfo(null);
  }, [selectedPmId, scope]);

  function togglePropertySelection(propertyId: string) {
    setSelectedPropertyIds((prev) =>
      prev.includes(propertyId)
        ? prev.filter((id) => id !== propertyId)
        : [...prev, propertyId]
    );
    setDuplicateInfo(null);
  }

  async function detectDuplicates(
    relIds: string[]
  ): Promise<{ relIds: string[]; labels: string[] } | null> {
    if (relIds.length === 0 || !periodStart) return null;
    const { data, error: dErr } = await supabase
      .from("pm_statements")
      .select("owner_pm_relationship_id")
      .in("owner_pm_relationship_id", relIds)
      .eq("statement_period_start", periodStart);
    if (dErr) {
      console.warn(dErr);
      return null;
    }
    const dupRelIds = [
      ...new Set(
        (data ?? []).map((row) => row.owner_pm_relationship_id as string)
      ),
    ];
    if (dupRelIds.length === 0) return null;
    const labels = dupRelIds
      .map((rid) => {
        const r = sortedRelsForPm.find((x) => x.id === rid);
        return r
          ? propertyCheckboxLabel(scopedProperties.get(r.property_id))
          : rid;
      })
      .filter(Boolean);
    return { relIds: dupRelIds, labels };
  }

  async function runSubmit(forcePastDuplicate: boolean) {
    setError(null);

    if (!selectedPmId) {
      setError("Select a property manager.");
      return;
    }
    if (pmScopedLoading) {
      setError("Still loading properties for this PM. Please wait.");
      return;
    }
    if (scope === "property" && selectedPropertyIds.length === 0) {
      setError("Select at least one property.");
      return;
    }
    if (!periodStart || !periodEnd) {
      setError("Statement period start and end are required.");
      return;
    }
    if (periodStart > periodEnd) {
      setError("Period end must be on or after period start.");
      return;
    }
    if (!fileName.trim()) {
      setError("Choose a file (PDF or CSV).");
      return;
    }

    const relsToUpsert: RelRow[] =
      scope === "all"
        ? sortedRelsForPm
        : sortedRelsForPm.filter((r) =>
            selectedPropertyIds.includes(r.property_id)
          );

    if (relsToUpsert.length === 0) {
      setError("No active properties found for this PM.");
      return;
    }

    if (!forcePastDuplicate) {
      const dup = await detectDuplicates(relsToUpsert.map((r) => r.id));
      if (dup && dup.relIds.length > 0) {
        setDuplicateInfo(dup);
        return;
      }
    }

    setSubmitting(true);
    setDuplicateInfo(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSubmitting(false);
      router.replace("/login");
      return;
    }

    const file = fileName.trim();
    const rows = relsToUpsert.map((r) => ({
      owner_pm_relationship_id: r.id,
      property_id: r.property_id,
      owner_id: user.id,
      statement_period_start: periodStart,
      statement_period_end: periodEnd,
      file_url: file,
      survey_triggered: false,
    }));

    const { data: saved, error: upErr } = await supabase
      .from("pm_statements")
      .upsert(rows, {
        onConflict: PM_STATEMENTS_CONFLICT,
      })
      .select("id, owner_pm_relationship_id, property_id");

    if (upErr) {
      setSubmitting(false);
      setError(upErr.message);
      return;
    }

    const savedRows =
      (saved as {
        id: string;
        owner_pm_relationship_id: string;
        property_id: string;
      }[]) ?? [];

    if (savedRows.length === 0) {
      setSubmitting(false);
      setError("No statement rows were saved.");
      return;
    }

    let surveysTriggered = 0;

    if (scope === "all") {
      const anchorRel = relsToUpsert[0];
      const anchorRow = savedRows.find(
        (s) => s.owner_pm_relationship_id === anchorRel.id
      );
      if (anchorRow?.id) {
        const res = await triggerPostStatementSurvey(
          supabase,
          user,
          anchorRel,
          anchorRow.id
        );
        if (res.error) {
          setSubmitting(false);
          setError(res.error);
          return;
        }
        if (res.triggered) surveysTriggered = 1;
      }
    } else {
      const seenRelIds = new Set<string>();
      for (const r of relsToUpsert) {
        if (seenRelIds.has(r.id)) continue;
        seenRelIds.add(r.id);
        const row = savedRows.find(
          (s) => s.owner_pm_relationship_id === r.id
        );
        if (!row?.id) continue;
        const res = await triggerPostStatementSurvey(
          supabase,
          user,
          r,
          row.id
        );
        if (res.error) {
          setSubmitting(false);
          setError(res.error);
          return;
        }
        if (res.triggered) surveysTriggered++;
      }
    }

    const allIds = savedRows.map((s) => s.id);
    await supabase
      .from("pm_statements")
      .update({ survey_triggered: true })
      .in("id", allIds);

    setSubmitting(false);
    const q =
      surveysTriggered > 0
        ? `statement=1&triggered=${surveysTriggered}`
        : "statement=1&triggered=0";
    router.push(`/dashboard/surveys?${q}`);
    router.refresh();
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void runSubmit(false);
  }

  function handleConfirmDuplicate() {
    void runSubmit(true);
  }

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading…</p>;
  }

  if (pmOptions.length === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          You need at least one active PM relationship to upload a statement.
        </p>
        <Link
          href="/dashboard/properties"
          className="text-sm font-medium text-zinc-900 underline dark:text-zinc-100"
        >
          Manage properties
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          <Link href="/dashboard" className="hover:underline">
            Dashboard
          </Link>
          <span className="mx-2">/</span>
          Upload statement
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Upload PM statement
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          One file for the period — applied to all properties with this PM or to
          the properties you select. File name only for MVP (PDF or CSV).
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
      >
        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          >
            {error}
          </div>
        ) : null}

        {duplicateInfo ? (
          <div
            role="status"
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100"
          >
            <p className="font-medium">
              Statement(s) already exist for this period (
              {duplicateInfo.relIds.length} propert
              {duplicateInfo.relIds.length === 1 ? "y" : "ies"})
            </p>
            <p className="mt-2 text-xs opacity-90">
              {duplicateInfo.labels.slice(0, 8).join(" · ")}
              {duplicateInfo.labels.length > 8
                ? ` · +${duplicateInfo.labels.length - 8} more`
                : ""}
            </p>
            <p className="mt-2 text-xs opacity-90">
              Continuing will update those records with this file name and
              dates (same period). You can cancel to go back.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleConfirmDuplicate}
                disabled={submitting}
                className="rounded-lg bg-amber-900 px-3 py-2 text-xs font-medium text-white hover:bg-amber-950 disabled:opacity-50 dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-100"
              >
                Proceed anyway
              </button>
              <button
                type="button"
                onClick={() => setDuplicateInfo(null)}
                disabled={submitting}
                className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-900/40"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <div>
          <label
            htmlFor="stmt-pm"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Property manager <span className="text-red-600">*</span>
          </label>
          <select
            id="stmt-pm"
            required
            value={selectedPmId}
            onChange={(e) => setSelectedPmId(e.target.value)}
            className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
          >
            <option value="">Select PM…</option>
            {pmOptions.map((pm) => (
              <option key={pm.id} value={pm.id}>
                {pm.name}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Properties Included
          </legend>

          <div
            className={[
              "rounded-xl border-2 px-3 py-3 transition-colors",
              scope === "all"
                ? "border-emerald-500 bg-emerald-50/70 shadow-sm ring-1 ring-emerald-500/20 dark:border-emerald-500 dark:bg-emerald-950/35 dark:ring-emerald-400/15"
                : "border-zinc-200 bg-zinc-50/50 dark:border-zinc-700 dark:bg-zinc-900/25",
            ].join(" ")}
          >
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="stmt-scope"
                checked={scope === "all"}
                onChange={() => setScope("all")}
                className="mt-1 h-4 w-4 shrink-0 accent-emerald-600 focus:ring-emerald-500"
              />
              <div className="min-w-0 flex-1">
                <span
                  className={[
                    "flex flex-wrap items-center gap-2 text-sm",
                    scope === "all"
                      ? "font-medium text-zinc-900 dark:text-zinc-50"
                      : "text-zinc-600 dark:text-zinc-400",
                  ].join(" ")}
                >
                  {scope === "all" ? (
                    <span
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm dark:bg-emerald-500"
                      aria-hidden
                    >
                      <ScopeSelectedCheckIcon />
                    </span>
                  ) : null}
                  <span>
                    This statement covers{" "}
                    <strong className="font-semibold">all my properties</strong>{" "}
                    with this PM
                  </span>
                </span>

                {scope === "all" && selectedPmId ? (
                  <div
                    className="mt-3 border-t border-emerald-200/80 pt-3 dark:border-emerald-800/50"
                    aria-live="polite"
                  >
                    <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                      Included in this upload
                    </p>
                    {pmScopedLoading ? (
                      <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
                        Loading properties…
                      </p>
                    ) : propertyOptions.length === 0 ? (
                      <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
                        No properties linked to this PM.
                      </p>
                    ) : (
                      <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto pr-1">
                        {propertyOptions.map((o) => (
                          <li
                            key={o.propertyId}
                            className="select-none text-xs text-zinc-400 dark:text-zinc-500"
                          >
                            <span className="mr-1.5 text-zinc-300 dark:text-zinc-600">
                              ·
                            </span>
                            {o.label}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
                {scope === "all" && !selectedPmId ? (
                  <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
                    Select a property manager to see which properties are
                    included.
                  </p>
                ) : null}
              </div>
            </label>
          </div>

          <div
            className={[
              "rounded-xl border-2 px-3 py-3 transition-colors",
              scope === "property"
                ? "border-emerald-500 bg-emerald-50/70 shadow-sm ring-1 ring-emerald-500/20 dark:border-emerald-500 dark:bg-emerald-950/35 dark:ring-emerald-400/15"
                : "border-zinc-200 bg-zinc-50/50 dark:border-zinc-700 dark:bg-zinc-900/25",
            ].join(" ")}
          >
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="stmt-scope"
                checked={scope === "property"}
                onChange={() => setScope("property")}
                className="mt-1 h-4 w-4 shrink-0 accent-emerald-600 focus:ring-emerald-500"
              />
              <div className="min-w-0 flex-1">
                <span
                  className={[
                    "flex flex-wrap items-center gap-2 text-sm",
                    scope === "property"
                      ? "font-medium text-zinc-900 dark:text-zinc-50"
                      : "text-zinc-600 dark:text-zinc-400",
                  ].join(" ")}
                >
                  {scope === "property" ? (
                    <span
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm dark:bg-emerald-500"
                      aria-hidden
                    >
                      <ScopeSelectedCheckIcon />
                    </span>
                  ) : null}
                  <span>
                    This statement is for{" "}
                    <strong className="font-semibold">
                      specific properties
                    </strong>{" "}
                    only
                  </span>
                </span>
              </div>
            </label>

            {scope === "property" ? (
              <div
                className="mt-3 border-t border-emerald-200/80 pt-3 pl-0 sm:pl-7 dark:border-emerald-800/50"
              >
                {!selectedPmId ? (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Select a property manager above to load properties for this
                    PM.
                  </p>
                ) : pmScopedLoading ? (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Loading properties…
                  </p>
                ) : propertyOptions.length === 0 ? (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    No active properties found for this PM.
                  </p>
                ) : (
                  <>
                    <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Choose properties <span className="text-red-600">*</span>
                    </p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                      Select one or more properties this statement applies to.
                    </p>
                    <ul
                      role="list"
                      className="mt-2 max-h-60 space-y-2 overflow-y-auto rounded-lg border border-emerald-200/60 bg-white/80 p-3 dark:border-emerald-800/40 dark:bg-zinc-950/50"
                    >
                      {propertyOptions.map((o) => {
                        const checked = selectedPropertyIds.includes(
                          o.propertyId
                        );
                        const inputId = `stmt-property-${o.propertyId}`;
                        return (
                          <li key={o.propertyId}>
                            <label
                              htmlFor={inputId}
                              className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 hover:bg-emerald-50/80 dark:hover:bg-emerald-950/40"
                            >
                              <input
                                id={inputId}
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  togglePropertySelection(o.propertyId)
                                }
                                className="mt-0.5 rounded border-zinc-300 accent-emerald-600 focus:ring-emerald-500 dark:border-zinc-600 dark:bg-zinc-900"
                              />
                              <span className="text-sm text-zinc-800 dark:text-zinc-200">
                                {o.label}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="stmt-start"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Statement period start <span className="text-red-600">*</span>
            </label>
            <input
              id="stmt-start"
              type="date"
              required
              value={periodStart}
              onChange={(e) => {
                setPeriodStart(e.target.value);
                setDuplicateInfo(null);
              }}
              className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>
          <div>
            <label
              htmlFor="stmt-end"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Statement period end <span className="text-red-600">*</span>
            </label>
            <input
              id="stmt-end"
              type="date"
              required
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="stmt-file"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            File (PDF or CSV) <span className="text-red-600">*</span>
          </label>
          <input
            id="stmt-file"
            type="file"
            accept=".pdf,.csv,application/pdf,text/csv"
            required
            onChange={(e) => {
              const f = e.target.files?.[0];
              setFileName(f?.name ?? "");
            }}
            className="mt-1.5 block w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white dark:text-zinc-400 dark:file:bg-zinc-100 dark:file:text-zinc-900"
          />
          {fileName ? (
            <p className="mt-1 text-xs text-zinc-500">Selected: {fileName}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={submitting || Boolean(duplicateInfo)}
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {submitting ? "Saving…" : "Upload"}
          </button>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-800 dark:border-zinc-600 dark:text-zinc-200"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
