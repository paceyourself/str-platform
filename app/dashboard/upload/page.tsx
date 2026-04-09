"use client";

import { createClient } from "@/lib/supabase";
import Papa from "papaparse";
import { useCallback, useEffect, useState } from "react";

type PropertyOption = {
  id: string;
  property_name: string | null;
  address_line1: string | null;
};

function propertyOptionLabel(p: PropertyOption) {
  const primary =
    (p.property_name?.trim() || p.address_line1?.trim() || "").trim() || p.id;
  return primary;
}

/**
 * CSV column header → bookings column (keys must match export headers exactly:
 * capitalization, spaces, hyphens). `null` = skip (not inserted).
 */
const BOOKINGS_CSV_MAP: Record<string, string | null> = {
  "Reservation Id": "source_reservation_id",
  Status: "status",
  Unit: null,
  "Booked Date": "booked_date",
  "Check-In": "check_in",
  Checkout: "check_out",
  Nights: "nights",
  Income: "net_owner_revenue",
  Currency: "currency",
};

const DATE_DB_COLUMNS = new Set(["check_in", "check_out", "booked_date"]);

/** Oversee CSV "Type" → bookings.block_type; unknown/empty → "other". */
function mapCsvTypeToBlockType(csvType: string): string {
  const t = csvType.trim();
  if (!t) return "other";
  const map: Record<string, string> = {
    Vrbo: "guest_ota",
    Website: "guest_ota",
    "Owner Guest": "owner_guest",
    "Owner Hold": "owner_stay",
    Maintenance: "maintenance",
  };
  return map[t] ?? "other";
}

/** Normalize date strings to YYYY-MM-DD for Postgres `date` columns. CSV uses M/D/YYYY (e.g. 4/7/2026). */
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

const BASE_BOOKING_KEYS = new Set([
  "property_id",
  "owner_pm_relationship_id",
  "source_file_id",
]);

function rowToPayload(
  headers: string[],
  cells: string[],
  propertyId: string,
  ownerPmRelationshipId: string | null,
  sourceFileId: string
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
    const dbCol = BOOKINGS_CSV_MAP[key];
    if (dbCol == null) continue;
    const v = raw.trim();
    if (!v) continue;
    if (DATE_DB_COLUMNS.has(dbCol)) {
      const d = parseDateValue(v);
      if (d) {
        payload[dbCol] = d;
      }
    } else if (dbCol === "nights" || dbCol === "net_owner_revenue") {
      const n = Number(String(v).replace(/[^0-9.-]/g, ""));
      if (Number.isFinite(n)) payload[dbCol] = n;
    } else {
      payload[dbCol] = v;
    }
  }

  const bookedHeader = headers.find(
    (h) => BOOKINGS_CSV_MAP[h.trim()] === "booked_date"
  );
  if (bookedHeader) {
    const d = parseDateValue((row[bookedHeader] ?? "").trim());
    if (d) payload.booked_date = d;
  }

  const typeRaw = (row["Type"] ?? "").trim();
  if (typeRaw) {
    payload.raw_type_label = typeRaw;
  }
  payload.block_type = mapCsvTypeToBlockType(typeRaw);

  const dataKeys = Object.keys(payload).filter((k) => !BASE_BOOKING_KEYS.has(k));
  const substantiveKeys = dataKeys.filter(
    (k) => k !== "block_type" && k !== "raw_type_label"
  );
  if (substantiveKeys.length === 0) return null;
  return payload;
}

