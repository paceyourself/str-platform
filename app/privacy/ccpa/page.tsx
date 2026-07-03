import type { Metadata } from "next";
import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { CcpaAddendumContent } from "@/components/legal/ccpa-addendum-content";

export const metadata: Metadata = {
  title: "CCPA Privacy Addendum | VeroSTR",
  description:
    "VeroSTR Privacy Policy Addendum for California Residents (CCPA).",
};

export default function CcpaPrivacyPage() {
  return (
    <LegalPageShell>
      <CcpaAddendumContent />
    </LegalPageShell>
  );
}
