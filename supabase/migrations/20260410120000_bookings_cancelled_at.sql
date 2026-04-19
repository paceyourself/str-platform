-- Full-history CSV uploads mark missing reservations as cancelled; store when that happened.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
=