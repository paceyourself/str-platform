"use client";
import { createClient } from "@/lib/supabase";
import { useCallback, useEffect, useState } from "react";

type FeeRow = {
  relationship_id: string;
  owner_name: string | null;
  property_name: string | null;
  company_name: string | null;
  pm_fee_pct: number | null;
  pm_monthly_fixed_fee: number | null;
  contract_maintenance_threshold: number | null;
};

type EditState = {
  pm_fee_pct: string;
  pm_monthly_fixed_fee: string;
  contract_maintenance_threshold: string;
};

type Tab = "fees";

export default function AdminPropertiesPage() {
  const supabase = createClient();
  const [tab, setTab] = useState<Tab>("fees");
  const [rows, setRows] = useState<FeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ pm_fee_pct: "", pm_monthly_fixed_fee: "", contract_maintenance_threshold: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: qErr } = await supabase
      .from("owner_pm_relationships")
      .select(`
        id,
        pm_fee_pct,
        pm_monthly_fixed_fee,
        contract_maintenance_threshold,
        properties ( property_name ),
        pm_profiles ( company_name ),
        owner_profiles ( display_name )
      `)
      .eq("active", true)
      .order("id");

    if (qErr) {
      setError(qErr.message);
      setLoading(false);
      return;
    }

    const mapped: FeeRow[] = (data ?? []).map((r) => {
      const prop = r.properties as unknown as { property_name: string | null } | null;
      const pm = r.pm_profiles as unknown as { company_name: string | null } | null;
      const owner = r.owner_profiles as unknown as { display_name: string | null } | null;
      return {
        relationship_id: r.id as string,
        owner_name: owner?.display_name ?? null,
        property_name: prop?.property_name ?? null,
        company_name: pm?.company_name ?? null,
        pm_fee_pct: r.pm_fee_pct as number | null,
        pm_monthly_fixed_fee: r.pm_monthly_fixed_fee as number | null,
        contract_maintenance_threshold: r.contract_maintenance_threshold as number | null,
      };
    });

    setRows(mapped.sort((a, b) => (a.owner_name ?? "").localeCompare(b.owner_name ?? "")));
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  function startEdit(row: FeeRow) {
    setEditingId(row.relationship_id);
    setEditState({
      pm_fee_pct: row.pm_fee_pct?.toString() ?? "",
      pm_monthly_fixed_fee: row.pm_monthly_fixed_fee?.toString() ?? "",
      contract_maintenance_threshold: row.contract_maintenance_threshold?.toString() ?? "",
    });
    setError(null);
    setSuccessId(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setError(null);
  }

  async function handleSave(row: FeeRow) {
    setSaving(true);
    setError(null);

    const feePct = editState.pm_fee_pct.trim() ? Number(editState.pm_fee_pct) : null;
    const fixedFee = editState.pm_monthly_fixed_fee.trim() ? Number(editState.pm_monthly_fixed_fee) : null;
    const threshold = editState.contract_maintenance_threshold.trim() ? Number(editState.contract_maintenance_threshold) : null;

    const relUpdate: Record<string, unknown> = {};
    if (feePct !== null) relUpdate.pm_fee_pct = feePct;
    if (fixedFee !== null) relUpdate.pm_monthly_fixed_fee = fixedFee;
    if (threshold !== null) relUpdate.contract_maintenance_threshold = threshold;

    // Update relationship row
    if (Object.keys(relUpdate).length > 0) {
      const { error: uErr } = await supabase
        .from("owner_pm_relationships")
        .update(relUpdate)
        .eq("id", row.relationship_id);
      if (uErr) {
        setError(uErr.message);
        setSaving(false);
        return;
      }
    }

    // Write audit row to fee history
    const feeHistoryRow: Record<string, unknown> = {
      owner_pm_relationship_id: row.relationship_id,
      effective_date: new Date().toISOString().split("T")[0],
    };
    if (feePct !== null) feeHistoryRow.pm_fee_pct = feePct;
    if (fixedFee !== null) feeHistoryRow.pm_monthly_fixed_fee = fixedFee;
    if (threshold !== null) feeHistoryRow.approval_threshold = threshold;

    const { error: hErr } = await supabase
      .from("owner_pm_fee_history")
      .insert(feeHistoryRow);
    if (hErr) {
      setError(hErr.message);
      setSaving(false);
      return;
    }

    setSuccessId(row.relationship_id);
    setEditingId(null);
    setSaving(false);
    await load();
  }

  function fmt(val: number | null, prefix = "") {
    if (val == null) return <span className="text-zinc-400">—</span>;
    return `${prefix}${val}`;
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Properties</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Admin view of property relationships and fee configuration.
      </p>

      {/* Tabs */}
      <div className="mt-4 flex gap-2 border-b border-zinc-200 dark:border-zinc-700">
        <button
          onClick={() => setTab("fees")}
          className={[
            "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            tab === "fees"
              ? "border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
              : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300",
          ].join(" ")}
        >
          Fee Setup
        </button>
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* Fee Setup Tab */}
      {tab === "fees" && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
          {loading ? (
            <p className="px-4 py-6 text-sm text-zinc-500">Loading…</p>
          ) : (
            <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700 text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Owner</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Property</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">PM</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Fee %</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Fixed Fee</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Threshold</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
                {rows.map((row) => (
                  <tr key={row.relationship_id}>
                    <td className="px-4 py-3 text-zinc-900 dark:text-zinc-50 font-medium">{row.owner_name ?? "—"}</td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{row.property_name ?? "—"}</td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{row.company_name ?? "—"}</td>

                    {editingId === row.relationship_id ? (
                      <>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={editState.pm_fee_pct}
                            onChange={(e) => setEditState((s) => ({ ...s, pm_fee_pct: e.target.value }))}
                            placeholder="e.g. 20"
                            className="w-20 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-50"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={editState.pm_monthly_fixed_fee}
                            onChange={(e) => setEditState((s) => ({ ...s, pm_monthly_fixed_fee: e.target.value }))}
                            placeholder="e.g. 500"
                            className="w-24 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-50"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={editState.contract_maintenance_threshold}
                            onChange={(e) => setEditState((s) => ({ ...s, contract_maintenance_threshold: e.target.value }))}
                            placeholder="e.g. 250"
                            className="w-24 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-50"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleSave(row)}
                              disabled={saving}
                              className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
                            >
                              {saving ? "…" : "Save"}
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400"
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{fmt(row.pm_fee_pct, "")}{ row.pm_fee_pct != null ? "%" : ""}</td>
                        <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{fmt(row.pm_monthly_fixed_fee, "$")}</td>
                        <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{fmt(row.contract_maintenance_threshold, "$")}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => startEdit(row)}
                              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
                            >
                              Override
                            </button>
                            {successId === row.relationship_id && (
                              <span className="text-xs text-green-600 dark:text-green-400">Saved</span>
                            )}
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}