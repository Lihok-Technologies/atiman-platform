# Render + Supabase Cloud Deployment

Phase 4A deploys the existing ODM-CMMS Node.js service to Render and connects it to a Supabase-hosted PostgreSQL database. It adds deployment automation only; it does not change the application runtime or schema.

## Architecture

```text
+---------+       HTTPS        +----------------------+       pg over TLS       +---------------------+
| Browser | -----------------> | Render web service   | ----------------------> | Supabase Postgres   |
|         | <----------------- | Node.js / Express    | <---------------------- | public schema       |
+---------+                     +----------------------+                         +---------------------+
                                      |
                                      +-- GET /health (Render health check)
```

The browser communicates only with the Render URL. The Render service uses the existing `pg` runtime adapter and server-side database credentials to communicate with Supabase. Database credentials must never be exposed to browser code or committed to Git.

## Prerequisites

- A GitHub repository containing ODM-CMMS and access to its `main` branch.
- A [Render](https://render.com/) account connected to GitHub.
- A [Supabase](https://supabase.com/) account.
- Node.js 18 or newer and project dependencies installed with `npm ci` for local smoke testing.
- Node.js 18 or newer. No PostgreSQL client tools are required: migrations run through the `pg` dependency.
- A local Bash shell. On Windows, use WSL or Git Bash with PostgreSQL client tools available.

Do not put database passwords, connection strings, JWT secrets, or provider tokens in tracked files.

## 1. Create the Supabase Project

1. In Supabase, create a new project and choose a region near Render's Singapore region.
2. Generate and save a strong database password in a password manager.
3. Wait until the database reports that it is ready.
4. Open **Connect** in the Supabase dashboard and select the connection suitable for the deployment:
   - **Session pooler (port 5432)** is the recommended default for this persistent Render service and for applying the schema from an IPv4-only network.
   - **Transaction pooler (port 6543)** can be used when transaction pooling is desired.
   - A direct connection also uses port 5432, but may require IPv6 support or Supabase's IPv4 option.
5. Record the host, port, database name, user, and password separately. Pooler usernames commonly include the project reference (for example, `postgres.<project-ref>`).

Use TLS. The Phase 4A configuration sets `DB_SSL=true` and `DB_SSL_REJECT_UNAUTHORIZED=false`, which encrypts the connection without requiring Node.js to validate a locally installed Supabase CA certificate.

## 2. Apply the PostgreSQL Schema

Schema change is **explicit and authorized**, never a side effect of starting
the application. The canonical, authoritative mechanism is:

```bash
npm run db:migrate:postgres
```

`scripts/migrate-postgres.js` is the **single** authoritative PostgreSQL
migration mechanism:

- Uses the runtime `pg` dependency only. No PostgreSQL client tools are
  required, which matters because Render's Node runtime does not provide `psql`.
- Discovers migrations dynamically from `database/postgresql/` matching
  `^\d{3}_.*\.sql$` and applies them in ascending filename order. Nothing is
  hardcoded, so new migrations participate automatically.
- Applies **each file in its own transaction** (`BEGIN` / whole file /
  `COMMIT`). On failure it rolls that file back, exits non-zero, and does not
  attempt later migrations — so a migration can never be left half-applied.
- Requires explicit connection configuration. There is **no** fallback to
  `localhost`, `postgres`, or `odm_cmms`; missing configuration fails before any
  connection is opened.
- Refuses to run when `TEST_DB_*` is present, or under `NODE_ENV=test`, or under
  `RUN_DB_TESTS=true`, so it can never be redirected onto a disposable test
  database.
- Serializes concurrent runs with a transaction-scoped advisory lock held for
  the whole run, which is safe under both session and transaction pooling.
- Never reads `database/migrations/` (legacy MySQL) and never invokes the legacy
  MySQL runners or `init-db` scripts.
- Never logs passwords, connection strings, URLs, or tokens.

Configuration is read from `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`
(or the `PG*` equivalents). Use TLS with `DB_SSL=true`; set
`DB_SSL_REJECT_UNAUTHORIZED=false` only when a CA certificate is not installed
locally.

### Forward-only policy

There is **no down-migration and no reset command**. Migrations are written to
be safely re-applicable, so rerunning the command is the recovery path for an
interrupted apply. A mistake is corrected by adding a new forward migration.

### Schema readiness assertion

After migrating, assert that the database is actually compatible with the
running application:

```bash
node scripts/smoke-test-pg.js
```

This gate is **read-only** (`default_transaction_read_only = on`) and is not a
migration mechanism. It asserts the objects the application requires — including
the ATM-001 M1 governance columns, `chk_task_template_versions_requires_governance`,
`chk_task_template_versions_approver_not_publisher`, and the publisher foreign
key in its `ON DELETE RESTRICT` state — because a bare connectivity check plus a
table count cannot distinguish a migration-008 database from a migration-013
one. It exits non-zero when the schema is not compatible.

### Production authorization

**An approved merge to `main` is the production deployment authorization event.**
Auto-Deploy is intentionally enabled, so the merge deploys and the database
migrations included in that release are authorized by that same approved merge.
There is no additional post-merge manual-deploy authorization step.

Because merging deploys, **PRs must be reviewed for production readiness before
merge**, not after. The governed path is:

```
reviewed and approved PR  ->  merge to main  ->  automatic production deployment
```

Do not commit directly to `main` as a deployment shortcut: the merge is only an
authorization event because the PR was reviewed and approved first.

The safety rule is unchanged and remains mandatory — Render executes the
canonical pre-deploy gate before application startup:

- `preDeployCommand` runs `npm run db:migrate:postgres` then
  `node scripts/smoke-test-pg.js`.
- Render starts `node src/index.js` **only** after both succeed.
- A failed migration or readiness assertion fails the deployment **closed**, so
  the application never starts against a schema it cannot use.

> **OWNER action required once, in Render:** confirm that the `atiman-api`
> service has **Auto-Deploy set to On Commit** and that the Blueprint has been
> synced so `preDeployCommand` reflects the repository. Until that is done,
> repository configuration and live service settings may disagree.

Manual deploys (`Manual Deploy > Deploy latest commit`) remain available for
operational recovery, but they are not required by this policy and are not the
normal authorization path.

### ATM-001 M1 production consequence

Migration 013 adds the governance lifecycle to the pre-existing `task_templates`
table with `review_state DEFAULT 'draft'` and
`safety_review_state DEFAULT 'not_assessed'`. Applying it therefore places every
existing legacy template in the draft / not-assessed governance state.

Those templates remain **legacy knowledge candidates**. They are not approved
Atiman knowledge and become governed published knowledge only after they pass
governed review, evidence, safety assessment, approval, and publication.

## 3. Deploy with the Render Blueprint

1. In Render, select **New > Blueprint** and connect this GitHub repository.
2. Render detects the root `render.yaml`. Review the `atiman-api` web service and apply the Blueprint.
3. Supply every environment variable marked `sync: false`:
   - `DB_HOST`: the Supabase host only, without a URI scheme.
   - `DB_NAME`: usually `postgres` for a new Supabase project.
   - `DB_USER`: the exact user shown by Supabase.
   - `DB_PASSWORD`: the Supabase database password.
   - `CORS_ALLOWED_ORIGINS`: the exact public Render origin, such as `https://atiman-api.onrender.com`. Add other trusted browser origins as a comma-separated list only when needed.
4. Confirm that Render generated `JWT_SECRET`. Do not replace it with a placeholder; production validation requires a non-placeholder secret of at least 32 characters.
5. Deploy. Render runs `npm ci --omit=dev`, then the pre-deploy command — `npm run db:migrate:postgres` followed by `node scripts/smoke-test-pg.js` — and starts `node src/index.js` only after both succeed. Because `autoDeploy` is `true`, every subsequent approved merge to `main` deploys automatically and is the production deployment authorization event.

If the service deploys before the schema exists, the pre-deploy command fails with a missing `public.users` message and the deploy is aborted. Apply the schema with `npm run db:migrate:postgres` (see section 2), then deploy again from Render.

Render monitors `GET /health`. The correct cloud health path is `/health`, **not** `/api/health`.

## Environment Variables

| Variable | Phase 4A value | Purpose |
|---|---|---|
| `NODE_ENV` | `production` | Enables production runtime checks and behavior. |
| `HOST` | `0.0.0.0` | Allows Render's proxy to reach the Node.js listener. |
| `PORT` | `10000` | Port exposed by the Render web service. |
| `DB_HOST` | Supabase host | Direct or pooler hostname, without `postgres://`. |
| `DB_PORT` | `5432` or `6543` | PostgreSQL/direct or session pooler uses 5432; transaction pooling uses 6543. |
| `DB_NAME` | Usually `postgres` | Supabase PostgreSQL database name. |
| `DB_USER` | Supabase database user | Use the exact pooler/direct username shown by Supabase. |
| `DB_PASSWORD` | Secret | Supabase database password; never commit it. |
| `DB_CONNECTION_LIMIT` | `10` | Maximum connections in the application pool. |
| `DB_SSL` | `true` | Enables TLS for the `pg` connection. |
| `DB_SSL_REJECT_UNAUTHORIZED` | `false` | Allows encrypted Supabase connections without a locally installed CA certificate. |
| `JWT_SECRET` | Render-generated, at least 32 characters | Signs application JWTs. Keep stable and secret. |
| `JWT_EXPIRES_IN` | `24h` | JWT lifetime. |
| `CORS_ALLOWED_ORIGINS` | Exact trusted origin(s) | Comma-separated browser origin allowlist; do not use `*` with credentials. |
| `REQUEST_BODY_LIMIT` | `1mb` | JSON and URL-encoded request body limit. |
| `UPLOAD_MAX_SIZE` | `10485760` | General upload limit in bytes (10 MiB). |
| `ASSET_IMPORT_MAX_ROWS` | `10000` | Maximum CSV asset import rows. |
| `LOG_LEVEL` | `info` | Production logging level. |

The Blueprint also fixes the service plan to `starter`, region to `singapore`, and deployment branch to `main`.

## 4. Verify the Deployment

After Render reports the service as live, verify the configured health check:

```bash
curl -fsS https://atiman-api.onrender.com/health
```

A successful response is HTTP 200 JSON with `success: true`, a message, and a timestamp. If Render assigns a different hostname, substitute that hostname but keep the `/health` path.

To rerun only the read-only database verification from a configured local shell:

```bash
node scripts/smoke-test-pg.js
```

The smoke test performs `SELECT 1`, verifies that `public.users` is a base table, and prints the number of base tables and views in `public`. It does not modify data or schema.

## Running the Scripts Locally

Run both helpers from a clean checkout after `npm ci`:

```bash
# Apply migrations (forward-only, re-applicable), then assert schema readiness
npm run db:migrate:postgres
node scripts/smoke-test-pg.js
```

Both commands accept either libpq-style `PG*` settings or the application's
`DB_*` aliases. Avoid placing secrets directly in shell history; use your shell's
secure environment loading or a secret manager, and unset local secret variables
when finished.

## Troubleshooting

### Migration refuses to run

`npm run db:migrate:postgres` exits with code 2 and applies nothing when
configuration is missing or a test-database variable is present. It refuses when
`TEST_DB_*` is set, when `NODE_ENV=test`, or when `RUN_DB_TESTS=true`. Unset
those and provide explicit `DB_HOST`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`.
No default host, database, user, or password is assumed. PostgreSQL client tools
are not required.

### Schema readiness failed, or the core `users` table is missing

The database is reachable but its schema is older or incomplete relative to the
application, or the credentials target the wrong database. Recheck `DB_HOST`,
`DB_PORT`, `DB_NAME`, and `DB_USER`, then run:

```bash
npm run db:migrate:postgres
node scripts/smoke-test-pg.js
```

Do not bypass the Render pre-deploy check. If a migration fails, the runner
names the failing file and the transaction for that file was rolled back.

### TLS or certificate errors

Confirm `DB_SSL=true`, `DB_SSL_REJECT_UNAUTHORIZED=false`, and `PGSSLMODE=require`. Ensure the host and port came from the same Supabase connection mode. If organization policy requires certificate verification, install Supabase's CA certificate and test a `verify-full` setup separately before changing the Phase 4A defaults.

### Connection timeout or network unreachable

Use the Supabase session pooler host on port 5432 when the client or Render cannot reach the direct IPv6 endpoint. Check Supabase network restrictions and verify that the project is running rather than paused.

### Render startup delays

A Render service can take time to start or restart. Retry the `/health` request after the service starts, and inspect Render logs if it never returns HTTP 200. Startup latency does not change the health path.

## What This Does Not Change

- No application code, API, authentication, authorization, RBAC, business logic, or PostgreSQL schema is changed by Phase 4A.
- The numbered PostgreSQL migration files in `database/postgresql/` remain the source of truth, applied only by `npm run db:migrate:postgres`.
- PostgreSQL through `pg` remains the only HTTP/application runtime database driver.
- `mysql2` stays installed only for the documented legacy one-off import and migration utilities; it is not used by Render, the smoke test, or the production runtime.
- Supabase Auth, Storage, Realtime, Edge Functions, and RLS are not introduced.
- Phase 4B is out of scope.
