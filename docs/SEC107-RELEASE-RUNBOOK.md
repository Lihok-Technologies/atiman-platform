# SEC-107 Production Release Checklist & Recovery Runbook

Status: documentation-only. Labels: **VERIFIED** (repository/CI evidence observed this session),
**NOT VERIFIED** (no repository evidence; requires provider access or OWNER confirmation).

---

## 1. Release-readiness checklist

### Verified prerequisites (VERIFIED)

| Item | Evidence |
|---|---|
| Baseline `main` | `4d2db654175e48b9fb95296ed325617f72957dde` |
| Working tree clean | `git status --short` empty |
| SEC-107 release candidate merged | PR #119 (`f4364ca`, head `8d399a9`) |
| WP5 dependency consolidation merged | PR #120 (`4d2db65`) |
| `render.yaml` `autoDeploy` | `false` (SEC-107 HOLD active) |
| Default suite | 210/210 PASS |
| PostgreSQL integration CI | success (main push `39112373930`) |
| Independent VUDA | per-PR **PASS** + final-release **PASS** |
| Dependency audit | `npm audit` and `npm audit --omit=dev` → **0 vulnerabilities** |

### Production APP_URL prerequisite (REQUIRED)

`APP_URL` **must** be configured to the verified canonical **HTTPS** application origin before
production deployment — the approved example is `https://atiman-api.onrender.com`. `getPublicBaseUrl()`
rejects an `http://` `APP_URL` when `NODE_ENV=production`. Local development may use HTTP (for example
`http://localhost:3000`).

### Authoritative dependency inventory (VERIFIED from PR #120)

| Package | Before | After | Notes |
|---|---|---|---|
| multer | 2.2.0 | 2.4.0 | DoS advisories |
| mysql2 | 3.20.0 | 3.24.6 | auth-downgrade + DoS |
| brace-expansion | 2.1.4 | 2.1.7 | DoS |
| proxy-addr | 2.0.7 | 2.0.8 | critical IP-spoofing |
| qs | 6.15.3 | 6.16.1 | array-limit bypass |
| sql-escaper | 1.3.3 | 1.5.2 | mysql2 transitive |

`body-parser` (2.3.0) is **not** one of the six corrections — it is a pre-existing
transitive dependency. This corrects an earlier release-readiness report that listed it by mistake.

### Unverified prerequisites (NOT VERIFIED — OWNER action)

- PostgreSQL backup mechanism, retention, RPO, RTO, and PITR (no repository evidence).
- Verified TLS (certificate verification) — currently disabled (see §3).
- `TRUST_PROXY` topology — must be set only for a known reverse-proxy.

---

## 2. Recovery runbook

### Migration failure recovery (VERIFIED)

- Migrations apply **atomically**: each file runs in its own `BEGIN → … → COMMIT`; on
  failure it `ROLLBACK`s and stops, so a migration can never be left half-applied.
- Migrations are **forward-only**: there is no down-migration and no reset. Rerunning the
  canonical command is the recovery path for an interrupted apply; a mistake is corrected by
  adding a new forward migration.
- `render.yaml` `preDeployCommand` runs `npm run db:migrate:postgres && node scripts/smoke-test-pg.js`
  **before** application start, so a failed migration or schema mismatch fails the deployment
  **closed**.

### Post-migration / post-restoration validation (VERIFIED)

```bash
node scripts/smoke-test-pg.js
```

This gate is **read-only** (`default_transaction_read_only = on`); it asserts the semantic objects
the application requires and exits non-zero on an incompatible schema. It is the intended
post-restoration validation step, though it is not currently documented as such for backup restores.

### Backup and restore (NOT VERIFIED — release blocker to disposition)

No repository-documented PostgreSQL backup, restore, or point-in-time-recovery procedure exists.
`DEPLOYMENT.md`'s backup/restore commands target legacy **MySQL** (`mysqldump`) and are inapplicable
to the PostgreSQL runtime. The following are therefore **unestablished from repository evidence**:

- Backup mechanism and ownership
- Backup retention
- Recovery point objective (RPO) and recovery time objective (RTO)
- Point-in-time recovery availability
- Restoration procedure
- Responsible operator and required OWNER approvals

These must be established from the managed PostgreSQL provider (Supabase/Render) and documented, or
explicitly accepted as residual risk by the OWNER, **before** a production release is authorized.
They are recorded here as open items, not asserted.

---

## 3. Database SSL posture

- **Why certificate verification is disabled:** `render.yaml` sets `DB_SSL=true` +
  `DB_SSL_REJECT_UNAUTHORIZED=false`. `DEPLOYMENT_CLOUD.md` documents that Supabase does not provide
  a locally-installable CA certificate, so the connection is encrypted but the server certificate is
  not verified.
- **Is verified TLS supported?** Yes. `src/config/database.js` defaults `rejectUnauthorized` to
  `true` whenever `DB_SSL_REJECT_UNAUTHORIZED` is not exactly `'false'`, so `verify-ca`/`verify-full`
  is available once a CA is installed (e.g. via `NODE_EXTRA_CA_CERTS`).
- **Security implication:** `DB_SSL_REJECT_UNAUTHORIZED=false` is encrypted-but-unauthenticated
  (exposed to an active man-in-the-middle that can present any certificate).
- **Recommended production posture:** move to certificate verification
  (`DB_SSL_REJECT_UNAUTHORIZED=true`, or omit it) after installing the provider CA; otherwise the
  OWNER explicitly accepts the encrypted-but-unauthenticated residual risk.

---

## 4. Required OWNER decisions

1. Lift the **SEC-107 production HOLD** and authorize the production deployment (Manual Deploy).
2. Reconfirm or remediate the **`DB_SSL_REJECT_UNAUTHORIZED`** posture (§3).
3. Approve (or explicitly accept the absence of) a documented **PostgreSQL backup/restore** procedure (§2).
4. Confirm **`TRUST_PROXY`** is set only for the known reverse-proxy topology.
