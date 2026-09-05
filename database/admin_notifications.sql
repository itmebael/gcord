-- Admin notification helper + dashboard-friendly inbox
-- Run in Supabase SQL Editor after rls_privacy.sql

BEGIN;

DROP FUNCTION IF EXISTS app_notify_admins(notif_category, text, text, text, bigint, notif_severity);

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

GRANT EXECUTE ON FUNCTION app_notify_admins(notif_category, text, text, text, bigint, notif_severity)
  TO anon, authenticated;

-- Ensure seeded admin/superadmin inboxes have dashboard-ready alerts
INSERT INTO notifications (user_id, category, title, body, ref_no, transaction_id, severity, is_read, created_at)
SELECT u.id, x.category, x.title, x.body, x.ref_no, x.transaction_id, x.severity, FALSE, NOW()
FROM users u
CROSS JOIN (
  VALUES
    ('system'::notif_category, 'Admin dashboard ready', 'Your admin notifications are connected to live system activity.', NULL::varchar, NULL::bigint, 'info'::notif_severity),
    ('transactions'::notif_category, 'Transaction monitoring active', 'Staff cash-out activity will appear here.', NULL::varchar, NULL::bigint, 'success'::notif_severity),
    ('alerts'::notif_category, 'Duplicate alerts enabled', 'Blocked duplicate attempts from staff will notify you.', NULL::varchar, NULL::bigint, 'warning'::notif_severity)
) AS x(category, title, body, ref_no, transaction_id, severity)
WHERE u.role = 'super_admin'
  AND u.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.user_id = u.id AND n.title = x.title
  );

COMMIT;
