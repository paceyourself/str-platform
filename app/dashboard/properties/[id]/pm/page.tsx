"use client";

import { createClient } from "@/lib/supabase";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { MARKET } from "../../property-form-shared";

type PmRow = { id: string; company_name: string };

type ExistingRel = {
  id: string;
  pm_id: string;
  start_date: string | null;
  contract_notice_days: number | null;
  contract_etf_exists: boolean | null;
  contract_listing_transfer: boolean | null;
  contract_payment_timeline_days: number | null;
  contract_exclusivity: boolean | null;
  contract_maintenance_threshold: number | string | null;
};

function ymdFromDateValue(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = String(raw).trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : s;
}

export default function PropertyPmPage() {
  const router = useRouter();
  const params = useParams();
  const propertyId = typeof params.id === "string" ? params.id : "";
  const supabase = createClient();

  const [propertyLabel, setPropertyLabel] = useState<string>("");
  const [loadingProp, setLoadingProp] = useState(true);
  const [existingRel, setExistingRel] = useState<ExistingRel | null>(null);

  const [pmList, setPmList] = useState<PmRow[]>([]);
  const [pmLoading, setPmLoading] = useState(false);
  const [pmSearch, setPmSearch] = useState("");
  const [pmDropdownOpen, setPmDropdownOpen] = useState(false);
  const [selectedPm, setSelectedPm] = useState<PmRow | null>(null);
  const [noPmYet, setNoPmYet] = useState(false);

  const [contractStartDate, setContractStartDate] = useState("");
  const [noticePeriodDays, setNoticePeriodDays] = useState("");
  const [earlyTerminationFeeExists, setEarlyTerminationFeeExists] =
    useState(false);
  const [listingTransfersOnExit, setListingTransfersOnExit] = useState(false);
  const [paymentTimelineDays, setPaymentTimelineDays] = useState("");
  const [exclusivityClause, setExclusivityClause] = useState(false);
  const [contractMaintenanceThreshold, setContractMaintenanceThreshold] =
    useState("");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pmPanelRef = useRef<HTMLDivElement>(null);

  const loadPmProfiles = useCallback(async () => {
    setPmLoading(true);
    const { data, error: qError } = await supabase
      .from("pm_profiles")
      .select("id, company_name")
      .contains("markets", [MARKET])
      .order("company_name", { ascending: true });
    setPmLoading(false);
    if (qError) {
      setError(qError.message);
      return;
    }
    setPmList(data ?? []);
  }, [supabase]);

  useEffect(() => {
    if (!propertyId) return;
    let cancelled = false;
    (async () => {
      setLoadingProp(true);
      setError(null);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }

      const { data: prop, error: pErr } = await supabase
        .from("properties")
        .select("id, owner_id, property_name, address_line1, deleted_at")
        .eq("id", propertyId)
        .maybeSingle();

      if (cancelled) return;
      if (pErr || !prop) {
        setLoadingProp(false);
        setError(pErr?.message ?? "Property not found.");
        return;
      }
      if (prop.owner_id !== user.id) {
        setLoadingProp(false);
        setError("You do not have access to this property.");
        return;
      }
      if (prop.deleted_at) {
        setLoadingProp(false);
        setError("This property has been removed.");
        return;
      }

      const label =
        prop.property_name?.trim() ||
        prop.address_line1?.trim() ||
        "Property";
      setPropertyLabel(label);

      await loadPmProfiles();

      const { data: rel, error: rErr } = await supabase
        .from("owner_pm_relationships")
        .select(
          `
          id,
          pm_id,
          start_date,
          contract_notice_days,
          contract_etf_exists,
          contract_listing_transfer,
          contract_payment_timeline_days,
          contract_exclusivity,
          contract_maintenance_threshold
        `
        )
        .eq("property_id", propertyId)
        .eq("owner_id", user.id)
        .eq("active", true)
        .order("start_date", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      setLoadingProp(false);

      if (rErr) {
        setError(rErr.message);
        return;
      }

      if (rel) {
        const row = rel as ExistingRel;
        setExistingRel(row);
        setContractStartDate(ymdFromDateValue(row.start_date));
        setNoticePeriodDays(
          row.contract_notice_days != null
            ? String(row.contract_notice_days)
            : ""
        );
        setEarlyTerminationFeeExists(row.contract_etf_exists === true);
        setListingTransfersOnExit(row.contract_listing_transfer === true);
        setPaymentTimelineDays(
          row.contract_payment_timeline_days != null
            ? String(row.contract_payment_timeline_days)
            : ""
        );
        setExclusivityClause(row.contract_exclusivity === true);
        const th = row.contract_maintenance_threshold;
        setContractMaintenanceThreshold(
          th != null && th !== "" ? String(th) : ""
        );

        const { data: pmRow } = await supabase
          .from("pm_profiles")
          .select("id, company_name")
          .eq("id", row.pm_id)
          .maybeSingle();

        if (!cancelled && pmRow) {
          const p = pmRow as PmRow;
          setSelectedPm(p);
          setPmSearch(p.company_name);
          setNoPmYet(false);
        }
      } else {
        setExistingRel(null);
        setSelectedPm(null);
        setPmSearch("");
        setNoPmYet(false);
        setContractStartDate("");
        setNoticePeriodDays("");
        setEarlyTerminationFeeExists(false);
        setListingTransfersOnExit(false);
        setPaymentTimelineDays("");
        setExclusivityClause(false);
        setContractMaintenanceThreshold("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [propertyId, router, supabase, loadPmProfiles]);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (!pmDropdownOpen) return;
      const el = pmPanelRef.current;
      if (el && !el.contains(e.target as Node)) {
        setPmDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [pmDropdownOpen]);

  const filteredPms = useMemo(() => {
    const q = pmSearch.trim().toLowerCase();
    if (!q) return pmList;
    return pmList.filter((p) => p.company_name.toLowerCase().includes(q));
  }, [pmList, pmSearch]);

  function selectPm(pm: PmRow) {
    setSelectedPm(pm);
    setNoPmYet(false);
    setPmDropdownOpen(false);
    setPmSearch(pm.company_name);
  }

  function chooseNoPm() {
    setSelectedPm(null);
    setNoPmYet(true);
    setPmDropdownOpen(false);
    setPmSearch("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!propertyId) return;

    if (!noPmYet && !selectedPm) {
      setError(
        'Select a property manager from the list, or choose "I don\'t have a PM yet".'
      );
      return;
    }

    if (!noPmYet && selectedPm) {
      if (!contractStartDate) {
        setError("Contract start date is required when a PM is selected.");
        return;
      }
      if (contractMaintenanceThreshold.trim()) {
        const t = Number(contractMaintenanceThreshold);
        if (!Number.isFinite(t) || t < 0) {
          setError(
            "Maintenance approval threshold must be a non-negative number."
          );
          return;
        }
      }
    }

    setSubmitting(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSubmitting(false);
      router.replace("/login");
      return;
    }

    if (noPmYet) {
      const { error: deactErr } = await supabase
        .from("owner_pm_relationships")
        .update({ active: false })
        .eq("property_id", propertyId)
        .eq("owner_id", user.id)
        .eq("active", true);

      setSubmitting(false);
      if (deactErr) {
        setError(deactErr.message);
        return;
      }
      router.push("/dashboard/properties");
      router.refresh();
      return;
    }

    if (!selectedPm) {
      setSubmitting(false);
      return;
    }

    const fields = {
      start_date: contractStartDate,
      contract_notice_days: noticePeriodDays.trim()
        ? Number(noticePeriodDays)
        : null,
      contract_etf_exists: earlyTerminationFeeExists,
      contract_listing_transfer: listingTransfersOnExit,
      contract_payment_timeline_days: paymentTimelineDays.trim()
        ? Number(paymentTimelineDays)
        : null,
      contract_exclusivity: exclusivityClause,
      contract_maintenance_threshold: (() => {
        const raw = contractMaintenanceThreshold.trim();
        if (!raw) return null;
        const t = Number(raw);
        return Number.isFinite(t) ? t : null;
      })(),
    };

    if (existingRel && existingRel.pm_id === selectedPm.id) {
      const { error: uErr } = await supabase
        .from("owner_pm_relationships")
        .update(fields)
        .eq("id", existingRel.id)
        .eq("owner_id", user.id);

      setSubmitting(false);
      if (uErr) {
        setError(uErr.message);
        return;
      }
    } else {
      await supabase
        .from("owner_pm_relationships")
        .update({ active: false })
        .eq("property_id", propertyId)
        .eq("owner_id", user.id)
        .eq("active", true);

      const { error: insErr } = await supabase
        .from("owner_pm_relationships")
        .insert({
          owner_id: user.id,
          pm_id: selectedPm.id,
          property_id: propertyId,
          active: true,
          ...fields,
        });

      setSubmitting(false);
      if (insErr) {
        setError(insErr.message);
        return;
      }
    }

    router.push("/dashboard/properties");
    router.refresh();
  }

  if (!propertyId) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400">Invalid property.</p>
    );
  }

  if (loadingProp) {
    return <p className="text-sm text-zinc-500">Loading…</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          <Link href="/dashboard" className="hover:underline">
            Dashboard
          </Link>
          <span className="mx-2">/</span>
          <Link href="/dashboard/properties" className="hover:underline">
            Properties
          </Link>
          <span className="mx-2">/</span>
          PM
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          PM association
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {propertyLabel ? (
            <>
              Link or update the property manager for{" "}
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                {propertyLabel}
              </span>
              .
            </>
          ) : (
            "Link or update the property manager for this property."
          )}
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
        >
          {error}
        </div>
      ) : null}

      <form
        className="space-y-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
        onSubmit={handleSubmit}
      >
        <div className="relative" ref={pmPanelRef}>
          <label
            htmlFor="pm_search"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Property manager
          </label>
          <input
            id="pm_search"
            type="text"
            autoComplete="off"
            placeholder={
              noPmYet ? "No PM selected" : "Search PM companies…"
            }
            value={noPmYet ? "" : pmSearch}
            onChange={(e) => {
              setPmSearch(e.target.value);
              setPmDropdownOpen(true);
              if (noPmYet) setNoPmYet(false);
              if (selectedPm && e.target.value !== selectedPm.company_name) {
                setSelectedPm(null);
              }
            }}
            onFocus={() => setPmDropdownOpen(true)}
            disabled={noPmYet}
            className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 disabled:cursor-not-allowed disabled:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:disabled:bg-zinc-800 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
          />
          {pmDropdownOpen && !noPmYet ? (
            <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {pmLoading ? (
                <p className="px-3 py-2 text-sm text-zinc-500">
                  Loading companies…
                </p>
              ) : filteredPms.length === 0 ? (
                <p className="px-3 py-2 text-sm text-zinc-500">
                  No matches. Try another search.
                </p>
              ) : (
                filteredPms.map((pm) => (
                  <button
                    key={pm.id}
                    type="button"
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => selectPm(pm)}
                    className="flex w-full px-3 py-2 text-left text-sm text-zinc-900 hover:bg-zinc-100 dark:text-zinc-50 dark:hover:bg-zinc-800"
                  >
                    {pm.company_name}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>

        {!selectedPm ? (
          <button
            type="button"
            onClick={chooseNoPm}
            className={`w-full rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
              noPmYet
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-300 text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800/50"
            }`}
          >
            I don&apos;t have a PM yet
          </button>
        ) : null}

        {!noPmYet && selectedPm ? (
          <div className="space-y-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900/40">
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              Contract details for {selectedPm.company_name}
            </p>

            <div>
              <label
                htmlFor="contract_start"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Contract start date <span className="text-red-600">*</span>
              </label>
              <input
                id="contract_start"
                type="date"
                required
                value={contractStartDate}
                onChange={(e) => setContractStartDate(e.target.value)}
                className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
              />
            </div>

            <div>
              <label
                htmlFor="notice_days"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Notice period (days)
              </label>
              <input
                id="notice_days"
                type="number"
                min={0}
                value={noticePeriodDays}
                onChange={(e) => setNoticePeriodDays(e.target.value)}
                className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
              />
            </div>

            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={earlyTerminationFeeExists}
                onChange={(e) =>
                  setEarlyTerminationFeeExists(e.target.checked)
                }
                className="size-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-600 dark:bg-zinc-800"
              />
              <span className="text-sm text-zinc-800 dark:text-zinc-200">
                Early termination fee exists
              </span>
            </label>

            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={listingTransfersOnExit}
                onChange={(e) =>
                  setListingTransfersOnExit(e.target.checked)
                }
                className="size-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-600 dark:bg-zinc-800"
              />
              <span className="text-sm text-zinc-800 dark:text-zinc-200">
                Listing transfers on exit
              </span>
            </label>

            <div>
              <label
                htmlFor="payment_timeline"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Payment timeline (days)
              </label>
              <input
                id="payment_timeline"
                type="number"
                min={0}
                value={paymentTimelineDays}
                onChange={(e) => setPaymentTimelineDays(e.target.value)}
                className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
              />
            </div>

            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={exclusivityClause}
                onChange={(e) => setExclusivityClause(e.target.checked)}
                className="size-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-600 dark:bg-zinc-800"
              />
              <span className="text-sm text-zinc-800 dark:text-zinc-200">
                Exclusivity clause
              </span>
            </label>

            <div>
              <label
                htmlFor="contract_maintenance_threshold"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Maintenance approval threshold ($)
              </label>
              <input
                id="contract_maintenance_threshold"
                type="number"
                min={0}
                step={1}
                inputMode="decimal"
                placeholder="e.g. 250"
                value={contractMaintenanceThreshold}
                onChange={(e) =>
                  setContractMaintenanceThreshold(e.target.value)
                }
                className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
              />
              <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                Dollar amount above which PM must get your approval before
                proceeding with maintenance work
              </p>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {submitting ? "Saving…" : "Save"}
          </button>
          <Link
            href="/dashboard/properties"
            className="inline-flex items-center justify-center rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800/50"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
