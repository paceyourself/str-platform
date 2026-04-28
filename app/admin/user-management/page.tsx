"use client";
import { createClient } from "@/lib/supabase";
import { useCallback, useEffect, useState } from "react";

type OwnerRow = {
    id: string;
    display_name: string | null;
    email: string | null;
    created_at: string;
    deactivated_at: string | null;
  };

  type PmRow = {
    id: string;
    company_name: string | null;
    claimed_by_user_id: string | null;
    profile_claimed: boolean;
    created_at: string;
    deactivated_at: string | null;
  };

type AdminRow = {
  user_id: string;
};

type UserRecord = {
    user_id: string;
    display_name: string | null;
    email: string | null;
    roles: string[];
    company_name: string | null;
    created_at: string;
    deactivated_at: string | null;
    is_owner: boolean;
    is_pm: boolean;
  };

export default function AdminUserManagementPage() {
    const supabase = createClient();
    const [users, setUsers] = useState<UserRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [acting, setActing] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    const [
      { data: owners },
      { data: pms },
      { data: admins },
    ] = await Promise.all([
        supabase.from("owner_profiles").select("id, display_name, email, created_at, deactivated_at"),
        supabase.from("pm_profiles").select("id, company_name, claimed_by_user_id, profile_claimed, created_at, deactivated_at"),
      supabase.from("admin_users").select("user_id"),
    ]);

    const adminSet = new Set((admins ?? []).map((a: AdminRow) => a.user_id));
    const map = new Map<string, UserRecord>();

    for (const o of owners ?? []) {
      const row = o as OwnerRow;
      map.set(row.id, {
        user_id: row.id,
        display_name: row.display_name,
        email: row.email,
        roles: adminSet.has(row.id) ? ["Owner", "Admin"] : ["Owner"],
        company_name: null,
        created_at: row.created_at,
        deactivated_at: row.deactivated_at,
        is_owner: true,
        is_pm: false,
      });
    }

    for (const p of pms ?? []) {
      const row = p as PmRow;
      if (!row.claimed_by_user_id) continue;
      if (map.has(row.claimed_by_user_id)) {
        map.get(row.claimed_by_user_id)!.roles.push("PM");
        map.get(row.claimed_by_user_id)!.company_name = row.company_name;
      } else {
        map.set(row.claimed_by_user_id, {
            user_id: row.claimed_by_user_id,
            display_name: null,
            email: null,
            roles: adminSet.has(row.claimed_by_user_id) ? ["PM", "Admin"] : ["PM"],
            company_name: row.company_name,
            created_at: row.created_at,
            deactivated_at: row.deactivated_at,
            is_owner: false,
            is_pm: true,
          });
      }
    }

    setUsers(Array.from(map.values()).sort((a, b) =>
      (a.display_name ?? a.company_name ?? "").localeCompare(
        b.display_name ?? b.company_name ?? ""
      )
    ));
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function handleDeactivate(u: UserRecord) {
    setActing(u.user_id);
    setError(null);
    const now = new Date().toISOString();
    if (u.is_owner) {
      await supabase.from("owner_profiles").update({ deactivated_at: now }).eq("id", u.user_id);
    }
    if (u.is_pm) {
      const { data: pmData } = await supabase.from("pm_profiles").select("id").eq("claimed_by_user_id", u.user_id).single();
      if (pmData) await supabase.from("pm_profiles").update({ deactivated_at: now }).eq("id", pmData.id);
    }
    await load();
    setActing(null);
  }

  async function handleReactivate(u: UserRecord) {
    setActing(u.user_id);
    setError(null);
    if (u.is_owner) {
      await supabase.from("owner_profiles").update({ deactivated_at: null }).eq("id", u.user_id);
    }
    if (u.is_pm) {
      const { data: pmData } = await supabase.from("pm_profiles").select("id").eq("claimed_by_user_id", u.user_id).single();
      if (pmData) await supabase.from("pm_profiles").update({ deactivated_at: null }).eq("id", pmData.id);
    }
    await load();
    setActing(null);
  }

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return (
      u.display_name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.company_name?.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        User Management
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
      Search and view all platform users. Deactivate or reactivate access. Admin accounts cannot be deactivated.
      </p>

      <div className="mt-4">
        <input
          type="search"
          placeholder="Search by name, email, or company…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="block w-full max-w-sm rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-zinc-500">Loading…</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
          <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700 text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Name</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Email</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Company</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Roles</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Joined</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Status</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Actions</th>
            </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-zinc-400">
                    No users found.
                  </td>
                </tr>
              ) : (
                filtered.map((u) => (
                  <tr key={u.user_id}>
                    <td className="px-4 py-3 text-zinc-900 dark:text-zinc-50 font-medium">
                      {u.display_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {u.email ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {u.company_name ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {u.roles.map((r) => (
                          <span
                            key={r}
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      {u.deactivated_at ? (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                          Deactivated
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {!u.roles.includes("Admin") && (
                        u.deactivated_at ? (
                          <button
                            onClick={() => handleReactivate(u)}
                            disabled={acting === u.user_id}
                            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
                          >
                            {acting === u.user_id ? "…" : "Reactivate"}
                          </button>
                        ) : (
                          <button
                            onClick={() => handleDeactivate(u)}
                            disabled={acting === u.user_id}
                            className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
                          >
                            {acting === u.user_id ? "…" : "Deactivate"}
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}