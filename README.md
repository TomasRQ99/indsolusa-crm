# IndSolUSA CRM

IndSolUSA's internal CRM for managing accounts, contacts, a deals pipeline, tasks and activities, with role-based access. Outgoing email is sent from the company's GoDaddy-hosted **sales@indsolusa.com** mailbox.

**Stack:** Next.js 15 (App Router, Server Actions) · TypeScript · PostgreSQL · Prisma · `jose` signed-cookie sessions · bcrypt passwords · zod validation · nodemailer (SMTP).

## Features (v0.1)

| Module | What it does |
| --- | --- |
| Accounts | Company records with owner, details, related contacts/deals/tasks and an activity timeline |
| Contacts | People, optionally attached to an account; search by name or email |
| Deals | Kanban pipeline (Lead → Qualified → Proposal → Negotiation → Won/Lost) with per-stage totals |
| Tasks | Assignable to-dos with due dates and overdue flags; "My" and "Team" views |
| Activities | Calls, meetings, emails and notes logged against accounts |
| Email | Send email to contacts from sales@indsolusa.com (Email page or an account page); each send is logged as an EMAIL activity |
| Users & roles | Admin screen to create users, change roles and deactivate accounts |
| Dashboard | Open pipeline, won this quarter, my tasks, recent activity |

### Permissions

| Role | Read | Edit | Manage users |
| --- | --- | --- | --- |
| REP | everything | records they own (accounts, deals) or are assigned (tasks) | no |
| MANAGER | everything | everything, can reassign account owners | no |
| ADMIN | everything | everything | yes |

Users are deactivated, never deleted. Role and active status are checked against the database on every request, so a change takes effect right away.

## Getting started (Windows)

1. Install the prerequisites:
   ```powershell
   winget install OpenJS.NodeJS.LTS
   winget install Git.Git
   winget install Docker.DockerDesktop   # or install PostgreSQL 16 directly
   ```
   Open a new terminal afterwards so `node`, `npm` and `git` are on your PATH.

2. Configure the environment:
   ```powershell
   cd corporate-crm
   Copy-Item .env.example .env
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   # paste the output into AUTH_SECRET in .env
   ```
   Then fill in the email settings (see **Email setup** below) and set `SEED_ADMIN_PASSWORD`.

3. Install, start the database, migrate and seed:
   ```powershell
   npm install
   npm run db:up          # starts Postgres in Docker (skip if you use a local install)
   npm run db:migrate -- --name init
   npm run db:seed
   ```

4. Run:
   ```powershell
   npm run dev
   ```
   Open http://localhost:3000 and sign in as `sales@indsolusa.com` with the `SEED_ADMIN_PASSWORD` you set.
   Change it right away under your name → **My profile**, then add staff under **Users**.
   Set `SEED_DEMO="true"` before seeding if you want throwaway sample data to try things out.

## Email setup (GoDaddy)

The CRM sends over SMTP as `sales@indsolusa.com`. GoDaddy sells two different email products, and each uses different servers.
To see which one you have, sign in to GoDaddy and open **My Products → Email & Office**.

| GoDaddy product | `SMTP_HOST` | `SMTP_PORT` | `SMTP_SECURE` |
| --- | --- | --- | --- |
| Professional Email | `smtpout.secureserver.net` | `465` | `true` |
| Microsoft 365 from GoDaddy | `smtp.office365.com` | `587` | `false` (STARTTLS) |

Set `SMTP_USER="sales@indsolusa.com"` and `SMTP_PASS` to that mailbox's password. Then, as an admin, open **Users → Email delivery → Send test email**.

Notes:
- The From address is always sales@indsolusa.com. Only the display name changes (for example "Jane Smith | IndSolUSA"), so replies come back to the sales inbox.
- Sending over SMTP doesn't save a copy in the mailbox's Sent folder. `MAIL_BCC` (sales@indsolusa.com by default) puts a copy in the inbox, and the CRM logs every email on the contact's timeline.
- **IndSolUSA uses Microsoft 365, and the tenant blocks SMTP AUTH**, so the CRM sends through **Microsoft Graph** instead:
  1. In entra.microsoft.com, go to App registrations → New registration ("IndSolUSA CRM", single tenant, no redirect URI).
  2. Under API permissions, add Microsoft Graph → *Application* permission **Mail.Send**, then click **Grant admin consent**.
  3. Under Certificates & secrets, create a new client secret and copy its **Value**.
  4. Put the Directory (tenant) ID, Application (client) ID and secret Value into `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID` and `GRAPH_CLIENT_SECRET` in `.env`.

  When these are set, the SMTP settings are ignored. Sent mail lands in sales@'s Sent Items. The client secret expires (you choose up to 24 months), so put a renewal reminder in your calendar.
  Mail.Send as an application permission lets the app send as *any* mailbox in the tenant. Guard the secret, or limit the app to sales@ with Exchange Online "RBAC for Applications".
- `.env` holds the mailbox password. Keep it out of git (already in `.gitignore`), and restrict who can read it on the server.
- Bulk or marketing email shouldn't go through this mailbox: GoDaddy caps how many messages it sends per day.

## Project layout

```
prisma/
  schema.prisma        data model (User, Account, Contact, Deal, Task, Activity)
  seed.ts              sample users and data
src/
  middleware.ts        redirects requests without a valid session to /login
  lib/                 db client, auth/session, permissions, form parsing, formatting
  components/          small shared client components
  app/
    login/             sign-in page and login/logout actions
    (app)/             authenticated area (sidebar layout)
      dashboard/ accounts/ contacts/ deals/ tasks/ activities/ email/ profile/ admin/users/
```

Each module keeps its mutations in a colocated `actions.ts` (Server Actions). Every action calls `requireUser()` or `requireRole()` and checks ownership with `assertCanEdit()` before writing.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run typecheck` | TypeScript check |
| `npm run db:migrate` | Create or apply migrations |
| `npm run db:seed` | Load sample data |
| `npm run db:studio` | Browse data in Prisma Studio |

## Suggested next steps

- Edit forms for contacts, deals and tasks (accounts already have one)
- Inline form validation messages instead of thrown errors (in production builds, Next.js hides the text of errors thrown from Server Actions)
- Drag-and-drop on the deals board
- SSO (Azure AD / Okta) through Auth.js once the company IdP is known
- Reading the sales@ inbox over IMAP so customer replies show up on contact timelines
- Email templates (quotes, follow-ups) and attachments
- Audit log, CSV import/export
- Tests (Vitest for lib/, Playwright for flows) and CI
