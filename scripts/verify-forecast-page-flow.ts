/**
 * Exercises the forecast page insert/list/error path as the property owner
 * (authenticated client + RLS), matching form submit behavior.
 *
 * Run: npx ts-node scripts/verify-forecast-page-flow.ts
 */

import * as path from "path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  computePmForecastCommitmentMetricsFromBookings,
  formatPmForecastCommitmentDbError,
  type CommitmentBookingRow,
} from "../lib/pm-forecast-commitments";

const ROOT = process.cwd();
loadEnv({ path: path.join(ROOT, ".env.local") });
loadEnv({ path: path.join(ROOT, ".env") });

const PROPERTY_ID = "6a6f825a-4a63-4fb5-8e74-9e257842d5b8";
const OWNER_EMAIL = "louispace@hotmail.com";
const DATE_COMMITTED = "2025-06-01";
const TARGET_DATE = "2025-12-31";
const COMMITTED_AMOUNT = 50000;

function assertClose(label: string, actual: number, expected: number) {
  if (Math.abs(actual - expected) >= 1e-9) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
  console.log(`OK  ${label}: ${actual}`);
}

async function main() {
  const url =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !serviceKey || !anonKey) {
    throw new Error("Missing Supabase URL / service role / anon key");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: linkData, error: linkErr } =
    await admin.auth.admin.generateLink({
      type: "magiclink",
      email: OWNER_EMAIL,
    });
  if (linkErr || !linkData?.properties?.hashed_token) {
    throw new Error(`generateLink failed: ${linkErr?.message}`);
  }

  const { data: otpData, error: otpErr } = await userClient.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "email",
  });
  if (otpErr || !otpData.user) {
    throw new Error(`verifyOtp failed: ${otpErr?.message}`);
  }
  const userId = otpData.user.id;
  console.log(`Authenticated as ${OWNER_EMAIL} (${userId})`);

  // Expected metrics from raw bookings (independent of UI)
  const { data: bookings, error: bErr } = await userClient
    .from("bookings")
    .select("booked_date, check_out, cancelled_at, gross_revenue")
    .eq("property_id", PROPERTY_ID)
    .not("booked_date", "is", null);
  if (bErr) throw new Error(bErr.message);

  const expected = computePmForecastCommitmentMetricsFromBookings(
    (bookings ?? []) as CommitmentBookingRow[],
    {
      property_id: PROPERTY_ID,
      date_committed: DATE_COMMITTED,
      target_date: TARGET_DATE,
      committed_incremental_amount: COMMITTED_AMOUNT,
    },
  );
  console.log("Expected live metrics:", expected);

  // Cross-year insert — must hit DB CHECK and map to friendly copy
  const { error: yearErr } = await userClient
    .from("pm_forecast_commitments")
    .insert({
      property_id: PROPERTY_ID,
      date_committed: "2026-11-01",
      target_date: "2027-03-01",
      committed_incremental_amount: 1000,
      entered_by: userId,
      notes: "cross-year should fail",
    });
  if (!yearErr) {
    throw new Error("Expected same_year_check rejection, but insert succeeded");
  }
  console.log("Raw DB error code:", yearErr.code);
  console.log("Raw DB error message:", yearErr.message);
  const friendly = formatPmForecastCommitmentDbError(yearErr);
  console.log("Friendly form error:", friendly);
  if (
    friendly.includes("violates check constraint") ||
    friendly.includes("23514") ||
    /same_year_check/i.test(friendly)
  ) {
    throw new Error(`Friendly error still exposes Postgres details: ${friendly}`);
  }
  if (!/same calendar year/i.test(friendly)) {
    throw new Error(`Unexpected friendly error: ${friendly}`);
  }
  console.log("OK  cross-year insert rejected with graceful form error");

  // Valid insert — same path as form submit
  const { data: inserted, error: insErr } = await userClient
    .from("pm_forecast_commitments")
    .insert({
      property_id: PROPERTY_ID,
      date_committed: DATE_COMMITTED,
      target_date: TARGET_DATE,
      committed_incremental_amount: COMMITTED_AMOUNT,
      entered_by: userId,
      notes: "verify-forecast-page-flow",
    })
    .select(
      "id, property_id, date_committed, target_date, committed_incremental_amount",
    )
    .single();

  if (insErr || !inserted) {
    throw new Error(`Valid insert failed: ${insErr?.message}`);
  }
  console.log(`Inserted commitment ${inserted.id}`);

  try {
    // List path: load commitments + bookings, compute live (page pattern)
    const [{ data: rows, error: listErr }, { data: bookingRows, error: bookErr }] =
      await Promise.all([
        userClient
          .from("pm_forecast_commitments")
          .select(
            "id, property_id, date_committed, target_date, committed_incremental_amount, notes, created_at",
          )
          .eq("property_id", PROPERTY_ID)
          .order("date_committed", { ascending: false }),
        userClient
          .from("bookings")
          .select("booked_date, check_out, cancelled_at, gross_revenue")
          .eq("property_id", PROPERTY_ID)
          .not("booked_date", "is", null),
      ]);
    if (listErr) throw new Error(listErr.message);
    if (bookErr) throw new Error(bookErr.message);

    const row = (rows ?? []).find((r) => r.id === inserted.id);
    if (!row) throw new Error("Inserted commitment not in list");

    const live = computePmForecastCommitmentMetricsFromBookings(
      (bookingRows ?? []) as CommitmentBookingRow[],
      {
        property_id: row.property_id,
        date_committed: String(row.date_committed).slice(0, 10),
        target_date: String(row.target_date).slice(0, 10),
        committed_incremental_amount: row.committed_incremental_amount,
      },
    );

    assertClose("list baseline", live.baseline, expected.baseline);
    assertClose(
      "list actual_incremental",
      live.actual_incremental,
      expected.actual_incremental,
    );
    if (live.miss_pct == null || expected.miss_pct == null) {
      throw new Error("miss_pct null unexpectedly");
    }
    assertClose("list miss_pct", live.miss_pct, expected.miss_pct);
    console.log("OK  commitment appears in list with correct live metrics");
  } finally {
    const { error: delErr } = await admin
      .from("pm_forecast_commitments")
      .delete()
      .eq("id", inserted.id);
    if (delErr) {
      console.error("WARN: cleanup failed:", delErr.message);
    } else {
      console.log(`Cleaned up commitment ${inserted.id}`);
    }
  }

  console.log("\nAll forecast page flow checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
