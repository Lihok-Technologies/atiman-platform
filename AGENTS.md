# ODM-CMMS Agent Guide

## Overview
ODM-CMMS is an Operator-Driven Maintenance CMMS built with Node.js, Express, EJS, and MySQL 8. It has a REST API under `/api`, a mobile-first server-rendered UI under `/mobile`, and tenant-aware RBAC, subscriptions, inspection, scheduling, QR, and reporting capabilities.

## Layout
- `src/app.js` — Express app and middleware setup.
- `src/index.js` — HTTP server entry point.
- `src/routes/`, `src/controllers/`, `src/models/` — API layers.
- `src/middleware/` — authentication, tenancy, RBAC, uploads, and errors.
- `src/services/` — domain integrations and background services.
- `database/` — schema, migrations, ISO taxonomy, and migration helpers.
- `tests/` — Node built-in test runner suites.
- `public/`, `views/` — static assets and EJS views.

## Commands
```bash
npm ci
npm start
npm run dev
npm test
npm run test:integration
npm run test:all
npm run db:init
```

`npm test` runs non-destructive tests only — database-mutating suites are skipped unless the integration gate below is satisfied. `npm run test:integration` runs destructive database suites only when `NODE_ENV=test` and `RUN_DB_TESTS=true` are set alongside the supplied `TEST_DB_HOST`, `TEST_DB_PORT`, `TEST_DB_NAME`, `TEST_DB_USER`, and `TEST_DB_PASSWORD`; the test database name must clearly identify a test database, and runtime `DB_*`/`PG*` credentials are never used for destructive tests. `npm run test:all` runs both commands.

## Environment
Copy `.env.example` for local use or `.env.production.example` as a production template. Do not commit real `.env` files or secrets. The server defaults to `127.0.0.1`; deployment environments that require external/container binding must set `HOST=0.0.0.0`. Configure `CORS_ALLOWED_ORIGINS` as a comma-separated allowlist when cross-origin browser access is required. `REQUEST_BODY_LIMIT` applies to JSON/form requests; Multer controls multipart limits separately. Production startup validates JWT/database secrets. Configure `TRUST_PROXY` only for a known proxy topology.

## Conventions
- JavaScript uses single quotes, two-space indentation, and semicolons.
- Keep organization/tenant checks and RBAC middleware on protected routes.
- Add or update tests for behavior changes.
- Run `npm test` and `npm audit --omit=dev` before submitting changes.
