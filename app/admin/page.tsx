"use client";

import { createClient } from "@/lib/supabase";
import React, { useEffect, useState } from "react";

type Review = {
  id: string;
  overall_rating: number;
  review_text: string;
  status: string;
  ai_flag_reason: string | null;
  ai_flag_score: number | null;
  moderation_note: string | null;
  relationship_period_start: string | null;
  relationship_period_end: string | null;
  created_at: string;
  owner: { display_name: string } | null;
  pm: { company_name: string } | null;
  ticket_tags: { ticket: { queue: string; created_at: string } }[];
};

type Tab = "pending" | "disputed";

export default function AdminPage() {
  const supabase = createClient();
  const [tab, setTab] = useState<Tab>("pending");
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<Record<string, string>>({});
  const [acting, setActing] = useState<string | null>(null);

  async function loadReviews(status: Tab) {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("reviews")
      .select(`
        id,
        overall_rating,
        review_text,
        status,
        ai_flag_reason,
        ai_flag_score,
        moderation_note,
        relationship_period_start,
        relationship_period_end,
        created_at,
        owner:owner_profiles!reviews_owner_id_fkey(display_name),
        pm:pm_profiles!reviews_pm_id_fkey(company_name),
        ticket_tags:review_ticket_tags(
          ticket:tickets(queue, created_at)
        )
      `)
      .eq("status", status)
      .order("created_at", { ascending: true });

    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    setReviews((data as unknown as Review[]) ?? []);
  }

  useEffect(() => {
    loadReviews(tab);
  }, [tab]);

  async function approve(reviewId: string) {
    setActing(reviewId);
    const { data: { user } } = await supabase.auth.getUser();
    const { error: err } = await supabase
      .from("reviews")
      .update({
        status: "visible",
        published_at: new Date().toISOString(),
        moderated_by: user?.id,
        moderated_at: new Date().toISOString(),
      })
      .eq("id", reviewId);
    setActing(null);
    if (err) { setError(err.message); return; }
    setReviews((prev) => prev.filter((r) => r.id !== reviewId));
  }

  async function remove(reviewId: string) {
    const note = actionNote[reviewId]?.trim();
    if (!note) {
      setError("A moderation note is required to remove a review.");
      return;
    }
    setActing(reviewId);
    const { data: { user } } = await supabase.auth.getUser();
    const { error: err } = await supabase
      .from("reviews")
      .update({
        status: "removed",
        moderation_note: note,
        moderated_by: user?.id,
        moderated_at: new Date().toISOString(),
      })
      .eq("id", reviewId);
    setActing(null);
    if (err) { setError(err.message); return; }
    setReviews((prev) => prev.filter((r) => r.id !== reviewId));
  }

  async function flag(reviewId: string) {
    const note = actionNote[reviewId]?.trim();
    if (!note) {
      setError("Add a note before flagging for follow-up.");
      return;
    }
    setActing(reviewId);
    const { error: err } = await supabase
      .from("reviews")
      .update({ moderation_note: note })
      .eq("id", reviewId);
    setActing(null);
    if (err) { setError(err.message); return; }
    setActionNote((prev) => ({ ...prev, [reviewId]: "" }));
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "pending", label: "Pending" },
    { key: "disputed", label: "Disputed" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Review moderation
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Approve, remove, or flag owner reviews before they go public.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-700">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Review list */}
      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : reviews.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No {tab} reviews — queue is clear.
        </p>
      ) : (
        <div className="space-y-4">
          {reviews.map((r) => (
            <div
              key={r.id}
              className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {r.owner?.display_name ?? "Unknown owner"} →{" "}
                    {r.pm?.company_name ?? "Unknown PM"}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Submitted {new Date(r.created_at).toLocaleDateString()}
                    {r.relationship_period_start && r.relationship_period_end
                      ? ` · Relationship ${r.relationship_period_start} – ${r.relationship_period_end}`
                      : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <span
                      key={s}
                      className={
                        s <= r.overall_rating
                          ? "text-amber-400"
                          : "text-zinc-300 dark:text-zinc-600"
                      }
                    >
                      ★
                    </span>
                  ))}
                </div>
              </div>

              {/* Review text */}
              <p className="mt-3 text-sm text-zinc-800 dark:text-zinc-200">
                {r.review_text}
              </p>

              {/* AI flag */}
              {r.ai_flag_reason && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
                  <span className="font-medium">AI flag:</span>{" "}
                  {r.ai_flag_reason}
                  {r.ai_flag_score != null
                    ? ` (confidence: ${(r.ai_flag_score * 100).toFixed(0)}%)`
                    : ""}
                </div>
              )}

              {/* Ticket tags */}
              {r.ticket_tags?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.ticket_tags.map((tt, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                    >
                      {tt.ticket?.queue} ·{" "}
                      {tt.ticket?.created_at
                        ? new Date(tt.ticket.created_at).toLocaleDateString(
                            "en-US",
                            { month: "short", year: "numeric" }
                          )
                        : ""}
                    </span>
                  ))}
                </div>
              )}

              {/* Existing moderation note */}
              {r.moderation_note && (
                <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                  Note: {r.moderation_note}
                </p>
              )}

              {/* Note input */}
              <textarea
                rows={2}
                placeholder="Moderation note (required for Remove; optional for Flag)"
                value={actionNote[r.id] ?? ""}
                onChange={(e) =>
                  setActionNote((prev) => ({
                    ...prev,
                    [r.id]: e.target.value,
                  }))
                }
                className="mt-4 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />

              {/* Actions */}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  disabled={acting === r.id}
                  onClick={() => approve(r.id)}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {acting === r.id ? "Working…" : "Approve"}
                </button>
                <button
                  disabled={acting === r.id}
                  onClick={() => remove(r.id)}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Remove
                </button>
                <button
                  disabled={acting === r.id}
                  onClick={() => flag(r.id)}
                  className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  Flag for follow-up
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}