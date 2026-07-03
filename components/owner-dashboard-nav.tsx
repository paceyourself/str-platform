"use client";

import { SignOutButton } from "@/components/sign-out-button";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type NavItem = {
  href: string;
  label: string;
  active: (path: string) => boolean;
};

const PRIMARY_NAV: NavItem[] = [
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
    label: "Data Load",
    active: (p) => p.startsWith("/dashboard/upload"),
  },
  {
    href: "/dashboard/analytics",
    label: "Analytics",
    active: (p) => p.startsWith("/dashboard/analytics"),
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
    "/dashboard/analytics",
    "/dashboard/billing",
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

function UserMenu({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!open) return;
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const billingActive = path.startsWith("/dashboard/billing");

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        onClick={() => setOpen((o) => !o)}
        className={[
          "inline-flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold transition-colors",
          billingActive
            ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
            : "border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800",
        ].join(" ")}
      >
        <svg
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.25a8.25 8.25 0 0115 0"
          />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 min-w-[11rem] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          <Link
            href="/dashboard/billing"
            role="menuitem"
            className={linkClass(billingActive)}
            onClick={() => setOpen(false)}
          >
            Billing
          </Link>
          <span
            role="menuitem"
            aria-disabled="true"
            className="block cursor-default px-2.5 py-1.5 text-sm text-zinc-400 dark:text-zinc-500"
          >
            Settings
          </span>
          <div className="my-1 border-t border-zinc-200 dark:border-zinc-700" />
          <div className="px-1 py-0.5">
            <SignOutButton className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100" />
          </div>
        </div>
      ) : null}
    </div>
  );
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
          {PRIMARY_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={linkClass(item.active(path))}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <UserMenu path={path} />
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-100 md:hidden dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
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
        </div>
      </div>

      {menuOpen ? (
        <div
          id="owner-dashboard-mobile-nav"
          className="border-t border-zinc-200 px-4 py-3 md:hidden dark:border-zinc-800"
        >
          <nav className="flex flex-col gap-1" aria-label="Mobile main">
            {PRIMARY_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={linkClass(item.active(path))}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/dashboard/billing"
              className={linkClass(path.startsWith("/dashboard/billing"))}
              onClick={() => setMenuOpen(false)}
            >
              Billing
            </Link>
            <span className="rounded-md px-2.5 py-1.5 text-sm text-zinc-400 dark:text-zinc-500">
              Settings
            </span>
            <div className="pt-1">
              <SignOutButton />
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
