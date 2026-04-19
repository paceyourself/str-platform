"use client";

import { createClient } from "@/lib/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

const QUEUES = [
  { value: "billing_accuracy", label: "Billing accuracy" },
  { value: "payment_timeliness", label: "Payment timeliness" },
  { value: "pricing_management", label: "Pricing management" },
  { value: "maintenance", label: "Maintenance" },
  { value: "guest_screening", label: "Guest screening" },
  { value: "communication", label: "Communication" },
  { value: "listing_management", label: "Listing management" },
] as const;

type PropertyRow = {
  id: string;
  property_name: string | null;
  address_line1: string | null;
  city: string | null;
};

type RelRow = {
  id: string;
  pm_id: string;
};

type BookingOption = {
  id: string;
  check_in: string | null;
  booked_date: string | null;
  channel: string | null;
  raw_type_label: string | null;
};

/** MM/DD/YYYY from Postgres date / ISO string (calendar date, no TZ shift). */
function toMmDdYyyy(value: string | null | undefined): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    return `${iso[2]}/${iso[3]}/${iso[1]}`;
  }
  return null;
}

function checkInSortValue(checkIn: string | null): number {
  if (checkIn == null) return Number.NEGATIVE_INFINITY;
  const s = String(checkIn).trim();
  if (!s) return Number.NEGATIVE_INFINITY;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    return Date.UTC(
      Number(iso[1]),
      Number(iso[2]) - 1,
      Number(iso[3])
    );
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

function bookingOptionLabel(b: BookingOption): string {
  const parts: string[] = [];
  const cin = toMmDdYyyy(b.check_in);
  if (cin) {
    parts.push(`Check-in: ${cin}`);
  }
  const channelOrType =
    (b.channel ?? "").trim() || (b.raw_type_label ?? "").trim();
  if (channelOrType) {
    parts.push(channelOrType);
  }
  const booked = toMmDdYyyy(b.booked_date);
  if (booked) {
    parts.push(`Booked: ${booked}`);
  }
  return parts.length > 0 ? parts.join(" · ") : `Booking ${b.id.slice(0, 8)}…`;
}

function propertyLabel(p: PropertyRow) {
  const primary =
    p.property_name?.trim() || p.address_line1?.trim() || "Property";
  return [primary, p.city].filter(Boolean).join(", ");
}

export default function NewOwnerTicketPage() {
  const router = useRouter();
  const supabase = createClient();

  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [rel, setRel] = useState<RelRow | null>(null);
  const [pmName, setPmName] = useState<string | null>(null);
  const [bookings, setBookings] = useState<BookingOption[]>([]);
  const [loadingProps, setLoadingProps] = useState(true);
  const [loadingRel, setLoadingRel] = useState(false);
  const [queue, setQueue] = useState<string>(QUEUES[0].value);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [relatedBookingId, setRelatedBookingId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadProperties = useCallback(async () => {
    setLoadingProps(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoadingProps(false);
      router.replace("/login");
      return;
    }
    const { data, error: qErr } = await supabase
      .from("properties")
      .select("id, property_name, address_line1, city")
      .eq("owner_id", user.id)
      .order("property_name", { ascending: true, nullsFirst: false });
    setLoadingProps(false);
    if (qErr) {
      setError(qErr.message);
      return;
    }
    const list = (data as PropertyRow[]) ?? [];
    setProperties(list);
    if (list.length === 1) setPropertyId(list[0].id);
  }, [router, supabase]);

  useEffect(() => {
    loadProperties();
  }, [loadProperties]);

  useEffect(() => {
    if (!propertyId) {
      setRel(null);
      setPmName(null);
      setBookings([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingRel(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const relRes = await supabase
        .from("owner_pm_relationships")
        .select("id, pm_id, pm_profiles ( company_name )")
        .eq("property_id", propertyId)
        .eq("active", true)
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      setLoadingRel(false);

      if (relRes.error) {
        setRel(null);
        setPmName(null);
        setBookings([]);
        setError(relRes.error.message);
        return;
      }

      const row = relRes.data as {
        id: string;
        pm_id: string;
        pm_profiles:
          | { company_name: string | null }
          | { company_name: string | null }[]
          | null;
      } | null;

      if (!row) {
        setRel(null);
        setPmName(null);
        setBookings([]);
        return;
      }

      setRel({ id: row.id, pm_id: row.pm_id });
      const pm = row.pm_profiles;
      setPmName(
        pm == null
          ? null
          : Array.isArray(pm)
            ? (pm[0]?.company_name ?? null)
            : (pm.company_name ?? null)
      );

      const bookRes = await supabase
        .from("bookings")
        .select("id, check_in, booked_date, channel, raw_type_label")
        .eq("property_id", propertyId)
        .order("check_in", { ascending: false, nullsFirst: false })
        .limit(200);

      if (!cancelled) {
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
    return () => {
      cancelled = true;
    };
  }, [propertyId, supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!rel) {
      setError("This property has no active PM. Link a PM before filing a ticket.");
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
      pm_id: rel.pm_id,
      owner_pm_relationship_id: rel.id,
      direction: "owner_to_pm",
      queue,
      title: title.trim(),
      description: description.trim(),
      status: "open",
    };

    if (incidentDate.trim()) {
      payload.incident_date = incidentDate.trim();
    }
    if (relatedBookingId.trim()) {
      payload.related_booking_id = relatedBookingId.trim();
    }

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
          Send an issue to your property manager for this property.
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
          <label
            htmlFor="property"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Property
          </label>
          <select
            id="property"
            required
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            disabled={loadingProps || properties.length === 0}
            className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
          >
            <option value="">
              {loadingProps ? "Loading…" : "Select property"}
            </option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {propertyLabel(p)}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900/50">
          <span className="text-zinc-500 dark:text-zinc-400">PM: </span>
          {loadingRel ? (
            <span className="text-zinc-600 dark:text-zinc-300">Loading…</span>
          ) : rel ? (
            <span className="font-medium text-zinc-900 dark:text-zinc-50">
              {pmName ?? "—"}
            </span>
          ) : (
            <span className="text-amber-800 dark:text-amber-200">
              No active PM for this property
            </span>
          )}
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
            disabled={!propertyId}
            className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
          >
            <option value="">None</option>
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
            disabled={submitting || !rel}
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
