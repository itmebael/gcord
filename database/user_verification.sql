-- Account ID verification for staff signup
-- Run in Supabase SQL Editor

BEGIN;

DO $$ BEGIN
  CREATE TYPE verification_status AS ENUM ('pending', 'verified', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS verification_status verification_status NOT NULL DEFAULT 'pending';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS verified_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;

-- Allow long data-URL / image storage for ID + face preview
ALTER TABLE users ALTER COLUMN valid_id_url TYPE TEXT;
ALTER TABLE users ALTER COLUMN face_capture_url TYPE TEXT;

-- Existing seeded / active accounts are already trusted
UPDATE users
SET verification_status = 'verified',
    verified_at = COALESCE(verified_at, NOW())
WHERE verification_status = 'pending'
  AND (
    role = 'super_admin'
    OR status = 'active'
  );

-- Block unverified logins in app_login
CREATE OR REPLACE FUNCTION app_login(p_identifier TEXT, p_password TEXT)
RETURNS TABLE (
  ok BOOLEAN,
  message TEXT,
  session_token TEXT,
  user_id BIGINT,
  username VARCHAR,
  email VARCHAR,
  first_name VARCHAR,
  last_name VARCHAR,
  full_name VARCHAR,
  phone VARCHAR,
  role user_role
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u users%ROWTYPE;
  v_token TEXT;
  v_id TEXT := lower(trim(BOTH FROM COALESCE(p_identifier, '')));
BEGIN
  IF v_id = '' OR COALESCE(p_password, '') = '' THEN
    RETURN QUERY SELECT FALSE, 'Enter username/email and password.'::TEXT,
      NULL::TEXT, NULL::BIGINT, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR,
      NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::user_role;
    RETURN;
  END IF;

  SELECT * INTO u
  FROM users
  WHERE lower(users.email) = v_id OR lower(users.username) = v_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Account not found.'::TEXT,
      NULL::TEXT, NULL::BIGINT, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR,
      NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::user_role;
    RETURN;
  END IF;

  IF u.status <> 'active' THEN
    RETURN QUERY SELECT FALSE, 'This account is inactive.'::TEXT,
      NULL::TEXT, NULL::BIGINT, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR,
      NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::user_role;
    RETURN;
  END IF;

  IF COALESCE(u.verification_status::text, 'pending') <> 'verified' THEN
    RETURN QUERY SELECT FALSE,
      'Account is not verified yet. Wait for Super Admin approval.'::TEXT,
      NULL::TEXT, NULL::BIGINT, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR,
      NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::user_role;
    RETURN;
  END IF;

  IF NOT app_verify_password(p_password, u.password_hash) THEN
    RETURN QUERY SELECT FALSE, 'Incorrect password.'::TEXT,
      NULL::TEXT, NULL::BIGINT, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR,
      NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::user_role;
    RETURN;
  END IF;

  UPDATE user_sessions
  SET is_active = FALSE, ended_at = NOW()
  WHERE user_sessions.user_id = u.id AND is_active = TRUE;

  v_token := replace(gen_random_uuid()::text, '-', '') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);

  INSERT INTO user_sessions (user_id, session_token, is_active)
  VALUES (u.id, v_token, TRUE);

  UPDATE users SET last_login_at = NOW() WHERE users.id = u.id;

  INSERT INTO system_logs (actor_user_id, actor_name, actor_role, action_code, message, status, icon)
  VALUES (
    u.id, u.full_name, u.role, 'login',
    CASE WHEN u.role = 'staff' THEN 'Staff ' ELSE 'Super Admin ' END || u.full_name || ' logged in',
    'success', 'login'
  );

  RETURN QUERY SELECT TRUE, 'OK'::TEXT, v_token, u.id, u.username, u.email,
    u.first_name, u.last_name, u.full_name, u.phone, u.role;
END;
$$;

-- Also allow public signup of pending staff (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION app_register_staff(
  p_email TEXT,
  p_password TEXT,
  p_first_name TEXT,
  p_last_name TEXT,
  p_age SMALLINT,
  p_birthday DATE,
  p_valid_id_url TEXT,
  p_face_capture_url TEXT,
  p_phone TEXT DEFAULT NULL
)
RETURNS TABLE (ok BOOLEAN, message TEXT, user_id BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username TEXT;
  v_hash TEXT;
  v_id BIGINT;
BEGIN
  IF COALESCE(trim(p_email), '') = '' OR COALESCE(p_password, '') = '' THEN
    RETURN QUERY SELECT FALSE, 'Email and password are required.'::TEXT, NULL::BIGINT;
    RETURN;
  END IF;
  IF length(p_password) < 8 THEN
    RETURN QUERY SELECT FALSE, 'Password must be at least 8 characters.'::TEXT, NULL::BIGINT;
    RETURN;
  END IF;
  IF COALESCE(trim(p_face_capture_url), '') = '' OR COALESCE(trim(p_valid_id_url), '') = '' THEN
    RETURN QUERY SELECT FALSE, 'Valid ID and face capture are required.'::TEXT, NULL::BIGINT;
    RETURN;
  END IF;

  v_username := lower(split_part(trim(p_email), '@', 1));
  v_username := regexp_replace(v_username, '[^a-z0-9._-]', '', 'g');
  IF v_username = '' THEN v_username := 'user' || floor(random()*100000)::text; END IF;

  -- Prefer app hash style if client already hashed; here store as plain marked sha path from client
  v_hash := p_password;

  INSERT INTO users (
    username, email, password_hash, first_name, last_name, phone, role, status,
    age, birthday, valid_id_url, face_capture_url, verification_status
  ) VALUES (
    v_username,
    lower(trim(p_email)),
    v_hash,
    trim(p_first_name),
    trim(p_last_name),
    NULLIF(trim(COALESCE(p_phone, '')), ''),
    'staff',
    'active',
    p_age,
    p_birthday,
    p_valid_id_url,
    p_face_capture_url,
    'pending'
  )
  RETURNING id INTO v_id;

  INSERT INTO user_security_settings (user_id, login_alerts, duplicate_alerts, require_reauth)
  VALUES (v_id, TRUE, TRUE, FALSE)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO system_logs (actor_user_id, actor_name, actor_role, action_code, message, status, icon)
  VALUES (v_id, trim(p_first_name) || ' ' || trim(p_last_name), 'staff', 'create_transaction',
    'New staff signup pending verification', 'warning', 'warn');

  RETURN QUERY SELECT TRUE, 'Account created. Wait for Super Admin verification.'::TEXT, v_id;
EXCEPTION WHEN unique_violation THEN
  RETURN QUERY SELECT FALSE, 'Email or username already exists.'::TEXT, NULL::BIGINT;
END;
$$;

GRANT EXECUTE ON FUNCTION app_register_staff(text, text, text, text, smallint, date, text, text, text)
  TO anon, authenticated;

COMMIT;

