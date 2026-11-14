# HRMS – multi-tenant HR SaaS

Employee records, attendance, leave, payroll, performance, compliance and community in one secure
workspace per company. Built from *HRMS – Requirements Specification (Revised)*; code comments
reference its sections (A1, B7, C3 …).

- **API**: NestJS 11 · PostgreSQL (Row-Level Security) · Drizzle ORM · Argon2id · Zod
- **Web**: Next.js 16 · React 19 · Tailwind CSS 4 · TanStack Query · Radix UI · GSAP (homepage animations)
- **Shared**: permission catalogue, workflows and Zod schemas used by both

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/SECURITY.md](docs/SECURITY.md).

## Who is who

| Role | Where | What they do |
|---|---|---|
| **Super Admin** | `/platform` (separate login) | Runs the SaaS: creates companies and their Company Admins, plans and pricing, platform currency, logo, favicon and sign-in footer. |
| **Company Admin** | Company workspace | Everything inside one company: all HR and Operations permissions, roles and access, settings, and permanent deletes. |
| **HR · Operations · Team Lead · Employee** | Company workspace | Permissions per role, editable by the Company Admin. |

## Run it locally (Windows, macOS, Linux)

Requires Node.js 22+. No Docker needed: a local PostgreSQL runs from npm.

```bash
npm install
npm run setup          # creates .env with random secrets, builds the shared package
npm run db:start       # terminal 1 – PostgreSQL on :5433 (keep running)
npm run build -w @hrms/api && npm run db:migrate
npm run dev:api        # terminal 2 – API on :4000
npm run dev:web        # terminal 3 – web on http://localhost:3000
```

<http://localhost:3000> is the public homepage (features, plans from the database, sign in).

Create your Super Admin account once (uses `PLATFORM_ADMIN_*` from `.env`, or pass flags):

```bash
npm run build -w @hrms/api && npm run platform:admin -- --email you@example.com --name "Your Name"
```

Sign in at <http://localhost:3000/platform/login>. Companies join in two ways:

- **Super Admin creates it**: **New company** makes a workspace with its own email domain (e.g. `prepecomalign.com`)
  and a Company Admin, with sign-in details shown to you once, or an email link so they set their own password.
- **Website sign-up** (`/signup`): the visitor picks a plan and monthly or yearly billing, creates their Company Admin
  account and lands on **Billing** to pay. The workspace opens once you confirm the payment.

### Live demo

Visitors can explore a sample company read-only at `/demo` after leaving their name, email and company (saved as
**Leads**). Set it up once:

```bash
node scripts/seed-demo.mjs   # creates a sample company; login details go to demo-credentials.local.md
```

Then open that company in the Super Admin console and tick **Public demo company (read-only)** in its Billing card.
Every change in the demo is refused by the API, so visitors can't break it.

## Super Admin console

- **Companies**: create, suspend, change plan or modules, employee limit and email domain; resend the welcome email.
  Each company page has a **Billing** card: monthly or yearly cycle, invoices, **Mark paid** / **Mark unpaid**, and the
  demo switch. The list shows each company's payment status.
- **Leads**: demo visitors and website sign-ups, with CSV export.
- **Platform settings → Plans & pricing**: monthly and yearly price per plan. The homepage, sign-up page and every
  company's Billing page show them live.
- **Platform settings → General**: the platform currency (all plans use it), the sign-in page footer (`{year}` is filled
  in), and the platform logo and favicon.
- **Platform settings → Payment methods**: bank accounts, mobile wallets etc. with the details companies see when paying.
- **Super Admins** and **Email** (SMTP status and test email).

### Billing

There's no card gateway yet; payments are confirmed by hand.

1. Each billing period has an invoice at the plan's monthly or yearly price.
2. The Company Admin pays with one of your payment methods and enters the transaction reference on **Billing & plan**.
3. You check it and click **Mark paid**: the company is paid until the end of that period.
4. When a period ends, the next invoice is created automatically and the company shows **Payment due** for 7 days,
   then **Unpaid**. An unpaid workspace is paused: the Company Admin can only open Billing, everyone else sees a notice.
   **Mark unpaid** pauses a company immediately (e.g. a bounced payment).

## Company highlights

- Employees sign in with email and password only; emails are unique across the platform and use the company's domain.
- Terminated employees stay listed with all their records and can be **reactivated** (login restored), or **deleted
  permanently** by someone with the "Delete records" permission.
- HR and Company Admins correct attendance directly; employees request corrections that go through approval.
- **Org chart → Reporting lines** draws the company as a tree from the top down, with zoom.
- **Community**: the Company Admin writes the automatic birthday post (Settings → Community, with `{name}`,
  `{department}`… placeholders). Moderators who remove someone else's post or comment must give a reason, which the
  author receives. The first two removals in 12 months are warnings; the third alerts HR for disciplinary action
  (**Community → Moderation** lists them all).
- Medical claims only for employees HR marks eligible; KPI submissions can carry proof-of-work files.
- Light and dark mode everywhere.

