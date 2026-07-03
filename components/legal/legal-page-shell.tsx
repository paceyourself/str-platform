import Link from "next/link";
import type { ReactNode } from "react";

export function LegalPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <Link
            href="/"
            className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            VeroSTR
          </Link>
          <nav className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            <Link
              href="/terms"
              className="hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Terms
            </Link>
            <Link
              href="/terms/pm-sponsored"
              className="hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              PM-sponsored Terms
            </Link>
            <Link
              href="/privacy"
              className="hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Privacy
            </Link>
            <Link
              href="/privacy/ccpa"
              className="hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              CCPA
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        {children}
      </main>
    </div>
  );
}

export function LegalH1({ children }: { children: ReactNode }) {
  return (
    <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
      {children}
    </h1>
  );
}

export function LegalH2({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-8 text-base font-semibold uppercase tracking-wide text-zinc-900 dark:text-zinc-50">
      {children}
    </h2>
  );
}

export function LegalH3({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-6 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
      {children}
    </h3>
  );
}

export function LegalP({
  children,
  id,
}: {
  children: ReactNode;
  id?: string;
}) {
  return (
    <p
      id={id}
      className="mt-4 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300"
    >
      {children}
    </p>
  );
}

export function LegalUl({ children }: { children: ReactNode }) {
  return (
    <ul className="mt-4 list-disc space-y-2 pl-6 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
      {children}
    </ul>
  );
}

export function LegalOl({ children }: { children: ReactNode }) {
  return (
    <ol className="mt-4 list-decimal space-y-2 pl-6 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
      {children}
    </ol>
  );
}

export function LegalLi({ children }: { children: ReactNode }) {
  return <li>{children}</li>;
}

export function LegalA({
  href,
  children,
  external,
}: {
  href: string;
  children: ReactNode;
  external?: boolean;
}) {
  const className =
    "font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300";
  if (external || href.startsWith("http") || href.startsWith("mailto:")) {
    return (
      <a href={href} className={className} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

export function LegalLastUpdated({ children }: { children: ReactNode }) {
  return (
    <p className="mt-10 border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      {children}
    </p>
  );
}

export function LegalAddress({ children }: { children: ReactNode }) {
  return (
    <address className="mt-2 not-italic text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
      {children}
    </address>
  );
}
