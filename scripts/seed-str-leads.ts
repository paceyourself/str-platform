/**
 * One-time seed: Walton FOIA xlsx (Entity/LLC only) + Sunbiz-enriched CSV → public.str_leads.
 *
 * Env (load from .env.local via dotenv, or export before running):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Run:
 *   npx ts-node scripts/seed-str-leads.ts
 *   npx ts-node scripts/seed-str-leads.ts --foia ./Walton_County_STR_Registry.xlsx --enriched ./walton.csv
 *
 * Prerequisites:
 *   - FOIA workbook + enriched CSV (defaults: project root filenames below)
 *   - Migration applied: partial UNIQUE index on str_leads(parcel_id) for upsert.
 */

import * as fs from "fs";
import * as path from "path";
import { config as loadEnv } from "dotenv";
import Papa from "papaparse";
import pkg from "xlsx";
const { readFile, utils } = pkg;
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
loadEnv({ path: path.join(ROOT, ".env.local") });
loadEnv({ path: path.join(ROOT, ".env") });

const DEFAULT_FOIA_REL = "Walton_County_STR_Registry.xlsx";
const DEFAULT_ENRICHED_REL = "walton_county_llc_enriched_clean.csv";

/**
 * Parses `--foia <path>` / `--enriched <path>` (or `--foia=<path>`).
 * Relative paths resolve from `process.cwd()`. Omitted flags use defaults under cwd.
 */
function parseCliPaths(argv: string[]): {
  foiaPath: string;
  enrichedPath: string;
} {
  let foia: string | undefined;
  let enriched: string | undefined;

  const seedIdx = argv.findIndex((a) => /seed-str-leads\.(ts|cjs|js|mts)$/i.test(a));
  const start = seedIdx >= 0 ? seedIdx + 1 : 2;

  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--foia") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--foia requires a path (e.g. --foia ./book.xlsx)");
      }
      foia = next;
      i += 1;
      continue;
    }
    if (a === "--enriched") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--enriched requires a path (e.g. --enriched ./file.csv)");
      }
      enriched = next;
      i += 1;
      continue;
    }
    if (a.startsWith("--foia=")) {
      foia = a.slice("--foia=".length);
      if (!foia) throw new Error("--foia= requires a non-empty path");
      continue;
    }
    if (a.startsWith("--enriched=")) {
      enriched = a.slice("--enriched=".length);
      if (!enriched) throw new Error("--enriched= requires a non-empty path");
      continue;
    }
  }

  const foiaPath = path.resolve(ROOT, foia ?? DEFAULT_FOIA_REL);
  const enrichedPath = path.resolve(ROOT, enriched ?? DEFAULT_ENRICHED_REL);
  return { foiaPath, enrichedPath };
}

const MARKET_ID = "30a";
const LEAD_SOURCE = "walton_county_foia";
const ENTITY_OWNER_TYPE = "entity";
const DEFAULT_LEAD_STATUS = "new";
const ENTITY_GOVT_SOURCE = "florida_sunbiz";

type FoiaRow = {
  parcelId: string;
  strNumber: string;
  ownerName: string;
  city: string;
  zip: string;
  areaRaw: string;
};

type EnrichedRow = {
  parcel_id: string;
  entity_subtype: string;
  sunbiz_doc_number: string;
  contact_street: string;
  contact_city: string;
  contact_state: string;
  contact_zip: string;
};

function normHeaderMap(row: Record<string, unknown>): Map<string, string> {
  const m = new Map<string, string>();
  for (const [k, v] of Object.entries(row)) {
    const key = String(k).trim().toLowerCase();
    m.set(key, v == null ? "" : String(v).trim());
  }
  return m;
}

function getCol(m: Map<string, string>, ...aliases: string[]): string {
  for (const a of aliases) {
    const v = m.get(a.trim().toLowerCase());
    if (v !== undefined && v !== "") return v;
  }
  return "";
}

function ownerHasADU(ownerName: string): boolean {
  return /\(\s*ADU\s*\)/i.test(ownerName);
}

