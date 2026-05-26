"use client";

import { createClient } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import Papa from "papaparse";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const MARKET = "30a" as const;

type PropertyOption = {
  id: string;
  property_name: string | null;
  address_line1: string | null;
};

type PmOption = { id: string; company_name: string };

type ParsedUploadState = {
  fileName: string;
  headers: string[];
  rawRows: Record<string, unknown>[];
  /** Distinct Unit values → row count */
  unitCounts: Map<string, number>;
  /** Unit labels in CSV that do not match any owner property_name (case-insensitive) */
  unknownUnits: string[];
  /** Every non-empty Reservation Id from the file (for cancellation sync) */
  csvReservationIds: Set<string>;
};


type PmFieldMapping = {
  column_map: Record<string, string | null>;
  type_label_map: Record<string, string>;
  cancellation_signal_type: string | null;
};

/** Matches column_map target values from Postgres/JSONB (handles extra whitespace). */
function mapValueIsTarget(field: unknown, target: string): boolean {
  if (field === null || field === undefined) return false;
  return String(field).trim().toLowerCase() === target.trim().toLowerCase();
}

/** Case-insensitive match for combobox: input text vs PM company_name */
function pmDisplayNamesMatch(
  input: string,
  companyName: string | null | undefined
): boolean {
  return (
    input.trim().toLowerCase() === (companyName ?? "").trim().toLowerCase()
  );
}

function resolveReservationIdHeader(
  columnMap: Record<string, string | null> | Record<string, unknown>
): string | null {
  for (const [k, v] of Object.entries(columnMap)) {
    if (!mapValueIsTarget(v, "source_reservation_id")) continue;
    const header = typeof k === "string" ? k.trim() : String(k ?? "").trim();
    if (header) return header;
  }
  return null;
}

/** Skipped columns (null) include property name + nights — prefer a non-"nights" null key for unit matching. */
function resolvePropertyColumnHeader(
  columnMap: Record<string, string | null>
): string | null {
  const nullKeys = Object.entries(columnMap)
    .filter(([, v]) => v === null)
    .map(([k]) => k.trim())
    .filter(Boolean);
  const skip = new Set(["nights", "night"]);
  const preferred = nullKeys.filter((k) => !skip.has(k.toLowerCase()));
  return preferred[0] ?? nullKeys[0] ?? null;
}

function resolveTypeColumnHeader(
  columnMap: Record<string, string | null>
): string | null {
  const e = Object.entries(columnMap).find(([, v]) =>
    mapValueIsTarget(v, "raw_type_label")
  );
  return e?.[0]?.trim() || null;
}

function resolveBlockType(
  csvType: string,
  typeLabelMap: Record<string, string>
): string {
  const t = csvType.trim();
  if (!t) return "other";
  if (Object.prototype.hasOwnProperty.call(typeLabelMap, t)) {
    return typeLabelMap[t] ?? "other";
  }
  return mapCsvTypeToBlockType(t);
}

/** Oversee CSV "Type" → bookings.block_type fallback when not in PM type_label_map. */
function mapCsvTypeToBlockType(csvType: string): string {
  const t = csvType.trim();
  if (!t) return "other";
  const map: Record<string, string> = {
    Guest: "guest_pm_direct",
    Vrbo: "guest_ota",
    Website: "guest_ota",
    "Booking.com": "guest_ota",
    Airbnb: "guest_ota",
    BNBFinder: "guest_ota",
    Owner: "owner_stay",
    "Owner Guest": "owner_guest",
    "Owner Hold": "owner_stay",
    Maintenance: "maintenance",
  };
  return map[t] ?? "other";
}

function parseDateValue(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(s);
  if (us) {
    const mm = us[1].padStart(2, "0");
    const dd = us[2].padStart(2, "0");
    return `${us[3]}-${mm}-${dd}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return null;
}

const DATE_DB_COLUMNS = new Set(["check_in", "check_out", "booked_date"]);

/** Local date at noon — avoids TZ drift parsing YYYY-MM-DD. */
function parseDateOnlyLocal(isoPrefix: string): Date | null {
  const ymd =
    /^(\d{4})-(\d{2})-(\d{2})(?:[^\d]|$)/.exec(String(isoPrefix).trim());
  if (!ymd) return null;
  const y = Number(ymd[1]);
  const mo = Number(ymd[2]);
  const d = Number(ymd[3]);
  const dt = new Date(y, mo - 1, d, 12, 0, 0);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== mo - 1 ||
    dt.getDate() !== d
  ) {
    return null;
  }
  return dt;
}

/**
 * Months strictly before the calendar month containing `now`.
 * Completed months only (never the current partial month).
 */
function isCalendarMonthFullyClosedBeforeNow(
  coverageYear: number,
  coverageMonth: number,
  now = new Date(),
): boolean {
  const cy = now.getFullYear();
  const cm = now.getMonth() + 1;
  return coverageYear < cy || (coverageYear === cy && coverageMonth < cm);
}

/**
 * Nights [check_in, check_out); collect distinct calendar months that overlap any night.
 */
function calendarMonthsOverlappingStay(
  checkInIso: string | null | undefined,
  checkOutIso: string | null | undefined,
): { coverage_year: number; coverage_month: number }[] {
  const ci = parseDateOnlyLocal(String(checkInIso ?? ""));
  const co = parseDateOnlyLocal(String(checkOutIso ?? ""));
  if (!ci || !co) return [];
  if (!(co > ci)) return [];

  const seen = new Set<string>();
  const out: { coverage_year: number; coverage_month: number }[] = [];
  let cur = new Date(ci.getTime());

  while (cur < co) {
    const y = cur.getFullYear();
    const m = cur.getMonth() + 1;
    const key = `${y}-${m}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ coverage_year: y, coverage_month: m });
    }
    cur.setDate(cur.getDate() + 1);
  }

  return out.sort(
    (a, b) =>
      a.coverage_year - b.coverage_year || a.coverage_month - b.coverage_month,
  );
}