## Going live (SaaS)

All deployment settings are environment variables – no code edits. Set these on the hosting platform:

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `DATABASE_ADMIN_URL` | App (RLS) and migration connections |
| `APP_URL` | Public URL, used in emails |
| `JWT_SECRET`, `DATA_HMAC_SECRET`, `DATA_ENCRYPTION_KEY` | Secrets – generate once, never change after data exists |
| `COOKIE_SECURE=true`, `NODE_ENV=production` | Required in production |
| `SMTP_URL`, `MAIL_FROM` | Outgoing email |
| `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_TAGLINE`, `NEXT_PUBLIC_SUPPORT_EMAIL` | Name and tagline; the support email powers "Get started" / "Contact us" on the homepage |
| `API_INTERNAL_URL` | Only when web and API run as separate servers (not on Vercel) |
| `STORAGE_DRIVER` | `disk` (files under `STORAGE_DIR`) or `db` (inside Postgres). Defaults to `db` on Vercel |
| `DB_POOL_MAX` | Connections per API instance (default 20, or 3 on Vercel) |

Then run `npm run db:migrate` and `npm run platform:admin -- --email … --name …` once against the production database.
Run `npm run db:migrate` again after every update: it applies new migrations and re-applies the security hardening
(RLS policies, grants, same-company foreign keys). Logo, favicon, currency and footer are then set in the Super Admin console.

### Vercel

`vercel.json` deploys `apps/web` and `apps/api` as two services on one domain (`/api/*` and `/iclock/*` go to the API).
The repository `.env` is **not** deployed: add the variables above under Project → Settings → Environment Variables.

- **Database:** use a hosted Postgres (Neon, Supabase, …). `DATABASE_ADMIN_URL` is the owner login, ideally the *direct*
  (non-pooled) URL. Give `DATABASE_URL` a **different** user name and password: the migration creates that role
  (no superuser, no `BYPASSRLS`) so company isolation is enforced. Include `?sslmode=require` if your provider needs it.
- **Migrations** run automatically during production builds when `DATABASE_ADMIN_URL` is set (preview builds skip them
  unless `MIGRATE_ON_PREVIEW=true`).
- **Uploads** are stored in Postgres (Vercel's disk is read-only) and are limited to 4 MB (Vercel's request limit is 4.5 MB).
- `APP_URL` defaults to the project's production domain; set it if you use a custom domain.
- Background jobs (emails, daily attendance) only run while an API instance is awake.

## Tests

```bash
npm test -w @hrms/api                     # unit tests: attendance rules, payroll maths
node scripts/smoke.mjs                    # auth & CSRF (API must be running)
node scripts/e2e-flows.mjs                # workflows, tenant isolation, billing, sign-up, demo, moderation
node scripts/cleanup-test-companies.mjs   # removes leftover e2e/smoke test companies (and their test leads)
```

The e2e and smoke scripts delete the companies they create. Logins are rate-limited (10/min per IP), so wait a
minute between full e2e runs.

## Deploy

`infra/docker-compose.yml` runs Postgres, migrations, API and web with non-root, read-only containers.
Put an HTTPS reverse proxy in front of the `web` service. CI is in `.github/workflows/ci.yml`.

## Biometric devices (SRS 5.2)

Register each device under **Attendance → Devices & import**, then point the device at the HRMS:

- **ZKTeco** (ADMS / Push SDK): *Comm. → Cloud Server Setting* → server = your HRMS host, HTTPS on. The device is matched by the serial number you registered and calls `/iclock/cdata`.
- **Hikvision** (ISAPI): *Network → Advanced → HTTP Listening* → `https://<host>/api/v1/attendance/hikvision/<device key>`. ISUP 5.0 needs a separate gateway and isn't supported.

Device user IDs are matched to an employee's biometric ID (or employee code). Unknown IDs are held for HR to link or discard.

## Module map

| Spec | Where |
|---|---|
| A1 Roles & access, A2 dashboards | `modules/access`, `modules/dashboard` · `/access/*`, `/dashboard` |
| B1–B8 Employees, documents, resignation, directory, headcount, levels, promotions | `modules/employees`, `modules/org` |
| C1–C5 Attendance, overtime, leave, holidays, calendar | `modules/attendance`, `modules/leave` |
| D1–D4 Payroll, loans, medical, food allowance | `modules/payroll` |
| E1–E3 KPIs, incentives, surveys | `modules/performance` |
| F1–F7 Policies, guidelines, complaints, confidentiality, audit, queries, surveys | `modules/compliance`, `common/interceptors.ts` |
| G1–G4 Community, announcements, birthdays, notifications | `modules/community`, `modules/dashboard/scheduler.service.ts` |
| H1 Approval workflows | `packages/shared/src/workflows.ts`, `core/approvals.service.ts` |
| Platform (SaaS operator) | `modules/platform` (companies, plans, billing, payment methods, leads, settings, branding, sign-up, demo) · `/platform/*`, `/`, `/signup`, `/demo`, `/billing` |