function compareStrNumber(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function pickWinnerForParcel(
  parcelId: string,
  group: FoiaRow[],
): { winner: FoiaRow; losers: FoiaRow[] } {
  const withADU = group.filter((r) => ownerHasADU(r.ownerName));
  const withoutADU = group.filter((r) => !ownerHasADU(r.ownerName));
  const pool =
    withoutADU.length > 0 && withADU.length > 0 ? withoutADU : group;
  const sorted = [...pool].sort((a, b) =>
    compareStrNumber(a.strNumber, b.strNumber),
  );
  const winner = sorted[0];
  const losers = group.filter((r) => r !== winner);
  return { winner, losers };
}

/** Maps enriched subtype labels → str_leads.entity_subtype CHECK values. */
function mapEntitySubtype(raw: string): string | null {
  const n = raw.trim().toLowerCase().replace(/\s+/g, "_");
  const synonyms: Record<string, string> = {
    llc: "llc",
    trust: "trust",
    corporation: "corporation",
    corp: "corporation",
    limited_partnership: "limited_partnership",
    lp: "limited_partnership",
    other: "other",
  };
  return synonyms[n] ?? null;
}

function buildMailingAddress(e: EnrichedRow): string | null {
  const parts = [
    e.contact_street.trim(),
    e.contact_city.trim(),
    [e.contact_state.trim(), e.contact_zip.trim()].filter(Boolean).join(" "),
  ].filter((p) => p !== "");
  if (parts.length === 0) return null;
  return parts.join(", ");
}

function readFoiaEntityRows(foiaPath: string): FoiaRow[] {
  if (!fs.existsSync(foiaPath)) {
    throw new Error(`Missing FOIA workbook: ${foiaPath}`);
  }
  const wb = readFile(foiaPath);
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no sheets.");
  const sheet = wb.Sheets[sheetName];
  const raw = utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });

  const out: FoiaRow[] = [];
  for (const rec of raw) {
    const m = normHeaderMap(rec);
    const ownerType = getCol(m, "owner type", "owner_type");
    if (ownerType.trim().toLowerCase() !== "entity/llc") continue;

    const parcelId = getCol(m, "parcel number", "parcel_number", "parcel id");
    const strNumber = getCol(m, "str number", "str_number", "str permit number");
    const status = getCol(m, "status");
    const ownerName = getCol(m, "owner name", "owner_name");
    const city = getCol(m, "city");
    const zip = getCol(m, "zip", "zip code");
    const areaRaw = getCol(m, "area");

    if (status.trim().toUpperCase() !== "ACTIVE") {
      continue;
    }

    out.push({
      parcelId: parcelId.trim(),
      strNumber: strNumber.trim(),
      ownerName,
      city,
      zip,
      areaRaw: areaRaw.trim(),
    });
  }
  return out;
}

function readEnrichedByParcel(enrichedPath: string): Map<string, EnrichedRow> {
  if (!fs.existsSync(enrichedPath)) {
    throw new Error(`Missing enriched CSV: ${enrichedPath}`);
  }
  const text = fs.readFileSync(enrichedPath, "utf8");
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  if (parsed.errors.length > 0) {
    console.warn("papaparse warnings:", parsed.errors.slice(0, 5));
  }

  const map = new Map<string, EnrichedRow>();
  for (const rec of parsed.data) {
    const m = normHeaderMap(rec);
    const parcelId = getCol(m, "parcel_id", "parcel id", "parcel number");
    if (!parcelId) continue;

    const row: EnrichedRow = {
      parcel_id: parcelId.trim(),
      entity_subtype: getCol(m, "entity_subtype", "entity subtype"),
      sunbiz_doc_number: getCol(m, "sunbiz_doc_number", "sunbiz doc number"),
      contact_street: getCol(m, "contact_street", "contact street"),
      contact_city: getCol(m, "contact_city", "contact city"),
      contact_state: getCol(m, "contact_state", "contact state"),
      contact_zip: getCol(m, "contact_zip", "contact zip"),
    };

    if (map.has(row.parcel_id)) {
      console.warn(
        `[enriched CSV duplicate parcel_id] ${row.parcel_id} — keeping first row`,
      );
      continue;
    }
    map.set(row.parcel_id, row);
  }
  return map;
}

function dedupeFoiaByParcel(rows: FoiaRow[]): {
  winners: FoiaRow[];
  skippedDuplicates: number;
  missingParcelRows: number;
} {
  let missingParcelRows = 0;
  const byParcel = new Map<string, FoiaRow[]>();
  for (const r of rows) {
    if (!r.parcelId.trim()) {
      missingParcelRows += 1;
      console.warn(
        `[skip] FOIA Entity/LLC row missing Parcel Number (STR=${r.strNumber})`,
      );
      continue;
    }
    const list = byParcel.get(r.parcelId) ?? [];
    list.push(r);
    byParcel.set(r.parcelId, list);
  }

  let skippedDuplicates = 0;
  const winners: FoiaRow[] = [];

  for (const [parcelId, group] of byParcel) {
    if (group.length === 1) {
      winners.push(group[0]);
      continue;
    }
    const { winner, losers } = pickWinnerForParcel(parcelId, group);
    for (const loser of losers) {
      skippedDuplicates += 1;
      console.log(
        `[duplicate parcel_id=${parcelId}] skipped STR=${loser.strNumber} Owner="${loser.ownerName}"`,
      );
    }
    winners.push(winner);
  }

  return { winners, skippedDuplicates, missingParcelRows };
}

