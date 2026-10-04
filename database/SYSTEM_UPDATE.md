Apply the update
================

1. Back up the existing database, then run `20260920_system_update.sql` in the Supabase SQL Editor. It is an additive migration for the existing GCORD database and can be rerun. It requires the existing `user_verification.sql` and `admin_staff_earnings.sql` migrations. Do not rerun `gcord_schema.sql`: that script drops existing tables.
2. Deploy the updated HTML and JavaScript together, including `spreadsheet-export.js`.
3. Confirm that Supabase email signup is enabled and its email template delivers the numeric verification code requested by the signup dialog. Verify a real signup, then sign in with the same email and password.

New signups require first and last names; middle and extension names are optional. Successful email verification creates an active, verified staff account. Age, birthdate, ID and face capture are no longer requested. Existing accounts, approval states and historical ID data are preserved. The migration stores name parts separately and maintains the existing `full_name` column for other screens and database functions.

Dashboard totals and admin reports use recorded transaction rows: total = verified + duplicate. The admin dashboard and the default admin report both cover all time and all staff. Filtered reports intentionally show only the selected staff, status and period. Staff reports cover that staff member's records and show their applied date range. Recorded dates use Philippine time, with an inclusive start date and end date (through midnight at the start of the following day). Receipt dates do not determine these report periods.

Reports download as Excel `.xlsx` workbooks. Open them in Excel or import them into a spreadsheet application. Reference and phone numbers are explicit text cells, preserving leading zeroes without formulas. Recipient is the GCash account owner; claimant is a separate field. Historical claimant values are not guessed or copied from recipient names.

Automatic receipt capture is already enabled on the scanner. It waits for a stable, readable GCash receipt and then presents the result for review. Real camera testing needs HTTPS (or localhost), camera permission, and access to the OCR service. Capture and Upload remain available.

September 22 scanner/dashboard fixes
-----------------------------------

Deploy the updated `login.html` as well. It now recognizes the existing persistent session and redirects returning staff to their dashboard and admins to the admin dashboard without another login. Explicit logout clears the saved session. No database migration is needed for this redirect fix; revoked sessions and cleared browser storage still require signing in again.

Deploy `admin-dashboard.html`, `dashboard.html`, `scan.html`, `scanner-auto-capture.js` and `transactions.js` together. The admin summary now has Total Transactions, Successfully Verified (Verified Transactions), and Duplicates Blocked, without the All Time / All Staff caption. Existing totals still cover all saved records.

Normal receipt previews are read-only until Save. Detecting an already claimed reference automatically records the blocked attempt against the signed-in user without requiring receipt fields or another customer claimant. The duplicate popup shows the recording status and only offers **Go to My Transactions**. Apply `database/record_duplicate_scan.sql` after the claimant and earnings migrations, and deploy `scan.html` and `supabase-api.js` together. The RPC writes both the transaction and duplicate event atomically. Cancelling returns to the camera, repeated clicks during a save are ignored, and auto capture can retry after an OCR timeout or scanner restart. My Transactions details now display the saved claimant separately from the GCash owner. OCR skips explicitly identified sender names when looking for a masked recipient.

The existing Last 7 Days and This Month report filters pass automated Manila-date boundary and staff isolation checks. Deploy `reports.html`, `staff-reports.js`, `report-trend.js` and `supabase-api.js` together and apply the migration above if the live version still has missing claimant fields or report errors. Historical missing claimants and incorrect owner names require correction using the actual receipt/customer information; they cannot be reconstructed reliably. Earlier cancelled scans cannot be distinguished safely from intentional saves in historical rows, so this update does not delete them automatically.

`npm.cmd test` also checks cancellation without writes, claimant submission, double-click protection, OCR restart and timeout recovery. Live camera/OCR tests across staff accounts and any historical data corrections remain deployment checks.

Validation: `npm.cmd test` runs receipt parsing, scan validation, report boundaries, pagination/count consistency, spreadsheet text preservation and password checks. The SQL migration and real email delivery require validation in your Supabase environment; they have not been executed by this code update.
