-- Apply AFTER admin_staff_earnings.sql, using the Supabase SQL Editor as owner.
-- Uses your EXISTING public.commission_tiers table; does not recreate or seed it.
-- Staff see their own tiers and shared defaults (user_id IS NULL), never other staff's.
-- Admin retains authorized management access. All browser calls need x-gcord-session.
-- Matching: inclusive bounds; matching personal tiers take precedence over defaults.
-- If ranges overlap, lowest sort_order then lowest id wins. No match earns zero.
-- Existing proportional earnings are preserved and labeled legacy; no historical backfill.
BEGIN;
SET LOCAL search_path = pg_catalog, public;

ALTER TABLE public.staff_earnings
  ADD COLUMN IF NOT EXISTS commission_tier_id bigint REFERENCES public.commission_tiers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tier_min_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS tier_max_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS commission_method text NOT NULL DEFAULT 'legacy'
    CHECK (commission_method IN ('legacy', 'fixed_tier', 'no_matching_tier'));

-- Preserve previously calculated values while permitting fixed commission payouts.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.staff_earnings'::regclass
      AND attname = 'earnings' AND attgenerated <> '') THEN
    ALTER TABLE public.staff_earnings ALTER COLUMN earnings DROP EXPRESSION;
  END IF;
END $$;
ALTER TABLE public.staff_earnings ALTER COLUMN earnings SET NOT NULL;

-- Replace all existing policies on these two tables: permissive policies are ORed,
-- so merely adding an own-user policy would not close a pre-existing broad policy.
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('commission_tiers', 'staff_earnings')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;
ALTER TABLE public.commission_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_earnings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commission_tiers, public.staff_earnings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.commission_tiers, public.staff_earnings TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.commission_tiers TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.commission_tiers_id_seq TO anon, authenticated;

CREATE POLICY commission_tiers_read ON public.commission_tiers FOR SELECT TO anon, authenticated
  USING (public.app_current_user_id() IS NOT NULL AND
    (user_id IS NULL OR user_id = public.app_current_user_id() OR public.app_is_admin()));
CREATE POLICY commission_tiers_admin_insert ON public.commission_tiers FOR INSERT TO anon, authenticated
  WITH CHECK (public.app_is_admin());
CREATE POLICY commission_tiers_admin_update ON public.commission_tiers FOR UPDATE TO anon, authenticated
  USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());
CREATE POLICY commission_tiers_admin_delete ON public.commission_tiers FOR DELETE TO anon, authenticated
  USING (public.app_is_admin());
CREATE POLICY staff_earnings_read ON public.staff_earnings FOR SELECT TO anon, authenticated
  USING (public.app_current_user_id() IS NOT NULL AND
    (staff_user_id = public.app_current_user_id() OR public.app_is_admin()));

-- Block session reassignment: the old schema granted UPDATE on entire session rows.
-- A staff member must not repoint a session token to another user to read their pay.
REVOKE UPDATE ON public.user_sessions FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (user_id, session_token) ON public.user_sessions FROM PUBLIC, anon, authenticated;
GRANT UPDATE (is_active, ended_at) ON public.user_sessions TO anon, authenticated;
-- Preserve the earlier migration's protection against self-service role escalation.
REVOKE UPDATE ON public.users FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (role, password_hash) ON public.users FROM PUBLIC, anon, authenticated;
GRANT UPDATE (username, email, first_name, last_name, middle_initial, phone,
  age, birthday, valid_id_url, face_capture_url, updated_at) ON public.users TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_record_staff_earnings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE v_tier public.commission_tiers%ROWTYPE;
  v_previous public.staff_earnings%ROWTYPE;
  v_method text;
BEGIN
  IF NEW.status = 'duplicate' THEN
    UPDATE public.staff_earnings SET voided = true WHERE transaction_id = NEW.id;
    IF NEW.matched_transaction_id IS NOT NULL THEN
      INSERT INTO public.duplicate_events(ref_no, original_transaction_id, duplicate_transaction_id, amount)
      VALUES (NEW.ref_no, NEW.matched_transaction_id, NEW.id, NEW.amount)
      ON CONFLICT (original_transaction_id, duplicate_transaction_id) DO NOTHING;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.claimed_at IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_previous FROM public.staff_earnings WHERE transaction_id = NEW.id FOR UPDATE;
  IF FOUND AND v_previous.transaction_amount = NEW.amount THEN
    -- Tier edits/deletion never alter past payouts. Restoring a claim restores its payout.
    UPDATE public.staff_earnings SET voided = false WHERE transaction_id = NEW.id;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = NEW.created_by_user_id AND role = 'staff') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_tier FROM public.commission_tiers
  WHERE (user_id = NEW.created_by_user_id OR user_id IS NULL)
    AND NEW.amount BETWEEN min_amount AND max_amount
  ORDER BY (user_id IS NOT NULL) DESC, sort_order, id LIMIT 1;
  v_method := CASE WHEN FOUND THEN 'fixed_tier' ELSE 'no_matching_tier' END;
  INSERT INTO public.staff_earnings
    (transaction_id, staff_user_id, transaction_amount, earning_rate, transaction_basis,
     earnings, earned_at, commission_tier_id, tier_min_amount, tier_max_amount, commission_method)
  VALUES (NEW.id, NEW.created_by_user_id, NEW.amount, COALESCE(v_tier.payout_amount, 0),
    NEW.amount, COALESCE(v_tier.payout_amount, 0), NEW.claimed_at,
    v_tier.id, v_tier.min_amount, v_tier.max_amount, v_method)
  ON CONFLICT (transaction_id) DO UPDATE SET
    transaction_amount = EXCLUDED.transaction_amount, earnings = EXCLUDED.earnings,
    earning_rate = EXCLUDED.earning_rate, transaction_basis = EXCLUDED.transaction_basis,
    commission_tier_id = EXCLUDED.commission_tier_id, tier_min_amount = EXCLUDED.tier_min_amount,
    tier_max_amount = EXCLUDED.tier_max_amount, commission_method = EXCLUDED.commission_method,
    voided = false;
  -- An authorized amount correction re-matches the current tiers; claim time stays fixed.
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.app_record_staff_earnings() FROM PUBLIC, anon, authenticated;

-- Prevent the obsolete proportional settings from appearing to affect commissions.
CREATE OR REPLACE FUNCTION public.app_set_earning_rate(p_rate numeric, p_basis numeric)
RETURNS public.staff_earning_settings LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'Commission tiers are enabled. Manage public.commission_tiers instead of proportional rates.';
END $$;
REVOKE ALL ON FUNCTION public.app_set_earning_rate(numeric,numeric) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
