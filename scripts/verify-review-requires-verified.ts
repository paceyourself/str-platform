/**
 * Authenticated insert into reviews for an unverified property must be
 * rejected by RLS (reviews_insert_requires_verified_property), not app code.
 *
 * Run: npx ts-node scripts/verify-review-requires-verified.ts
 */

import * as path from "path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
loadEnv({ path: path.join(ROOT, ".env.local") });
loadEnv({ path: path.join(ROOT, ".env") });

const OWNER_EMAIL = "louispace@hotmail.com";
const PROPERTY_ID = "6a6f825a-4a63-4fb5-8e74-9e257842d5b8";
const REL_ID = "60491586-341a-4b59-8ec4-9c004fa0e298";
const PM_ID = "fe991b0b-7219-4e70-9351-82fe6e09ff31";

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

  const { data: prop, error: pErr } = await admin
    .from("properties")
    .select("id, verification_status")
    .eq("id", PROPERTY_ID)
    .single();
  if (pErr) throw new Error(pErr.message);
  console.log("Property verification_status:", prop.verification_status);
  if (prop.verification_status !== "unverified") {
    throw new Error(
      `Expected unverified for test property, got ${prop.verification_status}`,
    );
  }

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
  console.log(`Authenticated as ${OWNER_EMAIL}`);

  const { data, error } = await userClient
    .from("reviews")
    .insert({
      pm_id: PM_ID,
      owner_id: otpData.user.id,
      owner_pm_relationship_id: REL_ID,
      overall_rating: 5,
      review_text:
        "Policy test review — should be rejected because the property is unverified.",
      status: "pending",
    })
    .select("id")
    .maybeSingle();

  if (!error) {
    // Cleanup if somehow inserted
    if (data?.id) {
      await admin.from("reviews").delete().eq("id", data.id);
    }
    throw new Error(
      "Insert succeeded — expected RLS policy violation for unverified property",
    );
  }

  console.log("Rejected as expected.");
  console.log("  code:", error.code);
  console.log("  message:", error.message);

  const looksLikeRls =
    error.code === "42501" ||
    /row-level security|policy|violates/i.test(error.message);
  if (!looksLikeRls) {
    throw new Error(
      `Rejection does not look like an RLS/policy violation: ${error.code} ${error.message}`,
    );
  }
  console.log("OK  DB-level policy violation confirmed (not app-side).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
