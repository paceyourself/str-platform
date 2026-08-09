/**
 * One-shot verification for lib/pm-forecast-commitments.ts against live bookings.
 *
 * Run: npx ts-node --compiler-options "{\"module\":\"commonjs\"}" scripts/verify-pm-forecast-commitments.ts
 */

import * as path from "path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  computePmForecastCommitmentMetrics,
  computePmForecastCommitmentMetricsFromBookings,
  type CommitmentBookingRow,
} from "../lib/pm-forecast-commitments";

const ROOT = process.cwd();
loadEnv({ path: path.join(ROOT, ".env.local") });
loadEnv({ path: path.join(ROOT, ".env") });

const PROPERTY_ID = "6a6f825a-4a63-4fb5-8e74-9e257842d5b8"; // Hideaway Cottage (Louis)
const DATE_COMMITTED = "2025-06-01";
const TARGET_DATE = "2025-12-31";
const COMMITTED_INCREMENTAL = 50000;

function assertClose(label: string, actual: number, expected: number) {
  const ok = Math.abs(actual - expected) < 1e-9;
  if (!ok) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
  console.log(`OK  ${label}: ${actual}`);
}

async function main() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const commitment = {
    property_id: PROPERTY_ID,
    date_committed: DATE_COMMITTED,
    target_date: TARGET_DATE,
    committed_incremental_amount: COMMITTED_INCREMENTAL,
  };

  // --- Hand compute from raw booking rows ---
  const { data: rawRows, error: rawErr } = await supabase
    .from("bookings")
    .select("id, booked_date, check_out, cancelled_at, gross_revenue")
    .eq("property_id", PROPERTY_ID);

  if (rawErr) throw new Error(rawErr.message);
  const rows = (rawRows ?? []) as Array<
    CommitmentBookingRow & { id: string }
  >;

  let handBaseline = 0;
  let handActual = 0;
  const baselineIds: string[] = [];
  const actualIds: string[] = [];

  for (const b of rows) {
    if (b.cancelled_at != null) continue;
    if (b.booked_date == null || b.check_out == null) continue;
    if (!(b.check_out <= TARGET_DATE)) continue;
    const rev = Number(b.gross_revenue ?? 0) || 0;
    if (b.booked_date < DATE_COMMITTED) {
      handBaseline += rev;
      baselineIds.push(b.id);
    } else if (b.booked_date >= DATE_COMMITTED) {
      handActual += rev;
      actualIds.push(b.id);
    }
  }

  const handMiss =
    (COMMITTED_INCREMENTAL - handActual) / COMMITTED_INCREMENTAL;

  console.log("--- Hand totals from raw bookings ---");
  console.log(
    `baseline rows=${baselineIds.length} sum=${handBaseline}`,
  );
  console.log(`actual_incremental rows=${actualIds.length} sum=${handActual}`);
  console.log(`miss_pct=${handMiss}`);

  // --- Lib function (DB fetch path) ---
  const metrics = await computePmForecastCommitmentMetrics(
    supabase,
    commitment,
  );

  console.log("--- Lib computePmForecastCommitmentMetrics ---");
  assertClose("baseline", metrics.baseline, handBaseline);
  assertClose("actual_incremental", metrics.actual_incremental, handActual);
  if (metrics.miss_pct == null) {
    throw new Error("miss_pct unexpectedly null");
  }
  assertClose("miss_pct", metrics.miss_pct, handMiss);

  // Also confirm pure helper matches when passed the same raw set
  const fromPure = computePmForecastCommitmentMetricsFromBookings(
    rows,
    commitment,
  );
  assertClose("pure.baseline", fromPure.baseline, handBaseline);
  assertClose("pure.actual_incremental", fromPure.actual_incremental, handActual);

  // --- Canceled booking exclusion (both sides of the date split) ---
  const cancelRevenue = 99999.99;

  async function assertCanceledExcluded(opts: {
    label: string;
    booked_date: string;
    check_in: string;
    check_out: string;
    side: "baseline" | "actual_incremental";
  }) {
    const { data: inserted, error: insErr } = await supabase
      .from("bookings")
      .insert({
        property_id: PROPERTY_ID,
        block_type: "guest_ota",
        status: "cancelled",
        check_in: opts.check_in,
        check_out: opts.check_out,
        booked_date: opts.booked_date,
        gross_revenue: cancelRevenue,
        cancelled_at: "2025-07-15T12:00:00Z",
        currency: "USD",
      })
      .select("id")
      .single();

    if (insErr || !inserted?.id) {
      throw new Error(
        `Failed to insert canceled booking (${opts.label}): ${insErr?.message}`,
      );
    }

    const canceledId = inserted.id as string;
    console.log(
      `Inserted canceled booking [${opts.label}] ${canceledId} (+${cancelRevenue}, booked_date=${opts.booked_date})`,
    );

    try {
      const after = await computePmForecastCommitmentMetrics(
        supabase,
        commitment,
      );
      assertClose(
        `baseline unchanged with canceled booking (${opts.label})`,
        after.baseline,
        handBaseline,
      );
      assertClose(
        `actual_incremental unchanged with canceled booking (${opts.label})`,
        after.actual_incremental,
        handActual,
      );

      // Sanity: if cancelled_at were ignored, the matching side would jump
      const naive = computePmForecastCommitmentMetricsFromBookings(
        [
          ...rows,
          {
            booked_date: opts.booked_date,
            check_out: opts.check_out,
            cancelled_at: null,
            gross_revenue: cancelRevenue,
          },
        ],
        commitment,
      );
      const naiveSide =
        opts.side === "baseline" ? naive.baseline : naive.actual_incremental;
      const expectedNaive =
        (opts.side === "baseline" ? handBaseline : handActual) + cancelRevenue;
      if (Math.abs(naiveSide - expectedNaive) > 1e-9) {
        throw new Error(
          `sanity check for naive ${opts.side} inclusion failed (${opts.label})`,
        );
      }
      console.log(
        `OK  canceled booking would have added to ${opts.side} if not excluded (${opts.label})`,
      );
    } finally {
      const { error: delErr } = await supabase
        .from("bookings")
        .delete()
        .eq("id", canceledId);
      if (delErr) {
        console.error(
          `WARN: failed to delete test booking ${canceledId}:`,
          delErr.message,
        );
      } else {
        console.log(`Cleaned up canceled booking ${canceledId}`);
      }
    }
  }

  await assertCanceledExcluded({
    label: "actual_incremental side",
    booked_date: "2025-07-01", // >= date_committed
    check_in: "2025-08-01",
    check_out: "2025-08-05",
    side: "actual_incremental",
  });

  await assertCanceledExcluded({
    label: "baseline side",
    booked_date: "2025-05-01", // < date_committed
    check_in: "2025-08-01",
    check_out: "2025-08-05",
    side: "baseline",
  });

  console.log("\nAll verification checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
