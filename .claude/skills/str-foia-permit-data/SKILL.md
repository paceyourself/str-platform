# Market Data Acquisition Skill
**VeroSTR | Internal Use Only | v1.1 | May 2026**

Use this skill when onboarding a new STR market: acquiring permit data, enriching owner entities, deduplicating leads, seeding `str_leads`, or updating market status tracking. The authoritative reference is `STR_Market_Data_Acquisition_Playbook_v1_1.docx`.

---

## When to Use This Skill

- Filing or tracking a FOIA / public records request for STR permit data
- Enriching entity owner records against a state business registry
- Deduplicating and QA-checking lead records before seeding
- Running or updating the `str_leads` seed script
- Adding a new market to the platform
- Checking or updating `markets.str_lead_data_status`

---

## Five-Phase Process (Summary)

### Phase 1 — Market Viability
Confirm the market is worth activating before filing any requests. Check: PM interest, STR permit registry exists, entity enrichment source identified, county boundary defined.

### Phase 2 — Data Acquisition (FOIA)
File two separate requests:
1. **STR permit registry** → county clerk or STR office. Request: all active/expired/suspended permits, machine-readable (CSV preferred), including permit number, status, area, address, parcel ID, owner name, owner mailing address.
2. **Property tax roll** → County Property Appraiser. Needed for homestead exemption filter (non-homestead = likely STR) and individual owner mailing addresses.

Log each request in `markets.str_lead_data_status`. See status values in Phase 5 below.

### Phase 3 — Entity Enrichment
Classify each permit record as **entity** (LLC/Trust/Corp/LP/Inc) or **individual** (person name). For entity records, search the state business registry:

| State | Registry | URL |
|-------|----------|-----|
| FL | Sunbiz | search.sunbiz.org |
| NC | NC SOS | sosnc.gov |
| TN | TN SOS | sos.tn.gov/business |
| SC | SC SOS | sos.sc.gov/business |
| CA | CA SOS | bizfile.sos.ca.gov |
| NV | SilverFlume | esos.nv.gov |

**Fields to capture:** `sunbiz_doc_number`, `sunbiz_active_fl`, `sunbiz_status`, `sunbiz_contact_name`, `sunbiz_addr_raw`, `contact_name_clean`, `contact_street`, `contact_city`, `contact_state`, `contact_zip`.

**Outreach priority** is derived at query time — do NOT store as a column in `str_leads`.

### Phase 4 — Deduplication & QA
- **Unique key:** `parcel_id` (folio number from County PA). One record per parcel.
- ADU / multi-unit properties may generate multiple permits per parcel — resolve before seeding (keep the most recent active permit).
- QA checks before seeding: no blank `parcel_id`, no duplicate `parcel_id`, entity records have at least one contact field populated, all `str_permit_area` values match valid market zones.

### Phase 5 — Database Seeding

**Table:** `str_leads` (admin-only — RLS restricts writes to `admin_users`).

**Method:** TypeScript admin script using Supabase service role client. Upsert with `ON CONFLICT (parcel_id)` to prevent duplicates on re-runs. Log record count before and after — difference = duplicates excluded. Spot-check 5–10 records after seeding.

**Two-stage seeding for individual owners:**
- Stage 1: Seed entity records only. Skip individual owners until PA tax roll received.
- Stage 2: After PA FOIA response, enrich individual records with mailing address and homestead data, then seed as second batch using same `parcel_id` conflict rule.

**After seeding:** Update `markets.str_lead_data_status` to `seeded`.

---

## Schema Prerequisites for Each New Market

Before seeding, confirm:
- [ ] Market row exists in `markets` table with correct `id`, `name`, `state`
- [ ] `markets.str_lead_data_status` column present (deployed Sprint 11)
- [ ] `str_leads.lead_source` column present — required field, set to `'foia_[county]'` pattern
- [ ] `submarket_zip_codes` rows seeded for all zip codes in the market (for AirDNA submarket assignment)
- [ ] AirDNA submarket IDs identified for the market before seeding properties

---

## Market Status Values (`markets.str_lead_data_status`)

| Value | Meaning |
|-------|---------|
| `not_started` | No FOIA filed yet |
| `foia_filed` | Request submitted, awaiting response |
| `data_received` | Raw data received, not yet processed |
| `enrichment_in_progress` | Entity enrichment underway |
| `ready_to_seed` | QA complete, ready for database seed |
| `seeded` | `str_leads` populated, market active |
| `partial` | Entity records seeded; individual owner stage pending PA FOIA |

---

## Expansion Market Notes

| Market | Key Considerations |
|--------|-------------------|
| **Outer Banks, NC** | No statewide registry — file separate FOIAs with Dare County and Currituck County. Registry data may be incomplete. |
| **Smoky Mountains, TN** | Sevier County STRU program launched Jan 1 2024. Also file with Gatlinburg and Sevierville separately. STRs reclassified as commercial property if not primary residence. |
| **Lake Tahoe, CA/NV** | 5+ jurisdictions across two states. Start with Placer County only (permit cap 3,900, cleanest data). Two entity registries required (CA SOS + NV SilverFlume). |
| **Hilton Head, SC** | Town of Hilton Head Island manages permits directly. Annual permits expire calendar year-end — timing matters. Sea Pines has parallel HOA registration. |

---

## Key Files & Tables

| Item | Location / Value |
|------|-----------------|
| Authoritative playbook | `STR_Market_Data_Acquisition_Playbook_v1_1.docx` |
| Leads table | `str_leads` (6,715 Walton County records seeded Sprint 10) |
| Market status column | `markets.str_lead_data_status` |
| Submarket zip mapping | `submarket_zip_codes` |
| Seed script pattern | TypeScript, Supabase service role, upsert on `parcel_id` |
| Walton County records | 2,579 entity records seeded Sprint 10; individual records pending PA FOIA (Row 132) |

---

*VeroSTR | Market Data Acquisition Skill | v1.1 | May 2026*
