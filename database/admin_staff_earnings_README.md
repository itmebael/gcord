# Admin and staff earnings migration

If the existing role enum contains both `admin` and `super_admin`, the base migration now converts existing Super Admin accounts to Admin rather than failing. It retains the legacy enum label for dependency/history compatibility; it does not rebuild the enum or delete accounts. If only `super_admin` exists, it renames that label. Frontend role checks still need to accept `admin` as described below.

**Personal tier creation and editing:** After the migrations below, apply the updated `staff_edit_own_commission.sql` to enable Add my tier and the editor on My Earnings. Staff may create personal tiers without admin assignment and change their minimum, maximum, fixed payout and priority. The creation RPC assigns ownership from the active session; it accepts no user ID. Staff cannot edit shared defaults, change ownership, delete tiers, or modify other staff tiers. Direct table writes remain admin-only. Edits check the original timestamp to reject stale saves. Saved earnings are not recalculated.

**Commission tiers update:** Your existing `commission_tiers` table is now the source of commission payouts. Apply `admin_staff_earnings.sql` first **only if not already applied**, then `commission_tiers_earnings.sql`. Do not rerun the base migration afterward. The new migration replaces proportional calculations for new claims, and the current earnings page requires its added columns. The proportional-rate instructions below describe the original migration, not the active tier calculation.

Staff can read only their own commission tiers and earnings; shared default tiers (`user_id IS NULL`) are visible to signed-in staff. Admins can manage all tiers and view staff earnings. Database RLS enforces access even for direct API requests. Session ownership and role updates are restricted to prevent impersonation through the previous broad UPDATE grants.

For each transaction, a matching personal tier takes priority over a matching default tier. Bounds are inclusive. Within either group, lowest `sort_order`, then lowest `id`, wins if ranges overlap. A matched transaction earns the fixed `payout_amount` once; an unmatched transaction earns zero and is labeled “No matching tier.” Past payouts remain unchanged when tiers change. An admin correction to transaction amount re-matches current tiers. Existing proportional records are preserved as “Previous rate.” No historical transactions are backfilled.

The database migration has not been executed here. Use `commission_tiers_earnings_verify.sql` in staging to verify fixed payouts and cross-staff access restrictions with actual database roles. The earlier proportional verification script is superseded when tiers are enabled.

Run `admin_staff_earnings.sql` in the Supabase SQL Editor against the existing database, after the existing migrations. It runs in a transaction and preserves existing rows. Do not run `gcord_schema.sql` again: it drops your tables. Do not rerun the older role migration afterward.

This is database support, not a completed frontend implementation. Deploy alongside the JavaScript changes below. The migration has not been executed against a database in this workspace; PostgreSQL tooling is unavailable. Run the accompanying rollback verification script in a staging database first.

## Rules

- `verified` means successfully claimed, and `created_by_user_id` identifies the claiming staff member. There is no separate claim workflow in the existing app. If verification and payment are separate business steps, add an explicit claim operation before using this calculation for payouts.
- Default earnings: `round(transaction amount × 10 / 500, 2)`. This is proportional: PHP 250 earns PHP 5; PHP 500/1,000/1,500/5,000 earn PHP 10/20/30/100.
- Admins can change the rate and basis. Each earning keeps its original rate; changes apply to future earnings. Correcting a transaction amount recalculates using its original rate. Marking it duplicate voids its earnings. Deleting a transaction deletes its earning.
- New verified staff transactions earn automatically. Admin transactions and duplicates do not earn. Historical rows are not backfilled. Historical claim details remain unknown. Changing an old duplicate to verified constitutes a new claim.
- Today, week-to-date (Monday start), month-to-date, and overall summaries use claim time in `Asia/Manila`. Report date filters use the receipt's `txn_date` and include both endpoint dates.
- The person who claimed is interpreted as the staff member who recorded the transaction. A customer claimant would need a separate field/workflow.
- Optional GCash fields are nullable storage only. Populate them only from available provider data; SQL cannot retrieve or verify account ownership. No provider API availability was established by this work.

## Frontend integration

All calls use the existing Supabase client with the `x-gcord-session` header from `app_login`.

```js
// Replace super_admin checks/values/labels across the frontend with admin/Admin.
// Sign in again after deployment so cached session roles are refreshed.

// Admin: PHP 10 for each PHP 500.
await sb.rpc('app_set_earning_rate', { p_rate: 10, p_basis: 500 });

// Staff dashboard. Refresh after each successful save and on period selection.
const earnings = await sb.rpc('app_staff_earnings_summary');
// Returns [{ staff_user_id, today_earnings, weekly_earnings,
//            monthly_earnings, overall_earnings }].
// Admin can supply { p_staff_user_id: 123 } to view another staff account.

// Duplicate report. Use 'duplicate', not 'duplicates', as the status argument.
await sb.rpc('app_transaction_report', {
  p_from: '2026-09-01', p_to: '2026-09-30', p_status: 'duplicate',
  p_limit: 100, p_offset: 0
});

// Reference-only partial search. Do not filter recipient names/numbers in JS.
await sb.rpc('app_transaction_report', { p_reference: '123456' });

// View Details: pass the selected transaction ID.
await sb.rpc('app_transaction_report', { p_transaction_id: 123 });

// Duplicate claim display, including cross-staff matches without exposing the full row.
await sb.rpc('app_duplicate_claim_details', { p_ref: '1234567890123' });

await sb.rpc('app_change_password', {
  p_current_password: currentPassword, p_new_password: newPassword
});
```

Check `error` on every RPC and the password RPC's `data.ok`. An expired session raises an error, rather than masquerading as an empty report. Paginate report results for exports or totals; one page is not the entire dataset.

The current `addTransaction` writes directly to `transactions`. The new triggers run on those inserts. Use **the returned row's status and matched_transaction_id** to decide whether it was a duplicate; the earlier browser check can race. Remove the separate browser insert into `duplicate_events` because the trigger writes that event. The legacy `sp_save_transaction` also inserts duplicate events: update it before using that legacy RPC with this migration (its duplicate event insert must use `ON CONFLICT DO NOTHING`).

Include `gcash_owner_masked_name`, `gcash_account_number`, `claimed_at`, and `claimed_by_name` in the frontend select/mapping as needed. Send optional GCash fields in the insert only when supplied by the provider. Display unknown historical claim details as unavailable.

The migration revokes direct updates of password hashes and roles to prevent staff from elevating their own account or bypassing password checks. Existing role/status/verification management updates require a new admin-only RPC before those screens can continue updating these fields. Existing admin account creation still uses the old flow; strong password enforcement in this migration covers `app_change_password`, not that creation flow. Do not claim system-wide enforcement until account creation also uses a validated server-side password RPC.

Transaction Overview styling, glassmorphism, button wiring, reference-only search UI, role labels and dashboard earnings cards require HTML/CSS/JavaScript edits. SQL alone does not change them.
