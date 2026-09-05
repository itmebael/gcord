-- G-Cord: migration for the EXISTING Supabase schema in gcord_schema.sql.
-- Run once in the Supabase SQL Editor as the database owner, after existing migrations.
-- Do NOT rerun gcord_schema.sql: that file drops tables and recreates seed data.
-- Coordinate deployment with frontend changes: role values become 'admin'.
-- Assumptions: verified = successfully claimed; created_by_user_id = claiming staff.
-- New earnings only; historical transactions are deliberately not awarded earnings.
-- Formula: round(amount * rate / basis, 2), proportional (PHP 250 earns PHP 5).
-- Rates are snapshotted on first qualification; later rate changes are prospective.

BEGIN;
SET LOCAL search_path = public, pg_catalog;

-- Handle both the original enum and databases that already contain both labels.
-- Keep the legacy enum label when both exist to preserve dependent objects/history.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.user_role'::regtype
             AND enumlabel = 'super_admin') THEN
    IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.user_role'::regtype
               AND enumlabel = 'admin') THEN
      UPDATE public.users SET role = 'admin' WHERE role::text = 'super_admin';
    ELSE
      ALTER TYPE public.user_role RENAME VALUE 'super_admin' TO 'admin';
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.app_is_admin()
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$ SELECT COALESCE(public.app_current_user_role()::text = 'admin', false) $$;

