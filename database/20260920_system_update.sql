-- Apply once in Supabase SQL Editor on the existing GCORD database.
-- Requires user_verification.sql and admin_staff_earnings.sql. Safe to rerun.
-- Keeps existing records and legacy ID data; new signup uses verified email only.
-- Supabase Auth verifies email; existing public.users and app sessions stay in use.
BEGIN;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS middle_name varchar(80);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS extension_name varchar(80);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS claimant_name varchar(160);
-- Preserve dependent views/RPCs by keeping the existing full_name column.
ALTER TABLE public.users ALTER COLUMN full_name DROP EXPRESSION IF EXISTS;
CREATE OR REPLACE FUNCTION public.app_set_full_name()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  NEW.full_name := concat_ws(' ', NULLIF(trim(NEW.first_name),''),
    COALESCE(NULLIF(trim(NEW.middle_name),''), NULLIF(trim(NEW.middle_initial),'') || '.'),
    NULLIF(trim(NEW.last_name),''), NULLIF(trim(NEW.extension_name),''));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_set_full_name ON public.users;
CREATE TRIGGER trg_set_full_name BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.app_set_full_name();
REVOKE ALL ON FUNCTION public.app_set_full_name() FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS transactions_recorded_id_idx ON public.transactions(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS transactions_staff_recorded_id_idx ON public.transactions(created_by_user_id,created_at DESC,id DESC);
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE OR REPLACE FUNCTION public.app_verified_auth_email()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_email text;
BEGIN
  SELECT lower(email) INTO v_email FROM auth.users
  WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN RAISE EXCEPTION 'Verify your email first.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(auth.jwt()->'amr','[]'::jsonb)) a
    WHERE (a->>'timestamp')::numeric >= extract(epoch FROM now()-interval '10 minutes')) THEN
    RAISE EXCEPTION 'Verification expired. Request a new code or sign in with Google again.';
  END IF;
  RETURN v_email;
