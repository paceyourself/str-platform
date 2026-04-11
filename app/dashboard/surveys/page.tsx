"use client";

import { createClient } from "@/lib/supabase";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { averageDimensionScore } from "./survey-dimensions";

type SurveyRow = {
  id: string;
  trigger_type: string;
  sent_at: string;
  submitted_at: string | null;
  dimension_scores: Record<string, unknown> | null;
  pm_profiles:
    | { company_name: string | null }
    | { company_name: string | null }[]
    | null;
  properties:
    | { property_name: string | null }
    | { property_name: string | null }[]
    | null;
};

function pmName(row: SurveyRow): string {
  const pm = row.pm_profiles;
  if (pm == null) return "—";
  const p = Array.isArray(pm) ? pm[0] : pm;
  return p?.company_name?.trim() || "—";
}

function propName(row: SurveyRow): string {
  const pr = row.properties;
  if (pr == null) return "—";
  const p = Array.isArray(pr) ? pr[0] : pr;
  return p?.property_name?.trim() || "—";
}

function triggerLabel(type: string): string {
  switch (type) {
    case "post_owner_stay":
      return "Post–owner stay";
    case "post_statement":
      return "Post–statement";
    default:
      return type;
  }
}

function formatTriggeredAt(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatSubmittedSummary(
  scores: Record<string, unknown> | null | undefined
) {
  const avg = averageDimensionScore(scores);
  if (avg == null) return "—";
  return `Avg. score ${avg.toFixed(1)} / 5`;
}

function SurveysListContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const completed = searchParams.get("completed") === "1";
  const statement = searchParams.get("statement") === "1";
  const statementTriggeredRaw = searchParams.get("triggered");
  const statementTriggered =
    statementTriggeredRaw != null && statementTriggeredRaw !== ""
      ? Number.parseInt(statementTriggeredRaw, 10)
      : null;
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SurveyRow[]>([]);
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
      .from("survey_responses")
      .select(
        `
        id,
        trigger_type,
        sent_at,
        submitted_at,
        dimension_scores,
        pm_profiles ( company_name ),
        properties ( property_name )
      `
      )
      .eq("owner_id", user.id)
      .order("sent_at", { ascending: false });

    setLoading(false);
    if (qErr) {
      setError(qErr.message);
      setRows([]);
      return;
    }
    setRows((data as SurveyRow[]) ?? []);
  }, [router, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const pending = rows.filter((r) => r.submitted_at == null);
  const completedRows = rows.filter((r) => r.submitted_at != null);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          <Link href="/dashboard" className="hover:underline">
            Dashboard
          </Link>
          <span className="mx-2">/</span>
          Surveys
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Surveys
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Rate your property manager across key dimensions.
        </p>
      </div>

      {completed ? (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100"
        >
          Thank you — your survey has been submitted.
        </div>
      ) : null}
      {statement ? (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100"
        >
          {statementTriggered != null &&
          Number.isFinite(statementTriggered) &&
          statementTriggered > 0 ? (
            <>
              Statement upload complete —{" "}
              <strong>
                {statementTriggered} new survey
                {statementTriggered === 1 ? "" : "s"}
              </strong>{" "}
              {statementTriggered === 1 ? "was" : "were"} added for you to
              complete.
            </>
          ) : (
            <>
              Statement upload complete. No new survey was added (you may
              already have one linked to this statement period).
            </>
          )}
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-zinc-500">Loading surveys…</p>
      ) : (
        <>
          {pending.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
                Pending ({pending.length})
              </h2>
              <ul className="space-y-3">
                {pending.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-xl border-2 border-amber-300 bg-amber-50/80 p-4 dark:border-amber-800 dark:bg-amber-950/30"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1 text-sm">
                        <p className="font-medium text-zinc-900 dark:text-zinc-50">
                          {triggerLabel(r.trigger_type)}
                        </p>
                        <p className="text-zinc-700 dark:text-zinc-300">
                          <span className="text-zinc-500 dark:text-zinc-400">
                            PM:{" "}
                          </span>
                          {pmName(r)}
                        </p>
                        <p className="text-zinc-700 dark:text-zinc-300">
                          <span className="text-zinc-500 dark:text-zinc-400">
                            Property:{" "}
                          </span>
                          {propName(r)}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          Triggered {formatTriggeredAt(r.sent_at)}
                        </p>
                      </div>
                      <Link
                        href={`/dashboard/surveys/${r.id}`}
                        className="inline-flex shrink-0 items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                      >
                        Complete survey
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              No pending surveys.
            </p>
          )}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Completed
            </h2>
            {completedRows.length === 0 ? (
              <p className="text-sm text-zinc-500">No completed surveys yet.</p>
            ) : (
              <ul className="space-y-3">
                {completedRows.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium text-zinc-900 dark:text-zinc-50">
                        {pmName(r)}
                      </span>
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        {triggerLabel(r.trigger_type)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                      Submitted {formatTriggeredAt(r.submitted_at!)} ·{" "}
                      {formatSubmittedSummary(r.dimension_scores)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default function SurveysPage() {
  return (
    <Suspense
      fallback={<p className="text-sm text-zinc-500">Loading surveys…</p>}
    >
      <SurveysListContent />
    </Suspense>
  );
}
