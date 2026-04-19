-- Unclaimed PM alert when an owner files a ticket: log notification + invoke Edge Function (email).
-- Depends on pm_profiles.notification_email.
--
-- Email delivery: enable pg_net (Dashboard → Database → Extensions) if needed, deploy
-- supabase/functions/send-ticket-pm-alert, then store secrets (SQL editor), e.g.:
--   select vault.create_secret('ticket_pm_alert_function_url',
--     'https://<project-ref>.supabase.co/functions/v1/send-ticket-pm-alert');
--   select vault.create_secret('ticket_pm_alert_function_auth', '<service_role_jwt>');
-- Optional fallback (no Vault): set database settings app.settings.ticket_pm_alert_function_url
-- and app.settings.ticket_pm_alert_function_auth on role postgres.

CREATE EXTENSION IF NOT EXISTS pg_net;

DROP INDEX IF EXISTS public.notifications_recipient_type_ref_uidx;

ALTER TABLE public.notifications
  ALTER COLUMN recipient_user_id DROP NOT NULL;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS recipient_email text;

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
  );

CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_type_ref_uidx
  ON public.notifications (recipient_user_id, notification_type, reference_id)
  WHERE recipient_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_email_type_ref_uidx
  ON public.notifications (recipient_email, notification_type, reference_id)
  WHERE recipient_email IS NOT NULL;

CREATE OR REPLACE FUNCTION public.notify_unclaimed_pm_on_ticket ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company text;
  v_email text;
  v_claimed boolean;
  v_url text;
  v_auth text;
  v_notif_logged boolean := false;
BEGIN
  SELECT
    pp.company_name,
    pp.notification_email,
    pp.profile_claimed
  INTO v_company, v_email, v_claimed
  FROM public.pm_profiles pp
  WHERE pp.id = NEW.pm_id;

  IF NOT FOUND
    OR v_claimed IS DISTINCT FROM false
    OR v_email IS NULL
    OR btrim(v_email) = '' THEN
    RETURN NEW;
  END IF;

  v_email := btrim(v_email);

  BEGIN
    INSERT INTO public.notifications (
      recipient_user_id,
      recipient_email,
      notification_type,
      reference_id,
      channel
    )
    VALUES (
      NULL,
      v_email,
      'ticket_pm_alert',
      NEW.id,
      'email'
    );
    v_notif_logged := true;
  EXCEPTION
    WHEN unique_violation THEN
      v_notif_logged := false;
    WHEN OTHERS THEN
      RAISE WARNING 'notify_unclaimed_pm_on_ticket notifications insert: %', SQLERRM;
      v_notif_logged := false;
  END;

  IF NOT v_notif_logged THEN
    RETURN NEW;
  END IF;

  v_url := NULL;
  v_auth := NULL;

  BEGIN
    SELECT ds.decrypted_secret
    INTO v_url
    FROM vault.decrypted_secrets AS ds
    WHERE ds.name = 'ticket_pm_alert_function_url'
    LIMIT 1;
  EXCEPTION
    WHEN OTHERS THEN
      v_url := NULL;
  END;

  BEGIN
    SELECT ds.decrypted_secret
    INTO v_auth
    FROM vault.decrypted_secrets AS ds
    WHERE ds.name = 'ticket_pm_alert_function_auth'
    LIMIT 1;
  EXCEPTION
    WHEN OTHERS THEN
      v_auth := NULL;
  END;

  IF v_url IS NULL OR v_url = '' THEN
    v_url := nullif(current_setting('app.settings.ticket_pm_alert_function_url', true), '');
  END IF;

  IF v_auth IS NULL OR v_auth = '' THEN
    v_auth := nullif(current_setting('app.settings.ticket_pm_alert_function_auth', true), '');
  END IF;

  IF v_url IS NULL OR v_url = '' OR v_auth IS NULL OR v_auth = '' THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_auth
      ),
      body := jsonb_build_object(
        'to', btrim(v_email),
        'ticket_id', NEW.id,
        'queue', NEW.queue,
        'title', NEW.title,
        'company_name', v_company
      ),
      timeout_milliseconds := 10000
    );
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'notify_unclaimed_pm_on_ticket pg_net: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tickets_notify_unclaimed_pm_after_insert ON public.tickets;

CREATE TRIGGER tickets_notify_unclaimed_pm_after_insert
AFTER INSERT ON public.tickets
FOR EACH ROW
WHEN (NEW.status = 'open' AND NEW.direction = 'owner_to_pm')
EXECUTE FUNCTION public.notify_unclaimed_pm_on_ticket ();
