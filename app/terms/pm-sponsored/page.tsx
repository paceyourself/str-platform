import type { Metadata } from "next";
import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { TermsOfUseContent } from "@/components/legal/terms-of-use-content";

export const metadata: Metadata = {
  title: "PM-Sponsored Terms of Use | VeroSTR",
  description: "VeroSTR Terms of Use — PM-sponsored owner access.",
};

export default function PmSponsoredTermsPage() {
  return (
    <LegalPageShell>
      <TermsOfUseContent variant="pm-sponsored" />
    </LegalPageShell>
  );
}
