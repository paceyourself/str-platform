"use client";

import { createClient } from "@/lib/supabase";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

type ReviewListRow = {
  id: string;
  overall_rating: number | string;
  status: string;
  created_at: string;
  relationship_period_start: string | null;
  pm_profiles:
    | { company_name: string | null }
    | { company_name: string | null }[]
    | null;
};

function pmName(row: ReviewListRow): string {
  const pm = row.pm_profiles;
  if (pm == null) return "—";
  const p = Array.isArray(pm) ? pm[0] : pm;
  return p?.company_name?.trim() || "—";
}

function Stars({ rating }: { rating: number }) {
  const r = Math.min(5, Math.max(1, Math.round(Number(rating) || 0)));
  return (
    <span className="text-amber-500" aria-label={`${r} of 5 stars`}>
      {"★".repeat(r)}
      <span className="text-zinc-300 dark:text-zinc-600">{"★".repeat(5 - r)}</span>
    </span>
  );
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "pending":
      return "bg-amber-100 text-amber-950 dark:bg-amber-950/50 dark:text-amber-100";
    case "visible":
      return "bg-emerald-100 text-emerald-950 dark:bg-emerald-950/50 dark:text-emerald-100";
    case "disputed":
      return "bg-orange-100 text-orange-950 dark:bg-orange-950/50 dark:text-orange-100";
    case "removed":
      return "bg-red-100 text-red-950 dark:bg-red-950/50 dark:text-red-100";
    case "hidden":
      return "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200";
    default:
      return "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200";
  }
}

function formatSubmittedAt(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Postgres `date` as YYYY-MM-DD: parse as local calendar day (avoids UTC off-by-one). */
function formatRelationshipPeriodStart(value: string | null | undefined) {
  if (value == null || String(value).trim() === "") return null;
  const s = String(value).trim();
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]);
    const day = Number(ymd[3]);
    const d = new Date(y, m - 1, day);
    if (
      d.getFullYear() !== y ||
      d.getMonth() !== m - 1 ||
      d.getDate() !== day
    ) {
      return s;
    }
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function OwnerReviewsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const submitted = searchParams.get("submitted") === "1";
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<ReviewListRow[]>([]);
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
      .from("reviews")
      .select(
        `
        id,
        overall_rating,
        status,
        created_at,
        relationship_period_start,
        pm_profiles ( company_name )
      `
      )
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });

    setLoading(false);
    if (qErr) {
      setError(qErr.message);
      setReviews([]);
      return;
    }
    setReviews((data as ReviewListRow[]) ?? []);
  }, [router, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            <Link href="/dashboard" className="hover:underline">
              Dashboard
            </Link>
            <span className="mx-2">/</span>
            Reviews
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Your reviews
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Reviews you have submitted about your property managers.
          </p>
        </div>
        <Link
          href="/dashboard/reviews/new"
          className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Write a review
        </Link>
      </div>

      {submitted ? (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100"
        >
          Your review has been submitted and is pending approval.
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
        <p className="text-sm text-zinc-500">Loading reviews…</p>
      ) : reviews.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            You have not submitted any reviews yet.
          </p>
          <Link
            href="/dashboard/reviews/new"
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Write a review
          </Link>
        </div>
      ) : (
        <ul className="space-y-4">
          {reviews.map((r) => {
            const sinceLabel = formatRelationshipPeriodStart(
              r.relationship_period_start
            );
            return (
              <li
                key={r.id}
                className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    {pmName(r)}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(r.status)}`}
                  >
                    {r.status}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                  <Stars rating={Number(r.overall_rating)} />
                  <span className="text-zinc-500 dark:text-zinc-400">
                    Submitted {formatSubmittedAt(r.created_at)}
                  </span>
                </div>
                {sinceLabel ? (
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                    With this PM since:{" "}
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                      {sinceLabel}
                    </span>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function OwnerReviewsPage() {
  return (
    <Suspense
      fallback={
        <p className="text-sm text-zinc-500">Loading reviews…</p>
      }
    >
      <OwnerReviewsContent />
    </Suspense>
  );
}
