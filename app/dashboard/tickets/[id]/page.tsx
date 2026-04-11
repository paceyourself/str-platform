"use client";

import Link from "next/link";

export default function OwnerTicketDetailPage() {
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Link
        href="/dashboard/tickets"
        className="text-sm font-medium text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
      >
        ← Back to tickets
      </Link>
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        Ticket detail
      </h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Full ticket thread and history will appear here in a future update.
      </p>
    </div>
  );
}
