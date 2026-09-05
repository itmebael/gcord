-- Apply after user_verification.sql and admin_staff_earnings.sql.
-- Supabase Auth verifies email; existing public.users and app sessions stay in use.
BEGIN;
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
  IF NULLIF(trim(p_details->>'first_name'),'') IS NULL OR NULLIF(trim(p_details->>'last_name'),'') IS NULL
    OR NULLIF(p_details->>'valid_id_url','') IS NULL OR NULLIF(p_details->>'face_capture_url','') IS NULL THEN
    RAISE EXCEPTION 'Name, valid ID and face capture are required.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.users WHERE lower(email)=v_email) THEN RAISE EXCEPTION 'Account already exists. Please sign in or reset your password.'; END IF;
  INSERT INTO public.users(username,email,password_hash,first_name,last_name,age,birthday,valid_id_url,face_capture_url,phone,role,status,verification_status)
  VALUES ('staff_'||replace(gen_random_uuid()::text,'-',''),v_email,crypt(p_password,gen_salt('bf',12)),
    trim(p_details->>'first_name'),trim(p_details->>'last_name'),(p_details->>'age')::smallint,(p_details->>'birthday')::date,
    p_details->>'valid_id_url',p_details->>'face_capture_url',p_details->>'phone','staff','active','pending') RETURNING id INTO v_id;
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
NOTIFY pgrst,'reload schema';
COMMIT;