export default function BookingsUploadPage() {
  const supabase = createClient();
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingProps, setLoadingProps] = useState(true);
  const [uploading, setUploading] = useState(false);

  const loadProperties = useCallback(async () => {
    setLoadingProps(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoadingProps(false);
      return;
    }
    const { data, error: qErr } = await supabase
      .from("properties")
      .select("id, property_name, address_line1")
      .eq("owner_id", user.id)
      .order("property_name", { ascending: true, nullsFirst: false })
      .order("address_line1", { ascending: true, nullsFirst: false });
    setLoadingProps(false);
    if (qErr) {
      setError(qErr.message);
      return;
    }
    setProperties(data ?? []);
    if (data?.length === 1) setPropertyId(data[0].id);
  }, [supabase]);

  useEffect(() => {
    loadProperties();
  }, [loadProperties]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setStatus(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    if (!propertyId) {
      setError("Select a property first.");
      e.target.value = "";
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("You must be signed in.");
      e.target.value = "";
      return;
    }

    const { data: relRows, error: relErr } = await supabase
      .from("owner_pm_relationships")
      .select("id")
      .eq("property_id", propertyId)
      .eq("owner_id", user.id)
      .eq("active", true)
      .limit(1);

    if (relErr) {
      console.error(relErr);
    }
    const ownerPmRelationshipId: string | null = relRows?.[0]?.id ?? null;

    const { data: sourceFileRow, error: sourceFileErr } = await supabase
      .from("upload_files")
      .insert({
        owner_id: user.id,
        property_id: propertyId,
        file_name: file.name,
        storage_url: file.name,
      })
      .select("id")
      .single();

    if (sourceFileErr || !sourceFileRow) {
      setError(
        sourceFileErr?.message ??
          "Could not create upload_files row. Check table columns (e.g. owner_id, file_name, storage_url, property_id) and RLS."
      );
      e.target.value = "";
      return;
    }

    const sourceFileId = sourceFileRow.id as string;

    const text = await file.text();
    const normalized = text.replace(/^\uFEFF/, "");

    const papaResult = Papa.parse<Record<string, unknown>>(normalized, {
      header: true,
      skipEmptyLines: "greedy",
      dynamicTyping: false,
    });

    const rawRows = papaResult.data;
    console.log("Raw CSV row sample:", rawRows[0]);

    const headers = papaResult.meta.fields?.filter(
      (h): h is string => typeof h === "string"
    ) ?? [];

    console.log("[bookings upload] parsed CSV headers:", headers);
    console.log(
      "[bookings upload] header count:",
      headers.length,
      "data row count:",
      rawRows.length
    );
    const known = new Set([...Object.keys(BOOKINGS_CSV_MAP), "Type"]);
    const unmatched = headers.filter((h) => !known.has(h.trim()));
    const missingFromCsv = [...known].filter((k) => !headers.map((h) => h.trim()).includes(k));
    if (unmatched.length)
      console.warn("[bookings upload] CSV headers with no DB map:", unmatched);
    if (missingFromCsv.length)
      console.warn(
        "[bookings upload] expected columns not present in CSV:",
        missingFromCsv
      );

    if (papaResult.errors.length > 0) {
      console.warn("[bookings upload] Papa Parse errors:", papaResult.errors);
    }

    if (headers.length === 0) {
      setError("CSV has no header row.");
      e.target.value = "";
      return;
    }

    const payloads: Record<string, unknown>[] = [];
    for (const rowObj of rawRows) {
      const cells = headers.map((h) => {
        const v = rowObj[h];
        if (v == null) return "";
        return typeof v === "string" ? v : String(v);
      });
      const p = rowToPayload(
        headers,
        cells,
        propertyId,
        ownerPmRelationshipId,
        sourceFileId
      );
      if (p) payloads.push(p);
    }

    if (payloads.length === 0) {
      setError("No rows matched known columns. Check CSV headers.");
      e.target.value = "";
      return;
    }

    setUploading(true);
    console.log("First row payload:", payloads[0]);
    const chunk = 40;
    let inserted = 0;
    for (let i = 0; i < payloads.length; i += chunk) {
      const slice = payloads.slice(i, i + chunk);
      const { error: insErr } = await supabase.from("bookings").insert(slice);
      if (insErr) {
        setUploading(false);
        setError(insErr.message);
        e.target.value = "";
        return;
      }
      inserted += slice.length;
    }
    setUploading(false);
    setStatus(`Imported ${inserted} booking row(s).`);
    e.target.value = "";
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Upload bookings (CSV)
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          CSV columns are mapped to booking fields;{" "}
          <span className="font-medium">Booked Date</span> is sent as{" "}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">
            booked_date
          </code>{" "}
          (YYYY-MM-DD).
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

      <div>
        <label
          htmlFor="property"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Property
        </label>
        <select
          id="property"
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          disabled={loadingProps}
          className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
        >
          <option value="">
            {loadingProps ? "Loading…" : "Select property"}
          </option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {propertyOptionLabel(p)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="csv"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          CSV file
        </label>
        <input
          id="csv"
          type="file"
          accept=".csv,text/csv"
          disabled={uploading || !propertyId}
          onChange={onFile}
          className="mt-1.5 block w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white dark:text-zinc-400 dark:file:bg-zinc-100 dark:file:text-zinc-900"
        />
        {fileName ? (
          <p className="mt-1 text-xs text-zinc-500">Last file: {fileName}</p>
        ) : null}
      </div>
    </div>
  );
}
