/**
 * Positive case: verified property owner can insert a review.
 * Also confirms service-role insert still bypasses RLS.
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
    throw new Error("Missing Supabase env");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: rel, error: relErr } = await admin
    .from("owner_pm_relationships")
    .select("id, property_id, owner_id, pm_id")
    .eq("id", REL_ID)
    .single();
  if (relErr) throw new Error(relErr.message);
  console.log("Join path check:");
  console.log("  reviews.owner_pm_relationship_id →", REL_ID);
  console.log("  owner_pm_relationships.property_id →", rel.property_id);
  if (rel.property_id !== PROPERTY_ID) {
    throw new Error("Relationship does not point at expected property");
  }

  const { error: upErr } = await admin
    .from("properties")
    .update({ verification_status: "verified" })
    .eq("id", PROPERTY_ID);
  if (upErr) throw new Error(upErr.message);

  const { data: prop } = await admin
    .from("properties")
    .select("verification_status")
    .eq("id", PROPERTY_ID)
    .single();
  console.log("Property verification_status:", prop?.verification_status);

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

  let ownerReviewId: string | null = null;
  let serviceReviewId: string | null = null;

  try {
    const { data, error } = await userClient
      .from("reviews")
      .insert({
        pm_id: PM_ID,
        owner_id: otpData.user.id,
        owner_pm_relationship_id: REL_ID,
        overall_rating: 5,
        review_text:
          "Positive policy test — verified property owner insert should succeed. Padding for min length.",
        status: "pending",
      })
      .select("id")
      .single();

    if (error) {
      throw new Error(
        `Verified owner insert failed: ${error.code} ${error.message}`,
      );
    }
    ownerReviewId = data.id;
    console.log("OK  verified owner insert succeeded:", ownerReviewId);

    // Service role while property is unverified — should still work (bypasses RLS)
    await admin
      .from("properties")
      .update({ verification_status: "unverified" })
      .eq("id", PROPERTY_ID);

    const { data: svcRow, error: svcErr } = await admin
      .from("reviews")
      .insert({
        pm_id: PM_ID,
        owner_id: otpData.user.id,
        owner_pm_relationship_id: REL_ID,
        overall_rating: 4,
        review_text:
          "Service-role insert while property unverified — should bypass RLS. Padding text.",
        status: "pending",
      })
      .select("id")
      .single();

    if (svcErr) {
      throw new Error(`Service-role insert failed: ${svcErr.message}`);
    }
    serviceReviewId = svcRow.id;
    console.log(
      "OK  service-role insert while unverified succeeded:",
      serviceReviewId,
    );
  } finally {
    if (ownerReviewId) {
      await admin.from("reviews").delete().eq("id", ownerReviewId);
    }
    if (serviceReviewId) {
      await admin.from("reviews").delete().eq("id", serviceReviewId);
    }
    await admin
      .from("properties")
      .update({
        verification_status: "unverified",
        verification_document_url: null,
        verification_reviewed_by: null,
        verification_reviewed_at: null,
      })
      .eq("id", PROPERTY_ID);
    const { data: reset } = await admin
      .from("properties")
      .select("verification_status")
      .eq("id", PROPERTY_ID)
      .single();
    console.log("Reset verification_status to", reset?.verification_status);
  }

  console.log("\nAll positive-path checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
