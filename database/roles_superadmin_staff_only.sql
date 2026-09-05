-- Roles: Super Admin + Staff only (remove Admin)
-- Run in Supabase SQL Editor on your EXISTING database

BEGIN;

-- Move existing admin accounts to super_admin
UPDATE users
SET role = 'super_admin'
WHERE role::text = 'admin';

-- Update RLS helper: only super_admin is admin
CREATE OR REPLACE FUNCTION app_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(app_current_user_role() = 'super_admin', FALSE);
$$;

-- Notify helpers: target super_admin only
CREATE OR REPLACE FUNCTION app_notify_admins(
  p_category notif_category,
  p_title TEXT,
  p_body TEXT,
  p_ref_no TEXT,
  p_transaction_id BIGINT,
  p_severity notif_severity
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_actor BIGINT := app_current_user_id();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO notifications (user_id, category, title, body, ref_no, transaction_id, severity, is_read)
  SELECT u.id, p_category, p_title, p_body, p_ref_no, p_transaction_id, p_severity, FALSE
  FROM users u
  WHERE u.status = 'active'
    AND u.role = 'super_admin'
    AND u.id IS DISTINCT FROM v_actor;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMIT;

-- Optional: after confirming no rows use 'admin', you can later rebuild the enum
-- without the admin value on a fresh schema install (see gcord_schema.sql).
