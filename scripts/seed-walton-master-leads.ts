/**
 * One-time seed: Walton County master leads CSV → public.str_leads.
 *
 * Env (same dotenv pattern as seed-str-leads.ts):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Run:
 *   npx ts-node scripts/seed-walton-master-leads.ts
 *   npx ts-node scripts/seed-walton-master-leads.ts --file ./path/to/file.csv
 *
 * Upsert prerequisite: UNIQUE index on non-null parcel_id (see migrations).
 */

import * as fs from "fs";
import * as path from "path";
import { config as loadEnv } from "dotenv";
import Papa from "papaparse";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
loadEnv({ path: path.join(ROOT, ".env.local") });
loadEnv({ path: path.join(ROOT, ".env") });

const DEFAULT_CSV_REL = "walton_county_master_leads.csv";

function parseCsvPath(argv: string[]): string {
  let file: string | undefined;
  const scriptIdx = argv.findIndex((a) =>
    /seed-walton-master-leads\.(ts|cjs|js|mts)$/i.test(a),
  );
  const start = scriptIdx >= 0 ? scriptIdx + 1 : 2;

  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--file requires a CSV path");
      }
      file = next;
      i += 1;
      continue;
    }
    if (a.startsWith("--file=")) {
      file = a.slice("--file=".length).trim();
      if (!file) throw new Error("--file= requires a non-empty path");
      continue;
    }
  }

  return path.resolve(ROOT, file ?? DEFAULT_CSV_REL);
}

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

function parseHomestead(raw: string): boolean | null {
  const t = raw.trim().toUpperCase();
  if (t === "TRUE") return true;
  if (t === "FALSE") return false;
  return null;
}

