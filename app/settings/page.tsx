import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalH1,
  LegalP,
  LegalPageShell,
} from "@/components/legal/legal-page-shell";

export const metadata: Metadata = {
  title: "Settings | VeroSTR",
  description: "VeroSTR account settings.",
};

export default function SettingsPage() {
  return (
    <LegalPageShell>
      <LegalH1>Settings</LegalH1>
      <LegalP>
        Account settings — including profile, email preferences, and account
        management — are available when you are signed in.
      </LegalP>
      <LegalP>
        <Link
          href="/login"
          className="font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
        >
          Sign in
        </Link>{" "}
        to manage your account, or visit the{" "}
        <Link
          href="/dashboard"
          className="font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
        >
          dashboard
        </Link>{" "}
        if you are already authenticated.
      </LegalP>
      <p className="mt-4 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
        Full account settings UI — placeholder for Sprint 19.
      </p>
    </LegalPageShell>
  );
}
