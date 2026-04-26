"use client";
import { createClient } from "@/lib/supabase";
import { useCallback, useEffect, useState } from "react";

type BatchOption = { id: string; batch_month: string | null; created_at: string; booking_count: number; };
type PropertyOption = { id: string; property_name: string | null; owner_name: string | null; booking_count: number; };
type OwnerOption = { id: string; display_name: string | null; booking_count: number; };

type PurgeMode = "batch" | "property" | "owner";

export default function AdminBookingsPurgePage() {
  const supabase = createClient();
  const [mode, setMode] = useState<PurgeMode>("property");
  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [purging, setPurging] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setSelectedId("");
    setConfirm(false);
    setResult(null);
    setError(null);

    const [
      { data: batchData },
      { data: bookingData },
    ] = await Promise.all([
      supabase
        .from("upload_batches")
        .select("id, batch_month, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("bookings")
        .select("id, property_id, upload_batch_id, properties(property_name, owner_id, owner_profiles(display_name))"),
    ]);

    // Build batch options
    const batchMap = new Map<string, BatchOption>();
    for (const b of bookingData ?? []) {
      const bid = b.upload_batch_id as string | null;
      if (!bid) continue;
      if (!batchMap.has(bid)) {
        const batch = (batchData ?? []).find((bt) => bt.id === bid);
        batchMap.set(bid, {
          id: bid,
          batch_month: batch?.batch_month ?? null,
          created_at: batch?.created_at ?? "",
          booking_count: 0,
        });
      }
      batchMap.get(bid)!.booking_count++;
    }
    setBatches(Array.from(batchMap.values()));

    // Build property options
    const propMap = new Map<string, PropertyOption>();
    for (const b of bookingData ?? []) {
      const pid = b.property_id as string;
      if (!propMap.has(pid)) {
        const prop = b.properties as unknown as { property_name: string | null; owner_id: string; owner_profiles: { display_name: string | null }[] | null } | null;
        propMap.set(pid, {
          id: pid,
          property_name: prop?.property_name ?? null,
          owner_name: prop?.owner_profiles?.[0]?.display_name ?? null,
          booking_count: 0,
        });
      }
      propMap.get(pid)!.booking_count++;
    }
    setProperties(
      Array.from(propMap.values()).sort((a, b) =>
        (a.owner_name ?? "").localeCompare(b.owner_name ?? "")
      )
    );

    // Build owner options
    const ownerMap = new Map<string, OwnerOption>();
    for (const b of bookingData ?? []) {
        const prop = b.properties as unknown as { owner_id: string; owner_profiles: { display_name: string | null }[] | null } | null;
      if (!prop) continue;
      const oid = prop.owner_id;
      if (!ownerMap.has(oid)) {
        ownerMap.set(oid, {
          id: oid,
          display_name: prop?.owner_profiles?.[0]?.display_name ?? null,
          booking_count: 0,
        });
      }
      ownerMap.get(oid)!.booking_count++;
    }
    setOwners(
      Array.from(ownerMap.values()).sort((a, b) =>
        (a.display_name ?? "").localeCompare(b.display_name ?? "")
      )
    );

    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function handlePurge() {
    if (!selectedId || !confirm) return;
    setPurging(true);
    setError(null);
    setResult(null);

    const args =
      mode === "batch"
        ? { p_batch_id: selectedId }
        : mode === "property"
        ? { p_property_id: selectedId }
        : { p_owner_id: selectedId };

    const { data, error: fnErr } = await supabase.rpc("admin_purge_bookings", args);
    if (fnErr) {
      setError(fnErr.message);
    } else {
      const res = data as { deleted: number; message: string };
      setResult(res.message);
      setSelectedId("");
      setConfirm(false);
      await load();
    }
    setPurging(false);
  }

  const options =
    mode === "batch"
      ? batches.map((b) => ({
          id: b.id,
          label: `${b.batch_month ?? "Unknown month"} — ${b.booking_count} bookings — ${new Date(b.created_at).toLocaleDateString()}`,
        }))
      : mode === "property"
      ? properties.map((p) => ({
          id: p.id,
          label: `${p.property_name ?? "Unknown"} — ${p.owner_name ?? "Unknown owner"} — ${p.booking_count} bookings`,
        }))
      : owners.map((o) => ({
          id: o.id,
          label: `${o.display_name ?? "Unknown"} — ${o.booking_count} bookings`,
        }));

  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        Booking Purge Tool
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Permanently delete bookings by batch, property, or owner. This action cannot be undone.
      </p>

      <div className="mt-6 max-w-lg space-y-5">
        {/* Mode selector */}
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
            Purge by
          </label>
          <div className="flex gap-2">
            {(["property", "owner", "batch"] as PurgeMode[]).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setSelectedId(""); setConfirm(false); setResult(null); setError(null); }}
                className={[
                  "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                  mode === m
                    ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                    : "border border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800",
                ].join(" ")}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Scope selector */}
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
            {mode === "batch" ? "Select batch" : mode === "property" ? "Select property" : "Select owner"}
          </label>
          {loading ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : (
            <select
              value={selectedId}
              onChange={(e) => { setSelectedId(e.target.value); setConfirm(false); setResult(null); setError(null); }}
              className="block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
            >
              <option value="">Select…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          )}
          {mode === "batch" && batches.length === 0 && !loading && (
            <p className="mt-1.5 text-xs text-zinc-400">No upload batches found. Batch purge applies to future CSV loads only.</p>
          )}
        </div>

        {/* Confirmation checkbox */}
        {selectedId && (
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
              className="mt-0.5 rounded border-zinc-300"
            />
            <span className="text-sm text-red-600 dark:text-red-400 font-medium">
              I understand this permanently deletes all bookings for the selected {mode} and cannot be undone.
            </span>
          </label>
        )}

        {/* Purge button */}
        {selectedId && (
          <button
            onClick={handlePurge}
            disabled={!confirm || purging}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {purging ? "Purging…" : "Purge bookings"}
          </button>
        )}

        {/* Result */}
        {result && (
          <p className="text-sm text-green-600 dark:text-green-400 font-medium">{result}</p>
        )}
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    </div>
  );
}