/** Maps CSV-ish labels → str_leads.entity_subtype CHECK values. */
function normalizeEntitySubtype(raw: string): string | null {
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

function ownerNameHasADU(name: string): boolean {
  return /(\(ADU\)|\[ADU\])/i.test(name);
}

function compareStrPermitDescending(a: string, b: string): number {
  return b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" });
}

type MappedLead = Record<string, unknown>;

function csvRowToLead(m: Map<string, string>): MappedLead | null {
  const parcelId = getCol(m, "parcel_id").trim();
  if (!parcelId) {
    return null;
  }

  const ownerTypeRaw = getCol(m, "owner_type").trim().toLowerCase();
  const owner_type =
    ownerTypeRaw === "entity" ? "entity" : ownerTypeRaw === "individual" ? "individual" : null;
  if (!owner_type) {
    console.warn(`[skip] parcel_id=${parcelId} — invalid owner_type "${ownerTypeRaw}"`);
    return null;
  }

  const strPermitNum = getCol(m, "str_permit_number") || null;
  const homesteadRaw = getCol(m, "homestead_exempt").trim();
  let homestead_exempt = false;
  if (homesteadRaw !== "") {
    const parsed = parseHomestead(homesteadRaw);
    if (parsed === null) {
      console.warn(
        `[warn] parcel_id=${parcelId} — unknown homestead_exempt="${homesteadRaw}", using false`,
      );
    } else {
      homestead_exempt = parsed;
    }
  }

  const statusRaw = getCol(m, "str_permit_status").trim().toLowerCase();
  const permittedStatus = ["active", "expired", "suspended"];
  let str_permit_status =
    permittedStatus.includes(statusRaw) ? statusRaw : "";
  if (!str_permit_status) {
    console.warn(
      `[warn] parcel_id=${parcelId} — unknown str_permit_status "${getCol(m, "str_permit_status")}", defaulting active`,
    );
    str_permit_status = "active";
  }

  const row: MappedLead = {
    parcel_id: parcelId,
    str_permit_number: strPermitNum,
    str_permit_status,
    owner_contact_name: getCol(m, "owner_name_raw") || null,
    city: normEmpty(getCol(m, "property_city")),
    zip: normEmpty(getCol(m, "property_zip")),
    str_permit_area: normEmpty(getCol(m, "str_permit_area")),
    owner_type,
    homestead_exempt,
    lead_source: "foia_county_registry",
    market_id: "30a",
    lead_status: "new",
    updated_at: new Date().toISOString(),
  };

  row.entity_govt_source =
    owner_type === "entity" ? "florida_sunbiz" : "walton_county_pa";

  if (owner_type === "entity") {
    const st = normalizeEntitySubtype(getCol(m, "entity_subtype"));
    row.entity_subtype = st;

    row.entity_govt_id = normEmpty(getCol(m, "entity_govt_id"));
    row.entity_registered_agent = normEmpty(getCol(m, "final_contact_name"));

    const street = getCol(m, "contact_street").trim();
    if (street) {
      row.mailing_address = buildAddress([
        street,
        getCol(m, "contact_city").trim(),
        [getCol(m, "contact_state").trim(), getCol(m, "contact_zip").trim()]
          .filter(Boolean)
          .join(" ")
          .trim(),
      ]);
    } else {
      row.mailing_address = null;
    }
  } else {
    row.entity_subtype = null;
    row.entity_govt_id = null;
    row.entity_registered_agent = null;

    const mstreet = getCol(m, "mailing_street").trim();
    if (mstreet) {
      row.mailing_address = buildAddress([
        mstreet,
        getCol(m, "mailing_city").trim(),
        [getCol(m, "mailing_state").trim(), getCol(m, "mailing_zip").trim()]
          .filter(Boolean)
          .join(" ")
          .trim(),
      ]);
    } else {
      row.mailing_address = null;
    }
  }

  return row;
}

function normEmpty(v: string): string | null {
  const t = v.trim();
  return t === "" ? null : t;
}

function buildAddress(parts: string[]): string {
  const [a, b, c] = parts;
  return [a, b, c].filter((x) => x && x.trim() !== "").join(", ");
}

/**
 * Dedupe duplicate parcel_ids: prefer non-ADU name, then higher str_permit_number.
 */
function dedupeParcelRows(
  rows: MappedLead[],
): { winners: MappedLead[]; duplicatesDropped: number } {
  const byParcel = new Map<string, MappedLead[]>();
  for (const r of rows) {
    const pid = String(r.parcel_id ?? "").trim();
    if (!pid) continue;
    const list = byParcel.get(pid) ?? [];
    list.push(r);
    byParcel.set(pid, list);
  }

  let duplicatesDropped = 0;
  const winners: MappedLead[] = [];

  for (const [parcelId, group] of byParcel) {
    if (group.length === 1) {
      winners.push(group[0]);
      continue;
    }

    const withAdU = group.filter((r) => ownerNameHasADU(String(r.owner_contact_name ?? "")));
    const withoutAdU = group.filter((r) => !ownerNameHasADU(String(r.owner_contact_name ?? "")));
    const pool =
      withoutAdU.length > 0 && withAdU.length > 0 ? withoutAdU : [...group];

    const sorted = [...pool].sort((x, y) =>
      compareStrPermitDescending(
        String(x.str_permit_number ?? "").trim(),
        String(y.str_permit_number ?? "").trim(),
      ),
    );

    const winner = sorted[0];
    winners.push(winner);

    for (const r of group) {
      if (r === winner) continue;
      duplicatesDropped += 1;
      console.log(
        `[duplicate parcel_id=${parcelId}] dropped str_permit_number=${JSON.stringify(String(r.str_permit_number ?? ""))} owner_contact_name=${JSON.stringify(String(r.owner_contact_name ?? ""))}`,
      );
    }
  }

  return { winners, duplicatesDropped };
}

async function main(): Promise<void> {
  const csvPath = parseCsvPath(process.argv);
  console.log(`CSV: ${csvPath}`);

  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
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

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const text = fs.readFileSync(csvPath, "utf8");
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  if (parsed.errors.length > 0) {
    console.warn("papaparse warnings:", parsed.errors.slice(0, 5));
  }

  const totalRowsInSourceFile = parsed.data.length;
  const mapped: MappedLead[] = [];

  let skippedMapping = 0;
  for (const rec of parsed.data) {
    const m = normHeaderMap(rec);
    const lead = csvRowToLead(m);
    if (!lead) {
      skippedMapping += 1;
      continue;
    }
    mapped.push(lead);
  }

  const { winners, duplicatesDropped } = dedupeParcelRows(mapped);
  const BATCH = 100;
  let upsertedSuccessful = 0;
  let cumulativeUpsertAttempts = 0;
  let nextProgressAt = 500;
  const errors: string[] = [];

  for (let i = 0; i < winners.length; i += BATCH) {
    const batch = winners.slice(i, i + BATCH);
    cumulativeUpsertAttempts += batch.length;
    const { error } = await supabase.from("str_leads").upsert(batch, {
      onConflict: "parcel_id",
      ignoreDuplicates: false,
    });

    if (error) {
      const msg = `batch offset ${i}: ${error.message}`;
      errors.push(msg);
      console.error(msg);
    } else {
      upsertedSuccessful += batch.length;
    }

    if (cumulativeUpsertAttempts >= nextProgressAt || i + BATCH >= winners.length) {
      console.log(
        `… upsert progress: ${cumulativeUpsertAttempts} / ${winners.length} rows attempted`,
      );
      while (nextProgressAt <= cumulativeUpsertAttempts) nextProgressAt += 500;
    }
  }

  console.log("\n── seed-walton-master-leads summary ──");
  console.log(`Total rows in source file: ${totalRowsInSourceFile}`);
  console.log(`Rows after deduplication: ${winners.length}`);
  console.log(`Rows successfully upserted: ${upsertedSuccessful}`);
  console.log(`Rows skipped (duplicates dropped): ${duplicatesDropped}`);
  if (skippedMapping > 0) {
    console.log(`Rows skipped (invalid/missing parcel or owner_type): ${skippedMapping}`);
  }
  if (errors.length > 0) {
    console.log(`Errors (${errors.length}):`);
    errors.forEach((e) => console.log(`  - ${e}`));
  } else {
    console.log("Errors: none");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