CREATE OR REPLACE FUNCTION public.app_notify_admins(
  p_category notif_category, p_title text, p_body text, p_ref_no text,
  p_transaction_id bigint, p_severity notif_severity
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE v_count integer; v_actor bigint := public.app_current_user_id();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO public.notifications
    (user_id, category, title, body, ref_no, transaction_id, severity, is_read)
  SELECT id, p_category, p_title, p_body, p_ref_no, p_transaction_id, p_severity, false
  FROM public.users WHERE status = 'active' AND role = 'admin' AND id <> v_actor;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- Optional provider data: do not invent a name or infer it from a phone number.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS gcash_owner_masked_name varchar(160),
  ADD COLUMN IF NOT EXISTS gcash_account_number varchar(20),
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by_name varchar(160);

CREATE TABLE IF NOT EXISTS public.staff_earning_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  earning_rate numeric(12,2) NOT NULL CHECK (earning_rate >= 0),
  transaction_basis numeric(12,2) NOT NULL CHECK (transaction_basis > 0),
  updated_by bigint REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.staff_earning_settings(id, earning_rate, transaction_basis)
VALUES (true, 10, 500) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.staff_earnings (
  transaction_id bigint PRIMARY KEY REFERENCES public.transactions(id) ON DELETE CASCADE,
  staff_user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  transaction_amount numeric(12,2) NOT NULL CHECK (transaction_amount > 0),
  earning_rate numeric(12,2) NOT NULL CHECK (earning_rate >= 0),
  transaction_basis numeric(12,2) NOT NULL CHECK (transaction_basis > 0),
  earnings numeric(18,2) GENERATED ALWAYS AS
    (round(transaction_amount * earning_rate / transaction_basis, 2)) STORED,
  earned_at timestamptz NOT NULL,
  voided boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_staff_earnings_period
  ON public.staff_earnings(staff_user_id, earned_at) WHERE NOT voided;

ALTER TABLE public.staff_earning_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_earnings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_earning_settings, public.staff_earnings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.staff_earning_settings, public.staff_earnings TO anon, authenticated;
DROP POLICY IF EXISTS earning_settings_read ON public.staff_earning_settings;
CREATE POLICY earning_settings_read ON public.staff_earning_settings FOR SELECT TO anon, authenticated
  USING (public.app_current_user_id() IS NOT NULL);
DROP POLICY IF EXISTS earnings_read ON public.staff_earnings;
CREATE POLICY earnings_read ON public.staff_earnings FOR SELECT TO anon, authenticated
  USING (public.app_is_admin() OR staff_user_id = public.app_current_user_id());

CREATE OR REPLACE FUNCTION public.app_set_earning_rate(p_rate numeric, p_basis numeric)
RETURNS public.staff_earning_settings LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE v_result public.staff_earning_settings;
BEGIN
  IF NOT public.app_is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_rate IS NULL OR p_basis IS NULL OR p_rate < 0 OR p_basis <= 0
     OR p_rate >= 10000000000 OR p_basis >= 10000000000
     OR round(p_basis, 2) <= 0 THEN
    RAISE EXCEPTION 'Rate must be nonnegative and basis must be positive, within numeric(12,2) limits';
  END IF;
  UPDATE public.staff_earning_settings SET earning_rate = p_rate,
    transaction_basis = p_basis, updated_by = public.app_current_user_id(), updated_at = now()
  WHERE id RETURNING * INTO v_result;
  RETURN v_result;
END $$;

-- Ref-level serialization catches concurrent duplicate scans at the database layer.
-- Existing historical rows are not rewritten. Audit old repeated verified refs separately.
CREATE OR REPLACE FUNCTION public.app_prepare_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE v_original bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.ref_no, NEW.amount, NEW.created_by_user_id, NEW.status,
           NEW.matched_transaction_id, NEW.claimed_at, NEW.claimed_by_name)
       IS DISTINCT FROM
       ROW(OLD.ref_no, OLD.amount, OLD.created_by_user_id, OLD.status,
           OLD.matched_transaction_id, OLD.claimed_at, OLD.claimed_by_name) THEN
      -- Monetary and attribution corrections need admin authorization.
      IF NOT public.app_is_admin() THEN RAISE EXCEPTION 'Admin access required to modify a claim'; END IF;
      IF NEW.ref_no IS DISTINCT FROM OLD.ref_no OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
         OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at OR NEW.claimed_by_name IS DISTINCT FROM OLD.claimed_by_name THEN
        RAISE EXCEPTION 'Claim reference, staff and claim timestamp are immutable';
      END IF;
    END IF;
  END IF;
  NEW.ref_no := regexp_replace(COALESCE(NEW.ref_no, ''), '[^0-9]', '', 'g');
  IF NEW.ref_no = '' THEN RAISE EXCEPTION 'Reference number is required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.ref_no, 0));
  SELECT t.id INTO v_original FROM public.transactions t
  WHERE regexp_replace(t.ref_no, '[^0-9]', '', 'g') = NEW.ref_no
    AND t.status = 'verified' AND t.id <> NEW.id ORDER BY t.id LIMIT 1;
  IF v_original IS NOT NULL THEN
    NEW.status := 'duplicate'; NEW.matched_transaction_id := v_original;
  ELSIF NEW.status = 'verified' THEN
    NEW.matched_transaction_id := NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.claimed_at := NULL; NEW.claimed_by_name := NULL;
  END IF;
  IF NEW.status = 'verified' AND NEW.claimed_at IS NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    NEW.claimed_at := clock_timestamp();
    SELECT full_name INTO NEW.claimed_by_name FROM public.users WHERE id = NEW.created_by_user_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_prepare_claim ON public.transactions;
CREATE TRIGGER trg_prepare_claim BEFORE INSERT OR UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.app_prepare_claim();

CREATE OR REPLACE FUNCTION public.app_record_staff_earnings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.status = 'duplicate' THEN
    UPDATE public.staff_earnings SET voided = true WHERE transaction_id = NEW.id;
    IF NEW.matched_transaction_id IS NOT NULL THEN
      INSERT INTO public.duplicate_events(ref_no, original_transaction_id, duplicate_transaction_id, amount)
      VALUES (NEW.ref_no, NEW.matched_transaction_id, NEW.id, NEW.amount)
      ON CONFLICT (original_transaction_id, duplicate_transaction_id) DO NOTHING;
    END IF;
  ELSIF NEW.claimed_at IS NOT NULL THEN
    INSERT INTO public.staff_earnings
      (transaction_id, staff_user_id, transaction_amount, earning_rate, transaction_basis, earned_at)
    SELECT NEW.id, u.id, NEW.amount, s.earning_rate, s.transaction_basis, NEW.claimed_at
    FROM public.users u CROSS JOIN public.staff_earning_settings s
    WHERE u.id = NEW.created_by_user_id AND u.role = 'staff' AND s.id
    ON CONFLICT (transaction_id) DO UPDATE
      SET transaction_amount = EXCLUDED.transaction_amount, voided = false;
    -- The original rate, basis and earned_at deliberately remain unchanged.
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_record_staff_earnings ON public.transactions;
CREATE TRIGGER trg_record_staff_earnings AFTER INSERT OR UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.app_record_staff_earnings();

CREATE OR REPLACE FUNCTION public.app_staff_earnings_summary(p_staff_user_id bigint DEFAULT NULL)
RETURNS TABLE(staff_user_id bigint, today_earnings numeric, weekly_earnings numeric,
              monthly_earnings numeric, overall_earnings numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_uid bigint := public.app_current_user_id();
  v_target bigint := COALESCE(p_staff_user_id, v_uid);
  v_now timestamp := now() AT TIME ZONE 'Asia/Manila';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_target <> v_uid AND NOT public.app_is_admin() THEN RAISE EXCEPTION 'Access denied'; END IF;
  RETURN QUERY SELECT v_target,
    COALESCE(sum(e.earnings) FILTER (WHERE e.earned_at >= (date_trunc('day', v_now) AT TIME ZONE 'Asia/Manila')), 0),
    COALESCE(sum(e.earnings) FILTER (WHERE e.earned_at >= (date_trunc('week', v_now) AT TIME ZONE 'Asia/Manila')), 0),
    COALESCE(sum(e.earnings) FILTER (WHERE e.earned_at >= (date_trunc('month', v_now) AT TIME ZONE 'Asia/Manila')), 0),
    COALESCE(sum(e.earnings), 0)
  FROM public.staff_earnings e WHERE e.staff_user_id = v_target AND NOT e.voided AND e.earned_at <= now();
END $$;

-- Dedicated minimal global duplicate lookup. Old RPC remains backward compatible.
-- Historical names/times remain NULL because the original schema did not track claims.
CREATE OR REPLACE FUNCTION public.app_duplicate_claim_details(p_ref text)
RETURNS TABLE(transaction_id bigint, ref_no varchar, claimed_by_name varchar, claimed_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF public.app_current_user_id() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  RETURN QUERY SELECT t.id, t.ref_no, t.claimed_by_name, t.claimed_at
  FROM public.transactions t
  WHERE regexp_replace(t.ref_no, '[^0-9]', '', 'g') = regexp_replace(COALESCE(p_ref, ''), '[^0-9]', '', 'g')
    AND t.status = 'verified' ORDER BY t.id LIMIT 1;
END $$;

-- Reports and View Details: staff can see only their own rows, admins can see all.
-- Dates are inclusive receipt dates (txn_date), not UTC created_at dates.
CREATE OR REPLACE FUNCTION public.app_transaction_report(
  p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_status text DEFAULT 'all',
  p_reference text DEFAULT NULL, p_transaction_id bigint DEFAULT NULL,
  p_limit integer DEFAULT 100, p_offset integer DEFAULT 0
) RETURNS SETOF public.transactions LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE v_uid bigint := public.app_current_user_id(); v_admin boolean := public.app_is_admin();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_from > p_to THEN RAISE EXCEPTION 'Start date must not exceed end date'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('all', 'verified', 'duplicate') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'Limit must be 1..1000 and offset nonnegative';
  END IF;
  RETURN QUERY SELECT t.* FROM public.transactions t
  WHERE (v_admin OR t.created_by_user_id = v_uid)
    AND (p_from IS NULL OR t.txn_date >= p_from) AND (p_to IS NULL OR t.txn_date <= p_to)
    AND (p_status = 'all' OR t.status::text = p_status)
    AND (NULLIF(trim(p_reference), '') IS NULL OR
      (regexp_replace(p_reference, '[^0-9]', '', 'g') <> '' AND
       strpos(t.ref_no, regexp_replace(p_reference, '[^0-9]', '', 'g')) > 0))
    AND (p_transaction_id IS NULL OR t.id = p_transaction_id)
  ORDER BY t.txn_date DESC, t.id DESC LIMIT p_limit OFFSET p_offset;
END $$;

-- pgcrypto is already used by the repository's app_verify_password().
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE OR REPLACE FUNCTION public.app_change_password(p_current_password text, p_new_password text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
DECLARE v_uid bigint := public.app_current_user_id(); v_hash text; v_new_hash text;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok', false, 'message', 'Please sign in again.'); END IF;
  SELECT password_hash INTO v_hash FROM public.users WHERE id = v_uid FOR UPDATE;
  IF NOT COALESCE(public.app_verify_password(p_current_password, v_hash), false) THEN
    RETURN json_build_object('ok', false, 'message', 'Current password is incorrect.');
  END IF;
  IF p_new_password IS NULL OR length(p_new_password) < 12 OR octet_length(p_new_password) > 72
     OR p_new_password !~ '[A-Z]' OR p_new_password !~ '[a-z]'
     OR p_new_password !~ '[0-9]' OR p_new_password !~ '[^A-Za-z0-9[:space:]]' THEN
    RETURN json_build_object('ok', false, 'message',
      'Use at least 12 characters (maximum 72 bytes), uppercase, lowercase, a number and a special character such as @.');
  END IF;
  IF p_new_password = p_current_password THEN
    RETURN json_build_object('ok', false, 'message', 'Choose a different password.');
  END IF;
  v_new_hash := crypt(p_new_password, gen_salt('bf', 12));
  UPDATE public.users SET password_hash = v_new_hash WHERE id = v_uid;
  UPDATE public.user_sessions SET is_active = false, ended_at = now()
  WHERE user_id = v_uid AND session_token IS DISTINCT FROM public.app_session_token();
  RETURN json_build_object('ok', true, 'message', 'Password updated.');
END $$;

-- Prevent self-service role escalation and direct password-hash writes.
-- Admin account creation still needs a separate validated creation RPC in the app.
REVOKE UPDATE ON public.users FROM PUBLIC, anon, authenticated;
GRANT UPDATE (username, email, first_name, last_name, middle_initial, phone,
  age, birthday, valid_id_url, face_capture_url, updated_at) ON public.users TO anon, authenticated;

REVOKE ALL ON FUNCTION public.app_prepare_claim(), public.app_record_staff_earnings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_set_earning_rate(numeric,numeric),
  public.app_staff_earnings_summary(bigint), public.app_duplicate_claim_details(text),
  public.app_transaction_report(date,date,text,text,bigint,integer,integer),
  public.app_change_password(text,text),
  public.app_notify_admins(notif_category,text,text,text,bigint,notif_severity) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_set_earning_rate(numeric,numeric),
  public.app_staff_earnings_summary(bigint), public.app_duplicate_claim_details(text),
  public.app_transaction_report(date,date,text,text,bigint,integer,integer),
  public.app_change_password(text,text),
  public.app_notify_admins(notif_category,text,text,text,bigint,notif_severity) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
