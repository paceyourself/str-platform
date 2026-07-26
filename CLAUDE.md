# VeroSTR — Claude Code Orientation

STR owner analytics and PM accountability SaaS. Owners upload booking CSVs; platform benchmarks performance against AirDNA market data and holds PMs accountable via tickets, surveys, and reviews.

## Stack
- **Framework:** Next.js 16 (App Router), TypeScript
- **Database:** Supabase (Postgres), RLS enabled on all tables
- **Hosting:** Vercel
- **Payments:** Stripe (hosted checkout)
- **Email:** Resend
- **Schema version:** v0.19 (41 tables) — see `STR_Platform_Database_Schema_Current.docx`

## Key Files
| File | Purpose |
|------|---------|
| `.cursor/rules/verostr.mdc` | **Read first.** Standing invariants for analytics, billing, schema. |
| `lib/period-stats.ts` | Period calculations (CYTD/LTM/LFY). Async — always await. |
| `lib/coverage-completeness.ts` | `data_complete` Case 1/2 logic. Never bypass. |
| `lib/billing-rates.ts` | Reads pricing from `platform_pricing` table. Never hardcode prices. |
| `scripts/ingest-airdna.ts` | AirDNA benchmark ingestion. Run monthly after prior month closes. |
| `scripts/generate-brand-icons.mjs` | Generates favicon and apple-touch-icon. |
| `lib/period-default.ts` | Shared CYTD→LTM→LFY period resolver. Used by dashboard and analytics. |
| `components/legal/legal-page-shell.tsx` | Shared layout for all legal pages (/terms, /privacy, /privacy/ccpa, /settings). |
| `lib/supabase-admin.ts` | Admin Supabase client (SECURITY DEFINER). Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — never NEXT_PUBLIC_ variants. |
| `lib/app-url.ts` | getAppBaseUrl() — reads NEXT_PUBLIC_APP_URL first. Must be set in Vercel Production or Stripe redirects to Vercel preview URL. |

## Supabase Conventions
- Use `supabase` client from `lib/supabase.ts`; admin operations use `lib/supabase-admin.ts`
- RLS is active — always test queries under the correct role
- Migrations live in `supabase/migrations/` — never alter schema outside a migration file
- Pricing: always read via `get_current_rate('rate_key')` — never hardcode dollar amounts or trial lengths

## STR Data Rules
- Revenue column: `gross_revenue` only — `net_owner_revenue` does not exist
- Nights: always compute as `(check_out::date - check_in::date)` — no `nights` column
- Cross-month bookings must be prorated — see proration formula in `verostr.mdc`
- Future bookings excluded from all analytics via `check_in < CURRENT_DATE`
- RevPAR denominator = `available_nights`; ADR denominator = `prorated_booked_nights` — never swap
- `benchmark_occ` stored as 0–100 scale — do not divide by 100
- `markets.display_name` — markets table name column is `display_name` not `name`; `name` does not exist
- `subscriptions.tos_version_accepted` + `tos_accepted_at` — written by webhook on `checkout.session.completed`. TOS_VERSION constant defined in `app/api/billing/checkout/route.ts`.
- `feature_flags.owner_tiers text[]` + `pm_tiers text[]` — must be populated on every new flag INSERT; control which subscription tiers the flag applies to, separate from `active`. Omitting/mis-populating doesn't error, it silently mis-scopes the flag.

## AirDNA Benchmark Notes
- `market_benchmarks` has no `week_start_date` column — derive via `to_date(year::text || '-' || week_number::text, 'IYYY-IW')`
- Submarket rows: `WHERE submarket_id = :id`; market-level rows: `WHERE submarket_id IS NULL`
- Only plot benchmark weeks where the corresponding month has `data_complete = true` in `property_coverage_months`
