"use client";

import { createClient } from "@/lib/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

const QUEUE_LABELS: Record<string, string> = {
  billing_accuracy: "Billing accuracy",
  payment_timeliness: "Payment timeliness",
  pricing_management: "Pricing management",
  maintenance: "Maintenance",
  guest_screening: "Guest screening",
  communication: "Communication",
  listing_management: "Listing management",
};

type TicketRow = {
  id: string;
  queue: string | null;
  title: string;
  status: string;
  created_at: string;
  pm_profiles:
    | { company_name: string | null }
    | { company_name: string | null }[]
    | null;
};

function ticketPmName(t: TicketRow): string | null {
  const pm = t.pm_profiles;
  if (pm == null) return null;
  const p = Array.isArray(pm) ? pm[0] : pm;
  return p?.company_name ?? null;
}

function statusStyles(status: string) {
  switch (status) {
    case "open":
      return "bg-amber-100 text-amber-950 dark:bg-amber-950/50 dark:text-amber-100";
    case "acknowledged":
      return "bg-blue-100 text-blue-950 dark:bg-blue-950/50 dark:text-blue-100";
    case "resolved":
      return "bg-emerald-100 text-emerald-950 dark:bg-emerald-950/50 dark:text-emerald-100";
    case "disputed":
      return "bg-red-100 text-red-950 dark:bg-red-950/50 dark:text-red-100";
    default:
      return "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200";
  }
}

export default function OwnerTicketsPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      router.replace("/login");
      return;
    }

    const { data, error: qErr } = await supabase
      .from("tickets")
      .select(
        `
        id,
        queue,
        title,
        status,
        created_at,
        pm_profiles ( company_name )
      `
      )
      .eq("owner_id", user.id)
      .eq("direction", "owner_to_pm")
      .order("created_at", { ascending: false });

    setLoading(false);
    if (qErr) {
      setError(qErr.message);
      setTickets([]);
      return;
    }
    setTickets((data as TicketRow[]) ?? []);
  }, [router, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            My tickets
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Issues you filed with your property manager.
          </p>
        </div>
        <Link
          href="/dashboard/tickets/new"
          className="inline-flex justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          File new ticket
        </Link>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-zinc-500">Loading tickets…</p>
      ) : tickets.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No tickets yet.{" "}
          <Link
            href="/dashboard/tickets/new"
            className="font-medium text-zinc-900 underline dark:text-zinc-50"
          >
            File your first ticket
          </Link>
          .
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link
                href={`/dashboard/tickets/${t.id}`}
                className="block px-4 py-4 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusStyles(t.status)}`}
                  >
                    {t.status}
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {(t.queue && QUEUE_LABELS[t.queue]) || t.queue || "—"}
                  </span>
                </div>
                <p className="mt-1 font-medium text-zinc-900 dark:text-zinc-50">
                  {t.title}
                </p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {ticketPmName(t) ?? "PM"} ·{" "}
                  {new Date(t.created_at).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
