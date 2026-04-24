"use client";

import PmSelector, { type PmSelection } from "@/components/PmSelector";
import { createClient } from "@/lib/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const QUEUES = [
  { value: "billing_accuracy", label: "Billing accuracy" },
  { value: "payment_timeliness", label: "Payment timeliness" },
  { value: "pricing_management", label: "Pricing management" },
  { value: "maintenance", label: "Maintenance" },
  { value: "guest_screening", label: "Guest screening" },
  { value: "communication", label: "Communication" },
  { value: "listing_management", label: "Listing management" },
] as const;

type BookingOption = {
  id: string;
  check_in: string | null;
  booked_date: string | null;
  channel: string | null;
  raw_type_label: string | null;
};

function toMmDdYyyy(value: string | null | undefined): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
  return null;
}

function checkInSortValue(checkIn: string | null): number {
  if (checkIn == null) return Number.NEGATIVE_INFINITY;
  const s = String(checkIn).trim();
  if (!s) return Number.NEGATIVE_INFINITY;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const t = Date.parse(s);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

function bookingOptionLabel(b: BookingOption): string {
  const parts: string[] = [];
  const cin = toMmDdYyyy(b.check_in);
  if (cin) parts.push(`Check-in: ${cin}`);
  const channelOrType = (b.channel ?? "").trim() || (b.raw_type_label ?? "").trim();
  if (channelOrType) parts.push(channelOrType);
  const booked = toMmDdYyyy(b.booked_date);
  if (booked) parts.push(`Booked: ${booked}`);
  return parts.length > 0 ? parts.join(" · ") : `Booking ${b.id.slice(0, 8)}…`;
}

export default function NewOwnerTicketPage() {
  const router = useRouter();
  const supabase = createClient();

  const [selection, setSelection] = useState<PmSelection | null>(null);
  const [bookings, setBookings] = useState<BookingOption[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [queue, setQueue] = useState<string>(QUEUES[0].value);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [relatedBookingId, setRelatedBookingId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!selection) {
      setBookings([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingBookings(true);
      const { data: rels } = await supabase
        .from("owner_pm_relationships")
        .select("property_id")
        .eq("pm_id", selection.pm_id)
        .eq("active", true);

      const propIds = (rels ?? [])
        .map((r) => r.property_id as string)
        .filter(Boolean);

      if (propIds.length === 0) {
        setLoadingBookings(false);
        setBookings([]);
        return;
      }

      const bookRes = await supabase
        .from("bookings")
        .select("id, check_in, booked_date, channel, raw_type_label")
        .in("property_id", propIds)
        .order("check_in", { ascending: false, nullsFirst: false })
        .limit(200);

      if (!cancelled) {
        setLoadingBookings(false);
        const rows = (bookRes.data as BookingOption[]) ?? [];
        rows.sort((a, b) => {
          const vb = checkInSortValue(b.check_in);
          const va = checkInSortValue(a.check_in);
          if (vb !== va) return vb - va;
          return b.id.localeCompare(a.id);
        });
        setBookings(rows);
      }
    })();
    return () => { cancelled = true; };
  }, [selection, supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!selection) {
      setError("Select a property manager before filing a ticket.");
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
      owner_id: user.id,
      pm_id: selection.pm_id,
      owner_pm_relationship_id: selection.rel_id,
      direction: "owner_to_pm",
      queue,
      title: title.trim(),
      description: description.trim(),
      status: "open",
    };

    if (incidentDate.trim()) payload.incident_date = incidentDate.trim();
    if (relatedBookingId.trim()) payload.related_booking_id = relatedBookingId.trim();

    const res = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setSubmitting(false);
    if (!res.ok) {
      const { error } = await res.json();
      setError(error ?? "Something went wrong. Please try again.");
      return;
    }

    router.push("/dashboard/tickets");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/dashboard/tickets"
          className="text-sm font-medium text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
        >
          ← Back to tickets
        </Link>
        <h1 className="mt-4 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          File a ticket
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Send an issue to your property manager.
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

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Property manager
          </label>
          <PmSelector onSelect={setSelection} />
        </div>

        <div>
          <label
            htmlFor="queue"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Queue
          </label>
          <select
            id="queue"
            required
            value={queue}
            onChange={(e) => setQueue(e.target.value)}
            className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
          >
            {QUEUES.map((q) => (
              <option key={q.value} value={q.value}>
                {q.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="title"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Title <span className="text-red-600">*</span>
          </label>
          <input
            id="title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>

        <div>
          <label
            htmlFor="description"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Description <span className="text-red-600">*</span>
          </label>
          <textarea
            id="description"
            required
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>

        <div>
          <label
            htmlFor="incident_date"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Incident date (optional)
          </label>
          <input
            id="incident_date"
            type="date"
            value={incidentDate}
            onChange={(e) => setIncidentDate(e.target.value)}
            className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>

        <div>
          <label
            htmlFor="booking"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Related booking (optional)
          </label>
          <select
            id="booking"
            value={relatedBookingId}
            onChange={(e) => setRelatedBookingId(e.target.value)}
            disabled={!selection || loadingBookings}
            className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
          >
            <option value="">
              {loadingBookings ? "Loading…" : "None"}
            </option>
            {bookings.map((b) => (
              <option key={b.id} value={b.id}>
                {bookingOptionLabel(b)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting || !selection}
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {submitting ? "Submitting…" : "Submit ticket"}
          </button>
          <Link
            href="/dashboard/tickets"
            className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-800 dark:border-zinc-600 dark:text-zinc-200"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}