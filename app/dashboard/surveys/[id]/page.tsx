"use client";

import { createClient } from "@/lib/supabase";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  SURVEY_DIMENSIONS,
  emptyDimensionScores,
  type DimensionScores,
  type SurveyDimensionKey,
} from "../survey-dimensions";

type SurveyRow = {
  id: string;
  owner_id: string;
  trigger_type: string;
  trigger_reference_id: string;
  submitted_at: string | null;
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
  if (pm == null) return "your PM";
  const p = Array.isArray(pm) ? pm[0] : pm;
  return p?.company_name?.trim() || "your PM";
}

function propName(row: SurveyRow): string {
  const pr = row.properties;
  if (pr == null) return "your property";
  const p = Array.isArray(pr) ? pr[0] : pr;
  return p?.property_name?.trim() || "your property";
}

function formatCheckoutLine(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = String(iso).trim();
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (ymd) {
    const d = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    }
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }
  return s;
}

function DimensionStars({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
        {label} <span className="text-red-600">*</span>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              value === n
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {n}
          </button>
        ))}
        <span className="text-xs text-zinc-500">
          {value > 0 ? `${value}/5` : "Select"}
        </span>
      </div>
    </div>
  );
}

export default function SurveyCompletePage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [survey, setSurvey] = useState<SurveyRow | null>(null);
  const [contextLine, setContextLine] = useState<string>("");
  const [scores, setScores] = useState<Record<SurveyDimensionKey, number>>(
    () => emptyDimensionScores()
  );
  const [comments, setComments] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false);
      setError("Invalid survey.");
      return;
    }
    setLoading(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.replace("/login");
      return;
    }

    const { data: row, error: qErr } = await supabase
      .from("survey_responses")
      .select(
        `
        id,
        owner_id,
        trigger_type,
        trigger_reference_id,
        submitted_at,
        pm_profiles ( company_name ),
        properties ( property_name )
      `
      )
      .eq("id", id)
      .maybeSingle();

    setLoading(false);
    if (qErr) {
      setError(qErr.message);
      return;
    }
    if (!row) {
      setError("Survey not found.");
      return;
    }
    const s = row as SurveyRow;
    if (s.owner_id !== user.id) {
      setError("You do not have access to this survey.");
      return;
    }
    if (s.submitted_at) {
      setSurvey(s);
      return;
    }

    setSurvey(s);

    let line = "";
    if (s.trigger_type === "post_owner_stay") {
      const { data: booking } = await supabase
        .from("bookings")
        .select("check_out, check_in")
        .eq("id", s.trigger_reference_id)
        .maybeSingle();
      const b = booking as { check_out: string | null; check_in: string | null } | null;
      const co = formatCheckoutLine(b?.check_out ?? null);
      line = `Post-stay survey for your stay at ${propName(s)}${
        co ? `, checked out ${co}` : ""
      }.`;
    } else if (s.trigger_type === "post_statement") {
      const { data: stmt } = await supabase
        .from("pm_statements")
        .select("statement_period_start, statement_period_end")
        .eq("id", s.trigger_reference_id)
        .maybeSingle();
      const st = stmt as {
        statement_period_start: string | null;
        statement_period_end: string | null;
      } | null;
      const ps = st?.statement_period_start
        ? formatCheckoutLine(st.statement_period_start)
        : "";
      const pe = st?.statement_period_end
        ? formatCheckoutLine(st.statement_period_end)
        : "";
      line = `Survey after your PM statement for ${propName(s)}${
        ps && pe ? ` (${ps} – ${pe})` : ""
      }.`;
    } else {
      line = `Survey regarding ${pmName(s)} and ${propName(s)}.`;
    }
    setContextLine(line);
  }, [id, router, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!survey) return;

    for (const { key } of SURVEY_DIMENSIONS) {
      const v = scores[key];
      if (!Number.isFinite(v) || v < 1 || v > 5) {
        setError(`Please rate all dimensions (1–5). Missing: ${key}.`);
        return;
      }
    }

    const dimension_scores: DimensionScores = {
      financial_accuracy: scores.financial_accuracy,
      payment_timeliness: scores.payment_timeliness,
      pricing_management: scores.pricing_management,
      maintenance_responsiveness: scores.maintenance_responsiveness,
      communication: scores.communication,
      guest_screening: scores.guest_screening,
      listing_management: scores.listing_management,
    };

    setSubmitting(true);
    const { error: uErr } = await supabase
      .from("survey_responses")
      .update({
        dimension_scores,
        comments: comments.trim() || null,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", survey.id)
      .eq("owner_id", survey.owner_id)
      .is("submitted_at", null);

    setSubmitting(false);
    if (uErr) {
      setError(uErr.message);
      return;
    }

    router.push("/dashboard/surveys?completed=1");
    router.refresh();
  }

  function setDim(key: SurveyDimensionKey, n: number) {
    setScores((prev) => ({ ...prev, [key]: n }));
  }

  if (!id) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400">Invalid survey.</p>
    );
  }

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading survey…</p>;
  }

  if (error && !survey) {
    return (
      <div className="space-y-4">
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
        >
          {error}
        </div>
        <Link
          href="/dashboard/surveys"
          className="text-sm font-medium text-zinc-700 underline dark:text-zinc-300"
        >
          Back to surveys
        </Link>
      </div>
    );
  }

  if (survey?.submitted_at) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          This survey has already been submitted.
        </p>
        <Link
          href="/dashboard/surveys"
          className="inline-flex rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 dark:border-zinc-600 dark:text-zinc-200"
        >
          Back to surveys
        </Link>
      </div>
    );
  }

  if (!survey) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          <Link href="/dashboard" className="hover:underline">
            Dashboard
          </Link>
          <span className="mx-2">/</span>
          <Link href="/dashboard/surveys" className="hover:underline">
            Surveys
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Complete survey
        </h1>
        <p className="mt-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {pmName(survey)}
        </p>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {contextLine}
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
      >
        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          >
            {error}
          </div>
        ) : null}

        <div className="space-y-6">
          {SURVEY_DIMENSIONS.map(({ key, label }) => (
            <DimensionStars
              key={key}
              label={label}
              value={scores[key]}
              onChange={(n) => setDim(key, n)}
            />
          ))}
        </div>

        <div>
          <label
            htmlFor="survey-comments"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Additional comments (optional)
          </label>
          <textarea
            id="survey-comments"
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            rows={4}
            className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {submitting ? "Submitting…" : "Submit survey"}
          </button>
          <Link
            href="/dashboard/surveys"
            className="inline-flex items-center justify-center rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-800 dark:border-zinc-600 dark:text-zinc-200"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
