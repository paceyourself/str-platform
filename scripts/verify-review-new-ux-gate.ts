/**
 * Confirms reviews/new UX gate data path:
 * - unverified / rejected → no verified relationships → form blocked
 * - verified → at least one verified relationship → form allowed
 * Message link target is /settings (asserted from source).
 */

import * as fs from "fs";
import * as path from "path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
loadEnv({ path: path.join(ROOT, ".env.local") });

const OWNER_EMAIL = "louispace@hotmail.com";
const PROPERTY_ID = "6a6f825a-4a63-4fb5-8e74-9e257842d5b8";

async function loadRelVerification(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userClient: any,
  ownerId: string,
): Promise<Record<string, string>> {
  const { data: rels } = await userClient
    .from("owner_pm_relationships")
    .select("id, property_id")
    .eq("owner_id", ownerId)
    .eq("active", true);
  const rows = (rels ?? []) as Array<{ id: string; property_id: string | null }>;
  const propertyIds = [
    ...new Set(
      rows
        .map((r) => r.property_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const { data: props } = await userClient
    .from("properties")
    .select("id, verification_status")
    .in("id", propertyIds);
  const propRows = (props ?? []) as Array<{
    id: string;
    verification_status: string | null;
  }>;
  const statusByProperty = new Map(
    propRows.map((p) => [
      p.id,
      String(p.verification_status ?? "unverified"),
    ]),
  );
  const byRel: Record<string, string> = {};
  for (const r of rows) {
    if (!r.property_id) continue;
    byRel[r.id] = statusByProperty.get(r.property_id) ?? "unverified";
  }
  return byRel;
}

function gate(relVerification: Record<string, string>) {
  const hasVerifiedProperty = Object.values(relVerification).some(
    (s) => s === "verified",
  );
  return {
    hasVerifiedProperty,
    showForm: hasVerifiedProperty,
    showVerifyPrompt: !hasVerifiedProperty,
  };
}

async function main() {
  const pageSrc = fs.readFileSync(
    path.join(ROOT, "app/dashboard/reviews/new/page.tsx"),
    "utf8",
  );
  if (!pageSrc.includes("Verify this property to submit a review")) {
    throw new Error("Friendly message text missing from page");
  }
  if (!pageSrc.includes('href="/settings"')) {
    throw new Error('Settings link href="/settings" missing from page');
  }
  console.log('OK  page contains message + href="/settings"');

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

  // Ensure sibling properties used by same owner don't leave a verified escape hatch
  const { data: ownerProps } = await admin
    .from("properties")
    .select("id")
    .eq("owner_id", ownerId)
    .is("deleted_at", null);
  const allIds = (ownerProps ?? []).map((p) => p.id as string);

  async function setAll(status: string) {
    await admin
      .from("properties")
      .update({ verification_status: status })
      .in("id", allIds);
  }

  try {
    await setAll("unverified");
    let g = gate(await loadRelVerification(userClient, ownerId));
    console.log("unverified gate:", g);
    if (g.showForm || !g.showVerifyPrompt) {
      throw new Error("Expected verify prompt for unverified");
    }
    console.log("OK  unverified → prompt, no form");

    await setAll("rejected");
    g = gate(await loadRelVerification(userClient, ownerId));
    console.log("rejected gate:", g);
    if (g.showForm || !g.showVerifyPrompt) {
      throw new Error("Expected verify prompt for rejected");
    }
    console.log("OK  rejected → prompt, no form");

    // Verified on the test property only — other owned props stay rejected
    await admin
      .from("properties")
      .update({ verification_status: "verified" })
      .eq("id", PROPERTY_ID);
    g = gate(await loadRelVerification(userClient, ownerId));
    console.log("verified gate:", g);
    if (!g.showForm || g.showVerifyPrompt) {
      throw new Error("Expected form for verified property");
    }
    console.log("OK  verified → form allowed (no regression path)");
  } finally {
    await setAll("unverified");
    console.log("Reset all owner properties to unverified");
  }

  console.log("\nAll reviews/new UX gate checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
