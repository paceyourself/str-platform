import type { Metadata } from "next";
import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { TermsOfUseContent } from "@/components/legal/terms-of-use-content";

export const metadata: Metadata = {
  title: "Terms of Use | VeroSTR",
  description: "VeroSTR Terms of Use — owner direct subscription.",
};

export default function TermsPage() {
  return (
    <LegalPageShell>
      <TermsOfUseContent variant="owner-direct" />
    </LegalPageShell>
  );
}
