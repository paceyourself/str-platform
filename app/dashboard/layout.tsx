import {
  destinationFromAuthState,
  loadAuthRoutingState,
} from "@/lib/auth-routing";
import { OwnerDashboardNav } from "@/components/owner-dashboard-nav";
import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";

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

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <OwnerDashboardNav />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
