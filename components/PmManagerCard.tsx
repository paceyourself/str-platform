"use client";

import { createClient } from "@/lib/supabase";
import Link from "next/link";
import { useState } from "react";

type PropertyFeeSummary = {
  name: string;
  pm_fee_pct: number | null;
  pm_monthly_fixed_fee: number | null;
  relId: string;
};

type GroupedPmSummary = {
  pmId: string;
  companyName: string;
  profileClaimed: boolean;
  properties: PropertyFeeSummary[];
  contractStart: string | null;
};

type EditState = {
  relId: string;
  pmFeePct: string;
  pmMonthlyFixedFee: string;
  effectiveDate: string;
  submitting: boolean;
  error: string | null;
};

function feeLabel(prop: PropertyFeeSummary): string {
  const parts: string[] = [];
  if (prop.pm_monthly_fixed_fee != null)
    parts.push(`$${Number(prop.pm_monthly_fixed_fee).toLocaleString()}/mo`);
  if (prop.pm_fee_pct != null) parts.push(`${prop.pm_fee_pct}%`);
  return parts.join(" · ");
}

export default function PmManagerCard({
  rows,
  onFeesUpdated,
}: {
  rows: GroupedPmSummary[];
  onFeesUpdated: () => void;
}) {
  const supabase = createClient();
  const [editState, setEditState] = useState<EditState | null>(null);

  function openEdit(prop: PropertyFeeSummary) {
    setEditState({
      relId: prop.relId,
      pmFeePct: prop.pm_fee_pct != null ? String(prop.pm_fee_pct) : "",
      pmMonthlyFixedFee:
        prop.pm_monthly_fixed_fee != null
          ? String(prop.pm_monthly_fixed_fee)
          : "",
      effectiveDate: new Date().toISOString().slice(0, 10),
      submitting: false,
      error: null,
    });
  }

  function cancelEdit() {
    setEditState(null);
  }

  async function handleSave() {
    if (!editState) return;
    setEditState((s) => s && { ...s, submitting: true, error: null });

    const relFeeUpdate: Record<string, unknown> = {};
    const feeRow: Record<string, unknown> = {
      owner_pm_relationship_id: editState.relId,
      effective_date: editState.effectiveDate,
    };

    if (editState.pmFeePct.trim()) {
      const n = Number(editState.pmFeePct);
      if (Number.isFinite(n)) {
        relFeeUpdate.pm_fee_pct = n;
        feeRow.pm_fee_pct = n;
      }
    } else {
      relFeeUpdate.pm_fee_pct = null;
    }

    if (editState.pmMonthlyFixedFee.trim()) {
      const n = Number(editState.pmMonthlyFixedFee);
      if (Number.isFinite(n)) {
        relFeeUpdate.pm_monthly_fixed_fee = n;
        feeRow.pm_monthly_fixed_fee = n;
      }
    } else {
      relFeeUpdate.pm_monthly_fixed_fee = null;
    }

    const { error: uErr } = await supabase
      .from("owner_pm_relationships")
      .update(relFeeUpdate)
      .eq("id", editState.relId);

    if (uErr) {
      setEditState((s) => s && { ...s, submitting: false, error: uErr.message });
      return;
    }

    await supabase.from("owner_pm_fee_history").insert(feeRow);

    setEditState(null);
    onFeesUpdated();
  }

  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li
          key={row.pmId}
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
        >
          <div className="flex items-center justify-between">
            <p className="font-medium text-zinc-900 dark:text-zinc-50">
              {row.companyName}
            </p>
            {!row.profileClaimed && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                Unclaimed
              </span>
            )}
          </div>

          <ul className="mt-2 space-y-2">
            {row.properties.map((prop) => (
              <li key={prop.relId}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {prop.name}
                  </span>
                  <div className="flex items-center gap-2">
                    {prop.pm_fee_pct != null ||
                    prop.pm_monthly_fixed_fee != null ? (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {feeLabel(prop)}
                      </span>
                    ) : (
                      <span className="text-xs text-amber-600 dark:text-amber-400">
                        ⚠ Fees not entered
                      </span>
                    )}
                    {editState?.relId === prop.relId ? (
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                      >
                        Cancel
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openEdit(prop)}
                        className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                        title="Edit fees"
                      >
                        ✎
                      </button>
                    )}
                  </div>
                </div>

                {editState?.relId === prop.relId && (
                  <div className="mt-2 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/40">
                    {editState.error && (
                      <p className="text-xs text-red-600 dark:text-red-400">
                        {editState.error}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="block text-xs text-zinc-500 dark:text-zinc-400">
                          Fee (%)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          value={editState.pmFeePct}
                          onChange={(e) =>
                            setEditState(
                              (s) => s && { ...s, pmFeePct: e.target.value }
                            )
                          }
                          className="mt-0.5 block w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs text-zinc-500 dark:text-zinc-400">
                          Fixed fee ($/mo)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={editState.pmMonthlyFixedFee}
                          onChange={(e) =>
                            setEditState(
                              (s) =>
                                s && {
                                  ...s,
                                  pmMonthlyFixedFee: e.target.value,
                                }
                            )
                          }
                          className="mt-0.5 block w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs text-zinc-500 dark:text-zinc-400">
                          Effective date
                        </label>
                        <input
                          type="date"
                          value={editState.effectiveDate}
                          onChange={(e) =>
                            setEditState(
                              (s) =>
                                s && { ...s, effectiveDate: e.target.value }
                            )
                          }
                          className="mt-0.5 block w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={editState.submitting}
                      className="rounded bg-zinc-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                    >
                      {editState.submitting ? "Saving…" : "Save"}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <p className="mt-2">
            <Link
              href="/dashboard/tickets"
              className="text-xs font-medium text-zinc-500 hover:underline dark:text-zinc-400"
            >
              View tickets →
            </Link>
          </p>
        </li>
      ))}
    </ul>
  );
}