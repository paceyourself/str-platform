"use client";

import { createClient } from "@/lib/supabase";
import React, { Fragment, useCallback, useEffect, useMemo, useState } from "react";

type PricingRow = {
  id: string;
  rate_key: string;
  description: string;
  value: number;
  visible_to: string;
  effective_date: string;
  notes: string | null;
  created_at: string;
};

function todayLocalIso(): string {
  return new Date().toISOString().split("T")[0];
}

function formatDisplayValue(rateKey: string, value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) {
    return "—";
  }
  const n = Number(value);
  if (rateKey.endsWith("_pct")) {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(n)}%`;
  }
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

/** Rows must be ordered by rate_key asc, effective_date desc, created_at desc (e.g. from Supabase). */
function firstRowPerRateKey(rows: PricingRow[]): PricingRow[] {
  const out: PricingRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.rate_key)) continue;
    seen.add(r.rate_key);
    out.push(r);
  }
  return out;
}

export default function AdminPricingPage() {
  const supabase = useMemo(() => createClient(), []);
  const todayIso = useMemo(() => todayLocalIso(), []);

  const [latestRows, setLatestRows] = useState<PricingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [historyByKey, setHistoryByKey] = useState<Record<string, PricingRow[]>>({});
  const [historyLoading, setHistoryLoading] = useState<string | null>(null);

  const [editRow, setEditRow] = useState<PricingRow | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editEffectiveDate, setEditEffectiveDate] = useState(todayIso);
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const loadLatest = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("platform_pricing")
      .select(
        "id, rate_key, description, value, visible_to, effective_date, notes, created_at"
      )
      .lte("effective_date", todayIso)
      .order("rate_key", { ascending: true })
      .order("effective_date", { ascending: false })
      .order("created_at", { ascending: false });

    setLoading(false);
    if (err) {
      setError(err.message);
      setLatestRows([]);
      return;
    }
    const rows = (data as PricingRow[]) ?? [];
    setLatestRows(firstRowPerRateKey(rows));
  }, [supabase, todayIso]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) void loadLatest();
    });
  }, [loadLatest, supabase]);

  const fetchHistory = useCallback(
    async (rateKey: string) => {
      setHistoryLoading(rateKey);
      const { data, error: err } = await supabase
        .from("platform_pricing")
        .select(
          "id, rate_key, description, value, visible_to, effective_date, notes, created_at"
        )
        .eq("rate_key", rateKey)
        .order("effective_date", { ascending: false })
        .order("created_at", { ascending: false });

      setHistoryLoading(null);
      if (err) {
        setError(err.message);
        return;
      }
      setHistoryByKey((prev) => ({
        ...prev,
        [rateKey]: (data as PricingRow[]) ?? [],
      }));
    },
    [supabase]
  );

  function toggleHistory(rateKey: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(rateKey)) {
        next.delete(rateKey);
      } else {
        next.add(rateKey);
        void fetchHistory(rateKey);
      }
      return next;
    });
  }

  function openEdit(row: PricingRow) {
    setEditRow(row);
    setEditValue(String(row.value));
    setEditEffectiveDate(todayLocalIso());
    setEditNotes("");
  }

  function closeEdit() {
    if (saving) return;
    setEditRow(null);
  }

  async function saveEdit() {
    if (!editRow) return;
    const raw = editValue.trim();
    const num = Number(raw);
    if (!Number.isFinite(num)) {
      setError("Enter a valid number for value.");
      return;
    }
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.from("platform_pricing").insert({
      rate_key: editRow.rate_key,
      description: editRow.description,
      value: num,
      visible_to: editRow.visible_to,
      effective_date: editEffectiveDate,
      notes: editNotes.trim() || null,
    });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setEditRow(null);
    await loadLatest();
    if (expandedKeys.has(editRow.rate_key)) {
      await fetchHistory(editRow.rate_key);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Platform pricing
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Current rates are the latest row per key with effective date on or before today.
          Edits create a new row (history is preserved).
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : latestRows.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No pricing rows yet. Add rows in Supabase or seed{" "}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">platform_pricing</code>.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-700">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/50">
                <th className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-300">
                  Description
                </th>
                <th className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-300">
                  rate_key
                </th>
                <th className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-300">
                  Value
                </th>
                <th className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-300">
                  visible_to
                </th>
                <th className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-300">
                  effective_date
                </th>
                <th className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-300">
                  History
                </th>
                <th className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-300">
                  {/* edit */}
                </th>
              </tr>
            </thead>
            <tbody>
              {latestRows.map((row) => (
                <Fragment key={row.id}>
                  <tr className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="px-3 py-2 text-zinc-800 dark:text-zinc-200">
                      {row.description || "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                      {row.rate_key}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-zinc-900 dark:text-zinc-50">
                      {formatDisplayValue(row.rate_key, row.value)}
                    </td>
                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                      {row.visible_to || "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-zinc-700 dark:text-zinc-300">
                      {String(row.effective_date).slice(0, 10)}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => toggleHistory(row.rate_key)}
                        className="text-xs font-medium text-zinc-600 underline decoration-zinc-400 underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                      >
                        {expandedKeys.has(row.rate_key) ? "Hide" : "Show"} history
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        className="rounded-lg border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                  {expandedKeys.has(row.rate_key) ? (
                    <tr className="border-b border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/30">
                      <td colSpan={7} className="px-3 py-3">
                        {historyLoading === row.rate_key ? (
                          <p className="text-xs text-zinc-500">Loading history…</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                              Audit history — {row.rate_key}
                            </p>
                            <table className="w-full border-collapse text-xs">
                              <thead>
                                <tr className="border-b border-zinc-200 text-left dark:border-zinc-600">
                                  <th className="py-1 pr-3 font-medium text-zinc-600 dark:text-zinc-400">
                                    effective_date
                                  </th>
                                  <th className="py-1 pr-3 font-medium text-zinc-600 dark:text-zinc-400">
                                    value
                                  </th>
                                  <th className="py-1 pr-3 font-medium text-zinc-600 dark:text-zinc-400">
                                    notes
                                  </th>
                                  <th className="py-1 font-medium text-zinc-600 dark:text-zinc-400">
                                    created_at
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {(historyByKey[row.rate_key] ?? []).map((h) => (
                                  <tr
                                    key={h.id}
                                    className="border-b border-zinc-100 dark:border-zinc-800"
                                  >
                                    <td className="py-1.5 pr-3 tabular-nums text-zinc-800 dark:text-zinc-200">
                                      {String(h.effective_date).slice(0, 10)}
                                    </td>
                                    <td className="py-1.5 pr-3 tabular-nums text-zinc-800 dark:text-zinc-200">
                                      {formatDisplayValue(h.rate_key, h.value)}
                                    </td>
                                    <td className="max-w-[240px] truncate py-1.5 pr-3 text-zinc-600 dark:text-zinc-400" title={h.notes ?? ""}>
                                      {h.notes?.trim() ? h.notes : "—"}
                                    </td>
                                    <td className="py-1.5 tabular-nums text-zinc-500 dark:text-zinc-500">
                                      {new Date(h.created_at).toLocaleString()}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editRow ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeEdit();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pricing-edit-title"
            className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-lg dark:border-zinc-700 dark:bg-zinc-950"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2
              id="pricing-edit-title"
              className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
            >
              New version — {editRow.rate_key}
            </h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Inserts a new row; previous versions stay in history.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label
                  htmlFor="pricing-edit-value"
                  className="block text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  Value
                  {editRow.rate_key.endsWith("_pct") ? (
                    <span className="font-normal text-zinc-500"> (percent, e.g. 12.5)</span>
                  ) : (
                    <span className="font-normal text-zinc-500"> (USD)</span>
                  )}
                </label>
                <input
                  id="pricing-edit-value"
                  type="text"
                  inputMode="decimal"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label
                  htmlFor="pricing-edit-effective"
                  className="block text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  Effective date
                </label>
                <input
                  id="pricing-edit-effective"
                  type="date"
                  value={editEffectiveDate}
                  onChange={(e) => setEditEffectiveDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label
                  htmlFor="pricing-edit-notes"
                  className="block text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  Notes
                </label>
                <textarea
                  id="pricing-edit-notes"
                  rows={3}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeEdit}
                disabled={saving}
                className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveEdit()}
                disabled={saving}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
