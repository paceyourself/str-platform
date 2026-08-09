/**
 * Exercises settings ownership-verification submit path as the property owner.
 * Confirms DB flips unverified → pending and document path is written.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
loadEnv({ path: path.join(ROOT, ".env.local") });
loadEnv({ path: path.join(ROOT, ".env") });

const OWNER_EMAIL = "louispace@hotmail.com";
const PROPERTY_ID = "6a6f825a-4a63-4fb5-8e74-9e257842d5b8";

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

  // Ensure starting state
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
  console.log("Authenticated as", OWNER_EMAIL);

  const tmp = path.join(os.tmpdir(), `verostr-verify-${Date.now()}.pdf`);
  fs.writeFileSync(tmp, Buffer.from("%PDF-1.4 test verification document\n"));
  const fileBytes = fs.readFileSync(tmp);
  const storagePath = `property-verification/${PROPERTY_ID}/${Date.now()}_test_deed.pdf`;

  const { error: uploadErr } = await userClient.storage
    .from("attachments")
    .upload(storagePath, fileBytes, {
      contentType: "application/pdf",
      upsert: false,
    });
  if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);
  console.log("Uploaded", storagePath);

  const { error: updateErr } = await userClient
    .from("properties")
    .update({
      verification_document_url: storagePath,
      verification_status: "pending",
      owner_type: "individual",
      entity_relationship: null,
      verification_reviewed_by: null,
      verification_reviewed_at: null,
    })
    .eq("id", PROPERTY_ID)
    .eq("owner_id", otpData.user.id)
    .is("deleted_at", null);

  if (updateErr) throw new Error(`Update failed: ${updateErr.message}`);

  const { data: row, error: readErr } = await admin
    .from("properties")
    .select(
      "verification_status, verification_document_url, owner_type, entity_relationship",
    )
    .eq("id", PROPERTY_ID)
    .single();
  if (readErr) throw new Error(readErr.message);

  console.log("DB row after submit:", row);
  if (row.verification_status !== "pending") {
    throw new Error(`Expected pending, got ${row.verification_status}`);
  }
  if (row.verification_document_url !== storagePath) {
    throw new Error("verification_document_url mismatch");
  }
  if (row.owner_type !== "individual") {
    throw new Error("owner_type mismatch");
  }

  // UI refresh behavior: component sets local state to pending after success
  // (no router.refresh / full reload). Simulate that state transition:
  const uiStatusAfterSubmit = "pending";
  console.log(
    "UI expected after submit (local state, no manual refresh):",
    uiStatusAfterSubmit,
  );

  // Cleanup storage + reset property for ongoing unverified testing
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
  fs.unlinkSync(tmp);
  console.log("Cleaned up test upload and reset property to unverified.");
  console.log("\nAll settings verification upload checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
