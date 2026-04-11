"use client";

import { createClient } from "@/lib/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type PmSearchRow = { id: string; company_name: string };

export default function SignupPage() {
  const router = useRouter();
  const supabase = createClient();

  const [role, setRole] = useState<"owner" | "pm">("owner");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const [companyQuery, setCompanyQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PmSearchRow[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedPm, setSelectedPm] = useState<PmSearchRow | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pmSubmitted, setPmSubmitted] = useState(false);

  const runPmSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (trimmed.length < 2) {
        setSearchResults([]);
        setSearchLoading(false);
        return;
      }
      setSearchLoading(true);
      const { data, error: qErr } = await supabase
        .from("pm_profiles")
        .select("id, company_name")
        .ilike("company_name", `%${trimmed}%`)
        .order("company_name", { ascending: true })
        .limit(20);
      setSearchLoading(false);
      if (qErr) {
        console.error(qErr);
        setSearchResults([]);
        return;
      }
      setSearchResults((data as PmSearchRow[]) ?? []);
    },
    [supabase]
  );

  useEffect(() => {
    if (role !== "pm") return;
    const t = window.setTimeout(() => {
      runPmSearch(companyQuery);
    }, 300);
    return () => window.clearTimeout(t);
  }, [companyQuery, role, runPmSearch]);

  useEffect(() => {
    if (role !== "pm") {
      setCompanyQuery("");
      setSearchResults([]);
      setSelectedPm(null);
    }
  }, [role]);

  async function handleOwnerSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName,
        },
      },
    });

    if (signUpError) {
      setLoading(false);
      setError(signUpError.message);
      return;
    }

    if (!data.user) {
      setLoading(false);
      setError("Could not create your account. Please try again.");
      return;
    }

    const { error: profileError } = await supabase.from("owner_profiles").insert({
      id: data.user.id,
      email,
      display_name: displayName,
    });

    setLoading(false);

    if (profileError) {
      setError(profileError.message);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  async function handlePmSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!selectedPm) {
      setError("Select your company from the search results.");
      return;
    }

    setLoading(true);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          role: "pm",
          company_name: selectedPm.company_name,
        },
      },
    });

    if (signUpError) {
      setLoading(false);
      setError(signUpError.message);
      return;
    }

    let userId = data.user?.id ?? null;

    if (!userId) {
      setLoading(false);
      setError("Could not create your account. Please try again.");
      return;
    }

    let session = data.session;
    if (!session) {
      const { data: signInData, error: signInErr } =
        await supabase.auth.signInWithPassword({
          email,
          password,
        });
      if (signInErr || !signInData.session) {
        setLoading(false);
        setError(
          signInErr?.message ??
            "Account created but you must confirm your email before linking your company. After confirming, log in and contact support if your claim did not complete."
        );
        return;
      }
      session = signInData.session;
      userId = signInData.session.user.id;
    }

    const { data: updated, error: claimError } = await supabase
      .from("pm_profiles")
      .update({
        claimed_by_user_id: userId,
        profile_claimed: false,
      })
      .eq("id", selectedPm.id)
      .is("claimed_by_user_id", null)
      .select("id");

    setLoading(false);

    if (claimError) {
      setError(claimError.message);
      return;
    }

    if (!updated?.length) {
      setError(
        "That company is no longer available to claim. It may already be linked to another user. Try another company or log in if you already submitted a request."
      );
      return;
    }

    setPmSubmitted(true);
  }

  if (pmSubmitted) {
    return (
      <div className="flex min-h-full flex-1 flex-col justify-center px-4 py-12">
        <div className="mx-auto w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            Request submitted
          </h1>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            Your claim request has been submitted. You will be notified when
            approved.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block text-sm font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-50"
          >
            Go to log in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-1 flex-col justify-center px-4 py-12">
      <div className="mx-auto w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Create an account
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-zinc-900 underline underline-offset-4 hover:text-zinc-700 dark:text-zinc-50 dark:hover:text-zinc-300"
          >
            Log in
          </Link>
        </p>

        <div className="mt-8">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            I am a…
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setRole("owner")}
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                role === "owner"
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-300 text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800/50"
              }`}
            >
              Property owner
            </button>
            <button
              type="button"
              onClick={() => setRole("pm")}
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                role === "pm"
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-300 text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800/50"
              }`}
            >
              Property manager
            </button>
          </div>
        </div>

        {role === "owner" ? (
          <form onSubmit={handleOwnerSubmit} className="mt-8 space-y-5">
            {error ? (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
              >
                {error}
              </div>
            ) : null}

            <div>
              <label
                htmlFor="display_name"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Display name
              </label>
              <input
                id="display_name"
                name="display_name"
                type="text"
                autoComplete="name"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none ring-zinc-400 placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
                placeholder="Jane Owner"
              />
            </div>

            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none ring-zinc-400 placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none ring-zinc-400 placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {loading ? "Creating account…" : "Sign up"}
            </button>
          </form>
        ) : (
          <form onSubmit={handlePmSubmit} className="mt-8 space-y-5">
            {error ? (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
              >
                {error}
              </div>
            ) : null}

            <div>
              <label
                htmlFor="pm_email"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Email
              </label>
              <input
                id="pm_email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
                placeholder="you@pmcompany.com"
              />
            </div>

            <div>
              <label
                htmlFor="pm_password"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Password
              </label>
              <input
                id="pm_password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
              />
            </div>

            <div className="relative">
              <label
                htmlFor="company_search"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Find your company
              </label>
              <input
                id="company_search"
                type="text"
                autoComplete="organization"
                value={companyQuery}
                onChange={(e) => {
                  setCompanyQuery(e.target.value);
                  if (
                    selectedPm &&
                    e.target.value.trim() !== selectedPm.company_name
                  ) {
                    setSelectedPm(null);
                  }
                }}
                placeholder="Search by company name…"
                className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
              />
              {selectedPm ? (
                <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                  Selected:{" "}
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    {selectedPm.company_name}
                  </span>
                </p>
              ) : null}
              {companyQuery.trim().length >= 2 ? (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                  {searchLoading ? (
                    <p className="px-3 py-2 text-sm text-zinc-500">
                      Searching…
                    </p>
                  ) : searchResults.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-zinc-500">
                      No matches. Try a different spelling.
                    </p>
                  ) : (
                    searchResults.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => {
                          setSelectedPm(row);
                          setCompanyQuery(row.company_name);
                        }}
                        className="flex w-full px-3 py-2 text-left text-sm text-zinc-900 hover:bg-zinc-100 dark:text-zinc-50 dark:hover:bg-zinc-800"
                      >
                        {row.company_name}
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {loading ? "Submitting…" : "Submit claim request"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
