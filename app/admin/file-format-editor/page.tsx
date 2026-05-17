"use client";

import { createClient } from "@/lib/supabase";
import { useCallback, useEffect, useState } from "react";

type PmOption = { id: string; company_name: string | null };

const PLATFORM_FIELDS = [
  "source_reservation_id",
  "status",
  "booked_date",
  "check_in",
  "check_out",
  "gross_revenue",
  "raw_type_label",
  "channel",
  "currency",
] as const;

const BLOCK_TYPES = [
  "guest_ota",
  "guest_pm_direct",
  "owner_stay",
  "owner_guest",
  "other",
] as const;

const CANCELLATION_SIGNALS = [
  { value: "", label: "— None —" },
  { value: "absence_detected", label: "absence_detected" },
  { value: "status_field", label: "status_field" },
  { value: "cancellation_row", label: "cancellation_row" },
] as const;

type ColumnRow = { id: string; csvHeader: string; platformField: string };
type TypeRow = { id: string; csvType: string; blockType: string };

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function AdminFileFormatEditorPage() {
  const supabase = createClient();

  const [pms, setPms] = useState<PmOption[]>([]);
  const [pmsLoading, setPmsLoading] = useState(true);
  const [selectedPmId, setSelectedPmId] = useState("");

  const [columnRows, setColumnRows] = useState<ColumnRow[]>([]);
  const [typeRows, setTypeRows] = useState<TypeRow[]>([]);
  const [cancellationSignal, setCancellationSignal] = useState("");
  const [flaggedLabels, setFlaggedLabels] = useState<string[]>([]);
  const [mappingLoading, setMappingLoading] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const loadPms = useCallback(async () => {
    setPmsLoading(true);
    const { data, error: qErr } = await supabase
      .from("pm_profiles")
      .select("id, company_name")
      .order("company_name");
    setPmsLoading(false);
    if (qErr) {
      setError(qErr.message);
      return;
    }
    setPms((data as PmOption[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    loadPms();
  }, [loadPms]);

  const loadMapping = useCallback(async () => {
    if (!selectedPmId) {
      setColumnRows([]);
      setTypeRows([]);
      setCancellationSignal("");
      setFlaggedLabels([]);
      return;
    }
    setMappingLoading(true);
    setError(null);
    setSuccess(false);
    const { data, error: qErr } = await supabase
      .from("pm_field_mappings")
      .select("column_map, type_label_map, cancellation_signal_type, flagged_labels")
      .eq("pm_id", selectedPmId)
      .maybeSingle();
    setMappingLoading(false);
    if (qErr) {
      setError(qErr.message);
      return;
    }
    if (!data) {
      setColumnRows([{ id: newId(), csvHeader: "", platformField: "" }]);
      setTypeRows([{ id: newId(), csvType: "", blockType: "guest_ota" }]);
      setCancellationSignal("");
      setFlaggedLabels([]);
      return;
    }
    const cm = (data.column_map ?? {}) as Record<string, string | null>;
    const tm = (data.type_label_map ?? {}) as Record<string, string>;
    setColumnRows(
      Object.entries(cm).map(([csvHeader, platform]) => ({
        id: newId(),
        csvHeader,
        platformField: platform === null ? "" : platform,
      }))
    );
    setTypeRows(
      Object.entries(tm).map(([csvType, blockType]) => ({
        id: newId(),
        csvType,
        blockType,
      }))
    );
    setCancellationSignal(
      (data.cancellation_signal_type as string | null) ?? ""
    );
    setFlaggedLabels(
      Array.isArray(data.flagged_labels)
        ? (data.flagged_labels as string[])
        : []
    );
  }, [supabase, selectedPmId]);

  useEffect(() => {
    loadMapping();
  }, [loadMapping]);

  function addColumnRow() {
    setColumnRows((r) => [...r, { id: newId(), csvHeader: "", platformField: "" }]);
  }
  function removeColumnRow(id: string) {
    setColumnRows((r) => (r.length <= 1 ? r : r.filter((x) => x.id !== id)));
  }
  function addTypeRow() {
    setTypeRows((r) => [...r, { id: newId(), csvType: "", blockType: "guest_ota" }]);
  }
  function removeTypeRow(id: string) {
    setTypeRows((r) => (r.length <= 1 ? r : r.filter((x) => x.id !== id)));
  }

  async function handleSave() {
    if (!selectedPmId) return;
    setSaving(true);
    setError(null);
    setSuccess(false);

    const column_map: Record<string, string | null> = {};
    for (const row of columnRows) {
      const h = row.csvHeader.trim();
      if (!h) continue;
      column_map[h] =
        row.platformField.trim() === "" ? null : row.platformField.trim();
    }

    const type_label_map: Record<string, string> = {};
    for (const row of typeRows) {
      const k = row.csvType.trim();
      if (!k) continue;
      type_label_map[k] = row.blockType;
    }

    const payload = {
      pm_id: selectedPmId,
      column_map,
      type_label_map,
      flagged_labels: flaggedLabels,
      cancellation_signal_type:
        cancellationSignal.trim() === "" ? null : cancellationSignal.trim(),
      updated_at: new Date().toISOString(),
    };

    const { error: upErr } = await supabase.from("pm_field_mappings").upsert(
      payload,
      { onConflict: "pm_id" }
    );
    setSaving(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    setSuccess(true);
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        File Format Editor
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Map each PM&apos;s booking CSV columns and type labels to platform fields.
      </p>

      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      {success && (
        <p className="mt-3 text-sm text-green-600 dark:text-green-400">
          Saved successfully.
        </p>
      )}

      <div className="mt-6 space-y-2">
        <label
          htmlFor="pm-select"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Property manager
        </label>
        <select
          id="pm-select"
          disabled={pmsLoading}
          value={selectedPmId}
          onChange={(e) => setSelectedPmId(e.target.value)}
          className="block w-full max-w-md rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
        >
          <option value="">{pmsLoading ? "Loading…" : "Select a PM"}</option>
          {pms.map((pm) => (
            <option key={pm.id} value={pm.id}>
              {pm.company_name ?? pm.id}
            </option>
          ))}
        </select>
      </div>

      {selectedPmId && (
        <>
          {mappingLoading ? (
            <p className="mt-6 text-sm text-zinc-500">Loading mapping…</p>
          ) : (
            <>
              <section className="mt-8">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Column map
                </h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  CSV header → platform field. Use &quot;— Skip —&quot; for columns that
                  are not loaded (e.g. property unit, nights).
                </p>
                <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-700">
                    <thead className="bg-zinc-50 dark:bg-zinc-800">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">
                          CSV Header
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">
                          Platform Field
                        </th>
                        <th className="w-16 px-2 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800 dark:bg-zinc-900">
                      {columnRows.map((row) => (
                        <tr key={row.id}>
                          <td className="px-4 py-2">
                            <input
                              type="text"
                              value={row.csvHeader}
                              onChange={(e) =>
                                setColumnRows((rows) =>
                                  rows.map((r) =>
                                    r.id === row.id
                                      ? { ...r, csvHeader: e.target.value }
                                      : r
                                  )
                                )
                              }
                              placeholder='e.g. "Reservation Id"'
                              className="w-full rounded border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-50"
                            />
                          </td>
                          <td className="px-4 py-2">
                            <select
                              value={row.platformField}
                              onChange={(e) =>
                                setColumnRows((rows) =>
                                  rows.map((r) =>
                                    r.id === row.id
                                      ? { ...r, platformField: e.target.value }
                                      : r
                                  )
                                )
                              }
                              className="w-full rounded border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-50"
                            >
                              <option value="">— Skip —</option>
                              {PLATFORM_FIELDS.map((f) => (
                                <option key={f} value={f}>
                                  {f}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              onClick={() => removeColumnRow(row.id)}
                              className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
                              aria-label="Remove row"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  onClick={addColumnRow}
                  className="mt-2 text-xs font-medium text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400"
                >
                  + Add mapping
                </button>
              </section>

              <section className="mt-10">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Type label map
                </h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  CSV &quot;Type&quot; values → platform{" "}
                  <code className="text-zinc-600 dark:text-zinc-300">block_type</code>.
                </p>
                <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-700">
                    <thead className="bg-zinc-50 dark:bg-zinc-800">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">
                          CSV Type Value
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">
                          Platform block_type
                        </th>
                        <th className="w-16 px-2 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800 dark:bg-zinc-900">
                      {typeRows.map((row) => (
                        <tr key={row.id}>
                          <td className="px-4 py-2">
                            <input
                              type="text"
                              value={row.csvType}
                              onChange={(e) =>
                                setTypeRows((rows) =>
                                  rows.map((r) =>
                                    r.id === row.id
                                      ? { ...r, csvType: e.target.value }
                                      : r
                                  )
                                )
                              }
                              placeholder="e.g. Guest"
                              className="w-full rounded border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-50"
                            />
                          </td>
                          <td className="px-4 py-2">
                            <select
                              value={row.blockType}
                              onChange={(e) =>
                                setTypeRows((rows) =>
                                  rows.map((r) =>
                                    r.id === row.id
                                      ? { ...r, blockType: e.target.value }
                                      : r
                                  )
                                )
                              }
                              className="w-full rounded border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-50"
                            >
                              {BLOCK_TYPES.map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              onClick={() => removeTypeRow(row.id)}
                              className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
                              aria-label="Remove row"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  onClick={addTypeRow}
                  className="mt-2 text-xs font-medium text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400"
                >
                  + Add mapping
                </button>
              </section>

              <section className="mt-10 max-w-md">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Cancellation signal type
                </h2>
                <select
                  value={cancellationSignal}
                  onChange={(e) => setCancellationSignal(e.target.value)}
                  className="mt-2 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
                >
                  {CANCELLATION_SIGNALS.map((o) => (
                    <option key={o.value || "none"} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </section>

              <div className="mt-10">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSave}
                  className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
