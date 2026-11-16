# Security design

| Area | Control |
|---|---|
| Tenant isolation | Postgres Row-Level Security (FORCE) on all 53 tenant tables; app connects as `hrms_app` (no BYPASSRLS); tenant comes only from the verified session. Every foreign key between tenant tables also has a same-company key on `(tenant_id, id)`, so no row can link to another company's employee, department, etc. (foreign-key checks bypass RLS, so this closes that gap in the database itself). Emails are unique across all companies (`user_directory` keyed by email). Verified by `scripts/e2e-flows.mjs` (cross-company read, edit and attendance-correction attempts). |
| Company creation | No public sign-up. Only Super Admins (platform owners: separate accounts, own session cookie, lockout) create companies and their Company Admins; the first Super Admin is created from the command line (`npm run platform:admin`). Company staff can only use emails on their company's own email domain. |
| Passwords | Argon2id (m=19 MiB, t=2, p=1); 12+ chars with mixed case and digits; constant-time handling for unknown accounts. |
| Brute force | Per-IP rate limits (company and Super Admin login 10/min, forgot-password 5/15 min, reset 10/min); account lock after 5 failures for 15 min, doubling on every further failure (30, 60, 120 … min, max 24 h) – SEC-04. |
| Sessions | 15-min HS256 access token + 14-day rotating refresh token (hashed at rest, reuse detection revokes the family); `HttpOnly; SameSite=Strict; Secure` cookies; `tokenVersion` revokes all tokens on password change / disable. Every request re-checks the user's status, token version and permissions, using a 10-second in-memory cache (changes made through Access & roles apply immediately on that server; elsewhere within 10 s). Sessions end after the inactivity time Operations sets (default 30 min); only requests made while the person is using the page extend it, background polling does not, and an idle session cannot be refreshed – SEC-03. |
| CSRF | SameSite=Strict + double-submit token header on every mutation. |
| Authorisation | Permission strings per role (editable per tenant, can't grant what you don't hold); data scope (own / team / all) enforced in services; no self-approval in workflows and the person who processed a payroll run cannot approve it (exception: a Company Admin may approve their own item when no one else holds that approval step). Permanent deletes need the separate "Delete records" permission; employees can only be deleted after they have left. |
| Confidentiality (F4) | Salary/CNIC redacted for Team Leads; documents and payslips visible only to the employee and authorised staff. |
| Anonymous complaints (F3) | No user reference, uploader, IP, user-agent or timestamp beyond the date; request logging disabled for that endpoint; one-time tracking code (only its hash is stored). |
| Surveys | Anonymous responses use an HMAC respondent key, preventing double voting without storing identity. |
| Audit (F5) | Every mutation is written in the same transaction as the change, with field-level old → new values for the changed record (AUD-04); audit table is append-only for the app role; secrets/CNIC redacted from logged bodies. |
| Encryption at rest (SEC-05) | CNIC, father's CNIC, basic salary, position salaries and complaint text are AES-256-GCM encrypted by the app before reaching Postgres (`DATA_ENCRYPTION_KEY`, or derived from `DATA_HMAC_SECRET`). `db:migrate` encrypts older plaintext rows. Never change the key once data exists. |
| Files | Size limits, magic-byte content sniffing (client MIME ignored), random storage keys, path-traversal guard, served only via authorised endpoints with `nosniff`. Platform logo and favicon: PNG/JPG/WebP/ICO only (SVG refused, it can carry scripts), max 256 KB, served with `Content-Security-Policy: default-src 'none'`. |
| Headers | API: Helmet with `default-src 'none'`. Web: nonce-based CSP, `frame-ancestors 'none'`, HSTS in production, `Permissions-Policy`. |
| Input | Shared Zod schemas validate every body/query on the server (unknown keys stripped); parameterised SQL only. |
| Errors | Uniform error envelope; stack traces and SQL never reach clients. |
| Secrets | Validated at boot (min 32 chars), generated randomly by `scripts/setup-env.mjs`, never committed. |
| Public endpoints | Without signing in: `/public/branding`, `/public/plans`, `/public/logo`, `/public/favicon` (platform-wide data, never company data), `/public/signup` (5 per hour per IP; creates an unpaid company) and `/public/demo` (10 per minute per IP; records the lead, then signs into the demo company). |
| Demo | The demo company is read-only in the API itself: every non-GET request from it is refused (`DEMO_READ_ONLY`), whatever the screen allows. |
| Billing lock | An unpaid company's sessions can only reach `/billing` and their notifications (`402 PAYMENT_REQUIRED`); suspension still blocks everything. Payment status changes apply on the next request. |
| Moderation | Removing someone else's post or comment needs the moderation permission and a reason; each removal is recorded (2 warnings, then a disciplinary case HR is alerted to). |
| Devices | Per-device API keys (shown once, hashed at rest, revocable). ZKTeco ADMS devices are identified by a registered serial number (the protocol has no secret); Hikvision devices carry their key in the listener URL, which is masked in request logs. |

**Limits to know about**
- Policy documents (F1) block right-click, copy and printing in the viewer and watermark the viewer's name. This is a deterrent: anything shown on screen can still be photographed or captured.
- Email delivery uses SMTP when `SMTP_URL` is set; in development emails are printed to the API log.
- Payslip amounts are not field-encrypted (payroll totals are summed in SQL); rely on encrypted Postgres storage for those.
- ZKTeco ADMS trusts the serial number. Anyone who knows a registered serial could post punches, so keep serials private and review held punches.
- Before going live: put the app behind HTTPS, set `COOKIE_SECURE=true`, use managed Postgres backups, move file storage to S3-compatible storage, and add MFA (recommended for HR/Admin roles).
