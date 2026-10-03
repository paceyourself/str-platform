/**
 * One-time bridge load: Mystic Hideaway Projection 2026.xlsx →
 * public.pm_forecasts + public.pm_forecast_weeks (Row 157, Sprint 23).
 *
 * Sheets: Hideaway, Mystic. Data rows 2–53 (52 ISO weeks). Row 55 totals ignored.
 * Blank and explicit-zero Projected Nights both load as 0.
 * projected_total_rent is NOT stored — compute at query time as rate * nights.
 *
 * Env (load from .env.local via dotenv):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Run:
 *   npx ts-node scripts/one-time/load-oversee-2026-projection.ts
 *   npx ts-node scripts/one-time/load-oversee-2026-projection.ts --file "./path/to/Mystic Hideaway Projection 2026.xlsx"
 *
 * Safety: refuses if pm_forecasts is non-empty, or if either target property
 * already has a header with label "Oversee 2026 Projection".
 * Test Cottage is never loaded.
 */

import * as fs from "fs";
import * as path from "path";
import { config as loadEnv } from "dotenv";
import pkg from "xlsx";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const { readFile, utils, SSF } = pkg;

const ROOT = process.cwd();
loadEnv({ path: path.join(ROOT, ".env.local") });
loadEnv({ path: path.join(ROOT, ".env") });

const FORECAST_LABEL = "Oversee 2026 Projection";
const SOURCE_NOTES =
  "One-time bridge load from Mystic Hideaway Projection 2026.xlsx (Row 157, Sprint 23)";
const OWNER_ID = "20dd808a-a31c-4d01-bd73-52e41f07ca79";
const PM_ID = "fe991b0b-7219-4e70-9351-82fe6e09ff31";
const FORECAST_YEAR = 2026;
const FORECAST_TYPE = "original";

const DEFAULT_XLSX_REL = path.join(
  "scripts",
  "one-time",
  "Mystic Hideaway Projection 2026.xlsx",
);

type Target = {
  sheet: "Hideaway" | "Mystic";
  property_id: string;
  owner_pm_relationship_id: string;
};

/** Explicit targets only — do not select by PM or all relationships. */
const TARGETS: Target[] = [
  {
    sheet: "Hideaway",
    property_id: "6a6f825a-4a63-4fb5-8e74-9e257842d5b8",
    owner_pm_relationship_id: "60491586-341a-4b59-8ec4-9c004fa0e298",
  },
  {
    sheet: "Mystic",
    property_id: "b4cb704f-53b5-478a-9775-7ac7e9319eba",
    owner_pm_relationship_id: "c8647ade-2d07-4d3e-b232-6aca5c3192c2",
  },
];

type WeekRow = {
  week_start_date: string;
  projected_nightly_rate: number;
  projected_nights: number;
};

function parseFileArg(argv: string[]): string {
  const scriptIdx = argv.findIndex((a) =>
    /load-oversee-2026-projection\.(ts|cjs|js|mts)$/i.test(a),
  );
  const start = scriptIdx >= 0 ? scriptIdx + 1 : 2;
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--file requires a path");
      }
      return path.isAbsolute(next) ? next : path.join(ROOT, next);
    }
    if (a.startsWith("--file=")) {
      const v = a.slice("--file=".length).trim();
      if (!v) throw new Error("--file= requires a path");
      return path.isAbsolute(v) ? v : path.join(ROOT, v);
    }
  }
  return path.join(ROOT, DEFAULT_XLSX_REL);
}

