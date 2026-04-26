"use client";
import { createClient } from "@/lib/supabase";
import { useCallback, useEffect, useState } from "react";

type ClaimRow = {
  id: string;
  company_name: string | null;
  claimed_by_user_id: string;
  email_domain: string | null;
  created_at: string;
  claimer_email?: string | null;
};

export default function AdminPmClaimsPage() {
  const supabase = createClient();
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: qErr } = await supabase
      .from("pm_profiles")
      .select("id, company_name, claimed_by_user_id, email_domain, created_at")
      .not("claimed_by_user_id", "is", null)
      .is("claim_verified_at", null)
      .order("created_at", { ascending: false });

    if (qErr) {
      setError(qErr.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as ClaimRow[];

    // Fetch owner emails for claimants
    const claimerIds = rows.map((r) => r.claimed_by_user_id);
    if (claimerIds.length > 0) {
      const { data: owners } = await supabase
        .from("owner_profiles")
        .select("id, email")
        .in("id", claimerIds);
      const emailMap = new Map(
        (owners ?? []).map((o) => [o.id as string, o.email as string | null])
      );
      rows.forEach((r) => {
        r.claimer_email = emailMap.get(r.claimed_by_user_id) ?? null;
      });
    }

    setClaims(rows);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function handleApprove(id: string) {
    setActing(id);
    setError(null);
    const { error: uErr } = await supabase
      .from("pm_profiles")
      .update({ claim_verified_at: new Date().toISOString() })
      .eq("id", id);
    if (uErr) {
      setError(uErr.message);
    } else {
      await load();
    }
    setActing(null);
  }

  async function handleReject(id: string) {
    setActing(id);
    setError(null);
    const { error: uErr } = await supabase
      .from("pm_profiles")
      .update({
        claimed_by_user_id: null,
        profile_claimed: false,
      })
      .eq("id", id);
    if (uErr) {
      setError(uErr.message);
    } else {
      await load();
    }
    setActing(null);
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        PM Claim Approval Queue
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Review and approve or reject PM profile claims. Approve verifies the
        claim and grants PM portal access. Reject clears the claim so the
        profile can be re-claimed.
      </p>

      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {loading ? (
        <p className="mt-6 text-sm text-zinc-500">Loading…</p>
      ) : claims.length === 0 ? (
        <div className="mt-6 rounded-lg border border-zinc-200 dark:border-zinc-700 px-6 py-10 text-center">
          <p className="text-sm text-zinc-500">No pending claims.</p>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
          <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700 text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">PM Company</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Claimed By</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Email Domain</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Claimed</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
              {claims.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-50">
                    {c.company_name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {c.claimer_email ?? c.claimed_by_user_id}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {c.email_domain ?? (
                      <span className="text-amber-600 dark:text-amber-400">No domain set</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                    {new Date(c.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApprove(c.id)}
                        disabled={acting === c.id}
                        className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                      >
                        {acting === c.id ? "…" : "Approve"}
                      </button>
                      <button
                        onClick={() => handleReject(c.id)}
                        disabled={acting === c.id}
                        className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        {acting === c.id ? "…" : "Reject"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}