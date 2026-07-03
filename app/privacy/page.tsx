import type { Metadata } from "next";
import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { PrivacyPolicyContent } from "@/components/legal/privacy-policy-content";

export const metadata: Metadata = {
  title: "Privacy Policy | VeroSTR",
  description: "VeroSTR Privacy Policy.",
};

export default function PrivacyPage() {
  return (
    <LegalPageShell>
      <PrivacyPolicyContent />
    </LegalPageShell>
  );
}
