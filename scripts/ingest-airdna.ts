/**
 * AirDNA → public.market_benchmarks ingestion.
 *
 * Env (same pattern as seed-str-leads.ts — load `.env.local` via dotenv):
 *   AIRDNA_API_KEY — Bearer token
 *   SUPABASE_URL — Supabase URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role key
 *
 * Run:
 *   npx ts-node scripts/ingest-airdna.ts --mode search
 *   npx ts-node scripts/ingest-airdna.ts --mode dry-run --market 30a
 *   npx ts-node scripts/ingest-airdna.ts --mode seed --market 30a
 *   npx ts-node scripts/ingest-airdna.ts --mode refresh --market 30a --filter
 *
 * API note: Metrics are fetched at v2 URLs with the submarket id in the path
 * (`/submarket/{submarketId}/metrics/revpar|adr|occupancy`). A POST to flat
 * `/submarket/revpar` returns 400 (verified against the live API).
 *
 * Listing filter note: `--filter` maps to AirDNA listing_type value `entire_place`
 * (their API rejects the human label "Entire home/apt").
 */

import * as path from "path";
import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
loadEnv({ path: path.join(ROOT, ".env.local") });
loadEnv({ path: path.join(ROOT, ".env") });

const BASE_URL = "https://api.airdna.co/api/enterprise/v2";

type Mode = "search" | "dry-run" | "seed" | "refresh";

type Cli = {
  mode: Mode | null;
  market: string;
  filterListingType: boolean;
  year?: number;
};

function parseArgv(argv: string[]): Cli {
  let mode: Mode | null = null;
  let market = "30a";
  let filterListingType = false;
  let year: number | undefined;

  const scriptIdx = argv.findIndex((a) => /ingest-airdna\.(ts|cjs|js|mts)$/i.test(a));
  const start = scriptIdx >= 0 ? scriptIdx + 1 : 2;

  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode") {
      const next = argv[i + 1];
      if (
        !next ||
        next.startsWith("--") ||
        !["search", "dry-run", "seed", "refresh"].includes(next)
      ) {
        throw new Error(
          '--mode requires one of: search | dry-run | seed | refresh (e.g. --mode dry-run)',
        );
      }
      mode = next as Mode;
      i += 1;
      continue;
    }
    if (a.startsWith("--mode=")) {
      const v = a.slice("--mode=".length).trim();
      if (!["search", "dry-run", "seed", "refresh"].includes(v)) {
        throw new Error(`Invalid --mode value: ${v}`);
      }
      mode = v as Mode;
      continue;
    }
    if (a === "--market") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--market requires a value (default 30a if omitted entirely)");
      }
      market = next.trim().toLowerCase();
      i += 1;
      continue;
    }
    if (a.startsWith("--market=")) {
      market = a.slice("--market=".length).trim().toLowerCase();
      if (!market) throw new Error("--market must be non-empty");
      continue;
    }
    if (a === "--filter") {
      filterListingType = true;
      continue;
    }
    if (a === "--year") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--year requires YYYY");
      }
      const y = Number(next);
      if (!Number.isInteger(y) || y < 1900 || y > 3000) {
        throw new Error(`Invalid --year: ${next}`);
      }
      year = y;
      i += 1;
      continue;
    }
    if (a.startsWith("--year=")) {
      const next = a.slice("--year=".length).trim();
      const y = Number(next);
      if (!Number.isInteger(y) || y < 1900 || y > 3000) {
        throw new Error(`Invalid --year: ${next}`);
      }
      year = y;
      continue;
    }
  }

  return { mode, market, filterListingType, year };
}

type AirDnaEnvelope<T> = {
  payload?: T;
  status?: { type: string; message?: string };
};

function buildMetricsBody(
  numMonths: number,
  filterListingType: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = { num_months: numMonths };
  // AirDNA rejects object-shaped filters; omit key when unfiltered per spec.
  if (filterListingType) {
    body.filters = [
      {
        field: "listing_type",
        type: "select",
        // Human label “Entire home/apt” corresponds to enterprise enum entire_place.
        value: "entire_place",
      },
    ];
  }
  return body;
}

