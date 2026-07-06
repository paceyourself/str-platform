import {
  destinationFromAuthState,
  loadAuthRoutingState,
} from "@/lib/auth-routing";
import { BenchmarkDisplayProvider } from "@/components/benchmark-display-context";
import { OwnerDashboardNav } from "@/components/owner-dashboard-nav";
import { hasFeatureAccess } from "@/lib/billing-rates";
import { createClient } from "@/lib/supabase-server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardLayout({
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

  const state = await loadAuthRoutingState(supabase, user.id);
  const dest = destinationFromAuthState(state);
  if (dest === "/pm/dashboard") {
    redirect("/pm/dashboard");
  }
  if (dest === "/signup") {
    redirect("/signup");
  }

  const benchmarkDisplayEnabled = await hasFeatureAccess(
    supabase,
    user.id,
    "analytics_benchmark_display",
  );

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <OwnerDashboardNav />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <BenchmarkDisplayProvider enabled={benchmarkDisplayEnabled}>
          {children}
        </BenchmarkDisplayProvider>
      </main>
    </div>
  );
}
