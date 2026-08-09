/**
 * Admin verification queue path:
 * - pending property displays fields
 * - Approve → verified + reviewer fields; owner review insert allowed
 * - Reject → rejected + reviewer fields; owner review insert blocked by RLS
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
loadEnv({ path: path.join(ROOT, ".env.local") });

const ADMIN_EMAIL = "louispace@hotmail.com";
const OWNER_EMAIL = "louispace@hotmail.com"; // same user is admin+owner in this env
const PROPERTY_ID = "6a6f825a-4a63-4fb5-8e74-9e257842d5b8";
const REL_ID = "60491586-341a-4b59-8ec4-9c004fa0e298";
const PM_ID = "fe991b0b-7219-4e70-9351-82fe6e09ff31";

async function authAs(email: string) {
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
  const { data: linkData, error: linkErr } =
    await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkErr || !linkData?.properties?.hashed_token) {
    throw new Error(linkErr?.message ?? "generateLink failed");
  }
  const { data: otpData, error: otpErr } = await userClient.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "email",
  });
  if (otpErr || !otpData.user) throw new Error(otpErr?.message ?? "otp failed");
  return { admin, userClient, userId: otpData.user.id };
}

async function seedPending(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userClient: any,
  ownerType: "individual" | "entity",
) {
  const tmp = path.join(os.tmpdir(), `admin-verify-${Date.now()}.pdf`);
  fs.writeFileSync(tmp, Buffer.from("%PDF-1.4 admin queue test\n"));
  const storagePath = `property-verification/${PROPERTY_ID}/${Date.now()}_admin_queue.pdf`;
  const bytes = fs.readFileSync(tmp);
  const { error: upErr } = await userClient.storage
    .from("attachments")
    .upload(storagePath, bytes, { contentType: "application/pdf", upsert: false });
  if (upErr) throw new Error(`upload: ${upErr.message}`);

  const { error: uErr } = await admin
    .from("properties")
    .update({
      verification_status: "pending",
      verification_document_url: storagePath,
      owner_type: ownerType,
      entity_relationship:
        ownerType === "entity" ? "Managing member" : null,
      verification_reviewed_by: null,
      verification_reviewed_at: null,
    })
    .eq("id", PROPERTY_ID);
  if (uErr) throw new Error(`seed pending: ${uErr.message}`);
  fs.unlinkSync(tmp);
  return storagePath;
}

async function tryReviewInsert(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userClient: any,
  userId: string,
): Promise<{ data: { id: string } | null; error: { code?: string; message: string } | null }> {
  return userClient
    .from("reviews")
    .insert({
      pm_id: PM_ID,
      owner_id: userId,
      owner_pm_relationship_id: REL_ID,
      overall_rating: 5,
      review_text:
        "Admin queue gate test review text — padding to satisfy minimum length.",
      status: "pending",
    })
    .select("id")
    .maybeSingle();
}

async function main() {
  const { admin, userClient, userId } = await authAs(ADMIN_EMAIL);
  console.log("Authenticated admin/owner:", ADMIN_EMAIL, userId);

  // --- Approve path (entity so entity_relationship displays) ---
  let storagePath = await seedPending(admin, userClient, "entity");

  const { data: queueRow, error: qErr } = await userClient
    .from("properties")
    .select(
      "id, property_name, owner_type, entity_relationship, verification_document_url, verification_status, owner:owner_profiles!properties_owner_id_fkey(display_name)",
    )
    .eq("verification_status", "pending")
    .eq("id", PROPERTY_ID)
    .maybeSingle();
  if (qErr) throw new Error(qErr.message);
  if (!queueRow) throw new Error("Pending property not in admin queue query");
  console.log("Queue display fields:", {
    property_name: queueRow.property_name,
    owner_type: queueRow.owner_type,
    entity_relationship: queueRow.entity_relationship,
    verification_document_url: queueRow.verification_document_url,
    owner: queueRow.owner,
  });
  if (queueRow.owner_type !== "entity") throw new Error("owner_type mismatch");
  if (queueRow.entity_relationship !== "Managing member") {
    throw new Error("entity_relationship mismatch");
  }

  const { data: signed } = await userClient.storage
    .from("attachments")
    .createSignedUrl(storagePath, 3600);
  if (!signed?.signedUrl) throw new Error("Signed document URL failed");
  console.log("OK  document signed URL available");

  // Approve (same path as admin UI)
  const { error: apprErr } = await userClient
    .from("properties")
    .update({
      verification_status: "verified",
      verification_reviewed_by: userId,
      verification_reviewed_at: new Date().toISOString(),
    })
    .eq("id", PROPERTY_ID)
    .eq("verification_status", "pending");
  if (apprErr) throw new Error(`Approve failed: ${apprErr.message}`);

  const { data: afterApprove } = await admin
    .from("properties")
    .select(
      "verification_status, verification_reviewed_by, verification_reviewed_at",
    )
    .eq("id", PROPERTY_ID)
    .single();
  console.log("After Approve:", afterApprove);
  if (afterApprove?.verification_status !== "verified") {
    throw new Error("Approve did not set verified");
  }
  if (afterApprove.verification_reviewed_by !== userId) {
    throw new Error("reviewed_by not set on approve");
  }
  if (!afterApprove.verification_reviewed_at) {
    throw new Error("reviewed_at not set on approve");
  }
  console.log("OK  Approve → verified + reviewer fields");

  // Owner can insert review (RLS)
  const { data: revOk, error: revOkErr } = await tryReviewInsert(
    userClient,
    userId,
  );
  if (revOkErr || !revOk?.id) {
    throw new Error(`Expected review insert after approve: ${revOkErr?.message}`);
  }
  console.log("OK  Approve case: owner review insert allowed", revOk.id);
  await admin.from("reviews").delete().eq("id", revOk.id);

  // UX gate: has verified property
  const { data: propsAfterApprove } = await userClient
    .from("properties")
    .select("id, verification_status")
    .eq("owner_id", userId)
    .is("deleted_at", null);
  const hasVerified = (propsAfterApprove ?? []).some(
    (p) => p.verification_status === "verified",
  );
  if (!hasVerified) throw new Error("UX gate would still block after approve");
  console.log("OK  Approve case: Prompt 4 UX gate allows form");

  await admin.storage.from("attachments").remove([storagePath]);

  // --- Reject path ---
  storagePath = await seedPending(admin, userClient, "individual");

  const { error: rejErr } = await userClient
    .from("properties")
    .update({
      verification_status: "rejected",
      verification_reviewed_by: userId,
      verification_reviewed_at: new Date().toISOString(),
    })
    .eq("id", PROPERTY_ID)
    .eq("verification_status", "pending");
  if (rejErr) throw new Error(`Reject failed: ${rejErr.message}`);

  const { data: afterReject } = await admin
    .from("properties")
    .select(
      "verification_status, verification_reviewed_by, verification_reviewed_at, owner_type, entity_relationship",
    )
    .eq("id", PROPERTY_ID)
    .single();
  console.log("After Reject:", afterReject);
  if (afterReject?.verification_status !== "rejected") {
    throw new Error("Reject did not set rejected");
  }
  if (afterReject.verification_reviewed_by !== userId) {
    throw new Error("reviewed_by not set on reject");
  }
  if (!afterReject.verification_reviewed_at) {
    throw new Error("reviewed_at not set on reject");
  }
  console.log("OK  Reject → rejected + reviewer fields");

  // Also ensure Mystic stays unverified so owner has no verified escape hatch
  await admin
    .from("properties")
    .update({ verification_status: "unverified" })
    .eq("id", "b4cb704f-53b5-478a-9775-7ac7e9319eba");

  const { data: revBad, error: revBadErr } = await tryReviewInsert(
    userClient,
    userId,
  );
  if (!revBadErr) {
    if (revBad?.id) await admin.from("reviews").delete().eq("id", revBad.id);
    throw new Error("Expected RLS block after reject");
  }
  console.log(
    "OK  Reject case: review insert blocked by RLS:",
    revBadErr.code,
    revBadErr.message,
  );

  const { data: propsAfterReject } = await userClient
    .from("properties")
    .select("id, verification_status")
    .eq("owner_id", userId)
    .is("deleted_at", null);
  const stillHasVerified = (propsAfterReject ?? []).some(
    (p) => p.verification_status === "verified",
  );
  if (stillHasVerified) {
    throw new Error("UX gate would incorrectly allow form after reject");
  }
  console.log("OK  Reject case: Prompt 4 UX gate shows verify prompt");

  await admin.storage.from("attachments").remove([storagePath]);
  await admin
    .from("properties")
    .update({
      verification_status: "unverified",
      verification_document_url: null,
      owner_type: null,
      entity_relationship: null,
      verification_reviewed_by: null,
      verification_reviewed_at: null,
    })
    .eq("id", PROPERTY_ID);

  console.log("\nAll admin verification queue checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