async function airDnaPost<T>(
  endpointPath: string,
  body: Record<string, unknown>,
): Promise<T> {
  const key = process.env.AIRDNA_API_KEY?.trim();
  if (!key) {
    console.error("Missing AIRDNA_API_KEY (set in .env.local or environment).");
    process.exit(1);
  }

  const res = await fetch(`${BASE_URL}${endpointPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text) as AirDnaEnvelope<T>;
  } catch {
    throw new Error(
      `AirDNA ${endpointPath}: HTTP ${res.status} — non-JSON body: ${text.slice(0, 500)}`,
    );
  }

  const envelope = json as AirDnaEnvelope<T>;
  if (!res.ok || envelope.status?.type === "error") {
    throw new Error(
      `AirDNA ${endpointPath}: HTTP ${res.status} — ${JSON.stringify(envelope.status ?? envelope)}`,
    );
  }

  return (envelope.payload ?? envelope) as T;
}

async function fetchSubmarketMonthlyMetrics<K extends string>(
  submarketId: string,
  numMonths: number,
  metricKey: K,
  filterListingType: boolean,
): Promise<{ metrics: Record<string, number | undefined>[] } & Record<string, unknown>> {
  const pathSeg =
    metricKey === "occupancy_rate"
      ? "/metrics/occupancy"
      : `/metrics/${metricKey === "revpar" ? "revpar" : metricKey}`;
  type Payload = {
    metrics: { date?: string; revpar?: number; adr?: number; occupancy_rate?: number }[];
    [rest: string]: unknown;
  };
  const payload = await airDnaPost<Payload>(
    `/submarket/${encodeURIComponent(submarketId)}${pathSeg}`,
    buildMetricsBody(numMonths, filterListingType),
  );
  const raw = payload.metrics ?? [];
  const mapped = raw.map((row) => {
    const ym = row.date ?? "";
    let v: number | undefined;
    if (metricKey === "revpar") v = row.revpar;
    else if (metricKey === "adr") v = row.adr;
    else v = row.occupancy_rate;
    return { date: ym, [metricKey]: v } as Record<string, string | number | undefined>;
  });
  return {
    ...(payload as object),
    metrics: mapped as Record<string, number | undefined>[],
  } as { metrics: Record<string, number | undefined>[] } & Record<string, unknown>;
}

type SearchHit = {
  id: string | number;
  name?: string;
  type?: string;
  listing_count?: number;
  location_name?: string;
  [key: string]: unknown;
};

async function marketSearchRosemary(term: string): Promise<SearchHit[]> {
  const pageSize = 25;
  const out: SearchHit[] = [];
  let offset = 0;
  for (;;) {
    const payload = await airDnaPost<{ results?: SearchHit[]; page_info?: unknown }>(
      "/market/search",
      {
        search_term: term,
        pagination: { page_size: pageSize, offset },
      },
    );
    const results = payload.results ?? [];
    out.push(...results);
    if (results.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

/** ISO-like local calendar arithmetic (consistent with Month boundaries above). */
function daysInCalendarMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

/**
 * ISO 8601 week-numbering year and ISO week (Mon–Sun), local calendar date.
 * Week 1 is the week with the year's first Thursday (contains Jan 4).
 */
function isoWeekYearAndNumber(d: Date): { isoYear: number; isoWeek: number } {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const isoYear = date.getFullYear();
  const week1 = new Date(isoYear, 0, 4);
  const isoWeek =
    1 +
    Math.round(
      ((date.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getDay() + 6) % 7)) /
        7,
    );
  return { isoYear, isoWeek };
}

/** Prorate one calendar month onto ISO weeks (locked formula — day loop). */
function prorateMonthToWeeklySeries(
  year: number,
  month: number,
  triple: { revpar: number; adr: number; occ: number },
): Map<
  string,
  {
    isoYear: number;
    isoWeek: number;
    benchmark_revpar: number;
    benchmark_adr: number;
    occupancy_weighted: number;
    occupancy_days: number;
  }
> {
  const dim = daysInCalendarMonth(year, month);
  const drRev = triple.revpar / dim;
  const drAdr = triple.adr / dim;

  const weekMap = new Map<
    string,
    {
      isoYear: number;
      isoWeek: number;
      benchmark_revpar: number;
      benchmark_adr: number;
      occupancy_weighted: number;
      occupancy_days: number;
    }
  >();

  for (let dom = 1; dom <= dim; dom++) {
    const dt = new Date(year, month - 1, dom);
    const { isoYear, isoWeek } = isoWeekYearAndNumber(dt);
    const key = `${isoYear}:${isoWeek}`;
    let cur = weekMap.get(key);
    if (!cur) {
      cur = {
        isoYear,
        isoWeek,
        benchmark_revpar: 0,
        benchmark_adr: 0,
        occupancy_weighted: 0,
        occupancy_days: 0,
      };
      weekMap.set(key, cur);
    }
    cur.benchmark_revpar += drRev;
    cur.benchmark_adr += drAdr;
    cur.occupancy_weighted += triple.occ;
    cur.occupancy_days += 1;
  }

  return weekMap;
}

function mergeWeekMaps(into: Map<string, WeeklyRowAgg>, delta: Map<string, WeeklyRowAgg>): void {
  for (const [k, row] of delta) {
    const cur = into.get(k);
    if (!cur) {
      into.set(k, { ...row });
    } else {
      cur.benchmark_revpar += row.benchmark_revpar;
      cur.benchmark_adr += row.benchmark_adr;
      cur.occupancy_weighted += row.occupancy_weighted;
      cur.occupancy_days += row.occupancy_days;
    }
  }
}

type WeeklyRowAgg = {
  isoYear: number;
  isoWeek: number;
  benchmark_revpar: number;
  benchmark_adr: number;
  occupancy_weighted: number;
  occupancy_days: number;
};

function parseYm(ym: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** Month before today's calendar month in local TZ. */
function lastCompletedCalendarMonth(now = new Date()): { year: number; month: number } {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** YYYYMM integer for lexical compare of chronological months. */
function ymKey(y: number, m: number): number {
  return y * 100 + m;
}

function ymString(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}

async function probeBenchmarkColumns(sb: SupabaseClient): Promise<{
  adrColumn: "benchmark_adr";
  occupancyColumn: "benchmark_occupancy" | "benchmark_occ";
}> {
  const { error: eAdr } = await sb.from("market_benchmarks").select("benchmark_adr").limit(1);
  if (eAdr) {
    console.error(
      [
        "",
        'Column "benchmark_adr" is not readable from market_benchmarks — apply migration, then rerun:',
        "",
        "  ALTER TABLE market_benchmarks ADD COLUMN IF NOT EXISTS benchmark_adr numeric;",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  const { error: eOccCanonical } = await sb
    .from("market_benchmarks")
    .select("benchmark_occupancy")
    .limit(1);
  if (!eOccCanonical) {
    return { adrColumn: "benchmark_adr", occupancyColumn: "benchmark_occupancy" };
  }

  const { error: eOccLegacy } = await sb
    .from("market_benchmarks")
    .select("benchmark_occ")
    .limit(1);
  if (!eOccLegacy) {
    return { adrColumn: "benchmark_adr", occupancyColumn: "benchmark_occ" };
  }

  console.error(
    [
      "",
      "Neither benchmark_occupancy nor benchmark_occ exists — apply migration:",
      "",
      '  ALTER TABLE market_benchmarks ADD COLUMN IF NOT EXISTS benchmark_occupancy numeric;',
      "",
      "Then rerun.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

function normalizeSubmarketId(raw: string): string | null {
  const t = raw.trim();
  if (!t || /^TBD_/i.test(t)) return null;
  return t;
}

async function getAirdnaSubmarketForMarket(
  sb: SupabaseClient,
  marketId: string,
): Promise<string> {
  const { data, error } = await sb
    .from("markets")
    .select("airdna_market_id")
    .eq("id", marketId)
    .maybeSingle<{ airdna_market_id: string | null }>();

  if (error) {
    throw new Error(`Failed to read markets.airdna_market_id: ${error.message}`);
  }

  const id = normalizeSubmarketId(String(data?.airdna_market_id ?? ""));
  if (!id) {
    console.error("airdna_market_id not set for this market. Run --mode search first.");
    process.exit(1);
  }
  return id;
}

async function runSearch(cli: Cli, sb: SupabaseClient): Promise<void> {
  const term = "Rosemary Beach";
  console.log(`POST ${BASE_URL}/market/search — search_term: "${term}"\n`);

  const results = await marketSearchRosemary(term);
  console.log(`Total flattened results (${results.length}). Full list:\n`);
  for (let i = 0; i < results.length; i++) {
    console.log(
      `${String(i + 1).padStart(3)}. ${JSON.stringify({
        id: results[i]?.id,
        type: results[i]?.type,
        name: results[i]?.name,
        location_name: results[i]?.location_name,
      })}`,
    );
  }

  const cand = results.filter((r) => String(r.type ?? "").toLowerCase() === "submarket");

  type Scored = { hit: SearchHit; score: number };
  const scored: Scored[] = [];
  for (const hit of cand) {
    const n = String(hit.name ?? "").toLowerCase();
    const rosemary = n.includes("rosemary beach");
    const thirty = n.includes("30a");
    if (!(rosemary || thirty)) continue;
    // Prefer Rosemary Beach substring; break ties toward higher score.
    let score = 0;
    if (rosemary) score += 200;
    else if (thirty) score += 100;
    scored.push({ hit, score });
  }

  scored.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : String(a.hit.name ?? "").localeCompare(String(b.hit.name ?? "")),
  );
  const pick = scored[0]?.hit ?? null;
  if (!pick) {
    console.error(
      "\nNo submarket matched (type=submarket and name containing “Rosemary Beach” or “30A”). Inspect the log above.\n",
    );
    process.exit(1);
  }

  const idStr = String(pick.id).trim();
  console.log("\nSelected submarket (auto-pick; verify visually above):");
  console.log(JSON.stringify({ id: idStr, type: pick.type, name: pick.name }, null, 2));

  await sb.from("markets").update({ airdna_market_id: idStr }).eq("id", cli.market);

  console.log("");
  console.log(`Stored markets.airdna_market_id=${idStr} WHERE id=${JSON.stringify(cli.market)}`);
  console.log("(SQL equivalent:)");
  console.log(
    `  UPDATE markets SET airdna_market_id = '${idStr}' WHERE id = '${cli.market.toLowerCase()}';`,
  );
}

function numMonthsForMode(mode: "dry-run" | "seed" | "refresh"): number {
  if (mode === "dry-run") return 36;
  // Seed must reach Jan 2023 from “current” LC month; docs allow up to 60 months.
  if (mode === "seed") return 60;
  return 24;
}

async function ingestMetricsModes(
  cli: Cli,
  sb: SupabaseClient,
  mode: "dry-run" | "seed" | "refresh",
): Promise<void> {
  const submarketId = await getAirdnaSubmarketForMarket(sb, cli.market);

  const colMap = mode === "dry-run" ? null : await probeBenchmarkColumns(sb);

  const nmonths = numMonthsForMode(mode);
  console.log(
    `Fetching submarket=${submarketId} num_months=${nmonths} filter=${cli.filterListingType ? "entire_place" : "(none)"} …`,
  );

  const [revPayload, adrPayload, occPayload] = await Promise.all([
    fetchSubmarketMonthlyMetrics(submarketId, nmonths, "revpar", cli.filterListingType),
    fetchSubmarketMonthlyMetrics(submarketId, nmonths, "adr", cli.filterListingType),
    fetchSubmarketMonthlyMetrics(submarketId, nmonths, "occupancy_rate", cli.filterListingType),
  ]);

  if (mode === "dry-run") {
    console.log("\n—— Raw revpar payload (JSON) ——\n");
    console.log(JSON.stringify(revPayload, null, 2));
    console.log("\n—— Raw adr payload (JSON) ——\n");
    console.log(JSON.stringify(adrPayload, null, 2));
    console.log("\n—— Raw occupancy payload (JSON) ——\n");
    console.log(JSON.stringify(occPayload, null, 2));
  }

  type Point = {
    ym: string;
    revpar: number;
    adr: number;
    occ: number;
  };

  const revMap = new Map<string, number>();
  for (const row of revPayload.metrics ?? []) {
    const ym = String(row.date ?? "");
    const v = row.revpar as number | undefined;
    if (ym && typeof v === "number" && !Number.isNaN(v)) revMap.set(ym, v);
  }
  const adrMap = new Map<string, number>();
  for (const row of adrPayload.metrics ?? []) {
    const ym = String(row.date ?? "");
    const v = row.adr as number | undefined;
    if (ym && typeof v === "number" && !Number.isNaN(v)) adrMap.set(ym, v);
  }
  const occMap = new Map<string, number>();
  for (const row of occPayload.metrics ?? []) {
    const ym = String(row.date ?? "");
    const v = row.occupancy_rate as number | undefined;
    if (ym && typeof v === "number" && !Number.isNaN(v)) occMap.set(ym, v);
  }

  const ymSet = new Set([...revMap.keys(), ...adrMap.keys(), ...occMap.keys()]);
  const onlyRev = [...ymSet].filter((k) => !adrMap.has(k) || !occMap.has(k));
  if (onlyRev.length > 0) {
    console.warn(
      `\n[WARN] ${onlyRev.length} month keys missing adr and/or occupancy; they will be skipped for proration.`,
    );
  }

  const triples: Point[] = [];
  for (const ym of [...ymSet].sort()) {
    const rp = revMap.get(ym);
    const ad = adrMap.get(ym);
    const oc = occMap.get(ym);
    if (rp === undefined || ad === undefined || oc === undefined) continue;
    triples.push({ ym, revpar: rp, adr: ad, occ: oc });
  }

  const lc = lastCompletedCalendarMonth();
  const lcKey = ymKey(lc.year, lc.month);

  const SEED_YEAR_START = 2023;
  const seedYearUpper = lc.year;

  function monthAllowedSeed(ym: string): boolean {
    const p = parseYm(ym);
    if (!p) return false;
    const key = ymKey(p.year, p.month);
    if (key > lcKey) return false;
    const y = p.year;
    const m = p.month;

    const inDefaultRange =
      y >= SEED_YEAR_START &&
      y <= seedYearUpper &&
      !(y === seedYearUpper && m > lc.month);

    if (!inDefaultRange) return false;

    if (cli.year !== undefined && y !== cli.year) return false;
    return true;
  }

  function monthAllowedRefresh(ym: string): boolean {
    const p = parseYm(ym);
    if (!p) return false;
    return p.year === lc.year && p.month === lc.month;
  }

  const mergedWeeks = new Map<string, WeeklyRowAgg>();
  const triplesFiltered: Point[] = [];

  if (mode === "refresh") {
    for (const t of triples) {
      if (!monthAllowedRefresh(t.ym)) continue;
      triplesFiltered.push(t);
    }
  } else if (mode === "seed") {
    for (const t of triples) {
      if (!monthAllowedSeed(t.ym)) continue;
      triplesFiltered.push(t);
    }
    if (triplesFiltered.length === 0 && triples.length > 0) {
      console.error(
        "Seed produced no overlapping completed months — check lc window / API range vs 2023+.",
      );
    }
  } else {
    // dry-run: same completed-month window as eventual seed would use (canonical behaviour).
    for (const t of triples) {
      if (!monthAllowedSeed(t.ym)) continue;
      triplesFiltered.push(t);
    }
  }

  for (const t of triplesFiltered) {
    const p = parseYm(t.ym);
    if (!p) continue;
    const wm = prorateMonthToWeeklySeries(p.year, p.month, {
      revpar: t.revpar,
      adr: t.adr,
      occ: t.occ,
    });
    mergeWeekMaps(mergedWeeks, wm);
  }

  const sortedWeekEntries = [...mergedWeeks.entries()].sort(
    ([, ra], [, rb]) =>
      ra.isoYear !== rb.isoYear ? ra.isoYear - rb.isoYear : ra.isoWeek - rb.isoWeek,
  );

  /** One market_benchmarks upsert row; DB may use benchmark_occupancy instead of benchmark_occ. */
  type BenchRowCore = {
    market_id: string;
    year: number;
    week_number: number;
    benchmark_revpar: number;
    benchmark_adr: number;
    benchmark_occ: number;
    data_source: string;
    granularity: string;
    source: string;
  };

  const upsertBodies: BenchRowCore[] = [];

  for (const [, row] of sortedWeekEntries) {
    if (!row) continue;
    const occDays = row.occupancy_days;
    upsertBodies.push({
      market_id: cli.market.toLowerCase(),
      year: row.isoYear,
      week_number: row.isoWeek,
      benchmark_revpar: Math.round(row.benchmark_revpar * 100) / 100,
      benchmark_adr: Math.round(row.benchmark_adr * 100) / 100,
      benchmark_occ:
        occDays > 0
          ? Math.round((row.occupancy_weighted / occDays) * 100) / 100
          : 0,
      data_source: "airdna",
      granularity: "monthly_prorated",
      source: "airdna_api",
    });
  }

  function isValidBenchmarkYearWeek(year: unknown, weekNumber: unknown): boolean {
    const y = Number(year);
    const w = Number(weekNumber);
    if (!Number.isFinite(y) || !Number.isFinite(w)) return false;
    if (!Number.isInteger(y) || !Number.isInteger(w)) return false;
    if (y < 1900 || y > 3000) return false;
    return w >= 1 && w <= 53;
  }

  function partitionBenchmarkRows(rows: BenchRowCore[]): {
    ok: BenchRowCore[];
    invalid: BenchRowCore[];
  } {
    const invalid: BenchRowCore[] = [];
    const ok: BenchRowCore[] = [];
    for (const r of rows) {
      if (isValidBenchmarkYearWeek(r.year, r.week_number)) ok.push(r);
      else invalid.push(r);
    }
    return { ok, invalid };
  }

  const { ok: rowsToUpsert, invalid: invalidBenchmarkRows } =
    partitionBenchmarkRows(upsertBodies);

  if (invalidBenchmarkRows.length > 0) {
    console.warn(
      `\n[benchmark row validation] Excluding ${invalidBenchmarkRows.length} row(s): year not a finite integer (1900–3000), or week_number not an integer in 1–53.`,
    );
    for (const r of invalidBenchmarkRows) {
      console.warn(JSON.stringify(r));
    }
  }

  /** Map canonical row to PostgREST column name for occupancy. */
  function rowForUpsert(r: BenchRowCore, occupancyColumn: "benchmark_occ" | "benchmark_occupancy"): Record<
    string,
    unknown
  > {
    const year = Number(r.year);
    const week_number = Number(r.week_number);

    if (occupancyColumn === "benchmark_occ") {
      return { ...r, year, week_number };
    }

    const { benchmark_occ: benchmark_occupancy, ...rest } = r;
    return { ...rest, year, week_number, benchmark_occupancy };
  }

  console.log("");
  console.log(
    `Prorated ISO-week rows (${upsertBodies.length}) ` +
      (mode === "refresh"
        ? `for LC month ${lc.year}-${String(lc.month).padStart(2, "0")} only`
        : mode === "dry-run"
          ? "(dry-run / same completed-month eligibility as seed)"
          : "") +
      (invalidBenchmarkRows.length > 0
        ? ` — ${invalidBenchmarkRows.length} invalid excluded, ${rowsToUpsert.length} eligible for upsert`
        : ""),
  );
  console.log("First 5 prorated rows that would be written:");
  console.log(JSON.stringify(rowsToUpsert.slice(0, 5), null, 2));

  if (mode === "dry-run") {
    console.log("\nDry-run finished — no database writes.");
    return;
  }

  const occCol = colMap!.occupancyColumn;
  const BATCH = 100;
  let written = 0;
  let batchIdx = 0;
  const errors: string[] = [];
  let seedNextLogCheckpoint = mode === "seed" ? 10 : 0;

  while (batchIdx < rowsToUpsert.length) {
    const slice = rowsToUpsert.slice(batchIdx, batchIdx + BATCH);
    const rows = slice.map((r) => rowForUpsert(r, occCol));
    batchIdx += slice.length;

    const { error } = await sb.from("market_benchmarks").upsert(rows, {
      onConflict: "market_id, week_number, year, source",
    });

    if (error) {
      const msg = `batch @${written}: ${error.message}`;
      errors.push(msg);
      console.error(msg);
    } else {
      written += slice.length;
      if (mode === "seed") {
        while (seedNextLogCheckpoint <= written) {
          console.log(`… seed progress: ${seedNextLogCheckpoint} rows written`);
          seedNextLogCheckpoint += 10;
        }
      }
    }
  }

  console.log("");
  console.log(`── ingest-airdna (${mode}) summary ──`);

  console.log(`Total prorated rows (pre-validation): ${upsertBodies.length}`);
  if (invalidBenchmarkRows.length > 0) {
    console.log(`Rows excluded by validation: ${invalidBenchmarkRows.length}`);
  }
  console.log(`Total rows upsert attempted: ${rowsToUpsert.length}`);
  console.log(`Total rows acknowledged by upserts: ${written}`);
  if (sortedWeekEntries.length > 0) {
    const ra = sortedWeekEntries[0][1];
    const rb = sortedWeekEntries[sortedWeekEntries.length - 1][1];
    console.log(
      `Approx. ISO-week span (min/max week-year): ${ra.isoYear}-W${String(ra.isoWeek).padStart(2, "0")} … ${rb.isoYear}-W${String(rb.isoWeek).padStart(2, "0")}`,
    );
  }

  console.log(`Last completed calendar month enforced: ${ymString(lc.year, lc.month)}`);
  if (errors.length) {
    console.log(`Errors (${errors.length}):`);
    errors.forEach((e) => console.log(`  - ${e}`));
  } else {
    console.log("Errors: none");
  }
}

async function main(): Promise<void> {
  let cli: Cli;
  try {
    cli = parseArgv(process.argv);
  } catch (e) {
    console.error((e as Error).message ?? e);
    process.exit(1);
    return;
  }

  if (!cli.mode) {
    console.error("Missing --mode (search | dry-run | seed | refresh).");
    process.exit(1);
  }

  if (cli.year !== undefined && cli.mode !== "seed") {
    console.error("--year may only be used with --mode seed.");
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    console.error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (use .env.local or shell env).",
    );
    process.exit(1);
  }

  const sb = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  switch (cli.mode) {
    case "search":
      await runSearch(cli, sb);
      break;
    case "dry-run":
      await ingestMetricsModes(cli, sb, "dry-run");
      break;
    case "refresh":
      await ingestMetricsModes(cli, sb, "refresh");
      break;
    case "seed":
      await ingestMetricsModes(cli, sb, "seed");
      break;
    default: {
      const _exhaustive: never = cli.mode;
      console.error(`Unknown mode: ${_exhaustive}`);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
