"use client";

import { createClient } from "@/lib/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  MARKET,
  PropertyDetailsFields,
  emptyPropertyForm,
  validatePropertyForm,
  type PropertyFormState,
} from "../property-form-shared";

export default function NewPropertyPage() {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState<PropertyFormState>(emptyPropertyForm);
  const [authReady, setAuthReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        router.replace("/login");
        return;
      }
      setAuthReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

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
      const propertyPayload = {
        owner_id: user.id,
        market_id: MARKET,
        property_name: form.property_name.trim(),
        address_line1: form.address_line1.trim(),
        address_line2: form.address_line2.trim() || null,
        city: form.city.trim(),
        state: form.state.trim(),
        zip: form.zip.trim(),
        bedroom_count: beds,
        property_type: form.property_type,
        beach_proximity: form.beach_proximity,
        private_pool: form.private_pool,
      };

      const { data: propertyRow, error: propError } = await supabase
        .from("properties")
        .insert(propertyPayload)
        .select("id")
        .single();

      setSubmitting(false);
      if (propError) {
        setError(propError.message);
        return;
      }

      const id = propertyRow?.id as string | undefined;
      if (!id) {
        setError("Property was created but no id was returned.");
        return;
      }

      router.push(`/dashboard/properties/${id}/pm`);
      router.refresh();
    },
    [form, router, supabase]
  );

  if (!authReady) {
    return (
      <p className="text-sm text-zinc-500">Loading…</p>
    );
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
          New
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Add a property
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Property details. You&apos;ll link a PM on the next step.
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

        <input type="hidden" name="market_id" value={MARKET} />

        <PropertyDetailsFields form={form} setForm={setForm} />

        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {submitting ? "Saving…" : "Continue to PM"}
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
