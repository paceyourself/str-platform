"use client";

import { createClient } from "@/lib/supabase";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type PmEmbed = { company_name: string | null };

type TicketRow = {
  id: string;
  title: string;
  description: string;
  direction: string;
  status: string;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  pm_profiles: PmEmbed | PmEmbed[] | null;
};

function pmCompanyName(nested: TicketRow["pm_profiles"]): string {
  if (nested == null) return "PM";
  const p = Array.isArray(nested) ? nested[0] : nested;
  return p?.company_name?.trim() || "PM";
}

function formatTimestamp(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

type ThreadStep = {
  key: string;
  label: string;
  content?: string;
  timestamp: string | null;
};

const MAX_THREAD_STEPS = 4;

export default function OwnerTicketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();
  const id = typeof params.id === "string" ? params.id : "";

  const [ticket, setTicket] = useState<TicketRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [responseText, setResponseText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadTicket = useCallback(async () => {
    if (!id) return;
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
        title,
        description,
        direction,
        status,
        created_at,
        acknowledged_at,
        resolved_at,
        resolution_note,
        pm_profiles ( company_name )
      `
      )
      .eq("id", id)
      .eq("owner_id", user.id)
      .maybeSingle();

    setLoading(false);
    if (qErr) {
      setError(qErr.message);
      setTicket(null);
      return;
    }
    if (!data) {
      setError("Ticket not found.");
      setTicket(null);
      return;
    }
    setTicket(data as TicketRow);
  }, [id, router, supabase]);

  useEffect(() => {
    void loadTicket();
  }, [loadTicket]);

  const threadSteps = useMemo((): ThreadStep[] => {
    if (!ticket) return [];
    const pmName = pmCompanyName(ticket.pm_profiles);
    const steps: ThreadStep[] = [];

    steps.push({
      key: "submission",
      label:
        ticket.direction === "owner_to_pm"
          ? "Filed by you"
          : `Request from ${pmName}`,
      content: ticket.description,
      timestamp: formatTimestamp(ticket.created_at),
    });

    if (ticket.acknowledged_at) {
      steps.push({
        key: "ack",
        label: "Acknowledged by PM",
        timestamp: formatTimestamp(ticket.acknowledged_at),
      });
    }

    const note = ticket.resolution_note?.trim();
    if (note) {
      steps.push({
        key: "resolution",
        label:
          ticket.direction === "owner_to_pm"
            ? "PM response"
            : "Your response",
        content: note,
        timestamp: ticket.resolved_at
          ? formatTimestamp(ticket.resolved_at)
          : null,
      });
    }

    return steps.slice(0, MAX_THREAD_STEPS);
  }, [ticket]);

  const showRespondForm =
    ticket?.direction === "pm_to_owner" && ticket.status === "open";

  async function handleRespond(e: React.FormEvent) {
    e.preventDefault();
    if (!ticket) return;
    const trimmed = responseText.trim();
    if (!trimmed) {
      setSubmitError("Enter a response.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSubmitting(false);
      router.replace("/login");
      return;
    }
    const { error: upErr } = await supabase
      .from("tickets")
      .update({
        resolution_note: trimmed,
        resolved_at: new Date().toISOString(),
        status: "resolved",
      })
      .eq("id", ticket.id)
      .eq("owner_id", user.id)
      .eq("status", "open");

    setSubmitting(false);
    if (upErr) {
      setSubmitError(upErr.message);
      return;
    }
    setResponseText("");
    await loadTicket();
  }

  if (!id) {
    return (
      <div className="mx-auto max-w-lg">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Invalid ticket.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <Link
        href="/dashboard/tickets"
        className="text-sm font-medium text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
      >
        ← Back to tickets
      </Link>

      {loading ? (
        <p className="text-sm text-zinc-500">Loading ticket…</p>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : ticket ? (
        <>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {ticket.title}
            </h1>
            <p className="mt-1 text-sm capitalize text-zinc-500 dark:text-zinc-400">
              Status: {ticket.status.replace(/_/g, " ")}
            </p>
          </div>

          <section aria-labelledby="ticket-thread-heading">
            <h2
              id="ticket-thread-heading"
              className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
            >
              Thread
            </h2>
            <ol className="mt-4 space-y-4 border-l-2 border-zinc-200 pl-5 dark:border-zinc-700">
              {threadSteps.map((step) => (
                <li key={step.key} className="relative">
                  <span
                    className="absolute -left-[1.4rem] top-1.5 h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-600"
                    aria-hidden
                  />
                  <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                      {step.label}
                    </p>
                    {step.content ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400">
                        {step.content}
                      </p>
                    ) : null}
                    {step.timestamp ? (
                      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
                        {step.timestamp}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {showRespondForm ? (
            <section
              className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
              aria-labelledby="respond-heading"
            >
              <h2
                id="respond-heading"
                className="text-sm font-semibold text-zinc-900 dark:text-zinc-50"
              >
                Respond
              </h2>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Your message will be saved on this ticket and marked resolved.
              </p>
              <form onSubmit={handleRespond} className="mt-4 space-y-3">
                {submitError ? (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {submitError}
                  </p>
                ) : null}
                <textarea
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  rows={4}
                  className="block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
                  placeholder="Type your response…"
                  disabled={submitting}
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {submitting ? "Sending…" : "Submit response"}
                </button>
              </form>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
