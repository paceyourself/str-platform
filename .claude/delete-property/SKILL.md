---
name: delete-property
description: Use this skill when asked to delete or remove a property from VeroSTR. Handles the full dependency chain in correct FK order with pre-flight checks and post-deletion verification. Never run without completing Step 1 first.
---

## WARNING
This permanently deletes data. There is no undo. Always complete Step 1 before touching any data.

## Step 0 — (When starting from email) Resolve property IDs

If given an owner email instead of a property ID, look up their properties first:

```
GET /auth/v1/admin/users?email=<owner_email>
→ extract user id

GET /rest/v1/properties?owner_id=eq.<user_id>&select=id,property_name,zip,market_id
→ collect all property IDs
```

Run Steps 1–10 for each property ID. If multiple properties, complete all pre-flight before deleting any.

## Step 1 — Pre-flight: Gather All IDs

Run all queries and copy results before proceeding.

**Query 1 — Confirm property exists:**
```sql
SELECT id, property_name, zip, market_id, airdna_submarket_id
FROM properties WHERE id = '<id>';
```
If 0 rows returned — STOP.

**Query 2 — Get all relationship IDs:**
```sql
SELECT id AS relationship_id, pm_id, owner_id
FROM owner_pm_relationships WHERE property_id = '<id>';
```
Copy ALL relationship_ids — required for Steps 5–7.

**Query 3 — Preview row counts (note for Step 11 verification):**
```sql
SELECT 'property_coverage_months' AS tbl, COUNT(*) FROM property_coverage_months WHERE property_id = '<id>'
UNION ALL SELECT 'bookings',          COUNT(*) FROM bookings          WHERE property_id = '<id>'
UNION ALL SELECT 'upload_files',      COUNT(*) FROM upload_files      WHERE property_id = '<id>'
UNION ALL SELECT 'upload_batches',    COUNT(*) FROM upload_batches    WHERE property_id = '<id>'
UNION ALL SELECT 'survey_responses',  COUNT(*) FROM survey_responses  WHERE owner_pm_relationship_id IN (SELECT id FROM owner_pm_relationships WHERE property_id = '<id>')
UNION ALL SELECT 'reviews',           COUNT(*) FROM reviews           WHERE owner_pm_relationship_id IN (SELECT id FROM owner_pm_relationships WHERE property_id = '<id>');
```

## Steps 2–10 — Delete in FK Order

All steps below use `property_id = '<id>'` unless noted.

### Step 2 — Delete property_coverage_months
```sql
DELETE FROM property_coverage_months WHERE property_id = '<id>';
```

### Step 3 — Delete bookings
```sql
DELETE FROM bookings WHERE property_id = '<id>';
```

### Step 4 — Delete upload_files
```sql
DELETE FROM upload_files WHERE property_id = '<id>';
```

### Step 5 — Delete upload_batches
```sql
DELETE FROM upload_batches WHERE property_id = '<id>';
```

### Step 6 — Delete survey_responses
Use ALL relationship IDs from Step 1 Query 2.
```sql
DELETE FROM survey_responses
WHERE owner_pm_relationship_id IN (
  '<relationship_id_1>',
  '<relationship_id_2>'  -- add more if needed
);
```

### Step 7 — Delete reviews
```sql
DELETE FROM reviews
WHERE owner_pm_relationship_id IN (
  '<relationship_id_1>',
  '<relationship_id_2>'
);
```

### Step 8 — Delete tickets
```sql
DELETE FROM tickets
WHERE owner_pm_relationship_id IN (
  '<relationship_id_1>',
  '<relationship_id_2>'
);
```

### Step 9 — Delete owner_pm_relationships
```sql
DELETE FROM owner_pm_relationships WHERE property_id = '<id>';
```

### Step 10 — Delete property
```sql
DELETE FROM properties WHERE id = '<id>';
```
If this returns a 409 FK error, a dependent table was missed. Read the error message — it names the blocking table and constraint.

## Step 11 — Verify Clean Removal

Every query must return 0 before marking complete.

```sql
SELECT COUNT(*) FROM properties              WHERE id          = '<id>';
SELECT COUNT(*) FROM property_coverage_months WHERE property_id = '<id>';
SELECT COUNT(*) FROM bookings                WHERE property_id = '<id>';
SELECT COUNT(*) FROM upload_files            WHERE property_id = '<id>';
SELECT COUNT(*) FROM upload_batches          WHERE property_id = '<id>';
SELECT COUNT(*) FROM owner_pm_relationships  WHERE property_id = '<id>';
SELECT COUNT(*) FROM survey_responses        WHERE owner_pm_relationship_id IN (SELECT id FROM owner_pm_relationships WHERE property_id = '<id>');
SELECT COUNT(*) FROM reviews                 WHERE owner_pm_relationship_id IN (SELECT id FROM owner_pm_relationships WHERE property_id = '<id>');
```

Note: the last two queries will return 0 automatically once owner_pm_relationships is deleted (the subquery returns no IDs). That is expected and correct.

## Full Dependency Chain — Reference

| Step | Table | FK Column | References |
|------|-------|-----------|------------|
| 2 | property_coverage_months | property_id | properties.id |
| 3 | bookings | property_id | properties.id |
| 4 | upload_files | property_id | properties.id |
| 5 | upload_batches | property_id | properties.id |
| 6 | survey_responses | owner_pm_relationship_id | owner_pm_relationships.id |
| 7 | reviews | owner_pm_relationship_id | owner_pm_relationships.id |
| 8 | tickets | owner_pm_relationship_id | owner_pm_relationships.id |
| 9 | owner_pm_relationships | property_id | properties.id |
| 10 | properties | — | (root) |
