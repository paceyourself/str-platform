"use client";

/**
 * Requires column: ALTER TABLE public.properties ADD COLUMN property_name text;
 */

import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const MARKET = "30a" as const;

const PROPERTY_TYPES = [
  { value: "standalone_home", label: "Standalone home" },
  { value: "condo_townhome", label: "Condo / townhome" },
  { value: "carriage_cottage", label: "Carriage cottage" },
  { value: "other", label: "Other" },
] as const;

const BEACH_PROXIMITY = [
  { value: "beachfront", label: "Beachfront" },
  { value: "walkable", label: "Walkable to beach" },
  { value: "short_drive", label: "Short drive" },
  { value: "not_applicable", label: "Not applicable" },
] as const;

type PmRow = { id: string; company_name: string };

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createClient();

  const [authReady, setAuthReady] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);

  const [propertyName, setPropertyName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("FL");
  const [zip, setZip] = useState("");
  const [bedroomCount, setBedroomCount] = useState("1");
  const [propertyType, setPropertyType] = useState<
    (typeof PROPERTY_TYPES)[number]["value"]
  >("standalone_home");
  const [beachProximity, setBeachProximity] = useState<
    (typeof BEACH_PROXIMITY)[number]["value"]
  >("walkable");
  const [privatePool, setPrivatePool] = useState(false);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        router.replace("/login");
        return;
      }
      setAuthReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, supabase.auth]);

  const loadPmProfiles = useCallback(async () => {
    setPmLoading(true);
    setError(null);
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
    if (step !== 2 || !authReady) return;
    loadPmProfiles();
  }, [step, authReady, loadPmProfiles]);

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

  function validateStep1(): boolean {
    if (!propertyName.trim()) {
      setError("Please enter a property name or nickname.");
      return false;
    }
    if (!addressLine1.trim() || !city.trim() || !state.trim() || !zip.trim()) {
      setError("Please fill in all required address fields.");
      return false;
    }
    const beds = Number(bedroomCount);
    if (!Number.isFinite(beds) || beds < 1) {
      setError("Bedroom count must be at least 1.");
      return false;
    }
    return true;
  }

  function goNext() {
    setError(null);
    if (!validateStep1()) return;
    setStep(2);
  }

  function goBack() {
    setError(null);
    setStep(1);
  }

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

  async function handleComplete(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

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

    const beds = Number(bedroomCount);
    const propertyPayload = {
      owner_id: user.id,
      market_id: MARKET,
      property_name: propertyName.trim(),
      address_line1: addressLine1.trim(),
      address_line2: addressLine2.trim() || null,
      city: city.trim(),
      state: state.trim(),
      zip: zip.trim(),
      bedroom_count: beds,
      property_type: propertyType,
      beach_proximity: beachProximity,
      private_pool: privatePool,
    };

    const { data: propertyRow, error: propError } = await supabase
      .from("properties")
      .insert(propertyPayload)
      .select("id")
      .single();

    if (propError) {
      setSubmitting(false);
      setError(propError.message);
      return;
    }

    if (!noPmYet && selectedPm) {
      const relPayload = {
        owner_id: user.id,
        pm_id: selectedPm.id,
        property_id: propertyRow.id,
        active: true,
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

      const { error: relError } = await supabase
        .from("owner_pm_relationships")
        .insert(relPayload);

      if (relError) {
        setSubmitting(false);
        setError(relError.message);
        return;
      }
    }

    setSubmitting(false);
    router.push("/dashboard");
    router.refresh();
  }

  if (!authReady) {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center px-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-full max-w-2xl flex-1 px-4 py-10">
      <div className="mb-8">
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          Step {step} of 2
        </p>
        <div className="mt-2 flex gap-2">
          <div
            className={`h-1 flex-1 rounded-full ${step >= 1 ? "bg-zinc-900 dark:bg-zinc-100" : "bg-zinc-200 dark:bg-zinc-700"}`}
          />
          <div
            className={`h-1 flex-1 rounded-full ${step >= 2 ? "bg-zinc-900 dark:bg-zinc-100" : "bg-zinc-200 dark:bg-zinc-700"}`}
          />
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {step === 1 ? "Property details" : "PM association"}
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {step === 1
            ? "Tell us about your rental property."
            : "Link a property manager or skip if you’re still looking."}
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
        >
          {error}
        </div>
      ) : null}

      {step === 1 ? (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            goNext();
          }}
        >
          <input type="hidden" name="market_id" value={MARKET} />

          <div>
            <label
              htmlFor="property_name"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Property name or nickname{" "}
              <span className="text-red-600">*</span>
            </label>
            <input
              id="property_name"
              name="property_name"
              type="text"
              required
              value={propertyName}
              onChange={(e) => setPropertyName(e.target.value)}
              className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
              placeholder="e.g. Mystic Cottage"
            />
          </div>

          <div>
            <label
              htmlFor="address_line_1"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Address line 1 <span className="text-red-600">*</span>
            </label>
            <input
              id="address_line_1"
              required
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
              className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
            />
          </div>

          <div>
            <label
              htmlFor="address_line_2"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Address line 2
            </label>
            <input
              id="address_line_2"
              value={addressLine2}
              onChange={(e) => setAddressLine2(e.target.value)}
              className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="city"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                City <span className="text-red-600">*</span>
              </label>
              <input
                id="city"
                required
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
              />
            </div>
            <div>
              <label
                htmlFor="state"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                State <span className="text-red-600">*</span>
              </label>
              <input
                id="state"
                required
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="zip"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              ZIP <span className="text-red-600">*</span>
            </label>
            <input
              id="zip"
              required
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
            />
          </div>

          <div>
            <label
              htmlFor="bedroom_count"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Bedroom count <span className="text-red-600">*</span>
            </label>
            <input
              id="bedroom_count"
              type="number"
              min={1}
              required
              value={bedroomCount}
              onChange={(e) => setBedroomCount(e.target.value)}
              className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
            />
          </div>

          <div>
            <label
              htmlFor="property_type"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Property type <span className="text-red-600">*</span>
            </label>
            <select
              id="property_type"
              required
              value={propertyType}
              onChange={(e) =>
                setPropertyType(
                  e.target.value as (typeof PROPERTY_TYPES)[number]["value"]
                )
              }
              className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
            >
              {PROPERTY_TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="beach_proximity"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Beach proximity <span className="text-red-600">*</span>
            </label>
            <select
              id="beach_proximity"
              required
              value={beachProximity}
              onChange={(e) =>
                setBeachProximity(
                  e.target.value as (typeof BEACH_PROXIMITY)[number]["value"]
                )
              }
              className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
            >
              {BEACH_PROXIMITY.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 dark:border-zinc-700 dark:bg-zinc-900/50">
            <input
              type="checkbox"
              checked={privatePool}
              onChange={(e) => setPrivatePool(e.target.checked)}
              className="size-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-600 dark:bg-zinc-800"
            />
            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              Private pool
            </span>
          </label>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Continue
            </button>
          </div>
        </form>
      ) : (
        <form className="space-y-6" onSubmit={handleComplete}>
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
                noPmYet
                  ? "No PM selected"
                  : "Search PM companies…"
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
                  name="contract_maintenance_threshold"
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

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={goBack}
              className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800/50"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {submitting ? "Saving…" : "Complete onboarding"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
