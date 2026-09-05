-- Apply after the earnings migrations. Customer claimant is separate from staff attribution.
BEGIN;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS claimant_name varchar(160);

CREATE OR REPLACE FUNCTION public.app_duplicate_claim_details(p_ref text)
RETURNS TABLE(transaction_id bigint, ref_no varchar, claimed_by_name varchar, claimed_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF public.app_current_user_id() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  RETURN QUERY SELECT t.id, t.ref_no, t.claimant_name, t.claimed_at
  FROM public.transactions t
  WHERE regexp_replace(t.ref_no, '[^0-9]', '', 'g') = regexp_replace(COALESCE(p_ref, ''), '[^0-9]', '', 'g')
    AND t.status = 'verified' ORDER BY t.id LIMIT 1;
END $$;
REVOKE ALL ON FUNCTION public.app_duplicate_claim_details(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_duplicate_claim_details(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_protect_customer_claimant()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.claimant_name := NULLIF(trim(NEW.claimant_name), '');
  IF TG_OP = 'UPDATE' AND NEW.claimant_name IS DISTINCT FROM OLD.claimant_name
     AND NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'The saved customer claimant can only be corrected by an admin.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_protect_customer_claimant ON public.transactions;
CREATE TRIGGER trg_protect_customer_claimant BEFORE INSERT OR UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.app_protect_customer_claimant();
REVOKE ALL ON FUNCTION public.app_protect_customer_claimant() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
