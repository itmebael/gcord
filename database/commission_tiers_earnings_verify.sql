-- Run in staging AFTER commission_tiers_earnings.sql, as the database owner.
-- Uses real anon-role RLS checks, not owner-role SELECTs that bypass RLS.
-- Rolls back all fixtures. Requires Supabase anon/authenticated database roles.
BEGIN;
-- Fail before fixture inserts if a setup migration was skipped or rolled back.
DO $$
BEGIN
  IF to_regclass('public.staff_earnings') IS NULL THEN
    RAISE EXCEPTION 'Earnings setup is missing: public.staff_earnings does not exist.'
      USING HINT = 'Run database/admin_staff_earnings.sql successfully first, then database/commission_tiers_earnings.sql. This verify file only tests setup; it does not install it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'staff_earnings' AND column_name = 'commission_method') THEN
    RAISE EXCEPTION 'The commission-tier earnings migration is missing.'
      USING HINT = 'Run database/commission_tiers_earnings.sql successfully before this verification script.';
  END IF;
  IF to_regprocedure('public.app_staff_earnings_summary(bigint)') IS NULL THEN
    RAISE EXCEPTION 'The earnings summary function is missing.'
      USING HINT = 'Check the setup migration results before running verification. Do not ignore errors from earlier migrations.';
  END IF;
END $$;
DO $$
DECLARE suffix text := replace(gen_random_uuid()::text, '-', '');
  a bigint; b bigint; tier_a bigint; tier_b bigint; tx_a bigint; tx_b bigint;
BEGIN
  INSERT INTO public.users(username,email,password_hash,first_name,last_name,role)
  VALUES ('commission_a_' || suffix, suffix || '@a.test', 'unused', 'Commission', 'A', 'staff') RETURNING id INTO a;
  INSERT INTO public.users(username,email,password_hash,first_name,last_name,role)
  VALUES ('commission_b_' || suffix, suffix || '@b.test', 'unused', 'Commission', 'B', 'staff') RETURNING id INTO b;
  INSERT INTO public.user_sessions(user_id,session_token) VALUES(a,suffix || 'a'),(b,suffix || 'b');
  INSERT INTO public.commission_tiers(user_id,min_amount,max_amount,payout_amount,sort_order)
  VALUES(a,500,999.99,17,0) RETURNING id INTO tier_a;
  INSERT INTO public.commission_tiers(user_id,min_amount,max_amount,payout_amount,sort_order)
  VALUES(b,500,999.99,33,0) RETURNING id INTO tier_b;
  INSERT INTO public.commission_tiers(user_id,min_amount,max_amount,payout_amount,sort_order)
  VALUES(NULL,500,999.99,3,0);
  PERFORM set_config('request.headers',json_build_object('x-gcord-session',suffix || 'a')::text,true);
  INSERT INTO public.transactions(ref_no,recipient_name,recipient_number,amount,txn_date,txn_time,created_by_user_id)
  VALUES ('881' || a, 'Test', '09170000000',750,current_date,current_time::time,a) RETURNING id INTO tx_a;
  PERFORM set_config('request.headers',json_build_object('x-gcord-session',suffix || 'b')::text,true);
  INSERT INTO public.transactions(ref_no,recipient_name,recipient_number,amount,txn_date,txn_time,created_by_user_id)
  VALUES ('882' || b, 'Test', '09170000000',750,current_date,current_time::time,b) RETURNING id INTO tx_b;
  IF (SELECT earnings FROM public.staff_earnings WHERE transaction_id = tx_a) IS DISTINCT FROM 17::numeric
     OR (SELECT earnings FROM public.staff_earnings WHERE transaction_id = tx_b) IS DISTINCT FROM 33::numeric THEN
    RAISE EXCEPTION 'Fixed personal payouts did not override defaults';
  END IF;
  UPDATE public.commission_tiers SET payout_amount = 99 WHERE id = tier_a;
  UPDATE public.transactions SET notes = 'Snapshot test' WHERE id = tx_a;
  IF (SELECT earnings FROM public.staff_earnings WHERE transaction_id = tx_a) IS DISTINCT FROM 17::numeric THEN
    RAISE EXCEPTION 'Tier edit changed a historical payout';
  END IF;
  PERFORM set_config('test.commission_a',a::text,true);
  PERFORM set_config('test.commission_b',b::text,true);
  PERFORM set_config('test.other_tier',tier_b::text,true);
  PERFORM set_config('request.headers',json_build_object('x-gcord-session',suffix || 'a')::text,true);
