---
name: ingest-market-data
description: Use this skill when ingesting STR market data from a source CSV or API into Supabase. Covers cleaning, validation, schema mapping, and load verification.
---

## Steps
1. Read the source file from /data/raw/
2. Validate required columns: [market_id, listing_id, revenue, occupancy_rate, date]
3. Clean nulls and normalize date format to ISO 8601
4. Map to the `str_listings` Supabase table schema
5. Insert via the Python ingestion script at /scripts/ingest.py
6. Run row count verification query to confirm load succeeded
7. Log results to /logs/ingest_log.txt

## Rules
- Never overwrite existing records — use upsert logic
- Flag anomalies (occupancy > 100%, negative revenue) to /logs/anomalies.csv rather than dropping them
- Always confirm affected row count before closing session