END $$;
CREATE OR REPLACE FUNCTION public.app_validate_new_password(p_password text)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF p_password IS NULL OR length(p_password)<12 OR octet_length(p_password)>72
    OR p_password !~ '[A-Z]' OR p_password !~ '[a-z]' OR p_password !~ '[0-9]'
    OR p_password !~ '[^A-Za-z0-9[:space:]]' THEN
    RAISE EXCEPTION 'Use 12 or more characters, uppercase, lowercase, a number and a special character (maximum 72 bytes).';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.app_complete_verified_signup(p_details jsonb, p_password text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE v_email text:=public.app_verified_auth_email(); v_id bigint;
BEGIN
  PERFORM public.app_validate_new_password(p_password);
  IF NULLIF(trim(p_details->>'first_name'),'') IS NULL OR NULLIF(trim(p_details->>'last_name'),'') IS NULL THEN
    RAISE EXCEPTION 'First name and last name are required.';
  END IF;
  IF length(concat_ws(' ',trim(p_details->>'first_name'),NULLIF(trim(p_details->>'middle_name'),''),trim(p_details->>'last_name'),NULLIF(trim(p_details->>'extension_name'),''))) > 160 THEN
    RAISE EXCEPTION 'Combined name must be at most 160 characters.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.users WHERE lower(email)=v_email) THEN RAISE EXCEPTION 'Account already exists. Please sign in or reset your password.'; END IF;
  INSERT INTO public.users(username,email,password_hash,first_name,last_name,middle_name,extension_name,phone,role,status,verification_status,verified_at)
  VALUES ('staff_'||replace(gen_random_uuid()::text,'-',''),v_email,crypt(p_password,gen_salt('bf',12)),
    trim(p_details->>'first_name'),trim(p_details->>'last_name'),NULLIF(trim(p_details->>'middle_name'),''),
    NULLIF(trim(p_details->>'extension_name'),''),p_details->>'phone','staff','active','verified',now()) RETURNING id INTO v_id;
  INSERT INTO public.user_security_settings(user_id,login_alerts,duplicate_alerts,require_reauth)
  VALUES(v_id,true,true,false) ON CONFLICT(user_id) DO NOTHING;
  RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION public.app_reset_verified_password(p_password text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE v_email text:=public.app_verified_auth_email(); v_id bigint;
BEGIN
  PERFORM public.app_validate_new_password(p_password);
  SELECT id INTO v_id FROM public.users WHERE lower(email)=v_email FOR UPDATE;
  IF v_id IS NULL THEN RAISE EXCEPTION 'No application account is linked to this verified email.'; END IF;
  UPDATE public.users SET password_hash=crypt(p_password,gen_salt('bf',12)) WHERE id=v_id;
  UPDATE public.user_sessions SET is_active=false,ended_at=now() WHERE user_id=v_id;
END $$;
CREATE OR REPLACE FUNCTION public.app_login_verified_identity()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_email text:=public.app_verified_auth_email(); u public.users%ROWTYPE; v_token text;
BEGIN
  SELECT * INTO u FROM public.users WHERE lower(email)=v_email FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Complete staff signup first using this email address.'; END IF;
  IF u.status::text<>'active' OR u.verification_status::text<>'verified' THEN
    RAISE EXCEPTION 'Your account must be active and approved by your admin before signing in.';
  END IF;
  v_token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  UPDATE public.user_sessions SET is_active=false,ended_at=now() WHERE user_id=u.id AND is_active;
  INSERT INTO public.user_sessions(user_id,session_token,is_active) VALUES(u.id,v_token,true);
  UPDATE public.users SET last_login_at=now() WHERE id=u.id;
  RETURN jsonb_build_object('id',u.id,'username',u.username,'email',u.email,'first_name',u.first_name,
    'last_name',u.last_name,'full_name',u.full_name,'phone',u.phone,'role',u.role,'session_token',v_token);
END $$;
-- Close the unverified registration paths. Existing admin RPCs remain available.
REVOKE INSERT ON public.users FROM PUBLIC,anon,authenticated;
DO $$ BEGIN
  IF to_regprocedure('public.app_register_staff(text,text,text,text,smallint,date,text,text,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.app_register_staff(text,text,text,text,smallint,date,text,text,text) FROM PUBLIC,anon,authenticated;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.app_verified_auth_email(),public.app_validate_new_password(text),
 public.app_complete_verified_signup(jsonb,text),public.app_reset_verified_password(text),public.app_login_verified_identity() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.app_complete_verified_signup(jsonb,text),public.app_reset_verified_password(text),public.app_login_verified_identity() TO authenticated;
CREATE OR REPLACE FUNCTION public.app_duplicate_claim_details(p_ref text)
RETURNS TABLE(transaction_id bigint, ref_no varchar, claimed_by_name varchar, claimed_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF public.app_current_user_id() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  -- Legacy verified records use their saved record time when no claim timestamp exists.
  RETURN QUERY SELECT t.id, t.ref_no, NULLIF(trim(t.claimant_name), '')::varchar, COALESCE(t.claimed_at, t.created_at)
  FROM public.transactions t
  WHERE regexp_replace(t.ref_no, '[^0-9]', '', 'g') = regexp_replace(COALESCE(p_ref, ''), '[^0-9]', '', 'g')
    AND t.status = 'verified' ORDER BY t.id LIMIT 1;
END $$;
REVOKE ALL ON FUNCTION public.app_duplicate_claim_details(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_duplicate_claim_details(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_protect_customer_claimant()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.claimant_name := NULLIF(trim(NEW.claimant_name), '');
  IF TG_OP = 'UPDATE' AND NEW.claimant_name IS DISTINCT FROM OLD.claimant_name
     AND NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'The saved customer claimant can only be corrected by an admin.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_protect_customer_claimant ON public.transactions;
CREATE TRIGGER trg_protect_customer_claimant BEFORE INSERT OR UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.app_protect_customer_claimant();
REVOKE ALL ON FUNCTION public.app_protect_customer_claimant() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
