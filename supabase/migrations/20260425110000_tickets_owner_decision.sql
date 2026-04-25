ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS owner_decision text
  CHECK (owner_decision IN ('approved', 'declined'));