function excelSerialToIsoDate(serial: number): string {
  const d = SSF.parse_date_code(serial);
  if (!d) {
    throw new Error(`Unable to parse Excel date serial: ${serial}`);
  }
  const y = d.y;
  const m = String(d.m).padStart(2, "0");
  const day = String(d.d).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function coerceNights(raw: unknown): number {
  // Blank and explicit-zero both load as 0.
  if (raw === null || raw === undefined || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 7 || !Number.isInteger(n)) {
    throw new Error(`Invalid projected_nights value: ${JSON.stringify(raw)}`);
  }
  return n;
}

function coerceRate(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid projected_nightly_rate value: ${JSON.stringify(raw)}`);
  }
  return Math.round(n * 100) / 100;
}

function readSheetWeeks(
  workbookPath: string,
  sheetName: "Hideaway" | "Mystic",
): WeekRow[] {
  const wb = readFile(workbookPath);
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    throw new Error(`Sheet "${sheetName}" not found in ${workbookPath}`);
  }
  const rows = utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: null,
    raw: true,
  });

  // Rows 2–53 inclusive (1-indexed) → indices 1..52. Ignore row 55 (index 54).
  const weeks: WeekRow[] = [];
  for (let i = 1; i <= 52; i++) {
    const row = rows[i];
    if (!row) {
      throw new Error(`${sheetName}: missing data row ${i + 1}`);
    }
    const dateSerial = row[1];
    if (typeof dateSerial !== "number") {
      throw new Error(
        `${sheetName} row ${i + 1}: expected Excel date serial in column B, got ${JSON.stringify(dateSerial)}`,
      );
    }
    weeks.push({
      week_start_date: excelSerialToIsoDate(dateSerial),
      projected_nightly_rate: coerceRate(row[2]),
      projected_nights: coerceNights(row[3]),
    });
  }
  if (weeks.length !== 52) {
    throw new Error(`${sheetName}: expected 52 weeks, got ${weeks.length}`);
  }
  return weeks;
}

async function assertSafeToLoad(supabase: SupabaseClient): Promise<void> {
  const { count, error } = await supabase
    .from("pm_forecasts")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(`pm_forecasts count failed: ${error.message}`);
  if ((count ?? 0) > 0) {
    throw new Error(
      `Refuse: pm_forecasts is non-empty (count=${count}). Aborting bridge load.`,
    );
  }

  const propertyIds = TARGETS.map((t) => t.property_id);
  const { data: existing, error: labelErr } = await supabase
    .from("pm_forecasts")
    .select("id, property_id, forecast_label")
    .in("property_id", propertyIds)
    .eq("forecast_label", FORECAST_LABEL);
  if (labelErr) {
    throw new Error(`Label preflight failed: ${labelErr.message}`);
  }
  if (existing && existing.length > 0) {
    throw new Error(
      `Refuse: target already has header "${FORECAST_LABEL}": ${JSON.stringify(existing)}`,
    );
  }
}

async function insertForecast(
  supabase: SupabaseClient,
  target: Target,
  weeks: WeekRow[],
): Promise<string> {
  const { data: header, error: headerErr } = await supabase
    .from("pm_forecasts")
    .insert({
      owner_pm_relationship_id: target.owner_pm_relationship_id,
      property_id: target.property_id,
      pm_id: PM_ID,
      owner_id: OWNER_ID,
      forecast_year: FORECAST_YEAR,
      forecast_type: FORECAST_TYPE,
      forecast_label: FORECAST_LABEL,
      forecast_adr: null,
      forecast_occ: null,
      forecast_revpar: null,
      forecast_gross_revenue: null,
      forecast_net_owner_revenue: null,
      actuals_through_date: null,
      is_owner_selected: true,
      entered_by: OWNER_ID,
      source_notes: SOURCE_NOTES,
    })
    .select("id")
    .single();

  if (headerErr || !header?.id) {
    throw new Error(
      `Insert pm_forecasts (${target.sheet}) failed: ${headerErr?.message ?? "no id"}`,
    );
  }

  const weekPayload = weeks.map((w) => ({
    pm_forecast_id: header.id as string,
    week_start_date: w.week_start_date,
    projected_nightly_rate: w.projected_nightly_rate,
    projected_nights: w.projected_nights,
  }));

  const { error: weekErr } = await supabase
    .from("pm_forecast_weeks")
    .insert(weekPayload);
  if (weekErr) {
    throw new Error(
      `Insert pm_forecast_weeks (${target.sheet}) failed: ${weekErr.message}`,
    );
  }

  return header.id as string;
}

async function main(): Promise<void> {
  const filePath = parseFileArg(process.argv);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Workbook not found: ${filePath}`);
  }

  const url =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await assertSafeToLoad(supabase);

  const parsed = TARGETS.map((t) => ({
    target: t,
    weeks: readSheetWeeks(filePath, t.sheet),
  }));

  console.log(`Workbook: ${filePath}`);
  console.log(`Label: ${FORECAST_LABEL}`);
  for (const { target, weeks } of parsed) {
    const nights = weeks.reduce((s, w) => s + w.projected_nights, 0);
    const rent = weeks.reduce(
      (s, w) => s + w.projected_nightly_rate * w.projected_nights,
      0,
    );
    console.log(
      `  ${target.sheet}: ${weeks.length} weeks, nights=${nights}, rate*nights=${rent}`,
    );
  }

  for (const { target, weeks } of parsed) {
    const id = await insertForecast(supabase, target, weeks);
    console.log(`Inserted ${target.sheet} header ${id}`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
