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

const REQUEST_TYPE_LABELS: Record<string, string> = {
  maintenance_work_order: "Maintenance work order",
  vendor_selection: "Vendor selection",
  guest_decision: "Guest decision",
  owner_action_required: "Owner action required",
};

type TicketRow = {
  id: string;
  title: string;
  description: string;
  status: string;
  direction: string;
  queue: string | null;
  request_type: string | null;
  acknowledged_at: string | null;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
  owner_pm_relationship_id: string | null;
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

function categoryLabel(t: TicketRow): string {
  if (t.direction === "pm_to_owner") {
    const rt = t.request_type?.trim();
    if (!rt) return "—";
    return REQUEST_TYPE_LABELS[rt] ?? rt.replace(/_/g, " ");
  }
  const q = t.queue?.trim();
  if (!q) return "—";
  return QUEUE_LABELS[q] ?? q.replace(/_/g, " ");
}

function statusStyles(status: string) {
  switch (status) {
    case "open":
      return "bg-amber-100 text-amber-950 dark:bg-amber-950/50 dark:text-amber-100";
    case "acknowledged":
      return "bg-blue-100 text-blue-950 dark:bg-blue-950/50 dark:text-blue-100";
    case "resolved":
      return "bg-emerald-100 text-emerald-950 dark:bg-emerald-950/50 dark:text-emerald-100";
    case "closed":
      return "bg-emerald-100 text-emerald-950 dark:bg-emerald-950/50 dark:text-emerald-100";
    case "disputed":
      return "bg-red-100 text-red-950 dark:bg-red-950/50 dark:text-red-100";
    default:
      return "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200";
  }
}

function sortByCreatedDesc(a: TicketRow, b: TicketRow) {
  return (
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

function sortByResolvedDesc(a: TicketRow, b: TicketRow) {
  const ta = new Date(a.resolved_at || a.created_at).getTime();
  const tb = new Date(b.resolved_at || b.created_at).getTime();
  return tb - ta;
}

function splitTickets(rows: TicketRow[]): {
  openTickets: TicketRow[];
  resolvedTickets: TicketRow[];
} {
  const openTickets: TicketRow[] = [];
  const resolvedTickets: TicketRow[] = [];
  for (const t of rows) {
    if (t.status === "open") {
      openTickets.push(t);
    } else if (t.status === "resolved" || t.status === "closed") {
      resolvedTickets.push(t);
    }
  }
  openTickets.sort(sortByCreatedDesc);
  resolvedTickets.sort(sortByResolvedDesc);
  return { openTickets, resolvedTickets };
}

function DirectionPill({ direction }: { direction: string }) {
  if (direction === "pm_to_owner") {
    return (
      <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-950 dark:bg-blue-950/50 dark:text-blue-100">
        PM request
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200">
      My ticket
    </span>
  );
}

function OpenTicketRow({
  t,
  expanded,
  onToggleRespond,
  respondDraft,
  onRespondDraftChange,
  respondError,
  respondSubmitting,
  onRespondSubmit,
}: {
  t: TicketRow;
  expanded: boolean;
  onToggleRespond: () => void;
  respondDraft: string;
  onRespondDraftChange: (value: string) => void;
  respondError: string | null;
  respondSubmitting: boolean;
  onRespondSubmit: () => void;
}) {
  const showRespond = t.direction === "pm_to_owner" && t.status === "open";
  return (
    <li className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start">
        <Link
          href={`/dashboard/tickets/${t.id}`}
          className="min-w-0 flex-1 transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-900/30 sm:-mx-2 sm:rounded-lg sm:px-2 sm:py-1"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-950 dark:bg-amber-950/50 dark:text-amber-100">
              Open
            </span>
            <DirectionPill direction={t.direction} />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {categoryLabel(t)}
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
        {showRespond ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onToggleRespond();
            }}
            className="shrink-0 self-start rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {expanded ? "Cancel" : "Respond"}
          </button>
        ) : null}
      </div>
      {expanded && showRespond ? (
        <div className="border-t border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
          {respondError ? (
            <p className="mb-2 text-sm text-red-600 dark:text-red-400">
              {respondError}
            </p>
          ) : null}
          <textarea
            value={respondDraft}
            onChange={(e) => onRespondDraftChange(e.target.value)}
            rows={3}
            className="block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
            placeholder="Your response…"
            disabled={respondSubmitting}
          />
          <button
            type="button"
            onClick={() => void onRespondSubmit()}
            disabled={respondSubmitting}
            className="mt-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {respondSubmitting ? "Sending…" : "Submit"}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function ResolvedTicketRow({ t }: { t: TicketRow }) {
  const badgeLabel = t.status === "closed" ? "Closed" : "Resolved";
  return (
    <li className="border-b border-zinc-200 dark:border-zinc-800">
      <Link
        href={`/dashboard/tickets/${t.id}`}
        className="block px-4 py-4 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles(t.status === "closed" ? "closed" : "resolved")}`}
          >
            {badgeLabel}
          </span>
          <DirectionPill direction={t.direction} />
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {categoryLabel(t)}
          </span>
        </div>
        <p className="mt-1 font-medium text-zinc-900 dark:text-zinc-50">
          {t.title}
        </p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {ticketPmName(t) ?? "PM"} ·{" "}
          {new Date(t.resolved_at || t.created_at).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
      </Link>
    </li>
  );
}

export default function OwnerTicketsPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [openTickets, setOpenTickets] = useState<TicketRow[]>([]);
  const [resolvedTickets, setResolvedTickets] = useState<TicketRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [expandedRespondId, setExpandedRespondId] = useState<string | null>(
    null
  );
  const [respondDraft, setRespondDraft] = useState<Record<string, string>>(
    {}
  );
  const [respondSubmitId, setRespondSubmitId] = useState<string | null>(null);
  const [respondError, setRespondError] = useState<string | null>(null);

  const hasAnyTickets = openTickets.length + resolvedTickets.length > 0;

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

    const { data: relRows, error: relErr } = await supabase
      .from("owner_pm_relationships")
      .select("id")
      .eq("owner_id", user.id)
      .eq("active", true);

    if (relErr) {
      setLoading(false);
      setError(relErr.message);
      setOpenTickets([]);
      setResolvedTickets([]);
      return;
    }

    const relIds = (relRows ?? [])
      .map((r) => r.id as string)
      .filter(Boolean);

    if (relIds.length === 0) {
      setLoading(false);
      setOpenTickets([]);
      setResolvedTickets([]);
      return;
    }

    const { data, error: qErr } = await supabase
      .from("tickets")
      .select(
        `
        id,
        title,
        description,
        status,
        direction,
        queue,
        request_type,
        acknowledged_at,
        resolution_note,
        created_at,
        resolved_at,
        owner_pm_relationship_id,
        pm_profiles ( company_name )
      `
      )
      .in("owner_pm_relationship_id", relIds)
      .order("created_at", { ascending: false });

    setLoading(false);
    if (qErr) {
      setError(qErr.message);
      setOpenTickets([]);
      setResolvedTickets([]);
      return;
    }

    const rows = (data as TicketRow[]) ?? [];
    const { openTickets: open, resolvedTickets: resolved } =
      splitTickets(rows);
    setOpenTickets(open);
    setResolvedTickets(resolved);
  }, [router, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRespondSubmit = useCallback(
    async (ticketId: string) => {
      const text = (respondDraft[ticketId] ?? "").trim();
      if (!text) {
        setRespondError("Enter a response.");
        return;
      }
      setRespondError(null);
      setRespondSubmitId(ticketId);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setRespondSubmitId(null);
        router.replace("/login");
        return;
      }

      const resolvedAt = new Date().toISOString();
      const { error: upErr } = await supabase
        .from("tickets")
        .update({
          resolution_note: text,
          resolved_at: resolvedAt,
          status: "resolved",
        })
        .eq("id", ticketId)
        .eq("owner_id", user.id)
        .eq("status", "open");

      setRespondSubmitId(null);
      if (upErr) {
        setRespondError(upErr.message);
        return;
      }

      let moved: TicketRow | null = null;
      setOpenTickets((prev) => {
        const ticket = prev.find((t) => t.id === ticketId);
        if (!ticket) {
          void load();
          return prev;
        }
        moved = {
          ...ticket,
          resolution_note: text,
          resolved_at: resolvedAt,
          status: "resolved",
        };
        return prev.filter((t) => t.id !== ticketId);
      });
      if (moved) {
        setResolvedTickets((p) =>
          [...p, moved as TicketRow].sort(sortByResolvedDesc)
        );
      }

      setExpandedRespondId(null);
      setRespondDraft((d) => {
        const next = { ...d };
        delete next[ticketId];
        return next;
      });
    },
    [load, respondDraft, router, supabase]
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            My tickets
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Issues and requests between you and your property manager.
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
      ) : !hasAnyTickets ? (
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
        <>
          <section>
            <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Needs your attention
            </h2>
            {openTickets.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                No tickets need your attention right now.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {openTickets.map((t) => (
                  <OpenTicketRow
                    key={t.id}
                    t={t}
                    expanded={expandedRespondId === t.id}
                    onToggleRespond={() => {
                      setExpandedRespondId((id) =>
                        id === t.id ? null : t.id
                      );
                      setRespondError(null);
                    }}
                    respondDraft={respondDraft[t.id] ?? ""}
                    onRespondDraftChange={(value) =>
                      setRespondDraft((d) => ({ ...d, [t.id]: value }))
                    }
                    respondError={
                      expandedRespondId === t.id ? respondError : null
                    }
                    respondSubmitting={respondSubmitId === t.id}
                    onRespondSubmit={() => handleRespondSubmit(t.id)}
                  />
                ))}
              </ul>
            )}
          </section>

          <section>
            <button
              type="button"
              onClick={() => setHistoryExpanded((e) => !e)}
              className="text-sm font-bold uppercase tracking-wide text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
              aria-expanded={historyExpanded}
            >
              History ({resolvedTickets.length})
            </button>
            {historyExpanded ? (
              resolvedTickets.length === 0 ? (
                <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                  No resolved tickets yet.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                  {resolvedTickets.map((t) => (
                    <ResolvedTicketRow key={t.id} t={t} />
                  ))}
                </ul>
              )
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
