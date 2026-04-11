import { PmDashboardNav } from "@/components/pm-dashboard-nav";
import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";

export default async function PmDashboardLayout({
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

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <PmDashboardNav />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
