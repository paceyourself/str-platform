"use client";

import { SignOutButton } from "@/components/sign-out-button";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  {
    href: "/pm/dashboard",
    label: "Dashboard",
    active: (p: string) =>
      p.startsWith("/pm/dashboard") &&
      !p.startsWith("/pm/dashboard/requests"),
  },
  {
    href: "/pm/dashboard/requests/new",
    label: "Submit Request",
    active: (p: string) => p.startsWith("/pm/dashboard/requests"),
  },
] as const;

function linkClass(active: boolean) {
  return [
    "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
    active
      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100"
      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
  ].join(" ");
}

export function PmDashboardNav() {
  const pathname = usePathname();
  const path = pathname.replace(/\/$/, "") || "/";

  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-6 px-4">
        <Link
          href="/pm/dashboard"
          className="shrink-0 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
        >
          STR Platform
        </Link>

        <nav
          className="flex flex-1 flex-wrap items-center justify-end gap-1 sm:gap-2"
          aria-label="PM dashboard"
        >
          {ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={linkClass(item.active(path))}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="shrink-0">
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
