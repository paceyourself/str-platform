"use client";

import { createClient } from "@/lib/supabase";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type PmProfileRow = {
  id: string;
  company_name: string | null;
  profile_claimed: boolean;
  claimed_by_user_id: string | null;
};

const QUEUE_LABELS: Record<string, string> = {
  billing_accuracy: "Billing accuracy",
  payment_timeliness: "Payment timeliness",
  pricing_management: "Pricing management",
  maintenance: "Maintenance",
  guest_screening: "Guest screening",
  communication: "Communication",
  listing_management: "Listing management",
};

/** PostgREST embeds; optional fields align with Supabase client inference. */
type InboxPropertyEmbed = {
  property_name?: string | null;
  address_line1?: string | null;
};

type InboxOwnerPmRelEmbed = {
  properties?:
    | InboxPropertyEmbed
    | InboxPropertyEmbed[]
    | null;
};

type InboxTicket = {
  id: string;
  queue: string | null;
  title: string;
  status: string;
  created_at: string;
  owner_pm_relationships?:
    | InboxOwnerPmRelEmbed
    | InboxOwnerPmRelEmbed[]
    | null;
};

function propertyNameFromTicket(t: InboxTicket): string {
  const rel = t.owner_pm_relationships;
  const r = rel == null ? null : Array.isArray(rel) ? rel[0] : rel;
  const p = r?.properties;
  const prop = p == null ? null : Array.isArray(p) ? p[0] : p;
  return (
    prop?.property_name?.trim() ||
    prop?.address_line1?.trim() ||
    "Property"
  );
}

const STATUS_SECTION_ORDER = [
  "open",
  "acknowledged",
  "resolved",
  "disputed",
  "other",
] as const;

function statusHeading(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function PmDashboardPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<PmProfileRow | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [inboxTickets, setInboxTickets] = useState<InboxTicket[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

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

  const loadInbox = useCallback(
    async (pmId: string) => {
      setInboxLoading(true);
      setInboxError(null);
      const { data, error } = await supabase
        .from("tickets")
        .select(
          `
          id,
          queue,
          title,
          status,
          created_at,
          owner_pm_relationships (
            properties ( property_name, address_line1 )
          )
        `
        )
        .eq("pm_id", pmId)
        .eq("direction", "owner_to_pm")
        .order("created_at", { ascending: false });

      setInboxLoading(false);
      if (error) {
        setInboxError(error.message);
        setInboxTickets([]);
        return;
      }
      setInboxTickets((data as InboxTicket[]) ?? []);
    },
    [supabase]
  );

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (profile?.profile_claimed && profile.id) {
      loadInbox(profile.id);
    } else {
      setInboxTickets([]);
    }
  }, [profile, loadInbox]);

  const groupedTickets = useMemo(() => {
    const map = new Map<string, InboxTicket[]>();
    for (const s of STATUS_SECTION_ORDER) {
      map.set(s, []);
    }
    for (const t of inboxTickets) {
      let bucket: (typeof STATUS_SECTION_ORDER)[number] = "other";
      if (t.status === "open") bucket = "open";
      else if (t.status === "acknowledged") bucket = "acknowledged";
      else if (t.status === "resolved") bucket = "resolved";
      else if (t.status === "disputed") bucket = "disputed";
      const list = map.get(bucket) ?? [];
      list.push(t);
      map.set(bucket, list);
    }
    return map;
  }, [inboxTickets]);

  const acknowledge = async (id: string) => {
    setActingId(id);
    const { error } = await supabase
      .from("tickets")
      .update({
        status: "acknowledged",
        acknowledged_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "open");
    setActingId(null);
    if (error) {
      alert(error.message);
      return;
    }
    if (profile?.id) loadInbox(profile.id);
  };

  const resolveTicket = async (id: string) => {
    const note = window.prompt("Resolution note (required):");
    if (note == null) return;
    const trimmed = note.trim();
    if (!trimmed) {
      alert("Please enter a resolution note.");
      return;
    }
    setActingId(id);
    const { error } = await supabase
      .from("tickets")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolution_note: trimmed,
      })
      .eq("id", id)
      .in("status", ["open", "acknowledged"]);
    setActingId(null);
    if (error) {
      alert(error.message);
      return;
    }
    if (profile?.id) loadInbox(profile.id);
  };

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

      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Ticket inbox
        </h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Tickets filed by owners (owner → PM).
        </p>
        {inboxError ? (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">
            {inboxError}
          </p>
        ) : null}
        {inboxLoading ? (
          <p className="mt-3 text-sm text-zinc-500">Loading tickets…</p>
        ) : inboxTickets.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            No tickets yet.
          </p>
        ) : (
          <div className="mt-4 space-y-6">
            {STATUS_SECTION_ORDER.map((statusKey) => {
              const list = groupedTickets.get(statusKey) ?? [];
              if (list.length === 0) return null;
              return (
                <div key={statusKey}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    {statusKey === "other" ? "Other" : statusHeading(statusKey)}
                  </h3>
                  <ul className="mt-2 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                    {list.map((t) => (
                      <li
                        key={t.id}
                        className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:justify-between"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            {(t.queue && QUEUE_LABELS[t.queue]) || t.queue} ·{" "}
                            {propertyNameFromTicket(t)}
                          </p>
                          <p className="mt-0.5 font-medium text-zinc-900 dark:text-zinc-50">
                            {t.title}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {new Date(t.created_at).toLocaleString(undefined, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          {t.status === "open" ? (
                            <button
                              type="button"
                              disabled={actingId === t.id}
                              onClick={() => acknowledge(t.id)}
                              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              Acknowledge
                            </button>
                          ) : null}
                          {t.status === "open" || t.status === "acknowledged" ? (
                            <button
                              type="button"
                              disabled={actingId === t.id}
                              onClick={() => resolveTicket(t.id)}
                              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              Resolve
                            </button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
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
        <Link
          href="/pm/dashboard/requests/new"
          className="inline-flex rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Submit Request to Owner
        </Link>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Maintenance, vendor selection, guest decisions, and other owner
          approvals.
        </p>
      </div>
    </div>
  );
}
