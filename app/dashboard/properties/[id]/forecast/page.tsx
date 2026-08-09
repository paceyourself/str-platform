"use client";

import {
  computePmForecastCommitmentMetricsFromBookings,
  formatPmForecastCommitmentDbError,
  type CommitmentBookingRow,
  type PmForecastCommitmentMetrics,
} from "@/lib/pm-forecast-commitments";
import { createClient } from "@/lib/supabase";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";

type CommitmentRow = {
  id: string;
  property_id: string;
  date_committed: string;
  target_date: string;
  committed_incremental_amount: number | string;
  notes: string | null;
  created_at: string;
};

type CommitmentWithMetrics = CommitmentRow & PmForecastCommitmentMetrics;

function ymd(raw: string | null | undefined): string {
  if (!raw) return "";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(raw).trim());
  return m ? m[1] : String(raw);
}

function formatMoney(n: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

function formatMissPct(missPct: number | null) {
  if (missPct == null) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  }).format(missPct);
}

function formatDateLabel(iso: string) {
  const d = ymd(iso);
  if (!d) return "—";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day, 12).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const emptyForm = {
  date_committed: "",
  target_date: "",
  committed_incremental_amount: "",
  notes: "",
};

export default function PropertyForecastPage() {
  const router = useRouter();
  const params = useParams();
  const propertyId = typeof params.id === "string" ? params.id : "";
  const supabase = createClient();

  const [propertyLabel, setPropertyLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [commitments, setCommitments] = useState<CommitmentWithMetrics[]>([]);

  const loadCommitments = useCallback(async () => {
    if (!propertyId) return;
    setListLoading(true);
    setError(null);

    const [{ data: rows, error: cErr }, { data: bookings, error: bErr }] =
      await Promise.all([
        supabase
          .from("pm_forecast_commitments")
          .select(
            "id, property_id, date_committed, target_date, committed_incremental_amount, notes, created_at",
          )
          .eq("property_id", propertyId)
          .order("date_committed", { ascending: false })
          .order("created_at", { ascending: false }),
        supabase
          .from("bookings")
          .select("booked_date, check_out, cancelled_at, gross_revenue")
          .eq("property_id", propertyId)
          .not("booked_date", "is", null),
      ]);

    setListLoading(false);

    if (cErr) {
      setError(cErr.message);
      setCommitments([]);
      return;
    }
    if (bErr) {
      setError(bErr.message);
      setCommitments([]);
      return;
    }

    const bookingRows = (bookings ?? []) as CommitmentBookingRow[];
    const withMetrics: CommitmentWithMetrics[] = (rows ?? []).map((row) => {
      const commitment = row as CommitmentRow;
      const metrics = computePmForecastCommitmentMetricsFromBookings(
        bookingRows,
        {
          property_id: commitment.property_id,
          date_committed: ymd(commitment.date_committed),
          target_date: ymd(commitment.target_date),
          committed_incremental_amount:
            commitment.committed_incremental_amount,
        },
      );
      return { ...commitment, ...metrics };
    });

    setCommitments(withMetrics);
  }, [propertyId, supabase]);

  useEffect(() => {
    if (!propertyId) {
      setLoading(false);
      setError("Missing property id.");
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }

      const { data: prop, error: pErr } = await supabase
        .from("properties")
        .select("id, owner_id, property_name, address_line1, deleted_at")
        .eq("id", propertyId)
        .maybeSingle();

      if (cancelled) return;

      if (pErr || !prop) {
        setLoading(false);
        setError(pErr?.message ?? "Property not found.");
        return;
      }
      if (prop.owner_id !== user.id) {
        setLoading(false);
        setError("You do not have access to this property.");
        return;
      }
      if (prop.deleted_at) {
        setLoading(false);
        setError("This property has been removed.");
        return;
      }

      const label =
        prop.property_name?.trim() ||
        prop.address_line1?.trim() ||
        "Property";
      setPropertyLabel(label);
      setLoading(false);
      await loadCommitments();
    })();
    return () => {
      cancelled = true;
    };
  }, [propertyId, router, supabase, loadCommitments]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setFormError(null);

      const dateCommitted = form.date_committed.trim();
      const targetDate = form.target_date.trim();
      const amountRaw = form.committed_incremental_amount.trim();
      const notes = form.notes.trim();

      if (!dateCommitted || !targetDate || !amountRaw) {
        setFormError("Commitment date, target date, and amount are required.");
        return;
      }

      const amount = Number(amountRaw);
      if (!Number.isFinite(amount)) {
        setFormError("Enter a valid committed incremental amount.");
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

      const { error: insertErr } = await supabase
        .from("pm_forecast_commitments")
        .insert({
          property_id: propertyId,
          date_committed: dateCommitted,
          target_date: targetDate,
          committed_incremental_amount: amount,
          notes: notes || null,
          entered_by: user.id,
        });

      setSubmitting(false);

      if (insertErr) {
        setFormError(formatPmForecastCommitmentDbError(insertErr));
        return;
      }

      setForm(emptyForm);
      await loadCommitments();
    },
    [form, loadCommitments, propertyId, router, supabase],
  );

  if (!propertyId) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400">Invalid property.</p>
    );
  }

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading forecast…</p>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          <Link href="/dashboard" className="hover:underline">
            Dashboard
          </Link>
          <span className="mx-2">/</span>
          <Link href="/dashboard/properties" className="hover:underline">
            Properties
          </Link>
          <span className="mx-2">/</span>
          Forecast
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          PM forecast
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {propertyLabel ? (
            <>
              Track incremental revenue commitments for{" "}
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                {propertyLabel}
              </span>
              .
            </>
          ) : (
            "Track incremental revenue commitments for this property."
          )}
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
        >
          {error}
        </div>
      ) : null}

      {/* Type 2 — point-in-time incremental commitment tracking */}
      <section className="space-y-6" aria-labelledby="type2-heading">
        <div>
          <h2
            id="type2-heading"
            className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
          >
            Incremental commitments
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Log a point-in-time commitment, then compare booked incremental
            revenue against it through the target date.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
        >
          {formError ? (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
            >
              {formError}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="date_committed"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Date committed
              </label>
              <input
                id="date_committed"
                type="date"
                required
                value={form.date_committed}
                onChange={(e) =>
                  setForm((f) => ({ ...f, date_committed: e.target.value }))
                }
                className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
              />
            </div>
            <div>
              <label
                htmlFor="target_date"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Target date
              </label>
              <input
                id="target_date"
                type="date"
                required
                value={form.target_date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, target_date: e.target.value }))
                }
                className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
              />
              <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                Must be in the same calendar year as the commitment date.
              </p>
            </div>
          </div>

          <div>
            <label
              htmlFor="committed_incremental_amount"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Committed incremental amount
            </label>
            <input
              id="committed_incremental_amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              required
              value={form.committed_incremental_amount}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  committed_incremental_amount: e.target.value,
                }))
              }
              className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
            />
          </div>

          <div>
            <label
              htmlFor="notes"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Notes <span className="font-normal text-zinc-500">(optional)</span>
            </label>
            <textarea
              id="notes"
              rows={3}
              value={form.notes}
              onChange={(e) =>
                setForm((f) => ({ ...f, notes: e.target.value }))
              }
              className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
            />
          </div>

          <div className="flex flex-wrap gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {submitting ? "Saving…" : "Log commitment"}
            </button>
            <Link
              href="/dashboard/properties"
              className="inline-flex items-center justify-center rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800/50"
            >
              Back to properties
            </Link>
          </div>
        </form>

        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          {listLoading ? (
            <p className="px-4 py-6 text-sm text-zinc-500">
              Loading commitments…
            </p>
          ) : commitments.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-500">
              No incremental commitments logged yet.
            </p>
          ) : (
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-3">Committed</th>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3 text-right">Committed $</th>
                  <th className="px-4 py-3 text-right">Baseline</th>
                  <th className="px-4 py-3 text-right">Actual incr.</th>
                  <th className="px-4 py-3 text-right">Miss %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {commitments.map((c) => (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-900 dark:text-zinc-50">
                      {formatDateLabel(c.date_committed)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-900 dark:text-zinc-50">
                      {formatDateLabel(c.target_date)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-zinc-900 dark:text-zinc-50">
                      {formatMoney(Number(c.committed_incremental_amount))}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-zinc-900 dark:text-zinc-50">
                      {formatMoney(c.baseline)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-zinc-900 dark:text-zinc-50">
                      {formatMoney(c.actual_incremental)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-zinc-900 dark:text-zinc-50">
                      {formatMissPct(c.miss_pct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Row 224 — Type 1 annual weekly schedule: deferred; mount in this page later. */}
    </div>
  );
}
