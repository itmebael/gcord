Apply the update
================

1. Back up the existing database, then run `20260920_system_update.sql` in the Supabase SQL Editor. It is an additive migration for the existing GCORD database and can be rerun. It requires the existing `user_verification.sql` and `admin_staff_earnings.sql` migrations. Do not rerun `gcord_schema.sql`: that script drops existing tables.
2. Deploy the updated HTML and JavaScript together, including `spreadsheet-export.js`.
3. Confirm that Supabase email signup is enabled and its email template delivers the numeric verification code requested by the signup dialog. Verify a real signup, then sign in with the same email and password.

New signups require first and last names; middle and extension names are optional. Successful email verification creates an active, verified staff account. Age, birthdate, ID and face capture are no longer requested. Existing accounts, approval states and historical ID data are preserved. The migration stores name parts separately and maintains the existing `full_name` column for other screens and database functions.

Dashboard totals and admin reports use recorded transaction rows: total = verified + duplicate. The admin dashboard and the default admin report both cover all time and all staff. Filtered reports intentionally show only the selected staff, status and period. Staff reports cover that staff member's records and show their applied date range. Recorded dates use Philippine time, with an inclusive start date and end date (through midnight at the start of the following day). Receipt dates do not determine these report periods.

Reports download as Excel `.xlsx` workbooks. Open them in Excel or import them into a spreadsheet application. Reference and phone numbers are explicit text cells, preserving leading zeroes without formulas. Recipient is the GCash account owner; claimant is a separate field. Historical claimant values are not guessed or copied from recipient names.

Automatic receipt capture is already enabled on the scanner. It waits for a stable, readable GCash receipt and then presents the result for review. Real camera testing needs HTTPS (or localhost), camera permission, and access to the OCR service. Capture and Upload remain available.

Validation: `npm.cmd test` runs receipt parsing, scan validation, report boundaries, pagination/count consistency, spreadsheet text preservation and password checks. The SQL migration and real email delivery require validation in your Supabase environment; they have not been executed by this code update.
