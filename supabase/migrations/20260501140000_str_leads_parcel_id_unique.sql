-- Enables Supabase upsert onConflict: 'parcel_id' for seed scripts and sync jobs.
-- Multiple NULL parcel_id values remain allowed (partial index).
CREATE UNIQUE INDEX IF NOT EXISTS str_leads_parcel_id_uidx
  ON public.str_leads (parcel_id)
  WHERE parcel_id IS NOT NULL;