type UpsertRow = {
  parcel_id: string;
  str_permit_number: string | null;
  str_permit_status: string;
  owner_contact_name: string | null;
  city: string | null;
  zip: string | null;
  str_permit_area: string | null;
  owner_type: string;
  lead_source: string;
  market_id: string;
  lead_status: string;
  updated_at: string;
  entity_subtype?: string;
  entity_govt_source?: string;
  entity_govt_id?: string;
  mailing_address?: string;
};

async function main(): Promise<void> {
  const { foiaPath, enrichedPath } = parseCliPaths(process.argv);
  console.log(`FOIA workbook: ${foiaPath}`);
  console.log(`Enriched CSV:  ${enrichedPath}`);

  const url = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    console.error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (use .env.local or shell env).",
    );
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const enrichedMap = readEnrichedByParcel(enrichedPath);
  const foiaEntity = readFoiaEntityRows(foiaPath);
  const { winners, skippedDuplicates, missingParcelRows } =
    dedupeFoiaByParcel(foiaEntity);

  const payloads: UpsertRow[] = [];
  let areaOtherNullCount = 0;

  const nowIso = new Date().toISOString();

  for (const foia of winners) {
    const areaIsOther = foia.areaRaw.trim().toLowerCase() === "other";
    if (areaIsOther) {
      areaOtherNullCount += 1;
      console.log(
        `[Area=Other] parcel_id=${foia.parcelId} STR=${foia.strNumber} — str_permit_area → NULL`,
      );
    }

    const enriched = enrichedMap.get(foia.parcelId);

    const row: UpsertRow = {
      parcel_id: foia.parcelId,
      str_permit_number: foia.strNumber || null,
      str_permit_status: "active",
      owner_contact_name: foia.ownerName || null,
      city: foia.city || null,
      zip: foia.zip || null,
      str_permit_area: areaIsOther ? null : foia.areaRaw || null,
      owner_type: ENTITY_OWNER_TYPE,
      lead_source: LEAD_SOURCE,
      market_id: MARKET_ID,
      lead_status: DEFAULT_LEAD_STATUS,
      updated_at: nowIso,
    };

    if (enriched) {
      const mailing = buildMailingAddress(enriched);
      if (mailing) row.mailing_address = mailing;

      const doc = enriched.sunbiz_doc_number.trim();
      const mappedSubtype = mapEntitySubtype(enriched.entity_subtype);
      if (doc !== "" || mappedSubtype !== null) {
        row.entity_govt_source = ENTITY_GOVT_SOURCE;
        if (doc !== "") row.entity_govt_id = doc;
        if (mappedSubtype !== null) row.entity_subtype = mappedSubtype;
      }
    }

    payloads.push(row);
  }

  const BATCH = 100;
  let upserted = 0;
  const errors: string[] = [];
  let cumulativeUpserted = 0;
  let nextProgressAt = 500;

  for (let i = 0; i < payloads.length; i += BATCH) {
    const batch = payloads.slice(i, i + BATCH);
    const { error } = await supabase.from("str_leads").upsert(batch, {
      onConflict: "parcel_id",
      ignoreDuplicates: false,
    });

    if (error) {
      const msg = `batch offset ${i}: ${error.message}`;
      console.error(msg);
      errors.push(msg);
    } else {
      upserted += batch.length;
    }

    cumulativeUpserted += batch.length;
    if (cumulativeUpserted >= nextProgressAt || i + BATCH >= payloads.length) {
      console.log(`… upsert progress: ${cumulativeUpserted} / ${payloads.length} rows`);
      while (nextProgressAt <= cumulativeUpserted) nextProgressAt += 500;
    }
  }

  const totalSkippedSpec = skippedDuplicates + areaOtherNullCount;

  console.log("\n── seed-str-leads summary ──");
  console.log(`Total rows processed (upsert attempts): ${payloads.length}`);
  console.log(`Rows inserted/updated (successful upserts): ${upserted}`);
  console.log(
    `Rows skipped (duplicates + Area=Other): ${totalSkippedSpec} (duplicate FOIA losers: ${skippedDuplicates}; Area=Other → NULL: ${areaOtherNullCount})`,
  );
  if (missingParcelRows > 0) {
    console.log(`FOIA rows skipped (missing Parcel Number): ${missingParcelRows}`);
  }
  if (errors.length > 0) {
    console.log(`Errors (${errors.length}):`);
    for (const e of errors) console.log(`  - ${e}`);
  } else {
    console.log("Errors: none");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
