import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
        <div className="mx-auto max-w-lg text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
            STR Platform
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
            Transparency and accountability for short-term rental owners
          </p>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              I&apos;m a Property Owner
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-6 py-3 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              I&apos;m a Property Manager
            </Link>
          </div>

          <p className="mt-8">
            <Link
              href="/pm"
              className="text-sm font-medium text-emerald-700 underline-offset-4 hover:underline dark:text-emerald-400"
            >
              Browse PM Directory
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
