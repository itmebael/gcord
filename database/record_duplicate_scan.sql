-- Run after customer_claimant.sql and the earnings migrations.
-- Record a duplicate scan against the signed-in staff member, never as a claim.
BEGIN;
CREATE OR REPLACE FUNCTION public.app_record_duplicate_scan(p_ref text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE v_uid bigint := public.app_current_user_id();
  v_original public.transactions%ROWTYPE; v_id bigint;
  v_ref text := regexp_replace(COALESCE(p_ref, ''), '[^0-9]', '', 'g');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  IF v_ref = '' THEN RAISE EXCEPTION 'Reference number is required.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_ref, 0));
  SELECT * INTO v_original FROM public.transactions
  WHERE regexp_replace(ref_no, '[^0-9]', '', 'g') = v_ref AND status = 'verified'
  ORDER BY id LIMIT 1 FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No original claimed transaction found.'; END IF;
  INSERT INTO public.transactions
    (ref_no, recipient_name, recipient_number, amount, txn_date, txn_time,
     status, source, created_by_user_id, matched_transaction_id)
  VALUES (v_ref, v_original.recipient_name, v_original.recipient_number,
    v_original.amount, v_original.txn_date, v_original.txn_time,
    'duplicate', 'scan', v_uid, v_original.id)
  RETURNING id INTO v_id;
  -- The earnings trigger records the duplicate event and excludes it from earnings.
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.app_record_duplicate_scan(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_record_duplicate_scan(text) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
