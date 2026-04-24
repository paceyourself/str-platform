"use client";

import PmSelector, { type PmSelection } from "@/components/PmSelector";
import { createClient } from "@/lib/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const MIN_REVIEW_LENGTH = 50;

type TicketOption = {
  id: string;
  title: string;
  status: string;
  created_at: string;
};

function StarRatingInput({
  value,
  onChange,
  id,
}: {
  value: number;
  onChange: (n: number) => void;
  id: string;
}) {
  return (
    <div className="flex items-center gap-1" id={id} role="group" aria-label="Overall rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`rounded p-1 text-2xl leading-none transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-900/20 dark:focus:ring-zinc-100/20 ${
            n <= value ? "text-amber-500" : "text-zinc-200 dark:text-zinc-600"
          }`}
          aria-pressed={n <= value}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
        >
          ★
        </button>
      ))}
      <span className="ml-2 text-sm text-zinc-500 dark:text-zinc-400">
        {value > 0 ? `${value} / 5` : "Required"}
      </span>
    </div>
  );
}

function relationshipStartFromRel(startDate: string | null | undefined): string | null {
  if (startDate == null || String(startDate).trim() === "") return null;
  const s = String(startDate).trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : null;
}

export default function NewOwnerReviewPage() {
  const router = useRouter();
  const supabase = createClient();

  const [selection, setSelection] = useState<PmSelection | null>(null);
  const [tickets, setTickets] = useState<TicketOption[]>([]);
  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<string>>(new Set());
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!selection) {
      setTickets([]);
      setSelectedTicketIds(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingTickets(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const ticRes = await supabase
        .from("tickets")
        .select("id, title, status, created_at")
        .eq("owner_id", user.id)
        .eq("owner_pm_relationship_id", selection.rel_id)
        .eq("direction", "owner_to_pm")
        .in("status", ["open", "resolved"])
        .order("created_at", { ascending: false });

      if (!cancelled) {
        setLoadingTickets(false);
        setTickets((ticRes.data as TicketOption[]) ?? []);
      }
    })();
    return () => { cancelled = true; };
  }, [selection, supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!selection) {
      setError("Select a property manager before submitting a review.");
      return;
    }
    if (rating < 1 || rating > 5) {
      setError("Please choose an overall rating from 1 to 5 stars.");
      return;
    }
    const text = reviewText.trim();
    if (text.length < MIN_REVIEW_LENGTH) {
      setError(`Review text must be at least ${MIN_REVIEW_LENGTH} characters.`);
      return;
    }

    setSubmitting(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSubmitting(false);
      router.replace("/login");
      return;
    }

    const payload: Record<string, unknown> = {
      pm_id: selection.pm_id,
      owner_id: user.id,
      owner_pm_relationship_id: selection.rel_id,
      overall_rating: rating,
      review_text: text,
      status: "pending",
      relationship_period_start: relationshipStartFromRel(selection.start_date),
    };

    if (periodEnd.trim()) payload.relationship_period_end = periodEnd.trim();

    const { data: reviewRow, error: insErr } = await supabase
      .from("reviews")
      .insert(payload)
      .select("id")
      .single();

    if (insErr) {
      setSubmitting(false);
      setError(insErr.message);
      return;
    }

    const reviewId = reviewRow?.id as string | undefined;
    const tagIds = [...selectedTicketIds];
    if (reviewId && tagIds.length > 0) {
      const tagRows = tagIds.map((ticket_id) => ({ review_id: reviewId, ticket_id }));
      const { error: tagErr } = await supabase.from("review_ticket_tags").insert(tagRows);
      if (tagErr) {
        setSubmitting(false);
        setError(`Your review was submitted, but linking tickets failed: ${tagErr.message}`);
        return;
      }
    }

    setSubmitting(false);
    router.push("/dashboard/reviews?submitted=1");
  }

  function toggleTicket(id: string) {
    setSelectedTicketIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          <Link href="/dashboard" className="hover:underline">Dashboard</Link>
          <span className="mx-2">/</span>
          <Link href="/dashboard/reviews" className="hover:underline">Reviews</Link>
          <span className="mx-2">/</span>
          New
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Write a review
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Share feedback about your property manager. Reviews are moderated before they appear publicly.
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

        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Property manager
          </label>
          <PmSelector onSelect={setSelection} />
        </div>

        <div>
          <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Overall rating <span className="text-red-600">*</span>
          </span>
          <div className="mt-2">
            <StarRatingInput id="review-rating" value={rating} onChange={setRating} />
          </div>
        </div>

        <div>
          <label
            htmlFor="review-text"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Review <span className="text-red-600">*</span>
          </label>
          <textarea
            id="review-text"
            value={reviewText}
            onChange={(e) => setReviewText(e.target.value)}
            rows={6}
            required
            minLength={MIN_REVIEW_LENGTH}
            placeholder={`At least ${MIN_REVIEW_LENGTH} characters…`}
            className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400"
          />
          <p className="mt-1 text-xs text-zinc-500">
            {reviewText.trim().length}/{MIN_REVIEW_LENGTH} characters minimum
          </p>
        </div>

        <div>
          <label
            htmlFor="period-end"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Date you stopped working with this PM (if applicable)
          </label>
          <input
            id="period-end"
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            className="mt-1 block w-full max-w-md rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400"
          />
          <p className="mt-1 text-xs text-zinc-500">Optional</p>
        </div>

        <div>
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Tag tickets (optional)
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Link tickets you filed to this PM as context for your review.
          </p>
          {!selection ? (
            <p className="mt-3 text-sm text-zinc-500">Select a property manager to see tickets.</p>
          ) : loadingTickets ? (
            <p className="mt-3 text-sm text-zinc-500">Loading tickets…</p>
          ) : tickets.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">No open or resolved tickets for this PM.</p>
          ) : (
            <ul className="mt-3 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-700 dark:bg-zinc-900/30">
              {tickets.map((t) => (
                <li key={t.id} className="flex gap-3 text-sm">
                  <input
                    type="checkbox"
                    id={`ticket-${t.id}`}
                    checked={selectedTicketIds.has(t.id)}
                    onChange={() => toggleTicket(t.id)}
                    className="mt-1 h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-600"
                  />
                  <label htmlFor={`ticket-${t.id}`} className="flex-1 cursor-pointer">
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">{t.title}</span>
                    <span className="ml-2 text-xs capitalize text-zinc-500">{t.status}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={submitting || !selection}
            className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {submitting ? "Submitting…" : "Submit review"}
          </button>
          <Link
            href="/dashboard/reviews"
            className="inline-flex items-center justify-center rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}