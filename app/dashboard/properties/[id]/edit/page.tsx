"use client";

import { createClient } from "@/lib/supabase";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  BEACH_PROXIMITY,
  PROPERTY_TYPES,
  PropertyBedroomAndSleepsFields,
  PropertyDetailsFieldsAfterSleeps,
  PropertyDetailsFieldsBeforeSleeps,
  emptyPropertyForm,
  validatePropertyForm,
  type PropertyFormState,
} from "../../property-form-shared";

function rowToForm(row: Record<string, unknown>): PropertyFormState {
  const pt = row.property_type as string | null | undefined;
  const bp = row.beach_proximity as string | null | undefined;
  const validPt = PROPERTY_TYPES.some((x) => x.value === pt);
  const validBp = BEACH_PROXIMITY.some((x) => x.value === bp);
  return {
    property_name: String(row.property_name ?? ""),
    address_line1: String(row.address_line1 ?? ""),
    address_line2: String(row.address_line2 ?? ""),
    city: String(row.city ?? ""),
    state: String(row.state ?? "FL"),
    zip: String(row.zip ?? ""),
    bedroom_count: String(
      row.bedroom_count != null ? row.bedroom_count : "1"
    ),
    sleeps: row.sleeps != null ? String(row.sleeps) : "",
    property_type: (validPt ? pt : "standalone_home") as PropertyFormState["property_type"],
    beach_proximity: (validBp ? bp : "walkable") as PropertyFormState["beach_proximity"],
    private_pool: Boolean(row.private_pool),
    positioning_statement: String(row.positioning_statement ?? ""),
  };
}

export default function EditPropertyPage() {
  const router = useRouter();
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const supabase = createClient();

  const [form, setForm] = useState<PropertyFormState>(emptyPropertyForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!id) {
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

      const { data: row, error: qErr } = await supabase
        .from("properties")
        .select(
          "id, owner_id, property_name, address_line1, address_line2, city, state, zip, bedroom_count, sleeps, property_type, beach_proximity, private_pool, positioning_statement, deleted_at"
        )
        .eq("id", id)
        .maybeSingle();

      if (cancelled) return;
      setLoading(false);

      if (qErr) {
        setError(qErr.message);
        return;
      }
      if (!row) {
        setError("Property not found.");
        return;
      }
      if (row.owner_id !== user.id) {
        setError("You do not have access to this property.");
        return;
      }
      if (row.deleted_at) {
        setError("This property has been removed.");
        return;
      }

      setForm(rowToForm(row as Record<string, unknown>));
    })();
    return () => {
      cancelled = true;
    };
  }, [id, router, supabase]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      const v = validatePropertyForm(form);
      if (v) {
        setError(v);
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

      const beds = Number(form.bedroom_count);
      const sleepsTrim = form.sleeps.trim();
      const { error: uErr } = await supabase
        .from("properties")
        .update({
          property_name: form.property_name.trim(),
          address_line1: form.address_line1.trim(),
          address_line2: form.address_line2.trim() || null,
          city: form.city.trim(),
          state: form.state.trim(),
          zip: form.zip.trim(),
          bedroom_count: beds,
          sleeps: sleepsTrim ? Number(form.sleeps) : null,
          property_type: form.property_type,
          beach_proximity: form.beach_proximity,
          private_pool: form.private_pool,
          positioning_statement: form.positioning_statement.trim() || null,
        })
        .eq("id", id)
        .eq("owner_id", user.id)
        .is("deleted_at", null);

      setSubmitting(false);
      if (uErr) {
        setError(uErr.message);
        return;
      }

      router.push("/dashboard/properties");
      router.refresh();
    },
    [form, id, router, supabase]
  );

  if (!id) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400">Invalid property.</p>
    );
  }

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading property…</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
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
          Edit
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Edit property
        </h1>
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

        <div className="space-y-5">
          <PropertyDetailsFieldsBeforeSleeps form={form} setForm={setForm} />
          <PropertyBedroomAndSleepsFields form={form} setForm={setForm} />
          <PropertyDetailsFieldsAfterSleeps form={form} setForm={setForm} />
        </div>

        <div>
          <label
            htmlFor="positioning_statement"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            What makes this property unique?
          </label>
          <textarea
            id="positioning_statement"
            rows={4}
            maxLength={500}
            value={form.positioning_statement}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                positioning_statement: e.target.value,
              }))
            }
            placeholder="Describe what makes this property stand out — location highlights, special features, or what guests love most"
            className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
          />
          <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
            {form.positioning_statement.length} / 500
          </p>
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {submitting ? "Saving…" : "Save changes"}
          </button>
          <Link
            href="/dashboard/properties"
            className="inline-flex items-center justify-center rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800/50"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
