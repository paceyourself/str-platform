"use client";
import { createClient } from "@/lib/supabase";
import { useCallback, useEffect, useState } from "react";

type OwnerRow = {
  id: string;
  display_name: string | null;
  email: string | null;
  created_at: string;
};

type PmRow = {
  id: string;
  company_name: string | null;
  claimed_by_user_id: string | null;
  profile_claimed: boolean;
  created_at: string;
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
};

export default function AdminUserManagementPage() {
  const supabase = createClient();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);

    const [
      { data: owners },
      { data: pms },
      { data: admins },
    ] = await Promise.all([
      supabase.from("owner_profiles").select("id, display_name, email, created_at"),
      supabase.from("pm_profiles").select("id, company_name, claimed_by_user_id, profile_claimed, created_at"),
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
        Search and view all platform users. Deactivation coming Sprint 9.
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
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-zinc-400">
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