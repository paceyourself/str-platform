-- Survey engine: owner surveys, PM statements, notifications, booking survey flag.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS survey_triggered boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  reference_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'in_app',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_recipient_type_ref_uidx
  ON public.notifications (recipient_user_id, notification_type, reference_id);

CREATE INDEX IF NOT EXISTS notifications_recipient_idx
  ON public.notifications (recipient_user_id);

CREATE TABLE IF NOT EXISTS public.pm_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties (id) ON DELETE CASCADE,
  owner_pm_relationship_id uuid NOT NULL REFERENCES public.owner_pm_relationships (id) ON DELETE CASCADE,
  statement_period_start date NOT NULL,
  statement_period_end date NOT NULL,
  file_url text,
  survey_triggered boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pm_statements_rel_period_uidx
  ON public.pm_statements (owner_pm_relationship_id, statement_period_start);

CREATE INDEX IF NOT EXISTS pm_statements_owner_idx ON public.pm_statements (owner_id);

CREATE TABLE IF NOT EXISTS public.survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  owner_pm_relationship_id uuid NOT NULL REFERENCES public.owner_pm_relationships (id) ON DELETE CASCADE,
  pm_id uuid NOT NULL REFERENCES public.pm_profiles (id) ON DELETE CASCADE,
  property_id uuid REFERENCES public.properties (id) ON DELETE SET NULL,
  trigger_type text NOT NULL
    CHECK (trigger_type IN ('post_owner_stay', 'post_statement')),
  trigger_reference_id uuid NOT NULL,
  dimension_scores jsonb,
  comments text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS survey_responses_owner_trigger_ref_uidx
  ON public.survey_responses (owner_id, trigger_type, trigger_reference_id);

CREATE INDEX IF NOT EXISTS survey_responses_owner_idx ON public.survey_responses (owner_id);
CREATE INDEX IF NOT EXISTS survey_responses_owner_pending_idx
  ON public.survey_responses (owner_id)
  WHERE submitted_at IS NULL;

ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pm_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "survey_responses_select_own" ON public.survey_responses;
CREATE POLICY "survey_responses_select_own"
ON public.survey_responses FOR SELECT TO authenticated
USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "survey_responses_insert_own" ON public.survey_responses;
CREATE POLICY "survey_responses_insert_own"
ON public.survey_responses FOR INSERT TO authenticated
WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "survey_responses_update_own" ON public.survey_responses;
CREATE POLICY "survey_responses_update_own"
ON public.survey_responses FOR UPDATE TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "pm_statements_select_own" ON public.pm_statements;
CREATE POLICY "pm_statements_select_own"
ON public.pm_statements FOR SELECT TO authenticated
USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "pm_statements_insert_own" ON public.pm_statements;
CREATE POLICY "pm_statements_insert_own"
ON public.pm_statements FOR INSERT TO authenticated
WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own"
ON public.notifications FOR SELECT TO authenticated
USING (recipient_user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_insert_own" ON public.notifications;
CREATE POLICY "notifications_insert_own"
ON public.notifications FOR INSERT TO authenticated
WITH CHECK (recipient_user_id = auth.uid());
