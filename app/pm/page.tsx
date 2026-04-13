"use client";

import { OwnerDashboardNav } from "@/components/owner-dashboard-nav";
import { createClient } from "@/lib/supabase";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const MARKET = "30a" as const;

type PmProfileRow = {
  id: string;
  company_name: string | null;
  profile_claimed: boolean | null;
  website_url: string | null;
  phone: string | null;
};

type ContractStatRow = {
  pm_id: string;
  rel_count: number;
  avg_notice_days: number | null;
  pct_etf: number | null;
  pct_listing_transfer: number | null;
  avg_payment_timeline_days: number | null;
  avg_maintenance_threshold: number | null;
};

type TicketStatRow = {
  pm_id: string;
  total: number;
  acknowledged_count: number;
  resolved_count: number;
};

type ReviewRow = {
  pm_id: string;
  overall_rating: number;
  review_text: string | null;
};

function hrefUrl(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

function formatPct(part: number, total: number): string {
  if (total <= 0 || !Number.isFinite(part)) return "—";
  return `${Math.round((100 * part) / total)}%`;
}

function formatAvg(n: number | null | undefined, suffix = ""): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  const rounded = Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : v.toFixed(1);
  return `${rounded}${suffix}`;
}

function formatMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(n));
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

function excerpt(text: string | null, max = 150): string {
  const s = text?.trim() ?? "";
  if (s.length <= max) return s;
  return `${s.slice(0, max).trim()}…`;
}

/** Normalize UUID / id so Map keys match pm_profiles.id and FK columns from joined rows. */
function pmKey(id: string | null | undefined): string {
  return String(id ?? "").trim().toLowerCase();
}

type RelAggRow = {
  pm_id: string;
  contract_notice_days: number | string | null;
  contract_etf_exists: boolean | null;
  contract_listing_transfer: boolean | null;
  contract_payment_timeline_days: number | string | null;
  contract_maintenance_threshold: number | string | null;
};

type TicketAggRow = {
  pm_id: string;
  status: string;
  acknowledged_at: string | null;
};

function buildContractMapFromRels(rows: RelAggRow[]): Map<string, ContractStatRow> {
  const byPm = new Map<string, RelAggRow[]>();
  for (const r of rows) {
    const k = pmKey(r.pm_id);
    if (!k) continue;
    const arr = byPm.get(k) ?? [];
    arr.push(r);
    byPm.set(k, arr);
  }
  const out = new Map<string, ContractStatRow>();
  for (const [k, list] of byPm) {
    const n = list.length;
    let noticeSum = 0;
    let noticeN = 0;
    let etf = 0;
    let listing = 0;
    let paySum = 0;
    let payN = 0;
    let maintSum = 0;
    let maintN = 0;
    for (const r of list) {
      const nd = r.contract_notice_days;
      if (nd != null && Number.isFinite(Number(nd))) {
        noticeSum += Number(nd);
        noticeN += 1;
      }
      if (r.contract_etf_exists === true) etf += 1;
      if (r.contract_listing_transfer === true) listing += 1;
      const pd = r.contract_payment_timeline_days;
      if (pd != null && Number.isFinite(Number(pd))) {
        paySum += Number(pd);
        payN += 1;
      }
      const md = r.contract_maintenance_threshold;
      if (md != null && Number.isFinite(Number(md))) {
        maintSum += Number(md);
        maintN += 1;
      }
    }
    out.set(k, {
      pm_id: String(list[0]?.pm_id ?? k),
      rel_count: n,
      avg_notice_days: noticeN > 0 ? noticeSum / noticeN : null,
      pct_etf: n > 0 ? (100 * etf) / n : null,
      pct_listing_transfer: n > 0 ? (100 * listing) / n : null,
      avg_payment_timeline_days: payN > 0 ? paySum / payN : null,
      avg_maintenance_threshold: maintN > 0 ? maintSum / maintN : null,
    });
  }
  return out;
}

function buildTicketMapFromRows(rows: TicketAggRow[]): Map<string, TicketStatRow> {
  const byPm = new Map<string, TicketAggRow[]>();
  for (const r of rows) {
    const k = pmKey(r.pm_id);
    if (!k) continue;
    const arr = byPm.get(k) ?? [];
    arr.push(r);
    byPm.set(k, arr);
  }
  const out = new Map<string, TicketStatRow>();
  for (const [k, list] of byPm) {
    const total = list.length;
    const acknowledged_count = list.filter((t) => t.acknowledged_at != null).length;
    const resolved_count = list.filter((t) => t.status === "resolved").length;
    out.set(k, {
      pm_id: String(list[0]?.pm_id ?? k),
      total,
      acknowledged_count,
      resolved_count,
    });
  }
  return out;
}

