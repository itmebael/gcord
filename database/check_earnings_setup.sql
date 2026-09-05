-- Read-only diagnostic. Run in the Supabase SQL Editor connected to the app project.
-- commission_tiers configures payouts; staff_earnings records earned payouts.
SELECT
  to_regclass('public.commission_tiers') IS NOT NULL AS has_commission_tiers,
  to_regclass('public.staff_earnings') IS NOT NULL AS has_earnings_ledger,
  to_regprocedure('public.app_staff_earnings_summary(bigint)') IS NOT NULL AS has_summary_function,
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff_earnings'
      AND column_name = 'commission_method') AS has_tier_migration,
  EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid = to_regclass('public.transactions')
      AND tgname = 'trg_record_staff_earnings' AND tgenabled <> 'D') AS has_earnings_trigger;

-- If all checks are true but the app still reports missing setup, run separately:
-- NOTIFY pgrst, 'reload schema';