/** Inclusive calendar months from the month containing minDate through the month containing maxDate. */
function calendarMonthsInclusiveInFileSpan(
  minDate: Date,
  maxDate: Date,
): { coverage_year: number; coverage_month: number }[] {
  const startY = minDate.getFullYear();
  const startM = minDate.getMonth() + 1;
  const endY = maxDate.getFullYear();
  const endM = maxDate.getMonth() + 1;
  const out: { coverage_year: number; coverage_month: number }[] = [];
  let y = startY;
  let m = startM;
  while (y < endY || (y === endY && m <= endM)) {
    out.push({ coverage_year: y, coverage_month: m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

async function upsertPropertyCoverageMonthsFromUpload(
  supabase: SupabaseClient,
  args: {
    pmId: string;
    uniquePayloads: Record<string, unknown>[];
    uploadBatchRows: { id: string; property_id: string }[];
    relStartDates: Record<string, string>;
  },
): Promise<{ error: string | null }> {
  const now = new Date();
  const { pmId, uniquePayloads, uploadBatchRows, relStartDates } = args;
  const allRows: Record<string, unknown>[] = [];

  for (const batch of uploadBatchRows) {
    const pid = String(batch.property_id ?? "").trim();
    const bid = String(batch.id ?? "").trim();
    if (!pid || !bid) continue;

    const monthKey = new Set<string>();
    let minCi: Date | null = null;
    let maxCo: Date | null = null;
    for (const p of uniquePayloads) {
      if (String(p.property_id ?? "").trim() !== pid) continue;
      const ci = parseDateOnlyLocal(String(p.check_in ?? ""));
      const co = parseDateOnlyLocal(String(p.check_out ?? ""));
      if (!ci || !co || !(co > ci)) continue;
      if (!minCi || ci < minCi) minCi = ci;
      if (!maxCo || co > maxCo) maxCo = co;
    }

    const relStartRaw =
      pid in relStartDates ? String(relStartDates[pid] ?? "").trim() : "";
    const relStartDt = relStartRaw ? parseDateOnlyLocal(relStartRaw) : null;
    const windowStart = relStartDt ?? minCi;

    const windowEnd = maxCo;

    if (windowStart && windowEnd && windowEnd > windowStart) {
      for (const ym of calendarMonthsInclusiveInFileSpan(windowStart, windowEnd)) {
        monthKey.add(`${ym.coverage_year}-${ym.coverage_month}`);
      }
    }

    for (const k of monthKey) {
      const [ys, ms] = k.split("-");
      const coverage_year = Number(ys);
      const coverage_month = Number(ms);
      if (!Number.isFinite(coverage_year) || !Number.isFinite(coverage_month)) continue;

      const data_complete = isCalendarMonthFullyClosedBeforeNow(
        coverage_year,
        coverage_month,
        now,
      );

      allRows.push({
        property_id: pid,
        pm_id: pmId,
        coverage_year,
        coverage_month,
        data_complete,
        upload_batch_id: bid,
        updated_at: now.toISOString(),
      });
    }
  }

  if (allRows.length === 0) {
    console.log(
      "[property_coverage_months] upsert skipped — no calendar months derived from stays in this upload",
    );
    return { error: null };
  }

  const chunkSize = 100;
  for (let i = 0; i < allRows.length; i += chunkSize) {
    const slice = allRows.slice(i, i + chunkSize);
    const { error } = await supabase.from("property_coverage_months").upsert(slice, {
      onConflict: "property_id,pm_id,coverage_year,coverage_month",
    });
    if (error) {
      console.error("[property_coverage_months] upsert failed:", error);
      return { error: error.message };
    }
  }

  console.log("[property_coverage_months] upsert ok", {
    rowCount: allRows.length,
  });
  return { error: null };
}

const BASE_BOOKING_KEYS = new Set([
  "property_id",
  "owner_pm_relationship_id",
  "source_file_id",
]);

/** Omit survey_triggered so upserts never overwrite it (only trigger sets true). */
function bookingPayloadForUpsert(
  row: Record<string, unknown>
): Record<string, unknown> {
  const { survey_triggered: _ignored, ...rest } = row;
  return rest;
}

function cellString(v: unknown): string {
  if (v == null) return "";
  return typeof v === "string" ? v : String(v);
}

/** Case-insensitive map: first wins (stable order from sorted properties). */
function buildPropertyNameLookup(properties: PropertyOption[]): Map<string, PropertyOption> {
  const sorted = [...properties].sort((a, b) => {
    const na = (a.property_name ?? "").localeCompare(b.property_name ?? "");
    if (na !== 0) return na;
    return (a.address_line1 ?? "").localeCompare(b.address_line1 ?? "");
  });
  const map = new Map<string, PropertyOption>();
  for (const p of sorted) {
    const name = (p.property_name ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!map.has(key)) map.set(key, p);
  }
  return map;
}

function rowToPayload(
  headers: string[],
  cells: string[],
  propertyId: string,
  ownerPmRelationshipId: string | null,
  sourceFileId: string,
  columnMap: Record<string, string | null>,
  typeLabelMap: Record<string, string>,
  typeColumnHeader: string
): Record<string, unknown> | null {
  const row: Record<string, string> = {};
  headers.forEach((h, i) => {
    row[h] = cells[i] ?? "";
  });

  const payload: Record<string, unknown> = {
    property_id: propertyId,
    owner_pm_relationship_id: ownerPmRelationshipId,
    source_file_id: sourceFileId,
  };

  for (const [header, raw] of Object.entries(row)) {
    const key = header.trim();
    if (!Object.prototype.hasOwnProperty.call(columnMap, key)) continue;
    const mapped = columnMap[key];
    if (mapped === null || mapped === undefined) continue;
    const canonical = typeof mapped === "string" ? mapped.trim() : String(mapped).trim();
    const dbCol = canonical.toLowerCase();
    if (!dbCol) continue;
    const v = raw.trim();
    if (!v) continue;
    if (DATE_DB_COLUMNS.has(dbCol)) {
      const d = parseDateValue(v);
      if (d) {
        payload[dbCol] = d;
      }
    } else if (dbCol === "gross_revenue") {
      const n = Number(String(v).replace(/[^0-9.-]/g, ""));
      if (Number.isFinite(n)) payload[dbCol] = n;
    } else {
      payload[dbCol] = v;
    }
  }

  const bookedHeader = headers.find((h) =>
    mapValueIsTarget(columnMap[h.trim()], "booked_date")
  );
  if (bookedHeader) {
    const d = parseDateValue((row[bookedHeader] ?? "").trim());
    if (d) payload.booked_date = d;
  }

  const typeRaw = (row[typeColumnHeader] ?? "").trim();
  if (typeRaw) {
    payload.raw_type_label = typeRaw;
  }
  payload.block_type = resolveBlockType(typeRaw, typeLabelMap);

  const dataKeys = Object.keys(payload).filter((k) => !BASE_BOOKING_KEYS.has(k));
  const substantiveKeys = dataKeys.filter(
    (k) => k !== "block_type" && k !== "raw_type_label"
  );
  if (substantiveKeys.length === 0) return null;
  return payload;
}

/** After booking upsert: surveys for completed owner stays (check_out before today). */
async function triggerPostOwnerStaySurveys(
  supabase: ReturnType<typeof createClient>,
  ownerId: string,
  sourceReservationIds: string[],
  relationshipIds: string[]
): Promise<number> {
  if (sourceReservationIds.length === 0 || relationshipIds.length === 0) {
    return 0;
  }

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const { data: bookingRows, error: bErr } = await supabase
    .from("bookings")
    .select(
      "id, property_id, block_type, check_out, survey_triggered, owner_pm_relationship_id, source_reservation_id"
    )
    .in("source_reservation_id", sourceReservationIds)
    .in("owner_pm_relationship_id", relationshipIds);

  if (bErr || !bookingRows?.length) {
    if (bErr) console.warn("[survey trigger] bookings query:", bErr);
    return 0;
  }

  type BRow = {
    id: string;
    property_id: string;
    block_type: string | null;
    check_out: string | null;
    survey_triggered: boolean | null;
    owner_pm_relationship_id: string | null;
  };

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 90);
  const cutoffStr = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, "0")}-${String(cutoffDate.getDate()).padStart(2, "0")}`;

  const candidates = (bookingRows as BRow[]).filter((b) => {
    if (b.block_type !== "owner_stay") return false;
    const co = b.check_out ? String(b.check_out).slice(0, 10) : "";
    if (!co || co >= todayStr) return false;
    if (co < cutoffStr) return false;
    if (b.survey_triggered === true) return false;
    if (!b.owner_pm_relationship_id) return false;
    return true;
  });
  
  if (candidates.length === 0) return 0;

  const relIds = [
    ...new Set(
      candidates
        .map((b) => b.owner_pm_relationship_id)
        .filter((x): x is string => Boolean(x))
    ),
  ];

  const { data: relData, error: rErr } = await supabase
    .from("owner_pm_relationships")
    .select("id, pm_id, owner_id")
    .in("id", relIds);

  if (rErr || !relData?.length) {
    if (rErr) console.warn("[survey trigger] relationships:", rErr);
    return 0;
  }

  const relMap = new Map(
    (relData as { id: string; pm_id: string; owner_id: string }[]).map(
      (r) => [r.id, r] as const
    )
  );

  let count = 0;
  for (const b of candidates) {
    const rel = relMap.get(b.owner_pm_relationship_id!);
    if (!rel || rel.owner_id !== ownerId) continue;

    const { data: dupNotifications, error: dupNotifErr } = await supabase
      .from("notifications")
      .select("id")
      .eq("recipient_user_id", ownerId)
      .eq("notification_type", "survey_post_owner_stay")
      .eq("reference_id", b.id)
      .limit(1);

    if (dupNotifErr) {
      console.warn("[survey trigger] duplicate notification check:", dupNotifErr);
      continue;
    }

    if (dupNotifications && dupNotifications.length > 0) {
      continue;
    }

    const { error: surErr } = await supabase.from("survey_responses").insert({
      owner_pm_relationship_id: b.owner_pm_relationship_id,
      owner_id: ownerId,
      pm_id: rel.pm_id,
      property_id: b.property_id,
      trigger_type: "post_owner_stay",
      trigger_reference_id: b.id,
      sent_at: new Date().toISOString(),
    });

    if (surErr) {
      console.warn("[survey trigger] survey_responses insert:", surErr);
      continue;
    }

    const { error: nErr } = await supabase.from("notifications").insert({
      recipient_user_id: ownerId,
      notification_type: "survey_post_owner_stay",
      reference_id: b.id,
      channel: "in_app",
    });

    if (nErr) {
      console.warn("[survey trigger] notifications insert:", nErr);
      continue;
    }

    const { error: uErr } = await supabase
      .from("bookings")
      .update({ survey_triggered: true })
      .eq("id", b.id);

    if (!uErr) count += 1;
  }

  return count;
}

/**
 * Step 3: true when contract_start_date (or legacy start_date) is within the last 90 calendar days
 * from today (inclusive of the cutoff day) — suppress post-stay surveys in that case.
 */
function suppressPostStaySurveyForRecentContract(
  contractStart: string | null | undefined
): boolean {
  const raw =
    contractStart == null ? "" : String(contractStart).trim();
  if (!raw) {
    return false;
  }
  const c = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c)) {
    return false;
  }
  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 90);
  const cy = cutoff.getFullYear();
  const cm = String(cutoff.getMonth() + 1).padStart(2, "0");
  const cd = String(cutoff.getDate()).padStart(2, "0");
  const cutoffStr = `${cy}-${cm}-${cd}`;
  if (c < cutoffStr) {
    return false;
  }
  return true;
}

function parseCsvForPreview(
  normalizedText: string,
  nameLookup: Map<string, PropertyOption>,
  columnMap: Record<string, string | null>
): Omit<ParsedUploadState, "fileName"> | { error: string } {
  const papaResult = Papa.parse<Record<string, unknown>>(normalizedText, {
    header: true,
    skipEmptyLines: "greedy",
    dynamicTyping: false,
  });

  const headers =
    papaResult.meta.fields?.filter((h): h is string => typeof h === "string") ??
    [];

  if (headers.length === 0) {
    return { error: "CSV has no header row." };
  }

  const rawRows = papaResult.data.filter(
    (r) => r && typeof r === "object" && Object.keys(r).length > 0
  );

  const propHeader = resolvePropertyColumnHeader(columnMap);
  if (!propHeader) {
    return {
      error:
        "PM field mapping must include a skipped column for property matching (map unit/property column to “Skip”).",
    };
  }
  const resHeader = resolveReservationIdHeader(columnMap);
  if (!resHeader) {
    return {
      error:
        "PM field mapping must map the reservation id column to source_reservation_id.",
    };
  }

  const unitCounts = new Map<string, number>();
  const csvReservationIds = new Set<string>();

  for (const rowObj of rawRows) {
    const unitRaw = cellString(rowObj[propHeader]).trim();
    const unitLabel = unitRaw || "(empty unit column)";
    unitCounts.set(unitLabel, (unitCounts.get(unitLabel) ?? 0) + 1);

    const resRaw = cellString(rowObj[resHeader]).trim();
    if (resRaw) csvReservationIds.add(resRaw);
  }

  const unknownUnits: string[] = [];
  for (const unitLabel of unitCounts.keys()) {
    if (unitLabel === "(empty unit column)") {
      unknownUnits.push(unitLabel);
      continue;
    }
    if (!nameLookup.has(unitLabel.toLowerCase())) {
      unknownUnits.push(unitLabel);
    }
  }
  unknownUnits.sort((a, b) => a.localeCompare(b));

  return {
    headers,
    rawRows,
    unitCounts,
    unknownUnits,
    csvReservationIds,
  };
}

export default function BookingsUploadPage() {
  const router = useRouter();
  const supabase = createClient();

  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [pmList, setPmList] = useState<PmOption[]>([]);
  const [selectedPmId, setSelectedPmId] = useState("");
  const [loadingProps, setLoadingProps] = useState(true);
  const [loadingPms, setLoadingPms] = useState(true);

  const [parsed, setParsed] = useState<ParsedUploadState | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  const [pmInputValue, setPmInputValue] = useState("");
  const [pmDropdownOpen, setPmDropdownOpen] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [pmFieldMapping, setPmFieldMapping] =
    useState<PmFieldMapping | null>(null);
  const [mappingLoad, setMappingLoad] = useState<
    "idle" | "loading" | "ready" | "missing" | "error"
  >("idle");

  const nameLookup = useMemo(
    () => buildPropertyNameLookup(properties),
    [properties]
  );

  const unitSummaryLines = useMemo(() => {
    if (!parsed) return [];
    const lines: string[] = [];
    const entries = [...parsed.unitCounts.entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    );
    for (const [unit, count] of entries) {
      lines.push(`${unit}: ${count} row${count === 1 ? "" : "s"}`);
    }
    return lines;
  }, [parsed]);

  const filteredPms = useMemo(() => {
    const q = pmInputValue.trim().toLowerCase();
    return pmList.filter((pm) =>
      (pm.company_name ?? "").toLowerCase().includes(q)
    );
  }, [pmList, pmInputValue]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!pmDropdownOpen) return;
      const root = document.getElementById("pm-combobox-root");
      if (root && !root.contains(e.target as Node)) {
        setPmDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [pmDropdownOpen]);

  useEffect(() => {
    if (loadingPms || uploading) {
      setPmDropdownOpen(false);
    }
  }, [loadingPms, uploading]);

  const loadPropertiesAndPms = useCallback(async () => {
    setLoadingProps(true);
    setLoadingPms(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoadingProps(false);
      setLoadingPms(false);
      return;
    }

    const [propRes, pmRes] = await Promise.all([
      supabase
        .from("properties")
        .select("id, property_name, address_line1")
        .eq("owner_id", user.id)
        .order("property_name", { ascending: true, nullsFirst: false })
        .order("address_line1", { ascending: true, nullsFirst: false }),
      supabase
        .from("pm_profiles")
        .select("id, company_name")
        .contains("markets", [MARKET])
        .order("company_name", { ascending: true }),
    ]);

    setLoadingProps(false);
    setLoadingPms(false);

    if (propRes.error) {
      setError(propRes.error.message);
      return;
    }
    const list = propRes.data ?? [];
    if (list.length === 0) {
      router.push("/onboarding");
      return;
    }
    setProperties(list);

    if (pmRes.error) {
      setError(pmRes.error.message);
      return;
    }
    setPmList(pmRes.data ?? []);
  }, [router, supabase]);

  useEffect(() => {
    loadPropertiesAndPms();
  }, [loadPropertiesAndPms]);

  useEffect(() => {
    setParsed(null);
    setStatus(null);
    setFileInputKey((k) => k + 1);
  }, [selectedPmId]);

  useEffect(() => {
    if (!selectedPmId) {
      setPmFieldMapping(null);
      setMappingLoad("idle");
      return;
    }
    let cancelled = false;
    setMappingLoad("loading");
    (async () => {
      const { data, error } = await supabase
        .from("pm_field_mappings")
        .select("column_map, type_label_map, cancellation_signal_type")
        .eq("pm_id", selectedPmId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setPmFieldMapping(null);
        setMappingLoad("error");
        return;
      }
      if (!data) {
        setPmFieldMapping(null);
        setMappingLoad("missing");
        return;
      }
      setPmFieldMapping({
        column_map: data.column_map as Record<string, string | null>,
        type_label_map: data.type_label_map as Record<string, string>,
        cancellation_signal_type: data.cancellation_signal_type as string | null,
      });
      setMappingLoad("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPmId, supabase]);

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setStatus(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (loadingProps || properties.length === 0) {
      setError("Still loading your properties. Try again in a moment.");
      e.target.value = "";
      return;
    }

    if (!selectedPmId) {
      setError("Select your property manager first.");
      e.target.value = "";
      return;
    }

    if (mappingLoad === "loading") {
      setError("Loading PM file format… Try again in a moment.");
      e.target.value = "";
      return;
    }
    if (mappingLoad !== "ready" || !pmFieldMapping) {
      setError(
        mappingLoad === "missing"
          ? "No field mapping configured for this PM. Please contact an administrator."
          : mappingLoad === "error"
            ? "Could not load PM field mapping. Try again."
            : "Select your property manager first."
      );
      e.target.value = "";
      return;
    }

    const text = await file.text();
    const normalized = text.replace(/^\uFEFF/, "");
    const preview = parseCsvForPreview(
      normalized,
      nameLookup,
      pmFieldMapping.column_map
    );

    if ("error" in preview) {
      setError(preview.error);
      e.target.value = "";
      return;
    }

    setParsed({
      fileName: file.name,
      ...preview,
    });
    e.target.value = "";
  }

  async function onConfirmUpload() {
    if (!parsed || !selectedPmId) return;

    if (mappingLoad !== "ready" || !pmFieldMapping) {
      setError(
        mappingLoad === "missing"
          ? "No field mapping configured for this PM. Please contact an administrator."
          : mappingLoad === "error"
            ? "Could not load PM field mapping. Try again."
            : "Still loading PM file format."
      );
      return;
    }

    setError(null);
    setStatus(null);
    setUploading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setUploading(false);
      setError("You must be signed in.");
      return;
    }

    const defaultPropertyId = properties[0]?.id ?? "";
    if (!defaultPropertyId) {
      setUploading(false);
      setError("No property on file.");
      return;
    }

    const { data: sourceFileRow, error: sourceFileErr } = await supabase
      .from("upload_files")
      .insert({
        owner_id: user.id,
        property_id: defaultPropertyId,
        file_name: parsed.fileName,
        storage_url: parsed.fileName,
      })
      .select("id")
      .single();

    if (sourceFileErr || !sourceFileRow) {
      setUploading(false);
      setError(
        sourceFileErr?.message ??
          "Could not create upload_files row. Check RLS and columns."
      );
      return;
    }

    const sourceFileId = sourceFileRow.id as string;

    const { data: relRows, error: relErr } = await supabase
      .from("owner_pm_relationships")
      .select("id, property_id, start_date")
      .eq("owner_id", user.id)
      .eq("pm_id", selectedPmId)
      .eq("active", true);

    if (relErr) {
      setUploading(false);
      setError(relErr.message);
      return;
    }

    const relByProperty = new Map<string, string>();
    const relList = relRows ?? [];
    const byProp = new Map<string, typeof relList>();
    for (const r of relList) {
      const pid = r.property_id as string;
      if (!byProp.has(pid)) byProp.set(pid, []);
      byProp.get(pid)!.push(r);
    }
    for (const [pid, rows] of byProp) {
      const sorted = [...rows].sort((a, b) => {
        const da = a.start_date ? String(a.start_date) : "";
        const db = b.start_date ? String(b.start_date) : "";
        return db.localeCompare(da);
      });
      const first = sorted[0];
      if (first?.id) relByProperty.set(pid, String(first.id));
    }

    const relationshipIds = [...new Set(relByProperty.values())];

    const existingReservationIds = new Set<string>();
    if (relationshipIds.length > 0) {
      const { data: existingBookings, error: exErr } = await supabase
        .from("bookings")
        .select("source_reservation_id")
        .in("owner_pm_relationship_id", relationshipIds);

      if (exErr) {
        setUploading(false);
        setError(exErr.message);
        return;
      }
      for (const row of existingBookings ?? []) {
        const id = row.source_reservation_id;
        if (id != null && String(id).trim() !== "") {
          existingReservationIds.add(String(id).trim());
        }
      }
    }

    const { headers, rawRows } = parsed;
    let rowsUnmatchedUnit = 0;
    let rowsSkippedOther = 0;
    const payloads: Record<string, unknown>[] = [];

    const columnMap = pmFieldMapping.column_map;
    const typeLabelMap = pmFieldMapping.type_label_map;
    const propHeader = resolvePropertyColumnHeader(columnMap);
    const typeCol = resolveTypeColumnHeader(columnMap) ?? "Type";
    if (!propHeader) {
      setUploading(false);
      setError(
        "Invalid PM field mapping: add a skipped CSV column for property / unit matching."
      );
      return;
    }

    for (const rowObj of rawRows) {
      const cells = headers.map((h) => cellString(rowObj[h]));
      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        row[h] = cells[i] ?? "";
      });

      const unitRaw = (row[propHeader] ?? "").trim();
      if (!unitRaw) {
        rowsUnmatchedUnit += 1;
        console.warn(
          "[bookings upload] unmatched row (empty property column)",
          row
        );
        continue;
      }

      const prop = nameLookup.get(unitRaw.toLowerCase());
      if (!prop) {
        rowsUnmatchedUnit += 1;
        console.warn(
          "[bookings upload] unmatched property column value:",
          unitRaw,
          row
        );
        continue;
      }

      const relId = relByProperty.get(prop.id) ?? null;
      if (!relId) {
        rowsSkippedOther += 1;
        console.warn(
          "[bookings upload] no active PM relationship for property",
          prop.id,
          row
        );
        continue;
      }

      const p = rowToPayload(
        headers,
        cells,
        prop.id,
        relId,
        sourceFileId,
        columnMap,
        typeLabelMap,
        typeCol
      );
      if (!p) {
        rowsSkippedOther += 1;
        continue;
      }

      const resKey = p.source_reservation_id;
      if (resKey == null || String(resKey).trim() === "") {
        rowsSkippedOther += 1;
        console.warn("[bookings upload] missing Reservation Id", row);
        continue;
      }

      const st = String(p.status ?? "").trim().toLowerCase();
      if (st && st !== "cancelled") {
        p.cancelled_at = null;
      }

      payloads.push(p);
    }

    const dedupedByReservation = new Map<string, Record<string, unknown>>();
    for (const p of payloads) {
      const k = String(p.source_reservation_id).trim();
      dedupedByReservation.set(k, p);
    }
    const uniquePayloads = [...dedupedByReservation.values()];

    const distinctPropertyIds = [
      ...new Set(
        uniquePayloads
          .map((p) => String(p.property_id ?? "").trim())
          .filter((id) => id.length > 0)
      ),
    ];

    if (uniquePayloads.length === 0) {
      setUploading(false);
      setError(
        "No rows could be imported. Check the property column values, reservation IDs, and that each property has an active relationship with the selected PM."
      );
      return;
    }

    let inserted = 0;
    let updated = 0;
    for (const p of uniquePayloads) {
      const key = String(p.source_reservation_id).trim();
      if (existingReservationIds.has(key)) updated += 1;
      else inserted += 1;
    }

    const chunkSize = 40;
    for (let i = 0; i < uniquePayloads.length; i += chunkSize) {
      const slice = uniquePayloads
        .slice(i, i + chunkSize)
        .map((row) => bookingPayloadForUpsert(row as Record<string, unknown>));
      const { error: upErr } = await supabase.from("bookings").upsert(slice, {
        onConflict: "source_reservation_id,property_id",
      });
      if (upErr) {
        setUploading(false);
        setError(upErr.message);
        return;
      }
    }

    const reservationKeys = [
      ...new Set(
        uniquePayloads.map((p) => String(p.source_reservation_id).trim())
      ),
    ];
    let surveysTriggered = 0;
    if (
      relationshipIds.length > 0 &&
      reservationKeys.length > 0 &&
      distinctPropertyIds.length > 0
    ) {
      let runSurveyTriggers = false;

      const { count: priorPropBatchCount, error: ubErr } = await supabase
        .from("upload_batches")
        .select("*", { count: "exact", head: true })
        .eq("owner_id", user.id)
        .in("property_id", distinctPropertyIds);

      if (ubErr) {
        console.warn("[survey gate] upload_batches:", ubErr);
        runSurveyTriggers = true;
      } else if ((priorPropBatchCount ?? 0) > 0) {
        runSurveyTriggers = true;
      } else {
        const { data: pmRels, error: pmRelErr } = await supabase
          .from("owner_pm_relationships")
          .select("property_id")
          .eq("owner_id", user.id)
          .eq("pm_id", selectedPmId)
          .eq("active", true);

        if (pmRelErr) {
          console.warn("[survey gate] owner_pm_relationships:", pmRelErr);
          runSurveyTriggers = true;
        } else {
          const inFile = new Set(distinctPropertyIds);
          const pmNotNewToOwner = (pmRels ?? []).some(
            (r) => !inFile.has(String(r.property_id))
          );
          if (pmNotNewToOwner) {
            runSurveyTriggers = false;
          } else {
            const relIdsToCheck = [
              ...new Set(
                distinctPropertyIds
                  .map((pid) => relByProperty.get(pid))
                  .filter((id): id is string => Boolean(id))
              ),
            ];

            if (relIdsToCheck.length === 0) {
              runSurveyTriggers = true;
            } else {
              const { data: contractRows, error: cErr } = await supabase
                .from("owner_pm_relationships")
                .select("contract_start_date, start_date")
                .in("id", relIdsToCheck);

              if (cErr) {
                console.warn("[survey gate] contract dates:", cErr);
                runSurveyTriggers = true;
              } else {
                runSurveyTriggers = true;
                for (const row of contractRows ?? []) {
                  const r = row as {
                    contract_start_date?: string | null;
                    start_date?: string | null;
                  };
                  const eff = r.contract_start_date ?? r.start_date;
                  if (suppressPostStaySurveyForRecentContract(eff)) {
                    runSurveyTriggers = false;
                    break;
                  }
                }
              }
            }
          }
        }
      }

      if (runSurveyTriggers) {
        surveysTriggered = await triggerPostOwnerStaySurveys(
          supabase,
          user.id,
          reservationKeys,
          relationshipIds
        );
      }
    }

    const cancelledAt = new Date().toISOString();
    let cancellationsDetected = 0;

    if (relationshipIds.length > 0) {
      const { data: openBookings, error: openErr } = await supabase
        .from("bookings")
        .select("id, source_reservation_id")
        .in("owner_pm_relationship_id", relationshipIds)
        .neq("status", "cancelled");

      if (openErr) {
        setUploading(false);
        setError(openErr.message);
        return;
      }

      const toCancelIds: string[] = [];
      for (const b of openBookings ?? []) {
        const sid = b.source_reservation_id;
        const s = sid != null ? String(sid).trim() : "";
        if (!s || parsed.csvReservationIds.has(s)) continue;
        toCancelIds.push(String(b.id));
      }

      cancellationsDetected = toCancelIds.length;

      const cancelChunk = 80;
      for (let i = 0; i < toCancelIds.length; i += cancelChunk) {
        const ids = toCancelIds.slice(i, i + cancelChunk);
        const { error: cancelErr } = await supabase
          .from("bookings")
          .update({ status: "cancelled", cancelled_at: cancelledAt })
          .in("id", ids);
        if (cancelErr) {
          setUploading(false);
          setError(cancelErr.message);
          return;
        }
      }
    }

    let importSideEffectError: string | null = null;

    if (distinctPropertyIds.length > 0) {
      const { data: createdBatches, error: ubErr } = await supabase
        .from("upload_batches")
        .insert(
          distinctPropertyIds.map((property_id) => ({
            owner_id: user.id,
            property_id,
            pm_id: selectedPmId,
            source_filename: parsed.fileName,
            status: "complete",
            row_count: uniquePayloads.filter(
              (p) => String(p.property_id ?? "").trim() === property_id,
            ).length,
          })),
        )
        .select("id, property_id");
      if (ubErr) {
        console.error("[upload] upload_batches insert failed:", ubErr);
        importSideEffectError = `Bookings were saved, but the upload batch could not be recorded (${ubErr.code ?? "error"}: ${ubErr.message}). Analytics coverage will not update until this succeeds.`;
      } else if (!createdBatches?.length) {
        console.error(
          "[upload] upload_batches insert returned no rows; expected one per property in file.",
          { expectedCount: distinctPropertyIds.length },
        );
        importSideEffectError =
          "Bookings were saved, but the upload batch insert returned no rows (check RLS: can you SELECT rows you insert on upload_batches?). Analytics coverage was not updated.";
      } else {
        const relStartDates: Record<string, string> = {};
        const { data: relData } = await supabase
          .from("owner_pm_relationships")
          .select("start_date, property_id")
          .in("property_id", distinctPropertyIds)
          .eq("pm_id", selectedPmId)
          .eq("active", true);

        for (const row of relData ?? []) {
          const rp = row as { property_id?: string; start_date?: string | null };
          const rid = String(rp.property_id ?? "").trim();
          const sd = rp.start_date;
          if (!rid || sd == null || String(sd).trim() === "") continue;
          relStartDates[rid] = String(sd).trim();
        }

        const { error: coverageErr } =
          await upsertPropertyCoverageMonthsFromUpload(supabase, {
            pmId: selectedPmId,
            uniquePayloads,
            uploadBatchRows: createdBatches as { id: string; property_id: string }[],
            relStartDates,
          });
        if (coverageErr) {
          console.error("[upload] property_coverage_months upsert:", coverageErr);
          importSideEffectError = `Upload batch was saved, but coverage months failed to update: ${coverageErr}`;
        }
      }
    }

    setUploading(false);
    setParsed(null);
    setFileInputKey((k) => k + 1);

    const parts = [
      `${inserted} new booking${inserted === 1 ? "" : "s"} added`,
      `${updated} updated`,
      `${cancellationsDetected} cancellation${cancellationsDetected === 1 ? "" : "s"} detected`,
      `${rowsUnmatchedUnit} row${rowsUnmatchedUnit === 1 ? "" : "s"} unmatched`,
    ];
    if (surveysTriggered > 0) {
      parts.push(
        `${surveysTriggered} survey${surveysTriggered === 1 ? "" : "s"} triggered for completed owner stays`
      );
    }
    let msg = parts.join(", ") + ".";
    if (rowsSkippedOther > 0) {
      msg += ` ${rowsSkippedOther} row${rowsSkippedOther === 1 ? "" : "s"} skipped (missing reservation id or no PM link).`;
    }
    setStatus(msg);
    if (importSideEffectError) {
      setError(importSideEffectError);
    }
  }

  function onClearPreview() {
    setParsed(null);
    setError(null);
    setFileInputKey((k) => k + 1);
  }

  function onPmInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setPmDropdownOpen(true);
    if (selectedPmId) {
      const locked = pmList.find((p) => p.id === selectedPmId);
      if (locked && pmDisplayNamesMatch(v, locked.company_name)) {
        setPmInputValue(v);
        return;
      }
    }
    if (selectedPmId) setSelectedPmId("");
    setPmInputValue(v);
  }

  function onPmInputFocus() {
    if (!loadingPms && !uploading) {
      setPmDropdownOpen(true);
    }
  }

  function selectPmOption(pm: PmOption) {
    const id =
      typeof pm.id === "string" ? pm.id : String(pm.id ?? "").trim();
    if (!id) return;
    setSelectedPmId(id);
    setPmInputValue(pm.company_name ?? "");
    setPmDropdownOpen(false);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Upload booking history (CSV)
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Upload your PM&apos;s full export in one file. Each import replaces the
          in-app picture for this PM: reservations missing from the file are
          marked cancelled. The CSV property/unit column is matched to your properties by
          name (case-insensitive).
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
      {status ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
          {status}
        </div>
      ) : null}

      <div id="pm-combobox-root" className="relative">
        <label
          htmlFor="pm-combobox-input"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Property manager
        </label>
        <input
          id="pm-combobox-input"
          type="text"
          role="combobox"
          aria-expanded={pmDropdownOpen}
          aria-controls="pm-combobox-list"
          aria-autocomplete="list"
          autoComplete="off"
          disabled={loadingPms || uploading}
          onChange={onPmInputChange}
          onFocus={onPmInputFocus}
          placeholder={loadingPms ? "Loading…" : "Select PM"}
          className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
        />
        {pmDropdownOpen && !loadingPms ? (
          <ul
            id="pm-combobox-list"
            role="listbox"
            className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-600 dark:bg-zinc-900"
          >
            {filteredPms.length === 0 ? (
              <li
                role="presentation"
                className="px-3 py-2 text-zinc-500 dark:text-zinc-400"
              >
                No PMs found
              </li>
            ) : (
              filteredPms.map((pm) => (
                <li key={pm.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedPmId === pm.id}
                    disabled={uploading}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectPmOption(pm)}
                    className="flex w-full px-3 py-2 text-left text-zinc-900 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
                  >
                    {pm.company_name}
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>

      {selectedPmId && mappingLoad === "missing" ? (
        <div
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100"
        >
          No field mapping configured for this PM. Please contact an administrator.
        </div>
      ) : null}
      {selectedPmId && mappingLoad === "loading" ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Loading PM CSV format…
        </p>
      ) : null}

      <div>
        <label
          htmlFor="csv-upload-input"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Combined CSV
        </label>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {parsed
            ? `Selected: ${parsed.fileName} — preview below; confirm to apply.`
            : "Headers must match your PM’s configured CSV format (set by an admin)."}
        </p>
        <div className="relative mt-2 min-h-[44px]">
          <div
            className="pointer-events-none flex min-h-[44px] w-full items-center gap-3 rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
            aria-hidden
          >
            <span className="shrink-0 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
              Choose file
            </span>
            <span className="min-w-0 truncate text-sm text-zinc-600 dark:text-zinc-400">
              {parsed?.fileName ?? "No file selected"}
            </span>
          </div>
          <input
            key={fileInputKey}
            id="csv-upload-input"
            type="file"
            accept=".csv,text/csv"
            disabled={
              uploading ||
              loadingProps ||
              !selectedPmId ||
              mappingLoad !== "ready"
            }
            onChange={onFileSelected}
            aria-label="Choose combined CSV file to upload"
            className="absolute inset-0 z-10 m-0 h-full w-full cursor-pointer p-0 opacity-0 disabled:cursor-not-allowed"
          />
        </div>
      </div>

      {parsed ? (
        <div className="space-y-4 rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-700 dark:bg-zinc-900/40">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Preview
            </h2>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              {parsed.rawRows.length} data row
              {parsed.rawRows.length === 1 ? "" : "s"} ·{" "}
              {parsed.csvReservationIds.size} distinct reservation id
              {parsed.csvReservationIds.size === 1 ? "" : "s"}
            </p>
          </div>

          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Property column (preview)
            </h3>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-zinc-800 dark:text-zinc-200">
              {unitSummaryLines.map((line, idx) => (
                <li key={`${idx}-${line}`}>{line}</li>
              ))}
            </ul>
          </div>

          {parsed.unknownUnits.length > 0 ? (
            <div
              role="status"
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100"
            >
              <p className="font-medium">Property column warning</p>
              <p className="mt-1 text-xs opacity-90">
                These values do not match any of your property names (after
                trimming). Rows for them will be skipped on import:
              </p>
              <ul className="mt-2 list-inside list-disc text-xs">
                {parsed.unknownUnits.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-emerald-800 dark:text-emerald-200">
              All distinct property column values match a name in your portfolio.
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={uploading}
              onClick={onConfirmUpload}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {uploading ? "Importing…" : "Confirm import"}
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={onClearPreview}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
