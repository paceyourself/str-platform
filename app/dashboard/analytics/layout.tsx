import { BenchmarkDisplayProvider } from "@/components/benchmark-display-context";
import { hasFeatureAccess } from "@/lib/billing-rates";
import { createClient } from "@/lib/supabase-server";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Analytics",
};

export default async function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [hasAccess, benchmarkDisplayEnabled] = await Promise.all([
    hasFeatureAccess(supabase, user.id, "analytics_page_access"),
    hasFeatureAccess(supabase, user.id, "analytics_benchmark_display"),
  ]);

  if (hasAccess) {
    return (
      <BenchmarkDisplayProvider enabled={benchmarkDisplayEnabled}>
        {children}
      </BenchmarkDisplayProvider>
    );
  }

  const checkoutEnabled = await hasFeatureAccess(
    supabase,
    user.id,
    "stripe_checkout_enabled",
  );

  if (checkoutEnabled) {
    redirect("/dashboard/billing");
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 py-12 text-center">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        Analytics requires a subscription
      </h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Owner analytics and benchmarking are part of the Essentials plan. Checkout
        is not available yet — contact{" "}
        <a
          href="mailto:support@verostr.com"
          className="font-medium text-emerald-700 underline dark:text-emerald-400"
        >
          support@verostr.com
        </a>{" "}
        for access.
      </p>
      <Link
        href="/dashboard"
        className="inline-block text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
