import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";

export default async function AdminLayout({
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

  const { data: adminRow } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .single();

  if (!adminRow) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-6 px-4 py-3">
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            VeroSTR Admin
          </span>
          
          <nav className="flex flex-wrap items-center gap-4 text-xs">
       <a href="/admin/admin-dashboard" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
    Admin Dashboard
  </a>
  <a href="/admin/analytics" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
    Analytics
  </a>
  <a href="/admin/owners" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
    Owners
  </a>
  <a href="/admin/properties" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
    Properties
  </a>
  <a href="/admin" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
    Reviews
  </a>
  <a href="/admin/pricing" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
    Pricing
  </a>
  <a href="/admin/settings" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
    Settings
  </a>
  <a href="/admin/user-management" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
    User Mgt
  </a>
  <a href="/admin/file-format-editor" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
    File Format Editor
  </a>
  <a href="/admin/admin-help" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
    Admin Help
  </a>
</nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        {children}
      </main>
    </div>
  );
}