END $$;

SET LOCAL ROLE anon;
DO $$
DECLARE a bigint := current_setting('test.commission_a')::bigint;
  b bigint := current_setting('test.commission_b')::bigint;
  changed integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.commission_tiers WHERE user_id IS NOT NULL AND user_id <> a) THEN
    RAISE EXCEPTION 'Staff can read another user commission tiers';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.commission_tiers WHERE user_id = a)
     OR NOT EXISTS (SELECT 1 FROM public.commission_tiers WHERE user_id IS NULL) THEN
    RAISE EXCEPTION 'Own/default tiers not visible';
  END IF;
  IF EXISTS (SELECT 1 FROM public.staff_earnings WHERE staff_user_id <> a) THEN
    RAISE EXCEPTION 'Staff can read another user earnings';
  END IF;
  IF (SELECT overall_earnings FROM public.app_staff_earnings_summary()) IS DISTINCT FROM 17::numeric THEN
    RAISE EXCEPTION 'Own summary incorrect';
  END IF;
  BEGIN
    PERFORM public.app_staff_earnings_summary(b);
    RAISE EXCEPTION 'Cross-staff RPC unexpectedly allowed' USING ERRCODE = 'ZX001';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  UPDATE public.commission_tiers SET payout_amount = 10000 WHERE user_id IN (a,b);
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 0 THEN RAISE EXCEPTION 'Staff modified commission tiers'; END IF;
  BEGIN
    INSERT INTO public.commission_tiers(user_id,min_amount,max_amount,payout_amount) VALUES(a,0,100,1000);
    RAISE EXCEPTION 'Staff tier insert unexpectedly allowed' USING ERRCODE = 'ZX001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.user_sessions SET user_id = b WHERE user_id = a;
    RAISE EXCEPTION 'Session reassignment unexpectedly allowed' USING ERRCODE = 'ZX001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.users SET role = 'admin' WHERE id = a;
    RAISE EXCEPTION 'Role escalation unexpectedly allowed' USING ERRCODE = 'ZX001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Optional extension: after applying staff_edit_own_commission.sql, verify
  -- the permitted RPC while direct table updates remain blocked above.
  IF to_regprocedure('public.app_update_my_commission_tier(bigint,numeric,numeric,numeric,integer,timestamp)') IS NOT NULL THEN
    DECLARE own_tier public.commission_tiers%ROWTYPE; saved public.commission_tiers%ROWTYPE; default_tier public.commission_tiers%ROWTYPE;
    BEGIN
      SELECT * INTO own_tier FROM public.commission_tiers WHERE user_id = a LIMIT 1;
      SELECT * INTO saved FROM public.app_update_my_commission_tier(own_tier.id,500,999.99,25,0,own_tier.updated_at);
      IF saved.payout_amount <> 25 OR saved.user_id <> a THEN RAISE EXCEPTION 'Personal tier edit failed'; END IF;
      IF (SELECT overall_earnings FROM public.app_staff_earnings_summary()) <> 17 THEN RAISE EXCEPTION 'Tier edit changed past earnings'; END IF;
      BEGIN
        PERFORM public.app_update_my_commission_tier(own_tier.id,500,999.99,50,0,own_tier.updated_at);
        RAISE EXCEPTION 'Stale tier edit unexpectedly allowed' USING ERRCODE = 'ZX001';
      EXCEPTION WHEN raise_exception THEN NULL;
      END;
      SELECT * INTO default_tier FROM public.commission_tiers WHERE user_id IS NULL LIMIT 1;
      BEGIN
        PERFORM public.app_update_my_commission_tier(default_tier.id,0,1000,100,0,default_tier.updated_at);
        RAISE EXCEPTION 'Shared default edit unexpectedly allowed' USING ERRCODE = 'ZX001';
      EXCEPTION WHEN raise_exception THEN NULL;
      END;
      BEGIN
        PERFORM public.app_update_my_commission_tier(current_setting('test.other_tier')::bigint,0,1000,100,0,now()::timestamp);
        RAISE EXCEPTION 'Cross-staff tier edit unexpectedly allowed' USING ERRCODE = 'ZX001';
      EXCEPTION WHEN raise_exception THEN NULL;
      END;
    END;
  END IF;
  RAISE NOTICE 'PASS: fixed payouts, saved payouts, own/default visibility, cross-staff privacy, write and impersonation restrictions';
END $$;
RESET ROLE;
ROLLBACK;
