"use client";

import { createClient } from "@/lib/supabase";
import { useCallback, useEffect, useState } from "react";

type PmProfileRow = {
  id: string;
  company_name: string | null;
  profile_claimed: boolean;
  claimed_by_user_id: string | null;
};

export default function PmDashboardPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<PmProfileRow | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setUnauthorized(false);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      setUnauthorized(true);
      return;
    }

    const { data, error } = await supabase
      .from("pm_profiles")
      .select("id, company_name, profile_claimed, claimed_by_user_id")
      .eq("claimed_by_user_id", user.id)
      .maybeSingle();

    setLoading(false);

    if (error) {
      console.error(error);
      setProfile(null);
      return;
    }

    setProfile(data as PmProfileRow | null);
  }, [supabase]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  if (loading) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading…</p>
    );
  }

  if (unauthorized) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        You must be signed in to view this page.
      </p>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-lg space-y-3 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          No PM profile linked
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Your account is not linked to a property manager company profile. If
          you have not submitted a claim yet, sign up as a property manager and
          select your company.
        </p>
      </div>
    );
  }

  if (!profile.profile_claimed) {
    return (
      <div className="max-w-lg space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-900/40 dark:bg-amber-950/30">
        <h1 className="text-lg font-semibold text-amber-950 dark:text-amber-100">
          Pending approval
        </h1>
        <p className="text-sm text-amber-900/90 dark:text-amber-200/90">
          Your account is pending approval. You will be notified when an
          administrator has verified your company claim.
        </p>
        <p className="text-xs text-amber-800/80 dark:text-amber-300/80">
          {profile.company_name ?? "Your company"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {profile.company_name ?? "Your company"}
        </h1>
        <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">
          Profile active
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <section className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Ticket inbox
          </h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            No tickets yet. (Placeholder)
          </p>
        </section>
        <section className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Work orders sent
          </h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            None yet. (Placeholder)
          </p>
        </section>
        <section className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Owner reviews
          </h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Coming soon. (Placeholder)
          </p>
        </section>
      </div>

      <div>
        <button
          type="button"
          disabled
          className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Submit Request to Owner
        </button>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Submitting requests to owners will be available in a future update.
        </p>
      </div>
    </div>
  );
}
