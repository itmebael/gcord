-- Run AFTER commission_tiers_earnings.sql in the Supabase SQL Editor.
-- Staff may create and edit personal tiers through these RPCs. Table write policies
-- remain admin-only. Ownership, shared defaults and other users' tiers cannot change.
BEGIN;
CREATE OR REPLACE FUNCTION public.app_create_my_commission_tier(
  p_min_amount numeric, p_max_amount numeric, p_payout_amount numeric, p_sort_order integer
) RETURNS public.commission_tiers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_uid bigint := public.app_current_user_id(); v_tier public.commission_tiers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  IF p_min_amount IS NULL OR p_max_amount IS NULL OR p_payout_amount IS NULL OR p_sort_order IS NULL
     OR p_min_amount < 0 OR p_max_amount < p_min_amount OR p_payout_amount < 0
     OR p_min_amount >= 10000000000 OR p_max_amount >= 10000000000 OR p_payout_amount >= 10000000000
     OR p_min_amount <> round(p_min_amount, 2) OR p_max_amount <> round(p_max_amount, 2)
     OR p_payout_amount <> round(p_payout_amount, 2) THEN
    RAISE EXCEPTION 'Use nonnegative amounts with at most two decimal places, and a maximum at least equal to the minimum.';
  END IF;
  INSERT INTO public.commission_tiers(user_id,min_amount,max_amount,payout_amount,sort_order)
  VALUES(v_uid,p_min_amount,p_max_amount,p_payout_amount,p_sort_order) RETURNING * INTO v_tier;
  RETURN v_tier;
END $$;
REVOKE ALL ON FUNCTION public.app_create_my_commission_tier(numeric,numeric,numeric,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_create_my_commission_tier(numeric,numeric,numeric,integer) TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.app_update_my_commission_tier(
  p_id bigint, p_min_amount numeric, p_max_amount numeric,
  p_payout_amount numeric, p_sort_order integer, p_expected_updated_at timestamp
) RETURNS public.commission_tiers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_uid bigint := public.app_current_user_id();
  v_tier public.commission_tiers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  IF p_min_amount IS NULL OR p_max_amount IS NULL OR p_payout_amount IS NULL
     OR p_sort_order IS NULL OR p_expected_updated_at IS NULL
     OR p_min_amount < 0 OR p_max_amount < p_min_amount OR p_payout_amount < 0
     OR p_min_amount >= 10000000000 OR p_max_amount >= 10000000000 OR p_payout_amount >= 10000000000
     OR p_min_amount <> round(p_min_amount, 2) OR p_max_amount <> round(p_max_amount, 2)
     OR p_payout_amount <> round(p_payout_amount, 2) THEN
    RAISE EXCEPTION 'Use nonnegative amounts with at most two decimal places, and a maximum at least equal to the minimum.';
  END IF;
  SELECT * INTO v_tier FROM public.commission_tiers
  WHERE id = p_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This personal commission tier is not available to edit.'; END IF;
  IF v_tier.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'This tier changed since you opened it. Reload your tiers before saving.';
  END IF;
  UPDATE public.commission_tiers
  SET min_amount = p_min_amount, max_amount = p_max_amount, payout_amount = p_payout_amount,
    sort_order = p_sort_order, updated_at = clock_timestamp() AT TIME ZONE 'UTC'
  WHERE id = v_tier.id AND user_id = v_uid RETURNING * INTO v_tier;
  RETURN v_tier;
END $$;
REVOKE ALL ON FUNCTION public.app_update_my_commission_tier(bigint,numeric,numeric,numeric,integer,timestamp) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_update_my_commission_tier(bigint,numeric,numeric,numeric,integer,timestamp) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
