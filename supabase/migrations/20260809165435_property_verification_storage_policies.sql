-- Owner verification document uploads under attachments/property-verification/{property_id}/...

CREATE POLICY "attachments_property_verification_insert_own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'attachments'
  AND (storage.foldername(name))[1] = 'property-verification'
  AND EXISTS (
    SELECT 1
    FROM public.properties p
    WHERE p.id::text = (storage.foldername(name))[2]
      AND p.owner_id = auth.uid()
      AND p.deleted_at IS NULL
  )
);

CREATE POLICY "attachments_property_verification_select_own"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'attachments'
  AND (storage.foldername(name))[1] = 'property-verification'
  AND EXISTS (
    SELECT 1
    FROM public.properties p
    WHERE p.id::text = (storage.foldername(name))[2]
      AND p.owner_id = auth.uid()
      AND p.deleted_at IS NULL
  )
);

CREATE POLICY "attachments_property_verification_select_admin"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'attachments'
  AND (storage.foldername(name))[1] = 'property-verification'
  AND EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE admin_users.user_id = auth.uid()
  )
);
