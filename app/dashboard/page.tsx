import { createClient } from "@/lib/supabase-server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = user?.email ?? "there";

  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        Welcome, {email}
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        This is your dashboard home. More features can go here later.
      </p>
    </div>
  );
}
