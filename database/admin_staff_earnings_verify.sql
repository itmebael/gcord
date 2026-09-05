-- Run AFTER the migration in a staging Supabase SQL Editor as database owner.
-- All test data and the temporary rate change are rolled back.
BEGIN;
DO $$
DECLARE
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_staff bigint; v_other bigint; v_admin bigint; v_tx bigint; v_dup bigint;
  v_token text; v_total numeric; v_count integer; v_result json;
BEGIN
  INSERT INTO public.users(username,email,password_hash,first_name,last_name,role)
  VALUES ('test_staff_' || v_suffix, v_suffix || '@staff.test', 'unused', 'Test', 'Staff', 'staff')
  RETURNING id INTO v_staff;
  INSERT INTO public.users(username,email,password_hash,first_name,last_name,role)
  VALUES ('test_other_' || v_suffix, v_suffix || '@other.test', 'unused', 'Test', 'Other', 'staff')
  RETURNING id INTO v_other;
  INSERT INTO public.users(username,email,password_hash,first_name,last_name,role)
  VALUES ('test_admin_' || v_suffix, v_suffix || '@admin.test', 'unused', 'Test', 'Admin', 'admin')
  RETURNING id INTO v_admin;
  v_token := v_suffix || 'admin';
  INSERT INTO public.user_sessions(user_id,session_token) VALUES(v_admin,v_token);
  PERFORM set_config('request.headers', json_build_object('x-gcord-session',v_token)::text, true);
  PERFORM public.app_set_earning_rate(10,500);
  v_token := v_suffix || 'staff';
  INSERT INTO public.user_sessions(user_id,session_token) VALUES(v_staff,v_token);
  PERFORM set_config('request.headers', json_build_object('x-gcord-session',v_token)::text, true);

  INSERT INTO public.transactions(ref_no,recipient_name,recipient_number,amount,txn_date,txn_time,created_by_user_id)
  SELECT '99' || v_staff::text || n::text, 'J*** S**', '09170000000', amount,
    current_date, current_time::time, v_staff
  FROM (VALUES (1,500),(2,1000),(3,1500),(4,5000)) x(n,amount);
  SELECT overall_earnings INTO v_total FROM public.app_staff_earnings_summary();
  IF v_total <> 160 THEN RAISE EXCEPTION 'Expected total 160, got %', v_total; END IF;
  SELECT id INTO v_tx FROM public.transactions WHERE ref_no = '99' || v_staff::text || '1';
  INSERT INTO public.transactions(ref_no,recipient_name,recipient_number,amount,txn_date,txn_time,created_by_user_id)
  VALUES ('99' || v_staff::text || '1', 'J*** S**', '09170000000',500,current_date,current_time::time,v_staff)
  RETURNING id INTO v_dup;
  IF (SELECT status FROM public.transactions WHERE id = v_dup) <> 'duplicate' THEN
    RAISE EXCEPTION 'Duplicate was not blocked';
  END IF;
  SELECT count(*) INTO v_count FROM public.staff_earnings WHERE transaction_id = v_dup;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Duplicate earned commission'; END IF;
  SELECT count(*) INTO v_count FROM public.app_transaction_report(current_date,current_date,'duplicate') WHERE id = v_dup;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Duplicate/period report failed'; END IF;
  SELECT count(*) INTO v_count FROM public.app_duplicate_claim_details('99' || v_staff::text || '1')
  WHERE claimed_by_name = 'Test Staff' AND claimed_at IS NOT NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Claim attribution missing'; END IF;
  BEGIN
    PERFORM public.app_set_earning_rate(20,500);
    RAISE EXCEPTION 'Staff rate update unexpectedly succeeded' USING ERRCODE = 'ZX001';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  BEGIN
    PERFORM public.app_staff_earnings_summary(v_other);
    RAISE EXCEPTION 'Cross-staff summary unexpectedly succeeded' USING ERRCODE = 'ZX001';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  PERFORM set_config('request.headers', json_build_object('x-gcord-session',v_suffix || 'admin')::text, true);
  PERFORM public.app_set_earning_rate(20,500);
  UPDATE public.transactions SET amount = 1000 WHERE id = v_tx;
  SELECT earnings INTO v_total FROM public.staff_earnings WHERE transaction_id = v_tx;
  IF v_total <> 20 THEN RAISE EXCEPTION 'Original rate was not preserved'; END IF;
  UPDATE public.transactions SET status = 'duplicate' WHERE id = v_tx;
  IF NOT (SELECT voided FROM public.staff_earnings WHERE transaction_id = v_tx) THEN
    RAISE EXCEPTION 'Earnings were not voided';
  END IF;
  RAISE NOTICE 'Earnings, duplicate, date filtering, attribution, authorization and rate snapshot checks passed.';
END $$;
ROLLBACK;