export default function PmDirectoryPage() {
  const supabase = createClient();
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pms, setPms] = useState<PmProfileRow[]>([]);
  const [contractByPm, setContractByPm] = useState<Map<string, ContractStatRow>>(
    new Map()
  );
  const [ticketByPm, setTicketByPm] = useState<Map<string, TicketStatRow>>(
    new Map()
  );
  const [reviewsByPm, setReviewsByPm] = useState<Map<string, ReviewRow[]>>(
    new Map()
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: pmData, error: pmErr } = await supabase
      .from("pm_profiles")
      .select(
        "id, company_name, profile_claimed, website_url, phone"
      )
      .contains("markets", [MARKET])
      .order("company_name", { ascending: true, nullsFirst: false });

    if (pmErr) {
      setError(pmErr.message);
      setLoading(false);
      setPms([]);
      return;
    }

    const list = (pmData as PmProfileRow[]) ?? [];
    setPms(list);
    const pmIds = list.map((p) => p.id).filter(Boolean);

    if (pmIds.length === 0) {
      setContractByPm(new Map());
      setTicketByPm(new Map());
      setReviewsByPm(new Map());
      setLoading(false);
      return;
    }

    const [relsRes, ticketsRes, reviewsRes] = await Promise.all([
      supabase
        .from("owner_pm_relationships")
        .select(
          `
          pm_id,
          contract_notice_days,
          contract_etf_exists,
          contract_listing_transfer,
          contract_payment_timeline_days,
          contract_maintenance_threshold
        `
        )
        .in("pm_id", pmIds)
        .eq("active", true),
      supabase
        .from("tickets")
        .select("pm_id, status, acknowledged_at")
        .in("pm_id", pmIds)
        .eq("direction", "owner_to_pm"),
      supabase
        .from("reviews")
        .select("pm_id, overall_rating, review_text")
        .eq("status", "visible")
        .in("pm_id", pmIds)
        .order("created_at", { ascending: false }),
    ]);

    const cMap = relsRes.error
      ? new Map<string, ContractStatRow>()
      : buildContractMapFromRels((relsRes.data as RelAggRow[]) ?? []);

    const tMap = ticketsRes.error
      ? new Map<string, TicketStatRow>()
      : buildTicketMapFromRows((ticketsRes.data as TicketAggRow[]) ?? []);

    if (relsRes.error) {
      console.warn("[pm directory] owner_pm_relationships batch:", relsRes.error);
    }
    if (ticketsRes.error) {
      console.warn("[pm directory] tickets batch:", ticketsRes.error);
    }

    const rMap = new Map<string, ReviewRow[]>();
    if (reviewsRes.error) {
      console.warn(reviewsRes.error);
    } else {
      const rows = (reviewsRes.data as ReviewRow[]) ?? [];
      for (const r of rows) {
        const id = pmKey(r.pm_id);
        if (!id) continue;
        const cur = rMap.get(id) ?? [];
        cur.push({
          pm_id: id,
          overall_rating: Number(r.overall_rating),
          review_text: r.review_text,
        });
        rMap.set(id, cur);
      }
    }

    setContractByPm(cMap);
    setTicketByPm(tMap);
    setReviewsByPm(rMap);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredPms = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pms;
    return pms.filter((p) =>
      (p.company_name ?? "").toLowerCase().includes(q)
    );
  }, [pms, search]);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <OwnerDashboardNav />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <div className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto max-w-4xl px-4 py-10">
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
              <Link href="/" className="hover:underline">
                Home
              </Link>
              <span className="mx-2">/</span>
              Property managers
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              30A Property Manager Directory
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
              Browse and compare property managers in the 30A market. Ratings and
              reviews from verified owners.
            </p>
            <div className="mt-6">
              <label htmlFor="pm-search" className="sr-only">
                Search by company name
              </label>
              <input
                id="pm-search"
                type="search"
                placeholder="Search by company name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full max-w-md rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/15 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-400"
              />
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-4xl px-4 py-8">
          {error ? (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
            >
              {error}
            </div>
          ) : null}

          {loading ? (
            <p className="text-sm text-zinc-500">Loading directory…</p>
          ) : filteredPms.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {pms.length === 0
                ? "No property managers listed for this market yet."
                : "No companies match your search."}
            </p>
          ) : (
            <ul className="space-y-6">
              {filteredPms.map((pm) => {
                const lookupKey = pmKey(pm.id);
                const contract = contractByPm.get(lookupKey);
                const tickets = ticketByPm.get(lookupKey);
                const reviews = reviewsByPm.get(lookupKey) ?? [];
                const reviewExcerpts = reviews.slice(0, 2);
                const web = hrefUrl(pm.website_url);

                if (
                  (pm.company_name ?? "").toLowerCase().includes("oversee")
                ) {
                  console.log("[pm directory] Oversee card render", {
                    pm_id: pm.id,
                    lookupKey,
                    contract,
                    tickets,
                    contractMapHasKey: contractByPm.has(lookupKey),
                    ticketMapHasKey: ticketByPm.has(lookupKey),
                    contractMapKeysSample: [...contractByPm.keys()].slice(0, 8),
                    ticketMapKeysSample: [...ticketByPm.keys()].slice(0, 8),
                  });
                }

                return (
                  <li
                    key={pm.id}
                    className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
                  >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                        {pm.company_name ?? "Unnamed company"}
                      </h2>
                      <span
                        className={`mt-2 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          pm.profile_claimed
                            ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100"
                            : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
                        }`}
                      >
                        {pm.profile_claimed ? "Claimed" : "Unclaimed"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                    {web ? (
                      <a
                        href={web}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
                      >
                        Website
                      </a>
                    ) : (
                      <span className="text-zinc-400">No website listed</span>
                    )}
                    {pm.phone?.trim() ? (
                      <a
                        href={`tel:${pm.phone.replace(/\s/g, "")}`}
                        className="text-zinc-700 hover:underline dark:text-zinc-300"
                      >
                        {pm.phone.trim()}
                      </a>
                    ) : (
                      <span className="text-zinc-400">No phone listed</span>
                    )}
                  </div>

                  <div className="mt-5 rounded-xl border border-zinc-100 bg-zinc-50/80 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/50">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Contract disclosure (aggregated from owner contracts)
                    </h3>
                    {!contract ||
                    !Number.isFinite(Number(contract.rel_count)) ||
                    Number(contract.rel_count) < 1 ? (
                      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                        No contract data yet
                      </p>
                    ) : (
                      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="text-zinc-500 dark:text-zinc-400">
                            Avg. notice period
                          </dt>
                          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                            {formatAvg(contract.avg_notice_days)} days
                          </dd>
                        </div>
                        <div>
                          <dt className="text-zinc-500 dark:text-zinc-400">
                            Contracts with ETF
                          </dt>
                          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                            {contract.pct_etf != null
                              ? `${formatAvg(contract.pct_etf)}%`
                              : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-zinc-500 dark:text-zinc-400">
                            Listing transfers on exit
                          </dt>
                          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                            {contract.pct_listing_transfer != null
                              ? `${formatAvg(contract.pct_listing_transfer)}%`
                              : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-zinc-500 dark:text-zinc-400">
                            Avg. payment timeline
                          </dt>
                          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                            {formatAvg(contract.avg_payment_timeline_days)} days
                          </dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="text-zinc-500 dark:text-zinc-400">
                            Avg. maintenance approval threshold
                          </dt>
                          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                            {formatMoney(
                              contract.avg_maintenance_threshold != null
                                ? Number(contract.avg_maintenance_threshold)
                                : null
                            )}
                          </dd>
                        </div>
                      </dl>
                    )}
                  </div>

                  <div className="mt-4 rounded-xl border border-zinc-100 bg-zinc-50/80 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/50">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Support tickets (owner → PM)
                    </h3>
                    {!tickets ||
                    !Number.isFinite(Number(tickets.total)) ||
                    Number(tickets.total) < 1 ? (
                      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                        No tickets yet
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1 text-sm text-zinc-800 dark:text-zinc-200">
                        <li>Total filed: {tickets.total}</li>
                        <li>
                          Acknowledged:{" "}
                          {formatPct(
                            tickets.acknowledged_count,
                            tickets.total
                          )}
                        </li>
                        <li>
                          Resolved:{" "}
                          {formatPct(tickets.resolved_count, tickets.total)}
                        </li>
                      </ul>
                    )}
                  </div>

                  <div className="mt-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Reviews
                    </h3>
                    {reviews.length === 0 ? (
                      <div className="mt-2 space-y-2">
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">
                          No reviews yet.
                        </p>
                        <Link
                          href={`/dashboard/reviews/new?pm_id=${encodeURIComponent(pm.id)}`}
                          className="inline-flex w-full items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-zinc-800 sm:w-auto dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                        >
                          Be the first to review
                        </Link>
                      </div>
                    ) : (
                      <>
                        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                          {reviews.length} visible review
                          {reviews.length === 1 ? "" : "s"}
                        </p>
                        {reviewExcerpts.length > 0 ? (
                          <ul className="mt-3 space-y-3">
                            {reviewExcerpts.map((rev, idx) => (
                              <li
                                key={`${pm.id}-${idx}`}
                                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                              >
                                <div className="flex items-center gap-2">
                                  <Stars rating={rev.overall_rating} />
                                  <span className="text-xs text-zinc-500">
                                    {rev.overall_rating}/5
                                  </span>
                                </div>
                                <p className="mt-1 text-zinc-700 dark:text-zinc-300">
                                  {excerpt(rev.review_text)}
                                </p>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      </main>
    </div>
  );
}
