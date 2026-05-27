-- Owner PM mapping configuration requests: notifications + attachments storage policies.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS body text,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

ALTER TABLE public.notifications
  ALTER COLUMN reference_id DROP NOT NULL;

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_recipient_chk;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_recipient_chk CHECK (
    (
      recipient_user_id IS NOT NULL
      AND recipient_email IS NULL
    )
    OR (
      recipient_user_id IS NULL
      AND recipient_email IS NOT NULL
    )
    OR (
      recipient_user_id IS NULL
      AND recipient_email IS NULL
      AND notification_type = 'pm_mapping_request'
    )
  );

DROP POLICY IF EXISTS "notifications_insert_pm_mapping_request" ON public.notifications;
CREATE POLICY "notifications_insert_pm_mapping_request"
ON public.notifications FOR INSERT TO authenticated
WITH CHECK (
  notification_type = 'pm_mapping_request'
  AND recipient_user_id IS NULL
  AND recipient_email IS NULL
  AND (metadata->>'owner_id')::uuid = auth.uid()
);

DROP POLICY IF EXISTS "notifications_select_admin_pm_mapping_request" ON public.notifications;
CREATE POLICY "notifications_select_admin_pm_mapping_request"
ON public.notifications FOR SELECT TO authenticated
USING (
  notification_type = 'pm_mapping_request'
  AND recipient_user_id IS NULL
  AND recipient_email IS NULL
  AND EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE admin_users.user_id = auth.uid()
  )
);

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('attachments', 'attachments', false, 10485760)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "attachments_pm_mapping_insert_own" ON storage.objects;
CREATE POLICY "attachments_pm_mapping_insert_own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'attachments'
  AND (storage.foldername(name))[1] = 'pm-mapping-requests'
  AND EXISTS (
    SELECT 1
    FROM public.owner_pm_relationships opr
    WHERE opr.owner_id = auth.uid()
      AND opr.active = true
      AND opr.pm_id::text = (storage.foldername(name))[2]
  )
);

DROP POLICY IF EXISTS "attachments_pm_mapping_select_admin" ON storage.objects;
CREATE POLICY "attachments_pm_mapping_select_admin"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'attachments'
  AND (storage.foldername(name))[1] = 'pm-mapping-requests'
  AND EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE admin_users.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "attachments_pm_mapping_select_own" ON storage.objects;
CREATE POLICY "attachments_pm_mapping_select_own"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'attachments'
  AND (storage.foldername(name))[1] = 'pm-mapping-requests'
  AND EXISTS (
    SELECT 1
    FROM public.owner_pm_relationships opr
    WHERE opr.owner_id = auth.uid()
      AND opr.active = true
      AND opr.pm_id::text = (storage.foldername(name))[2]
  )
);
