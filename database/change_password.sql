-- =============================================================================
-- Change password RPC (run in Supabase SQL Editor)
-- =============================================================================

CREATE OR REPLACE FUNCTION app_change_password(
  p_current_password TEXT,
  p_new_password TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid BIGINT;
  u RECORD;
  new_hash TEXT;
BEGIN
  uid := app_current_user_id();
  IF uid IS NULL THEN
    RETURN json_build_object('ok', false, 'message', 'Please sign in again.');
  END IF;

  SELECT id, password_hash INTO u
  FROM users
  WHERE id = uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'message', 'Account not found.');
  END IF;

  IF COALESCE(p_current_password, '') = '' THEN
    RETURN json_build_object('ok', false, 'message', 'Current password is required.');
  END IF;

  IF NOT app_verify_password(p_current_password, u.password_hash) THEN
    RETURN json_build_object('ok', false, 'message', 'Current password is incorrect.');
  END IF;

  IF length(COALESCE(p_new_password, '')) < 8 THEN
    RETURN json_build_object('ok', false, 'message', 'New password must be at least 8 characters.');
  END IF;

  IF p_current_password = p_new_password THEN
    RETURN json_build_object('ok', false, 'message', 'New password must be different from the current password.');
  END IF;

  BEGIN
    new_hash := 'sha256$' || encode(extensions.digest('gcord:' || p_new_password, 'sha256'), 'hex');
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      new_hash := 'sha256$' || encode(digest('gcord:' || p_new_password, 'sha256'), 'hex');
    EXCEPTION WHEN OTHERS THEN
      RETURN json_build_object('ok', false, 'message', 'Could not hash new password.');
    END;
  END;

  UPDATE users
  SET password_hash = new_hash,
      updated_at = NOW()
  WHERE id = uid;

  RETURN json_build_object('ok', true, 'message', 'Password updated.');
END;
$$;

GRANT EXECUTE ON FUNCTION app_change_password(TEXT, TEXT) TO anon, authenticated;
