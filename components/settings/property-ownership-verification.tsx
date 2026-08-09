"use client";

import { createClient } from "@/lib/supabase";
import { useCallback, useEffect, useState, type FormEvent } from "react";

type VerificationStatus =
  | "unverified"
  | "pending"
  | "verified"
  | "rejected"
  | string;

type PropertyRow = {
  id: string;
  property_name: string | null;
  address_line1: string | null;
  verification_status: VerificationStatus;
  owner_type: string | null;
  entity_relationship: string | null;
};

type UploadFormState = {
  file: File | null;
  owner_type: "" | "individual" | "entity";
  entity_relationship: string;
};

const emptyUploadForm: UploadFormState = {
  file: null,
  owner_type: "",
  entity_relationship: "",
};

function propertyLabel(p: PropertyRow): string {
  return p.property_name?.trim() || p.address_line1?.trim() || "Property";
}

function statusLabel(status: VerificationStatus): string {
  switch (status) {
    case "unverified":
      return "Unverified";
    case "pending":
      return "Pending review";
    case "verified":
      return "Verified";
    case "rejected":
      return "Rejected";
    default:
      return status;
  }
}

export default function PropertyOwnershipVerification() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, UploadFormState>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const loadProperties = useCallback(async () => {
    setLoading(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSignedIn(false);
      setProperties([]);
      setLoading(false);
      return;
    }
    setSignedIn(true);

    const { data, error: qErr } = await supabase
      .from("properties")
      .select(
        "id, property_name, address_line1, verification_status, owner_type, entity_relationship",
      )
      .eq("owner_id", user.id)
      .is("deleted_at", null)
      .order("property_name", { ascending: true });

    if (qErr) {
      setError(qErr.message);
      setProperties([]);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as PropertyRow[];
    setProperties(rows);
    setForms((prev) => {
      const next: Record<string, UploadFormState> = { ...prev };
      for (const p of rows) {
        if (!next[p.id]) next[p.id] = { ...emptyUploadForm };
      }
      return next;
    });
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void loadProperties();
  }, [loadProperties]);

  async function handleSubmit(propertyId: string, e: FormEvent) {
    e.preventDefault();
    setFormErrors((prev) => ({ ...prev, [propertyId]: "" }));

    const form = forms[propertyId] ?? emptyUploadForm;
    if (!form.file) {
      setFormErrors((prev) => ({
        ...prev,
        [propertyId]: "Choose a verification document to upload.",
      }));
      return;
    }
    if (form.owner_type !== "individual" && form.owner_type !== "entity") {
      setFormErrors((prev) => ({
        ...prev,
        [propertyId]: "Select whether you own as an individual or an entity.",
      }));
      return;
    }
    if (
      form.owner_type === "entity" &&
      !form.entity_relationship.trim()
    ) {
      setFormErrors((prev) => ({
        ...prev,
        [propertyId]: "Describe your relationship to the owning entity.",
      }));
      return;
    }

    setSubmittingId(propertyId);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSubmittingId(null);
      setSignedIn(false);
      return;
    }

    const timestamp = Date.now();
    const safeName = form.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `property-verification/${propertyId}/${timestamp}_${safeName}`;

    const { error: uploadErr } = await supabase.storage
      .from("attachments")
      .upload(path, form.file, { upsert: false });

    if (uploadErr) {
      setSubmittingId(null);
      setFormErrors((prev) => ({
        ...prev,
        [propertyId]: `Upload failed: ${uploadErr.message}`,
      }));
      return;
    }

    const { error: updateErr } = await supabase
      .from("properties")
      .update({
        verification_document_url: path,
        verification_status: "pending",
        owner_type: form.owner_type,
        entity_relationship:
          form.owner_type === "entity"
            ? form.entity_relationship.trim()
            : null,
        verification_reviewed_by: null,
        verification_reviewed_at: null,
      })
      .eq("id", propertyId)
      .eq("owner_id", user.id)
      .is("deleted_at", null);

    setSubmittingId(null);

    if (updateErr) {
      setFormErrors((prev) => ({
        ...prev,
        [propertyId]: `Could not update verification: ${updateErr.message}`,
      }));
      return;
    }

    // Reflect pending state immediately — no full-page reload.
    setProperties((prev) =>
      prev.map((p) =>
        p.id === propertyId
          ? {
              ...p,
              verification_status: "pending",
              owner_type: form.owner_type,
              entity_relationship:
                form.owner_type === "entity"
                  ? form.entity_relationship.trim()
                  : null,
            }
          : p,
      ),
    );
    setForms((prev) => ({ ...prev, [propertyId]: { ...emptyUploadForm } }));
  }

  return (
    <section className="mt-10 space-y-4" aria-labelledby="ownership-verification-heading">
      <h2
        id="ownership-verification-heading"
        className="text-base font-semibold uppercase tracking-wide text-zinc-900 dark:text-zinc-50"
      >
        Property ownership verification
      </h2>
      <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        Verify ownership of each property before submitting owner reviews of a
        property manager.
      </p>

      {loading ? (
        <p className="text-sm text-zinc-500">Loading properties…</p>
      ) : !signedIn ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Sign in to view and submit ownership verification for your properties.
        </p>
      ) : error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
        >
          {error}
        </div>
      ) : properties.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          You have no properties yet.
        </p>
      ) : (
        <ul className="space-y-4">
          {properties.map((p) => {
            const status = p.verification_status;
            const needsUpload =
              status === "unverified" || status === "rejected";
            const form = forms[p.id] ?? emptyUploadForm;
            const formError = formErrors[p.id];

            return (
              <li
                key={p.id}
                className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    {propertyLabel(p)}
                  </h3>
                  <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    {statusLabel(status)}
                  </span>
                </div>

                {status === "pending" ? (
                  <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                    Your verification document is pending review. No further
                    action is needed right now.
                  </p>
                ) : null}

                {status === "verified" ? (
                  <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                    Ownership verified. No further action needed.
                  </p>
                ) : null}

                {needsUpload ? (
                  <form
                    className="mt-4 space-y-4"
                    onSubmit={(e) => void handleSubmit(p.id, e)}
                  >
                    {status === "rejected" ? (
                      <p className="text-sm text-amber-800 dark:text-amber-200">
                        Previous verification was rejected. Upload a new
                        document to resubmit.
                      </p>
                    ) : null}

                    {formError ? (
                      <div
                        role="alert"
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
                      >
                        {formError}
                      </div>
                    ) : null}

                    <div>
                      <label
                        htmlFor={`verification-doc-${p.id}`}
                        className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                      >
                        Verification document
                      </label>
                      <input
                        id={`verification-doc-${p.id}`}
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null;
                          setForms((prev) => ({
                            ...prev,
                            [p.id]: { ...(prev[p.id] ?? emptyUploadForm), file },
                          }));
                        }}
                        className="mt-1.5 block w-full text-sm text-zinc-700 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white dark:text-zinc-300 dark:file:bg-zinc-100 dark:file:text-zinc-900"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor={`owner-type-${p.id}`}
                        className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                      >
                        Owner type
                      </label>
                      <select
                        id={`owner-type-${p.id}`}
                        value={form.owner_type}
                        onChange={(e) => {
                          const owner_type = e.target.value as
                            | ""
                            | "individual"
                            | "entity";
                          setForms((prev) => ({
                            ...prev,
                            [p.id]: {
                              ...(prev[p.id] ?? emptyUploadForm),
                              owner_type,
                              entity_relationship:
                                owner_type === "entity"
                                  ? (prev[p.id]?.entity_relationship ?? "")
                                  : "",
                            },
                          }));
                        }}
                        className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
                      >
                        <option value="">Select…</option>
                        <option value="individual">Individual</option>
                        <option value="entity">Entity</option>
                      </select>
                    </div>

                    {form.owner_type === "entity" ? (
                      <div>
                        <label
                          htmlFor={`entity-relationship-${p.id}`}
                          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                        >
                          Entity relationship
                        </label>
                        <input
                          id={`entity-relationship-${p.id}`}
                          type="text"
                          value={form.entity_relationship}
                          onChange={(e) =>
                            setForms((prev) => ({
                              ...prev,
                              [p.id]: {
                                ...(prev[p.id] ?? emptyUploadForm),
                                entity_relationship: e.target.value,
                              },
                            }))
                          }
                          placeholder="e.g. Managing member, Trustee"
                          className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
                        />
                      </div>
                    ) : null}

                    <button
                      type="submit"
                      disabled={submittingId === p.id}
                      className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      {submittingId === p.id
                        ? "Submitting…"
                        : "Submit for verification"}
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
