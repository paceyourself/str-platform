---
name: delete-property
description: Use this skill when asked to delete or remove a property from VeroSTR. Handles the full dependency chain in correct FK order with pre-flight checks and post-deletion verification. Never run without completing Step 1 first.
---

## WARNING
This permanently deletes data. There is no undo. Always complete the 
pre-flight step before touching any data.

## Step 1 — Pre-flight: Gather All IDs
Run these queries in Supabase SQL Editor. Copy all results before proceeding.

Confirm property exists (PK on properties is `id`):
```sql
SELECT id, property_name, zip, market_id, airdna_submarket_id
FROM properties WHERE id = '<id>';
```
If 0 rows returned — STOP. Property does not exist.

Get all owner_pm_relationship IDs:
```sql
SELECT id AS relationship_id, pm_id, owner_id
FROM owner_pm_relationships WHERE property_id = '<id>';
```
Copy ALL relationship_ids — required for Steps 4–6.

Preview row counts (note these for Step 11 verification):
```sql
SELECT 'property_coverage_months' AS tbl, COUNT(*) 
  FROM property_coverage_months WHERE property_id = '<id>'
UNION ALL SELECT 'bookings', COUNT(*) FROM bookings WHERE property_id = '<id>'
UNION ALL SELECT 'upload_files', COUNT(*) FROM upload_files WHERE property_id = '<id>'
UNION ALL SELECT 'upload_batches', COUNT(*) FROM upload_batches WHERE property_id = '<id>';
```

## Steps 2–10 — Delete in FK Order
[... steps from WI-001 ...]

## Step 11 — Verify Clean Removal
Every query must return 0 before marking complete.
[... verification queries ...]