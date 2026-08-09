-- Admins need UPDATE on properties to approve/reject ownership verification.
CREATE POLICY "Admins can update properties"
ON public.properties FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE admin_users.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE admin_users.user_id = auth.uid()
  )
);
