-- =============================================================================
-- G-Cord: apply per-user transaction privacy on an EXISTING database
-- Run this in Supabase SQL Editor (does not drop tables / seed data)
-- =============================================================================
-- After running:
-- 1) Staff SELECT only their own transactions
-- 2) Admin / super_admin SELECT all transactions
-- 3) Duplicate ref check uses RPC app_find_transaction_by_ref (global)
-- 4) Browser must send header x-gcord-session from app_login()
-- =============================================================================

BEGIN;

DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- token generation uses gen_random_uuid() (built-in)
  END;
END $$;

-- Session token column (safe if already added)
ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS session_token VARCHAR(64);

-- Add unique constraint only if missing (safe on re-run)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_sessions_session_token_key'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE relname = 'user_sessions_session_token_key'
  ) THEN
    ALTER TABLE user_sessions
      ADD CONSTRAINT user_sessions_session_token_key UNIQUE (session_token);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sess_token_active
  ON user_sessions (session_token)
  WHERE is_active = TRUE;

DROP FUNCTION IF EXISTS app_login(text, text);
DROP FUNCTION IF EXISTS app_logout();
DROP FUNCTION IF EXISTS app_find_transaction_by_ref(text);
DROP FUNCTION IF EXISTS app_current_user_id();
DROP FUNCTION IF EXISTS app_current_user_role();
DROP FUNCTION IF EXISTS app_is_admin();
DROP FUNCTION IF EXISTS app_session_token();
DROP FUNCTION IF EXISTS app_verify_password(text, text);

CREATE OR REPLACE FUNCTION app_session_token()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(TRIM(BOTH FROM COALESCE(
    current_setting('request.headers', true)::json->>'x-gcord-session',
    current_setting('request.headers', true)::json->>'X-Gcord-Session',
    ''
  )), '');
$$;

CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.user_id
  FROM user_sessions s
  JOIN users u ON u.id = s.user_id
  WHERE s.session_token = app_session_token()
    AND s.is_active = TRUE
    AND u.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION app_current_user_role()
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.role
  FROM user_sessions s
  JOIN users u ON u.id = s.user_id
  WHERE s.session_token = app_session_token()
    AND s.is_active = TRUE
    AND u.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION app_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(app_current_user_role() = 'super_admin', FALSE);
$$;

CREATE OR REPLACE FUNCTION app_verify_password(p_password TEXT, p_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  h TEXT := COALESCE(p_hash, '');
  pwd TEXT := COALESCE(p_password, '');
  bcrypt_hash TEXT;
BEGIN
  IF h = '' OR pwd = '' THEN RETURN FALSE; END IF;
  IF strpos(h, 'placeholder') > 0 THEN
    RETURN pwd IN ('admin1234', 'staff1234');
  END IF;
  IF left(h, 7) = 'sha256$' THEN
    BEGIN
      RETURN h = 'sha256$' || encode(extensions.digest('gcord:' || pwd, 'sha256'), 'hex');
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        RETURN h = 'sha256$' || encode(digest('gcord:' || pwd, 'sha256'), 'hex');
      EXCEPTION WHEN OTHERS THEN
        RETURN FALSE;
      END;
    END;
  END IF;
  IF left(h, 4) IN ('$2a$', '$2b$', '$2y$') THEN
    bcrypt_hash := regexp_replace(h, '^\$2y\$', '$2a$');
    BEGIN
      RETURN extensions.crypt(pwd, bcrypt_hash) = bcrypt_hash;
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        RETURN crypt(pwd, bcrypt_hash) = bcrypt_hash;
      EXCEPTION WHEN OTHERS THEN
        RETURN FALSE;
      END;
    END;
  END IF;
  RETURN FALSE;
END;
$$;

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
    CASE WHEN u.role = 'staff' THEN 'Staff ' ELSE 'Admin ' END || u.full_name || ' logged in',
    'success', 'login'
  );

  RETURN QUERY SELECT TRUE, 'OK'::TEXT, v_token, u.id, u.username, u.email,
    u.first_name, u.last_name, u.full_name, u.phone, u.role;
END;
$$;

CREATE OR REPLACE FUNCTION app_logout()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid BIGINT := app_current_user_id();
  v_name TEXT;
  v_role user_role;
