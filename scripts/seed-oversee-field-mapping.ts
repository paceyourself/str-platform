/**
 * One-time seed: Oversee PM field mapping → public.pm_field_mappings.
 *
 * Env (load from .env.local via dotenv):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Run:
 *   npx ts-node scripts/seed-oversee-field-mapping.ts
 *
 * Note: DB check constraint allows cancellation_signal_type ∈
 * absence_detected | status_field | cancellation_row (not "status_cancelled").
 * This seed uses status_field for Oversee status-based cancellation handling.
 */

import * as path from "path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
loadEnv({ path: path.join(ROOT, ".env.local") });
loadEnv({ path: path.join(ROOT, ".env") });

const OVERSEE_PM_ID = "fe991b0b-7219-4e70-9351-82fe6e09ff31";

const column_map = {
  "Reservation Id": "source_reservation_id",
  Status: "status",
  Unit: null,
  "Booked Date": "booked_date",
  "Check-In": "check_in",
  Checkout: "check_out",
  Nights: null,
  Income: "gross_revenue",
  Currency: "currency",
};

const type_label_map = {
  Guest: "guest_pm_direct",
  Vrbo: "guest_ota",
  Website: "guest_ota",
  "Booking.com": "guest_ota",
  Airbnb: "guest_ota",
  BNBFinder: "guest_ota",
  Owner: "owner_stay",
  "Owner Guest": "owner_guest",
};

const cancellation_signal_type = "status_field";

const flagged_labels: string[] = [];

async function main(): Promise<void> {
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

  const row = {
    pm_id: OVERSEE_PM_ID,
    column_map,
    type_label_map,
    flagged_labels,
    cancellation_signal_type,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("pm_field_mappings").upsert(row, {
    onConflict: "pm_id",
  });

  if (error) {
    console.error("Upsert failed:", error.message);
    process.exit(1);
  }

  console.log(`Upserted pm_field_mappings for pm_id=${OVERSEE_PM_ID}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
