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
| `lib/period-default.ts` | Shared CYTD → LTM → LFY default resolver for dashboard + analytics. |
| `lib/coverage-completeness.ts` | `data_complete` Case 1/2 logic. Never bypass. |
| `lib/billing-rates.ts` | Reads pricing from `platform_pricing` via `get_current_rate({ rate_key })`. Never hardcode prices. |
| `components/owner-dashboard-nav.tsx` | Owner nav; Billing + Sign out in user menu dropdown. |
| `scripts/ingest-airdna.ts` | AirDNA benchmark ingestion. Run monthly after prior month closes. |
| `scripts/generate-brand-icons.mjs` | Generates favicon and apple-touch-icon. |

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

## AirDNA Benchmark Notes
- `market_benchmarks` has no `week_start_date` column — derive via `to_date(year::text || '-' || week_number::text, 'IYYY-IW')`
- Submarket rows: `WHERE submarket_id = :id`; market-level rows: `WHERE submarket_id IS NULL`
- Only plot benchmark weeks where the corresponding month has `data_complete = true` in `property_coverage_months`
