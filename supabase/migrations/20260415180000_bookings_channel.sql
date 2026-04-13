-- Optional OTA / source label (ticket picker, reporting). Populated by imports or app logic.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS channel text;
