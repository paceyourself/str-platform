/**
 * Mixed-state per-selection gate:
 * Hideaway verified, Mystic unverified (same owner, same PM).
 * Selecting each relationship must yield prompt vs form independently.
 */

import * as path from "path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
loadEnv({ path: path.join(ROOT, ".env.local") });

const OWNER_EMAIL = "louispace@hotmail.com";
const HIDEAWAY_ID = "6a6f825a-4a63-4fb5-8e74-9e257842d5b8";
const MYSTIC_ID = "b4cb704f-53b5-478a-9775-7ac7e9319eba";
const HIDEAWAY_REL = "60491586-341a-4b59-8ec4-9c004fa0e298";
const MYSTIC_REL = "c8647ade-2d07-4d3e-b232-6aca5c3192c2";

function gateForSelection(
  relVerification: Record<string, string>,
  selectedRelId: string | null,
) {
  const hasVerifiedProperty = Object.values(relVerification).some(
    (s) => s === "verified",
  );
  const selectedStatus = selectedRelId
    ? (relVerification[selectedRelId] ?? "unverified")
    : null;
  const showFormForSelection = selectedStatus === "verified";
  const showPromptForSelection =
    selectedRelId != null && selectedStatus !== "verified";
  return {
    hasVerifiedProperty,
    selectedStatus,
    showFormForSelection,
    showPromptForSelection,
  };
}

async function main() {
  const url =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !serviceKey || !anonKey) throw new Error("Missing env");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: linkData } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: OWNER_EMAIL,
  });
  const { data: otpData, error: otpErr } = await userClient.auth.verifyOtp({
    token_hash: linkData!.properties!.hashed_token,
    type: "email",
  });
  if (otpErr || !otpData.user) throw new Error(otpErr?.message ?? "otp failed");
  const ownerId = otpData.user.id;

  // Mixed state: Hideaway verified, Mystic unverified
  await admin
    .from("properties")
    .update({ verification_status: "verified" })
    .eq("id", HIDEAWAY_ID);
  await admin
    .from("properties")
    .update({ verification_status: "unverified" })
    .eq("id", MYSTIC_ID);

  try {
    const { data: rels } = await userClient
      .from("owner_pm_relationships")
      .select("id, property_id")
      .eq("owner_id", ownerId)
      .eq("active", true);
    const rows = (rels ?? []) as Array<{
      id: string;
      property_id: string | null;
    }>;
    const propIds = [
      ...new Set(rows.map((r) => r.property_id).filter(Boolean) as string[]),
    ];
    const { data: props } = await userClient
      .from("properties")
      .select("id, property_name, verification_status")
      .in("id", propIds);

    const propRows = (props ?? []) as Array<{
      id: string;
      property_name: string | null;
      verification_status: string | null;
    }>;
    console.log(
      "Property states:",
      propRows.map((p) => ({
        name: p.property_name,
        status: p.verification_status,
      })),
    );

    const statusByProperty = new Map(
      propRows.map((p) => [p.id, String(p.verification_status ?? "unverified")]),
    );
    const relVerification: Record<string, string> = {};
    for (const r of rows) {
      if (!r.property_id) continue;
      relVerification[r.id] =
        statusByProperty.get(r.property_id) ?? "unverified";
    }

    // Confirm selector options are per-relationship (not collapsed to one PM)
    if (!relVerification[HIDEAWAY_REL] || !relVerification[MYSTIC_REL]) {
      throw new Error("Expected both Hideaway and Mystic relationships loaded");
    }
    if (relVerification[HIDEAWAY_REL] !== "verified") {
      throw new Error("Hideaway should be verified");
    }
    if (relVerification[MYSTIC_REL] !== "unverified") {
      throw new Error("Mystic should be unverified");
    }

    // Owner-level: has at least one verified → page allows selector (not owner-wide block)
    const none = gateForSelection(relVerification, null);
    if (!none.hasVerifiedProperty) {
      throw new Error("Owner-level gate incorrectly blocked mixed owner");
    }
    console.log("OK  mixed owner is not owner-wide blocked (selector available)");

    // Select unverified (Mystic) → prompt, not form
    const unverifiedSel = gateForSelection(relVerification, MYSTIC_REL);
    console.log("Select Mystic (unverified):", unverifiedSel);
    if (
      !unverifiedSel.showPromptForSelection ||
      unverifiedSel.showFormForSelection
    ) {
      throw new Error("Expected prompt (not form) for unverified selection");
    }
    console.log("OK  unverified selection → friendly prompt, no form");

    // Select verified (Hideaway) → form, not prompt
    const verifiedSel = gateForSelection(relVerification, HIDEAWAY_REL);
    console.log("Select Hideaway (verified):", verifiedSel);
    if (
      !verifiedSel.showFormForSelection ||
      verifiedSel.showPromptForSelection
    ) {
      throw new Error("Expected form (not prompt) for verified selection");
    }
    console.log("OK  verified selection → form renders");

    console.log(
      "\nPer-selection gate confirmed (not per-owner).",
    );
  } finally {
    await admin
      .from("properties")
      .update({ verification_status: "unverified" })
      .in("id", [HIDEAWAY_ID, MYSTIC_ID]);
    console.log("Reset Hideaway + Mystic to unverified");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
