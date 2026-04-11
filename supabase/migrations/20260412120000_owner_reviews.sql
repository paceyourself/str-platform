-- Owner review submission: extra columns, ticket tags, RLS for owners.

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS owner_pm_relationship_id uuid REFERENCES public.owner_pm_relationships (id) ON DELETE SET NULL;

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS relationship_period_start date,
  ADD COLUMN IF NOT EXISTS relationship_period_end date;

ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_status_check;

ALTER TABLE public.reviews ADD CONSTRAINT reviews_status_check
  CHECK (status IN ('visible', 'hidden', 'pending', 'disputed', 'removed'));

CREATE INDEX IF NOT EXISTS reviews_owner_id_idx ON public.reviews (owner_id);

CREATE TABLE IF NOT EXISTS public.review_ticket_tags (
  review_id uuid NOT NULL REFERENCES public.reviews (id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.tickets (id) ON DELETE CASCADE,
  PRIMARY KEY (review_id, ticket_id)
);

CREATE INDEX IF NOT EXISTS review_ticket_tags_ticket_id_idx ON public.review_ticket_tags (ticket_id);

ALTER TABLE public.review_ticket_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "review_ticket_tags_select_owner" ON public.review_ticket_tags;
CREATE POLICY "review_ticket_tags_select_owner"
ON public.review_ticket_tags
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.reviews r
    WHERE r.id = review_id AND r.owner_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "review_ticket_tags_insert_owner" ON public.review_ticket_tags;
CREATE POLICY "review_ticket_tags_insert_owner"
ON public.review_ticket_tags
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.reviews r
    WHERE r.id = review_id AND r.owner_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = ticket_id AND t.owner_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "reviews_insert_owner" ON public.reviews;
CREATE POLICY "reviews_insert_owner"
ON public.reviews
FOR INSERT
TO authenticated
WITH CHECK (
  owner_id = auth.uid()
  AND status = 'pending'
  AND owner_pm_relationship_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.owner_pm_relationships r
    WHERE r.id = owner_pm_relationship_id
      AND r.owner_id = auth.uid()
      AND r.pm_id = pm_id
      AND r.active IS TRUE
  )
);

DROP POLICY IF EXISTS "reviews_select_owner" ON public.reviews;
CREATE POLICY "reviews_select_owner"
ON public.reviews
FOR SELECT
TO authenticated
USING (owner_id = auth.uid());
