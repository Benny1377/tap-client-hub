# TAP Client Hub

TAP Client Hub is a Next.js 16 and Supabase dashboard for TAP Associates, LLC. It centralizes client records, service workflow tracking, staff time, payroll, tax work, credentials, contacts, and support operations in one role-aware application.

## Environments

- Repository: `https://github.com/Max77788/tap-client-hub`
- Production: `https://tap-client-hub.vercel.app`
- Database schema: `tap_hub_project`

## Product areas

| Area | Route | Purpose |
| --- | --- | --- |
| Clients | `/` | Search clients, review groups, and open client details |
| Contacts | `/contacts` | Browse and manage client and internal contacts; governed by the Clients module |
| Workload | `/workload` | Review work periods, stages, assignments, and workload KPIs |
| Timesheet | `/time` | Track and review staff time entries |
| Financials | `/fin` | Review financial work and billing data |
| Payroll | `/pr` | Manage payroll schedules and related work |
| Sales Tax | `/stx` | Track sales-tax paperwork and line items |
| 1099s | `/t9` | Track 1099 work |
| Tax Returns | `/tax` | Track tax-return work |
| Renditions | `/rend` | Track franchise-tax renditions |
| Annual Reports | `/annual` | Track state annual-report renewals |
| Vault | `/vault` | Manage client credential references and secure access links |
| Users & Access | `/users` | Manage user profiles, roles, passwords, and module assignments |
| Support | `/support` | Submit and review the signed-in user's support tickets |
| Support inbox | `/support/inbox` | Central support queue for authorized support staff |
| Settings | `/settings` | User self-service settings |

TAP-specific terminology:

- **STX** means sales tax.
- **Renditions** means franchise-tax renditions.
- **Annual Reports** means state renewal filings.

## Tech stack

- Next.js `16.2.9` App Router
- React `19.2.4`
- TypeScript `5`
- Tailwind CSS `4`
- Supabase SSR and JavaScript client
- PostgreSQL via the Supabase `tap_hub_project` schema
- Resend for email-based 2FA, password recovery, and support notifications
- Vercel for production hosting

## Local development

### Requirements

- Node.js and npm
- Access to the TAP Hub Supabase project
- A local `.env.local` file containing the required variables

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Useful commands:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

The repository's `AGENTS.md` contains the Next.js 16 guidance that must be checked before changing application code.

## Environment variables

Set these in `.env.local` locally and in the Vercel project environment for the appropriate deployment target. Never commit real secrets or expose server-only values to the browser.

| Variable | Scope | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Client and server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client and server | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Privileged server-side Supabase operations |
| `RESEND_API_KEY` | Server only | Email 2FA, password recovery, and support notifications |
| `SUPPORT_API_KEYS_JSON` | Server only | Bearer keys for server-to-server support API clients |
| `DEMO_SESSION_SECRET` | Server only | Optional secret for signed demo sessions; the service-role key is the fallback |
| `NEXT_PUBLIC_TAP_BANK_URL` | Client | Optional default bank URL used by Vault |
| `SUPABASE_ACCESS_TOKEN` | Local migration tooling | Optional Supabase Management API token for migration scripts |

`SUPPORT_API_KEYS_JSON` is a JSON object mapping an active `support_apps.key` to a secret, for example:

```bash
SUPPORT_API_KEYS_JSON='{"carry-ops":"<random-secret>","transact-ops":"<random-secret>"}'
```

Generate a separate strong secret for each external app. Support API keys must remain on the calling app's server and are sent as `Authorization: Bearer [app-secret]`.

## Authentication and access control

- `proxy.ts` protects application routes and redirects unauthenticated requests to `/login?next=...`.
- Login may use the Supabase session flow or the signed demo-session flow.
- Email 2FA and password-recovery routes are server-side email flows. Missing email configuration must fail safely rather than silently claiming delivery.
- `lib/access-policy.ts` is the canonical role and module policy.
- Owner and Admin users receive all modules.
- Staff and Offshore users can access only assigned modules.
- Managers can receive `Users & Access` only according to the existing policy and explicit grants. Managers may edit existing users but must not gain Owner/Admin-only create, delete, or escalation authority.
- Contacts is a second Clients surface, not an independently assignable module.
- Support self-service is available to signed-in users; the central inbox requires Owner/Admin access or the assigned Support module.

When debugging an access or redirect issue, inspect `proxy.ts` before React components. Direct-route enforcement and page/API authorization must agree with the sidebar policy.

## Data and migrations

The canonical baseline schema is `tap_hub_schema.sql`. It creates the dedicated `tap_hub_project` schema and core tables including:

- `profiles`, `clients`, `contacts`, and `client_tax_ids`
- `services`, `client_services`, `work_periods`, and `period_counts`
- `time_entries` and `billing_periods`
- `credentials` and `audit_log`
- State-renewal, comments, and support-related structures added by migrations

Apply migrations deliberately against the intended Supabase project. Relevant migration locations are:

- `supabase/migrations/` for database migrations maintained in the Supabase migration set
- `migrations/` for application-specific migrations and support-system changes
- `docs/datamodel/` for schema and data-model reference material

Do not assume local and hosted database schemas are identical. Before changing an API that writes legacy tables, inspect the hosted table shape and preserve required compatibility fields. In particular, credential writes may need both legacy `portal` and current UI `site` values.

## Shared support API

TAP Hub hosts the firm-wide support database. External FusionIQ applications call the versioned API from their server backends only:

- `POST /api/support/v1/tickets`
- `GET /api/support/v1/tickets/[id]`
- `POST /api/support/v1/tickets/[id]/messages`

Requests are isolated by the authenticated app key. Internal messages and sensitive profile references are not returned to external callers. The complete request/response contract, deployment steps, security model, and examples are documented in [`docs/support-integration.md`](docs/support-integration.md).

The in-app support system also provides authenticated routes under `/api/support/` for ticket creation, ticket detail, and the central inbox.

## Deployment

Deploy through the repository's configured Vercel project after focused verification:

1. Confirm the intended branch and review the diff.
2. Run `npm run lint`, `npx tsc --noEmit`, and `npm run build`.
3. Apply any required database migrations to the intended Supabase project.
4. Confirm production environment variables, especially Supabase, Resend, and support API secrets.
5. Deploy and verify the exact production alias.
6. Test login, the affected route, authorization behavior, and server persistence in production.

Keep deployment status, configuration status, and runtime verification separate when reporting a release.

## Testing and verification

Focused tests are stored under `tests/` and `lib/`. Support-related checks can be run with:

```bash
npm run test:support
```

For a scoped change, also run the most relevant focused regression tests, then the TypeScript check and production build. For persistence changes, verify the complete request path: UI input, API response, database row, reload, and cleanup where applicable.

## Security notes

- Never place service-role keys, Resend keys, support API keys, passwords, or credential values in source control, browser code, screenshots, or chat.
- The Vault stores credential references and metadata. Treat all linked credentials as sensitive.
- Do not use an email-only notification as the source of truth for support conversations. Tickets, replies, status changes, and delivery events must remain persisted in the database.
- Preserve unrelated working-tree changes when making a scoped fix.
