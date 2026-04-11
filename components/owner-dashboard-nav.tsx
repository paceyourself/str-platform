"use client";

import { SignOutButton } from "@/components/sign-out-button";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type NavItem = { href: string; label: string; active: (path: string) => boolean };

const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    active: (p) =>
      p === "/dashboard" || (p.startsWith("/dashboard") && !isMoreSpecificDashboard(p)),
  },
  {
    href: "/dashboard/properties",
    label: "Properties",
    active: (p) => p.startsWith("/dashboard/properties"),
  },
  {
    href: "/dashboard/upload",
    label: "Bookings",
    active: (p) => p.startsWith("/dashboard/upload"),
  },
  {
    href: "/dashboard/tickets",
    label: "Tickets",
    active: (p) => p.startsWith("/dashboard/tickets"),
  },
  {
    href: "/dashboard/surveys",
    label: "Surveys",
    active: (p) => p.startsWith("/dashboard/surveys"),
  },
  {
    href: "/dashboard/reviews",
    label: "Reviews",
    active: (p) => p.startsWith("/dashboard/reviews"),
  },
  {
    href: "/pm",
    label: "Find a PM",
    active: (p) => p === "/pm" || (p.startsWith("/pm/") && !p.startsWith("/pm/dashboard")),
  },
];

function isMoreSpecificDashboard(path: string) {
  const prefixes = [
    "/dashboard/properties",
    "/dashboard/upload",
    "/dashboard/tickets",
    "/dashboard/surveys",
    "/dashboard/reviews",
  ];
  return prefixes.some((prefix) => path.startsWith(prefix));
}

function linkClass(active: boolean) {
  return [
    "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
    active
      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100"
      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
  ].join(" ");
}

export function OwnerDashboardNav() {
  const pathname = usePathname();
  const path = pathname.replace(/\/$/, "") || "/";
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
        <Link
          href="/dashboard"
          className="shrink-0 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          onClick={() => setMenuOpen(false)}
        >
          STR Platform
        </Link>

        <nav
          className="hidden flex-1 items-center justify-center gap-1 md:flex lg:gap-2"
          aria-label="Main"
        >
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={linkClass(item.active(path))}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center md:flex">
          <SignOutButton />
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            aria-expanded={menuOpen}
            aria-controls="owner-dashboard-mobile-nav"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? (
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            ) : (
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            )}
          </button>
          <SignOutButton />
        </div>
      </div>

      {menuOpen ? (
        <div
          id="owner-dashboard-mobile-nav"
          className="border-t border-zinc-200 px-4 py-3 md:hidden dark:border-zinc-800"
        >
          <nav className="flex flex-col gap-1" aria-label="Mobile main">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={linkClass(item.active(path))}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      ) : null}
    </header>
  );
}
