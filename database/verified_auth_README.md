# Google login, email verification and password recovery

Apply `database/verified_auth.sql` as the database owner after `user_verification.sql` and the earnings migrations. Do not rerun gcord_schema.sql. Deploy login.html, verified-auth.js, verified-auth.css and supabase-api.js together.

The app retains its existing password accounts and custom database sessions. Supabase Auth supplies a verified identity only. Signup creates the application account after code verification, with staff role and pending ID approval. Google login requires a matching, active, approved application account. Forgotten passwords use an email code and reset the existing application password, ending old application sessions. They do not use Supabase email/password login.

## Supabase and Google settings required

1. Rotate the Google client secret shared in chat. Store the replacement only in Supabase Authentication → Sign In / Providers → Google. Enable Google and set client ID `727916637804-0q8vfdomlh34uojlgit83bkh0j2l56fn.apps.googleusercontent.com` and the replacement secret there.
2. Google Cloud OAuth client must be a Web application. Set authorized redirect URI to `https://zmbzjqwhxbjjhiqpmsvj.supabase.co/auth/v1/callback`. Add your real website origin under authorized JavaScript origins. Configure test users if the consent app is in testing mode.
3. Supabase Authentication → URL Configuration: set Site URL to your real website and allow the exact callback `https://YOUR-SITE/login.html?google=1` (plus the local HTTP development equivalent if needed). Serve pages over HTTPS or localhost HTTP, not file URLs. The app generates the callback using its current origin and directory.
4. Enable Email provider and email confirmations. The app uses `signInWithOtp` for signup and recovery, including existing legacy accounts that do not yet have an Auth identity. No application account is created by sending a code.
5. In Email Templates, update Magic Link **and Confirm Signup** templates to show the OTP, for example `<p>Your Gcord verification code is <strong>{{ .Token }}</strong>.</p>`. Do not use a magic-link-only template. The UI accepts 6–10 digits.
6. Configure production SMTP so real users can receive mail. Supabase's built-in sender has recipient restrictions/rate limits. Leave Auth rate limits enabled; the UI also requires a minute between resends. Keep verification code expiry short, e.g. 10 minutes. If CAPTCHA is enabled in your project, its token integration must also be configured before these requests can succeed.

## Deployment notes

- `verified_auth.sql` closes old unverified `app_register_staff` and direct browser INSERTs into users. Admin account creation must use an authorized server RPC rather than the old direct-insert fallback.
- Existing usernames/passwords continue through app_login. Apply user_verification.sql before this migration so pending ID approvals cannot sign in with passwords.
- Never put Google secrets or a Supabase service-role key in HTML/JS.
- ID photos remain in memory during the code dialog, then are saved through the existing profile fields; refreshing during verification requires repeating the signup form. Existing document storage behavior was preserved.
- A verified Auth identity without an application profile is expected after cancelling signup or requesting recovery for an unknown email. It has no application session or staff account.

## Checks

`tests/verified-auth.html` exercises mocked email sending, invalid code rejection, verified signup, cancellation, reset, and OAuth redirect arguments. It does not send emails or contact Google. Staging still needs real tests: invalid/expired code, resend limits, cancelled OAuth, approved and pending accounts, password reset invalidating old sessions, and anonymous RPC denial. SQL has not been run against the live database.

Official references: https://supabase.com/docs/guides/auth/social-login/auth-google and https://supabase.com/docs/guides/auth/auth-email-passwordless