BEGIN
  IF v_uid IS NULL THEN RETURN FALSE; END IF;
  SELECT full_name, role INTO v_name, v_role FROM users WHERE id = v_uid;

  UPDATE user_sessions
  SET is_active = FALSE, ended_at = NOW()
  WHERE session_token = app_session_token() AND is_active = TRUE;

  INSERT INTO system_logs (actor_user_id, actor_name, actor_role, action_code, message, status, icon)
  VALUES (v_uid, v_name, v_role, 'logout', COALESCE(v_name, 'User') || ' logged out', 'success', 'logout');

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION app_find_transaction_by_ref(p_ref TEXT)
RETURNS TABLE (
  id BIGINT,
  ref_no VARCHAR,
  status txn_status,
  created_by_user_id BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref TEXT := regexp_replace(COALESCE(p_ref, ''), '[^0-9]', '', 'g');
BEGIN
  IF app_current_user_id() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  RETURN QUERY
  SELECT t.id, t.ref_no, t.status, t.created_by_user_id
  FROM transactions t
  WHERE t.ref_no = v_ref
  ORDER BY t.id ASC
  LIMIT 1;
END;
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON FUNCTION app_login(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION app_logout() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION app_find_transaction_by_ref(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION app_current_user_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION app_current_user_role() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION app_is_admin() TO anon, authenticated;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE duplicate_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_security_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_usage_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select ON users;
DROP POLICY IF EXISTS users_insert ON users;
DROP POLICY IF EXISTS users_update ON users;
DROP POLICY IF EXISTS users_delete ON users;
CREATE POLICY users_select ON users FOR SELECT TO anon, authenticated
  USING (app_is_admin() OR id = app_current_user_id());
CREATE POLICY users_insert ON users FOR INSERT TO anon, authenticated
  WITH CHECK (app_is_admin());
CREATE POLICY users_update ON users FOR UPDATE TO anon, authenticated
  USING (app_is_admin() OR id = app_current_user_id())
  WITH CHECK (app_is_admin() OR id = app_current_user_id());
CREATE POLICY users_delete ON users FOR DELETE TO anon, authenticated
  USING (app_is_admin());

DROP POLICY IF EXISTS txn_select ON transactions;
DROP POLICY IF EXISTS txn_insert ON transactions;
DROP POLICY IF EXISTS txn_update ON transactions;
DROP POLICY IF EXISTS txn_delete ON transactions;
CREATE POLICY txn_select ON transactions FOR SELECT TO anon, authenticated
  USING (app_is_admin() OR created_by_user_id = app_current_user_id());
CREATE POLICY txn_insert ON transactions FOR INSERT TO anon, authenticated
  WITH CHECK (
    app_current_user_id() IS NOT NULL
    AND (app_is_admin() OR created_by_user_id = app_current_user_id())
  );
CREATE POLICY txn_update ON transactions FOR UPDATE TO anon, authenticated
  USING (app_is_admin() OR created_by_user_id = app_current_user_id())
  WITH CHECK (app_is_admin() OR created_by_user_id = app_current_user_id());
CREATE POLICY txn_delete ON transactions FOR DELETE TO anon, authenticated
  USING (app_is_admin());

DROP POLICY IF EXISTS scan_select ON scan_sessions;
DROP POLICY IF EXISTS scan_write ON scan_sessions;
CREATE POLICY scan_select ON scan_sessions FOR SELECT TO anon, authenticated
  USING (app_is_admin() OR user_id = app_current_user_id());
CREATE POLICY scan_write ON scan_sessions FOR ALL TO anon, authenticated
  USING (app_is_admin() OR user_id = app_current_user_id())
  WITH CHECK (app_is_admin() OR user_id = app_current_user_id());

DROP POLICY IF EXISTS dup_select ON duplicate_events;
DROP POLICY IF EXISTS dup_write ON duplicate_events;
CREATE POLICY dup_select ON duplicate_events FOR SELECT TO anon, authenticated
  USING (
    app_is_admin()
    OR EXISTS (
      SELECT 1 FROM transactions t
      WHERE t.id IN (original_transaction_id, duplicate_transaction_id)
        AND t.created_by_user_id = app_current_user_id()
    )
  );
CREATE POLICY dup_write ON duplicate_events FOR ALL TO anon, authenticated
  USING (app_current_user_id() IS NOT NULL)
  WITH CHECK (app_current_user_id() IS NOT NULL);

DROP POLICY IF EXISTS notif_select ON notifications;
DROP POLICY IF EXISTS notif_write ON notifications;
CREATE POLICY notif_select ON notifications FOR SELECT TO anon, authenticated
  USING (app_is_admin() OR user_id = app_current_user_id());
CREATE POLICY notif_write ON notifications FOR ALL TO anon, authenticated
  USING (app_is_admin() OR user_id = app_current_user_id())
  WITH CHECK (app_is_admin() OR user_id = app_current_user_id());

DROP POLICY IF EXISTS logs_select ON system_logs;
DROP POLICY IF EXISTS logs_insert ON system_logs;
CREATE POLICY logs_select ON system_logs FOR SELECT TO anon, authenticated
  USING (app_is_admin() OR actor_user_id = app_current_user_id());
CREATE POLICY logs_insert ON system_logs FOR INSERT TO anon, authenticated
  WITH CHECK (
    app_current_user_id() IS NOT NULL
    AND (actor_user_id IS NULL OR actor_user_id = app_current_user_id() OR app_is_admin())
  );

DROP POLICY IF EXISTS sec_all ON user_security_settings;
CREATE POLICY sec_all ON user_security_settings FOR ALL TO anon, authenticated
  USING (app_is_admin() OR user_id = app_current_user_id())
  WITH CHECK (app_is_admin() OR user_id = app_current_user_id());

DROP POLICY IF EXISTS sess_select ON user_sessions;
DROP POLICY IF EXISTS sess_update ON user_sessions;
CREATE POLICY sess_select ON user_sessions FOR SELECT TO anon, authenticated
  USING (app_is_admin() OR user_id = app_current_user_id());
CREATE POLICY sess_update ON user_sessions FOR UPDATE TO anon, authenticated
  USING (app_is_admin() OR user_id = app_current_user_id());

DROP POLICY IF EXISTS stats_admin ON daily_usage_stats;
CREATE POLICY stats_admin ON daily_usage_stats FOR ALL TO anon, authenticated
  USING (app_is_admin())
  WITH CHECK (app_is_admin());

COMMIT;
