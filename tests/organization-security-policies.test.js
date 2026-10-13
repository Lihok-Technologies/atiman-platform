/**
 * ATM-001-SEC-104 — the five OWNER-approved V1 organization security policies,
 * extended by ATM-001-SEC-104-R2 to close the independently verified failures.
 *
 *   1. Organization creation is restricted to `platform.admin`. This is the
 *      ADMINISTRATIVE provisioning route POST /api/organizations. It is NOT a
 *      prohibition on tenant self-registration: the separate, approved
 *      self-service endpoint POST /api/auth/organization-signup is deliberately
 *      preserved and must keep working (section G). Claims that "organization
 *      creation is fail-closed for every human principal" are FALSE as written
 *      and were corrected (VUDA finding F2).
 *   2. Organization profile updates require `org.config_admin` AND strict tenant
 *      scope (the caller's own organization only).
 *   3. Tenant administrators cannot change subscription or capacity fields. R2
 *      extends this to the CAPABILITY, not merely /api/organizations: every
 *      route that writes, or crosses a tenant to read, `organization_subscriptions`
 *      requires the platform-scoped `platform.admin` (VUDA finding F1). R3 closes
 *      the two residual tenant-scoped writes (§I) that were still reachable with
 *      `authenticate` alone: POST /api/subscriptions/cancel now requires the
 *      legacy matrix's `SUBSCRIPTION.CANCEL` and POST /api/subscriptions/reactivate
 *      its `SUBSCRIPTION.UPDATE`, both `admin: 'all'` with supervisor and operator
 *      `'none'`. The tenant's approved cancellation-request workflow is preserved;
 *      no capability was invented (the approved vocabulary names no subscription
 *      capability). The treatment of the `status` column written by /reactivate is
 *      left in conflict with case H5 and ESCALATED to the OWNER rather than
 *      reconciled here — see the subscription route header.
 *   4. Tenant isolation covers organization reading, listing, statistics and
 *      logo management — including a logo request that ADDRESSES a foreign
 *      tenant through the body, which must be refused and must write nothing in
 *      either tenant (VUDA finding F4).
 *   5. Direct organization deletion is disabled (fail-closed), preserving
 *      ATM-001-SEC-00C / PR #88 containment intent.
 *
 * R2 also preserves the accepted #104 behaviour: the profile allowlist is exact
 * against `information_schema`, same-tenant updates and listing/detail/statistics
 * restrictions still hold, and no allowlisted field may carry a non-string value
 * (a null produced an unhandled 500; arrays/objects/numbers/booleans were coerced
 * into profile columns).
 *
 * Evidence policy: the HTTP boundary is exercised against the REAL Express app
 * with REAL JWTs and REAL database rows, so routing, guards, resolution and the
 * persisted effect are production-shaped rather than simulated. Every
 * authorization claim is paired with a DATABASE-EFFECT claim read back from the
 * database after the request, because a known defect (D-1: `BaseModel.create`
 * never populates `insertId`, so a create can persist and then answer HTTP 500)
 * means a status code alone is not evidence of a write or of its absence.
 *
 * Where a claim is about what is ABSENT (non-disclosure), the assertion is made
 * against the whole serialised response body, never a hand-picked field list.
 *
 * ── Capability-grant fixtures (R2 finding F3) ────────────────────────────────
 *
 * F3 requires an administrator that holds an UNRELATED explicit grant, and
 * migration 022 makes a grant a permanent record (DELETE raises by trigger), so
 * that fixture cannot be cleaned up. It is therefore built ONCE, idempotently,
 * outside the per-run prefix: a stable organization, two stable users
 * (`sec104-f3-admin-granted` holds an active `knowledge.author` grant issued by
 * `sec104-f3-admin-plain`) and one stable paid plan + subscription. Re-running
 * the suite reuses the same rows, so the residue is bounded to that one set and
 * is documented in tests/database-test-guard.test.js. Every OTHER fixture in this
 * file is per-run and removed by `cleanupFixture()`.
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * src/config/database.js uses to select test-database credentials, so it can
 * never run against runtime credentials.
 */

process.env.JWT_SECRET = 'test-only-jwt-secret-not-for-production-000000';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { getConnection, isIntegrationTest } = require('../src/config/database');
const {
  CAPABILITIES, V1_HUMAN_GRANTABLE, NON_HUMAN_GRANTABLE, LEGACY_COMPATIBILITY_BUNDLES,
  RESOLUTION_MODES, TENANT_ADMINISTRATOR_PROFILE
} = require('../src/config/capabilities');
const { resolveCapabilities } = require('../src/services/capability.service');
const { checkPermission: permCheck, PERMISSIONS } = require('../src/config/permissions');
const subscriptionService = require('../src/services/subscription.service');
const organizationController = require('../src/controllers/organization.controller');
const Organization = require('../src/models/organization.model');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating organization-security suite requires the sanctioned database-test '
    + 'gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that test-database '
    + 'credentials are used instead of runtime credentials; run it via '
    + '`npm run test:integration`';

const JWT_SECRET = 'test-only-jwt-secret-not-for-production-000000';
const REPO_ROOT = path.resolve(__dirname, '..');
const ROUTES_FILE = path.join(REPO_ROOT, 'src', 'routes', 'organization.routes.js');
const CONTROLLER_FILE = path.join(REPO_ROOT, 'src', 'controllers', 'organization.controller.js');
const SUBSCRIPTION_ROUTES_FILE = path.join(REPO_ROOT, 'src', 'routes', 'subscription.routes.js');
const PAYMENT_ROUTES_FILE = path.join(REPO_ROOT, 'src', 'routes', 'payment.routes.js');
const PAYMENT_SERVICE_FILE = path.join(REPO_ROOT, 'src', 'services', 'payment.service.js');

/** Every organization-profile column a tenant principal may change (policy 3). */
const EXPECTED_ALLOWLIST = Object.freeze([
  'billing_address', 'billing_email', 'industry', 'logo_url', 'organization_name', 'phone'
]);

/** Every organizations column that must NOT be writable through PUT /:id. */
const FORBIDDEN_UPDATE_FIELDS = Object.freeze([
  'id', 'created_at', 'updated_at',
  'subscription_id', 'subscription_plan', 'subscription_status',
  'max_users', 'max_facilities', 'max_equipment'
]);

// ---------------------------------------------------------------------------
// Fixtures — identity is captured from the database, every name is unique per
// run, and cleanup is prefix-based, so the suite is safe on a long-lived shared
// test database and cannot collide with another suite's fixtures.
// ---------------------------------------------------------------------------

const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`;
const TAG = `SEC104-${RUN}`;

let ORG_A = null;   // the caller's own tenant for the "own" principals
let ORG_B = null;   // a foreign tenant
let PLAN_ID = null;
let PLAN_UPGRADE_ID = null;

let USER_OP_A = null;      // operator,   ORG_A
let USER_SUP_A = null;     // supervisor, ORG_A, is_organization_admin = true
let USER_ADMIN_A = null;   // admin,      ORG_A, is_organization_admin = true
let USER_ADMIN_B = null;   // admin,      ORG_B, is_organization_admin = true
let USER_OP_B = null;      // operator,   ORG_B
let USER_OP_FLAGGED = null; // operator,  ORG_A, is_organization_admin = true (flag must grant nothing)

// Stable F3 fixtures (never under the per-run prefix, never cleaned up — see the
// header). `granted` holds one unrelated active explicit grant; `plain` is the
// accountable same-tenant granter and the with/without-grant control.
let F3_ORG = null;
let F3_PLAN_ID = null;
let F3_USER_GRANTED = null;
let F3_USER_PLAIN = null;

const F3_ORG_NAME = 'ATM-001-SEC-104-R2 F3 Tenant';
const F3_GRANTED_USERNAME = 'sec104-f3-admin-granted';
const F3_PLAIN_USERNAME = 'sec104-f3-admin-plain';
const F3_PLAN_CODE = 'sec104-f3-paid';
const F3_UNRELATED_CAPABILITY = 'knowledge.author';

async function withConn(fn) {
  const conn = await getConnection();
  try {
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

const rows = (sql, params = []) => withConn((conn) => conn.query(sql, params));

const orgRow = async (id) => {
  const found = await rows('SELECT * FROM organizations WHERE id = $1', [id]);
  return found.length ? found[0] : null;
};

/** The whole persisted row as a comparable string, so any change is visible. */
const orgSnapshot = async (id) => JSON.stringify(await orgRow(id) ?? null);

const usersOfOrganization = (id) => rows(
  'SELECT id, username, role, is_active FROM users WHERE organization_id = $1 ORDER BY id', [id]);

const subscriptionRow = async (organizationId) => {
  const found = await rows(
    'SELECT * FROM organization_subscriptions WHERE organization_id = $1', [organizationId]);
  return found.length ? found[0] : null;
};

/** The whole persisted subscription row as a comparable string. */
const subscriptionSnapshot = async (organizationId) =>
  JSON.stringify(await subscriptionRow(organizationId) ?? null);

async function ensureFixture() {
  await withConn(async (conn) => {
    const orgs = await conn.query(
      `INSERT INTO organizations
         (organization_name, industry, subscription_plan, subscription_status,
          billing_email, billing_address, max_users, max_facilities, max_equipment, phone, logo_url)
       VALUES ($1, 'water', 'pro', 'active', $2, 'original address', 7, 7, 7, '+630000000000', NULL),
              ($3, 'power', 'pro', 'active', $4, 'original address', 7, 7, 7, '+630000000001', NULL)
       RETURNING id`,
      [`${TAG} Own Org`, `${TAG}-own@test.local`, `${TAG} Foreign Org`, `${TAG}-foreign@test.local`]);
    [ORG_A, ORG_B] = orgs.map((row) => Number(row.id));

    const users = await conn.query(
      `INSERT INTO users (organization_id, username, email, password_hash, full_name, role, is_active, is_organization_admin)
       VALUES ($1, $3, $3, 'x', 'SEC104 Operator A', 'operator', true, false),
              ($1, $4, $4, 'x', 'SEC104 Supervisor A', 'supervisor', true, true),
              ($1, $5, $5, 'x', 'SEC104 Admin A', 'admin', true, true),
              ($2, $6, $6, 'x', 'SEC104 Admin B', 'admin', true, true),
              ($2, $7, $7, 'x', 'SEC104 Operator B', 'operator', true, false),
              ($1, $8, $8, 'x', 'SEC104 Flagged Operator A', 'operator', true, true)
       RETURNING id`,
      [ORG_A, ORG_B,
        `sec104-${RUN}-op-a@test.local`, `sec104-${RUN}-sup-a@test.local`,
        `sec104-${RUN}-admin-a@test.local`, `sec104-${RUN}-admin-b@test.local`,
        `sec104-${RUN}-op-b@test.local`, `sec104-${RUN}-op-flagged@test.local`]);
    [USER_OP_A, USER_SUP_A, USER_ADMIN_A, USER_ADMIN_B, USER_OP_B, USER_OP_FLAGGED] =
      users.map((row) => Number(row.id));

    // A paid plan for both tenants, so the logo route's own paid-plan admission
    // is satisfied and the capability gate is the only thing under test.
    const plans = await conn.query(
      `INSERT INTO subscription_plans (plan_code, plan_name, base_price, max_facilities, max_equipment)
       VALUES ($1, 'SEC104 Pro', 10.00, 20, 200), ($2, 'SEC104 Upgrade', 90.00, 90, 900)
       RETURNING id`,
      [`sec104-${RUN}-pro`, `sec104-${RUN}-up`]);
    PLAN_ID = Number(plans[0].id);
    PLAN_UPGRADE_ID = Number(plans[1].id);

    for (const orgId of [ORG_A, ORG_B]) {
      await conn.query(
        `INSERT INTO organization_subscriptions (organization_id, plan_id, status, base_price)
         VALUES ($1, $2, 'active', 10.00)`,
        [orgId, PLAN_ID]);
    }
  });
}

/**
 * The stable F3 fixture (see the file header).
 *
 * Idempotent by construction: find-or-create the tenant, the two administrators
 * and the paid plan, then ensure exactly one active unrelated grant exists. A
 * second run therefore adds no row at all, which is what bounds the unavoidable
 * residue of a migration-022 grant.
 */
async function ensureF3Fixture() {
  await withConn(async (conn) => {
    const existingOrg = await conn.query(
      'SELECT id FROM organizations WHERE organization_name = $1', [F3_ORG_NAME]);
    F3_ORG = existingOrg.length
      ? Number(existingOrg[0].id)
      : Number((await conn.query(
        `INSERT INTO organizations
           (organization_name, industry, subscription_plan, subscription_status,
            billing_email, billing_address, max_users, max_facilities, max_equipment, phone)
         VALUES ($1, 'water', 'pro', 'active', $2, 'F3 fixture address', 7, 7, 7, '+630000000009')
         RETURNING id`, [F3_ORG_NAME, 'sec104-f3@test.local']))[0].id);

    const ensureUser = async (username, fullName) => {
      const found = await conn.query('SELECT id FROM users WHERE username = $1', [username]);
      if (found.length) {
        await conn.query(
          `UPDATE users SET is_active = true, role = 'admin', is_organization_admin = true,
                  organization_id = $2
            WHERE id = $1`, [Number(found[0].id), F3_ORG]);
        return Number(found[0].id);
      }
      const inserted = await conn.query(
        `INSERT INTO users (organization_id, username, email, password_hash, full_name, role, is_active, is_organization_admin)
         VALUES ($1, $2, $3, 'x', $4, 'admin', true, true) RETURNING id`,
        [F3_ORG, username, `${username}@test.local`, fullName]);
      return Number(inserted[0].id);
    };

    F3_USER_PLAIN = await ensureUser(F3_PLAIN_USERNAME, 'SEC104 F3 Plain Admin');
    F3_USER_GRANTED = await ensureUser(F3_GRANTED_USERNAME, 'SEC104 F3 Granted Admin');

    const existingPlan = await conn.query(
      'SELECT id FROM subscription_plans WHERE plan_code = $1', [F3_PLAN_CODE]);
    F3_PLAN_ID = existingPlan.length
      ? Number(existingPlan[0].id)
      : Number((await conn.query(
        `INSERT INTO subscription_plans (plan_code, plan_name, base_price, max_facilities, max_equipment)
         VALUES ($1, 'SEC104 F3 Paid', 10.00, 20, 200) RETURNING id`, [F3_PLAN_CODE]))[0].id);

    const existingSubscription = await conn.query(
      'SELECT id FROM organization_subscriptions WHERE organization_id = $1', [F3_ORG]);
    if (!existingSubscription.length) {
      await conn.query(
        `INSERT INTO organization_subscriptions (organization_id, plan_id, status, base_price)
         VALUES ($1, $2, 'active', 10.00)`, [F3_ORG, F3_PLAN_ID]);
    } else {
      await conn.query(
        `UPDATE organization_subscriptions SET plan_id = $2, status = 'active' WHERE organization_id = $1`,
        [F3_ORG, F3_PLAN_ID]);
    }

    // Exactly one ACTIVE unrelated grant. Migration 022 refuses a duplicate active
    // grant and refuses DELETE, so this is the only shape that can be idempotent.
    // The parameters are cast explicitly: the same placeholder feeds a varchar
    // target column and a comparison in the NOT EXISTS guard, and PostgreSQL
    // refuses to deduce two types for one parameter.
    await conn.query(
      `INSERT INTO user_capabilities (user_id, organization_id, capability, source, granted_by_user_id)
       SELECT $1::integer, $2::integer, $3::varchar(64), 'explicit', $4::integer
        WHERE NOT EXISTS (
          SELECT 1 FROM user_capabilities
           WHERE user_id = $1::integer AND organization_id = $2::integer
             AND capability = $3::varchar(64) AND revoked_at IS NULL)`,
      [F3_USER_GRANTED, F3_ORG, F3_UNRELATED_CAPABILITY, F3_USER_PLAIN]);
  });
}

async function cleanupFixture() {
  await withConn(async (conn) => {
    // Prefix-based, so rows left behind by an unexpectedly successful write
    // (which is exactly what the negative control produces) are removed too.
    //
    // The stable F3 fixture is explicitly excluded: its grant is undeletable
    // (migration 022), so deleting its user or tenant would fail and the residue
    // is bounded by being reused rather than recreated. See the file header.
    await conn.query(
      `DELETE FROM organization_subscriptions
        WHERE organization_id IN (SELECT id FROM organizations WHERE organization_name LIKE $1)`,
      [`${TAG}%`]);
    await conn.query(
      'DELETE FROM subscription_plans WHERE plan_code LIKE $1 AND plan_code <> $2',
      [`sec104-${RUN}%`, F3_PLAN_CODE]);
    await conn.query(
      'DELETE FROM users WHERE username LIKE $1 AND username NOT IN ($2, $3)',
      [`sec104-${RUN}%`, F3_GRANTED_USERNAME, F3_PLAIN_USERNAME]);
    await conn.query(
      `DELETE FROM organizations
        WHERE (organization_name LIKE $1 OR organization_name LIKE $2)
          AND organization_name <> $3`,
      [`${TAG}%`, `sec104-${RUN}%`, F3_ORG_NAME]);
  });
}

// ---------------------------------------------------------------------------
// HTTP harness — the real application, real JWTs
// ---------------------------------------------------------------------------

let server = null;
let port = null;

const safeJson = (text) => {
  try { return JSON.parse(text); } catch { return null; }
};

function call(method, requestPath, { userId, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = {};
    if (userId) headers.Authorization = `Bearer ${jwt.sign({ userId }, JWT_SECRET)}`;
    if (payload !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request({ host: '127.0.0.1', port, method, path: requestPath, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text: data, json: safeJson(data) }));
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

const get = (p, opts) => call('GET', p, opts);
const put = (p, body, opts = {}) => call('PUT', p, { ...opts, body });
const post = (p, body, opts = {}) => call('POST', p, { ...opts, body });
const del = (p, opts) => call('DELETE', p, opts);

/** Read a source file with comments removed, so only executable code is asserted. */
const codeOnly = (file) => fs.readFileSync(file, 'utf8')
  .split('\n')
  .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
  .join('\n');

/** The same code with all whitespace collapsed, so multi-line chains are matchable. */
const flatCode = (file) => codeOnly(file).replace(/\s+/g, ' ');

/** A unique creation payload, mirroring the shape POST / expects. */
const createBody = (suffix) => ({
  organization_name: `${TAG} Created ${suffix}`,
  subscription_plan: 'enterprise',
  subscription_status: 'active',
  max_users: 9999,
  max_facilities: 999,
  max_equipment: 9999,
  admin_username: `sec104-${RUN}-created-${suffix}`,
  admin_email: `sec104-${RUN}-created-${suffix}@test.local`,
  admin_password: 'NotARealPassword-104!',
  admin_full_name: 'SEC104 Created Admin'
});

const createdOrganizationCount = async () => {
  const found = await rows(
    'SELECT count(*)::int AS c FROM organizations WHERE organization_name LIKE $1', [`${TAG} Created%`]);
  return found[0].c;
};

const createdUserCount = async (suffix) => {
  const found = await rows(
    'SELECT count(*)::int AS c FROM users WHERE username = $1',
    [`sec104-${RUN}-created-${suffix}`]);
  return found[0].c;
};

// ===========================================================================

describe('ATM-001-SEC-104 V1 organization security policies', { skip: DB_TEST_SKIP_REASON, concurrency: 1 }, () => {
  before(async () => {
    await ensureFixture();
    await ensureF3Fixture();
    process.env.JWT_SECRET = JWT_SECRET;
    const app = require('../src/app');
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await cleanupFixture();
  });

  // ------------------------------------------------------------------
  // A. The routed authority contract (structural; no database)
  // ------------------------------------------------------------------

  describe('A. route authority contract', () => {
    it('A1. binds every organization route to its approved authority', () => {
      const flat = flatCode(ROUTES_FILE);

      assert.match(flat, /router\.get\('\/', requireCapability\('platform\.admin'\), organizationController\.getAll\)/,
        'GET / must require the platform-scoped capability');
      assert.match(flat, /router\.post\('\/', requireCapability\('platform\.admin'\), organizationController\.create\)/,
        'POST / must require the platform-scoped capability (policy 1)');
      assert.match(flat, /router\.put\(\s*'\/:id', resolveOrganization, requireOwnOrganization, requireCapability\('org\.config_admin'\), organizationController\.update\s*\)/,
        'PUT /:id must require strict tenant scope AND org.config_admin (policy 2)');
      assert.match(flat, /router\.put\(\s*'\/:id\/subscription', requireCapability\('platform\.admin'\), organizationController\.updateSubscription\s*\)/,
        'PUT /:id/subscription must require the platform-scoped capability (policy 3)');
      assert.match(flat, /router\.get\('\/:id', resolveOrganization, requireOwnOrganization, organizationController\.getById\)/,
        'GET /:id must be tenant-scoped (policy 4)');
      assert.match(flat, /router\.get\('\/:id\/stats', resolveOrganization, requireOwnOrganization, organizationController\.getUsageStats\)/,
        'GET /:id/stats must be tenant-scoped (policy 4)');
      assert.match(flat, /router\.post\('\/logo', resolveOrganization, requireCapability\('org\.config_admin'\), organizationController\.uploadLogo\)/,
        'POST /logo must require org.config_admin (policies 2 and 4)');
      assert.match(flat, /router\.delete\('\/:id', denyOrganizationDeletion\)/,
        'DELETE /:id must be the fail-closed denial (policy 5)');

      assert.doesNotMatch(flat, /requireAdmin/,
        'no organization route may still be guarded by the legacy admin/supervisor role guard');
      assert.doesNotMatch(flat, /organizationController\.remove/,
        'the destructive controller operation must not be routed');
      assert.doesNotMatch(flat, /requirePermissionViaCapability/,
        'the organization family must not route through the incomplete legacy adapter');

      assert.strictEqual((flat.match(/resolveOrganization, requireOwnOrganization,/g) || []).length, 3,
        'exactly the three :id routes must carry the strict tenant predicate');
      assert.strictEqual((flat.match(/requireCapability\('platform\.admin'\)/g) || []).length, 3,
        'exactly the three platform-scoped routes must require platform.admin');
      assert.strictEqual((flat.match(/requireCapability\('org\.config_admin'\)/g) || []).length, 2,
        'exactly the two profile-mutating routes must require org.config_admin');
    });

    it('A2. uses only identifiers from the approved capability vocabulary', () => {
      const flat = flatCode(ROUTES_FILE);
      const used = [...flat.matchAll(/requireCapability\('([^']+)'\)/g)].map((m) => m[1]);
      const vocabulary = new Set(Object.values(CAPABILITIES));

      for (const capability of used) {
        assert.ok(vocabulary.has(capability),
          `${capability} must be a member of the approved vocabulary in src/config/capabilities.js`);
      }
      assert.deepStrictEqual([...new Set(used)].sort(), ['org.config_admin', 'platform.admin'],
        'the organization family must use exactly these two approved capabilities');
    });

    it('A3. keeps platform.admin non-human-grantable and org.config_admin tenant-grantable', () => {
      assert.strictEqual(CAPABILITIES.PLATFORM_ADMIN, 'platform.admin');
      assert.strictEqual(CAPABILITIES.ORG_CONFIG_ADMIN, 'org.config_admin');

      assert.ok(NON_HUMAN_GRANTABLE.includes('platform.admin'),
        'platform.admin must remain architecturally non-human-grantable');
      assert.ok(!V1_HUMAN_GRANTABLE.includes('platform.admin'),
        'platform.admin must never be added to the V1 human-grantable set');
      assert.ok(V1_HUMAN_GRANTABLE.includes('org.config_admin'),
        'org.config_admin must remain the tenant-scoped grantable capability');

      for (const role of ['admin', 'supervisor', 'operator']) {
        assert.ok(!LEGACY_COMPATIBILITY_BUNDLES[role].includes('platform.admin'),
          `the ${role} legacy bundle must never carry platform.admin`);
      }
      assert.ok(LEGACY_COMPATIBILITY_BUNDLES.admin.includes('org.config_admin'),
        'the admin legacy bundle must carry org.config_admin');
      assert.ok(!LEGACY_COMPATIBILITY_BUNDLES.supervisor.includes('org.config_admin'),
        'the supervisor legacy bundle must NOT carry org.config_admin');
      assert.ok(!LEGACY_COMPATIBILITY_BUNDLES.operator.includes('org.config_admin'),
        'the operator legacy bundle must NOT carry org.config_admin');
    });

    it('A4. replaces the raw body spread with an explicit profile allowlist', () => {
      assert.ok(Array.isArray(organizationController.TENANT_EDITABLE_ORGANIZATION_FIELDS),
        'the controller must publish its profile allowlist as the field-level authority');
      assert.deepStrictEqual(
        [...organizationController.TENANT_EDITABLE_ORGANIZATION_FIELDS].sort(),
        [...EXPECTED_ALLOWLIST].sort(),
        'the allowlist must be exactly the organization profile fields');

      for (const field of FORBIDDEN_UPDATE_FIELDS) {
        assert.ok(!organizationController.TENANT_EDITABLE_ORGANIZATION_FIELDS.includes(field),
          `${field} must not be tenant-editable`);
      }

      const flat = flatCode(CONTROLLER_FILE);
      assert.doesNotMatch(flat, /\.\.\.req\.body/,
        'the raw request-body spread must be gone');
      assert.doesNotMatch(flat, /userRole/,
        'no controller decision may branch on the caller role any more');
      assert.doesNotMatch(flat, /isOrgAdmin/,
        'the unused is_organization_admin read must be gone');
    });

    it('A5. disables deletion in the route and retains the operation unreachable', () => {
      const flat = flatCode(ROUTES_FILE);

      assert.match(flat, /const denyOrganizationDeletion = \(req, res\) => \{/,
        'the denial must not inspect the caller or the identifier');
      assert.match(flat, /code: 'ORGANIZATION_DELETION_DISABLED'/,
        'the denial must carry the stable ATM-001-SEC-00C code');
      assert.match(flat, /router\.delete\('\/:id', denyOrganizationDeletion\)/);
      assert.strictEqual((flat.match(/router\.delete\(/g) || []).length, 1,
        'exactly one DELETE handler may be registered');
      assert.strictEqual((flat.match(/denyOrganizationDeletion/g) || []).length, 2,
        'the denial handler must be declared once and routed once');

      assert.strictEqual(typeof organizationController.remove, 'function',
        'the destructive controller operation must be retained for a future OWNER-approved policy');
      assert.strictEqual(typeof Organization.delete, 'function',
        'the model operation must be retained');
    });

    it('A6. binds every subscription-state route to the platform-scoped capability (F1)', () => {
      const flat = flatCode(SUBSCRIPTION_ROUTES_FILE);

      assert.match(flat, /router\.put\('\/plan', requireCapability\('platform\.admin'\), subscriptionController\.changePlan\)/,
        'PUT /plan must require platform.admin — it had no role guard at all');
      assert.match(flat, /router\.put\('\/extra-users', requireCapability\('platform\.admin'\), subscriptionController\.setExtraUsers\)/,
        'PUT /extra-users must require platform.admin — the capacity lever');
      assert.match(flat, /router\.put\('\/admin\/organizations\/:id', requireCapability\('platform\.admin'\),\s*subscriptionController\.updateOrganizationSubscription\)/,
        'PUT /admin/organizations/:id must require platform.admin, not the admin-or-supervisor role guard');
      assert.match(flat, /router\.get\('\/admin\/organizations\/:id', requireCapability\('platform\.admin'\),\s*subscriptionController\.getOrganizationSubscription\)/,
        'the cross-tenant subscription READ must require platform.admin too');

      assert.doesNotMatch(flat, /requireAdmin/,
        'no subscription route may be guarded by the admin-or-supervisor role guard any more');

      // Capability-wide: every PUT that writes organization_subscriptions state
      // must be preceded by the platform guard on the same registration.
      const puts = flat.match(/router\.put\([^;]*\)/g) || [];
      assert.strictEqual(puts.length, 3, 'exactly three subscription PUT routes may exist');
      for (const registration of puts) {
        assert.match(registration, /requireCapability\('platform\.admin'\)/,
          `every subscription write route must be platform-scoped: ${registration}`);
      }
      assert.strictEqual((flat.match(/requireCapability\('platform\.admin'\)/g) || []).length, 4,
        'exactly the three writes and the one cross-tenant read must be platform-scoped');

      // The approved identifiers only (no invented capability, no new role).
      const used = [...flat.matchAll(/requireCapability\('([^']+)'\)/g)].map((m) => m[1]);
      assert.deepStrictEqual([...new Set(used)], ['platform.admin'],
        'the subscription family must use the approved platform-scoped capability only');
      assert.ok(Object.values(CAPABILITIES).includes('platform.admin'));
      assert.ok(NON_HUMAN_GRANTABLE.includes('platform.admin'));

      // R3: the §I residual is CLOSED. The two tenant-scoped subscription writes
      // now carry an authority from the approved legacy matrix, because the
      // approved capability vocabulary contains no subscription capability at
      // all. CANCEL is the matrix's cancellation authority; UPDATE is its
      // remaining enumerated modification authority and is NOT a reuse of CANCEL.
      // Neither is platform.admin, so the tenant's sanctioned "cancel at period
      // end" request (views/mobile/admin/subscription.ejs) keeps working.
      assert.match(flat, /const \{ requirePermission \} = require\('\.\.\/middleware\/rbac'\)/,
        'the tenant-scoped subscription authority is the legacy matrix adapter');
      assert.match(flat, /router\.post\('\/cancel', requirePermission\('SUBSCRIPTION', 'CANCEL'\),\s*subscriptionController\.cancelSubscription\)/,
        'POST /cancel must carry the matrix cancellation authority so the tenant workflow survives');
      assert.match(flat, /router\.post\('\/reactivate', requirePermission\('SUBSCRIPTION', 'UPDATE'\),\s*subscriptionController\.reactivateSubscription\)/,
        'POST /reactivate must carry the matrix modification authority — never platform.admin, never CANCEL');

      assert.strictEqual((flat.match(/router\.post\(/g) || []).length, 2,
        'exactly the two tenant-scoped subscription POST routes may exist');
      for (const registration of flat.match(/router\.post\([^;]*\)/g) || []) {
        assert.match(registration, /requirePermission\('SUBSCRIPTION', '(CANCEL|UPDATE)'\)/,
          `every tenant-scoped subscription write must carry a matrix authority: ${registration}`);
      }
      assert.doesNotMatch(flat, /router\.post\('\/cancel', subscriptionController/,
        'the cancellation-request route must not be reachable with authentication alone');
      assert.doesNotMatch(flat, /router\.post\('\/reactivate', subscriptionController/,
        'the reactivation route must not be reachable with authentication alone');

      // The named matrix authority must really be admin-only: the guard is only
      // an authority if the entry it consults refuses supervisor and operator.
      assert.strictEqual(permCheck('admin', 'SUBSCRIPTION', 'CANCEL'), 'all');
      assert.strictEqual(permCheck('supervisor', 'SUBSCRIPTION', 'CANCEL'), 'none');
      assert.strictEqual(permCheck('operator', 'SUBSCRIPTION', 'CANCEL'), 'none');
      assert.strictEqual(permCheck('admin', 'SUBSCRIPTION', 'UPDATE'), 'all');
      assert.strictEqual(permCheck('supervisor', 'SUBSCRIPTION', 'UPDATE'), 'none');
      assert.strictEqual(permCheck('operator', 'SUBSCRIPTION', 'UPDATE'), 'none');
      // …and the act named for reactivation must not be the cancellation act.
      assert.notStrictEqual(
        flat.match(/router\.post\('\/reactivate', requirePermission\('SUBSCRIPTION', '([A-Z]+)'\)/)[1],
        'CANCEL',
        'reactivation must not silently reuse the cancellation authority');
    });

    it('A7. keeps the sanctioned paid-subscription path intact (F1 preservation)', () => {
      const paymentRoutes = flatCode(PAYMENT_ROUTES_FILE);
      const paymentService = codeOnly(PAYMENT_SERVICE_FILE);

      // The tenant-requested, payment-backed path is unchanged and still guarded
      // by the legacy subscription permission (admin only), NOT by platform.admin.
      for (const route of ['/checkout', '/extra-seats']) {
        const registration = new RegExp(
          `router\\.post\\('${route.replace('/', '\\/')}',\\s*authenticate,\\s*requirePermission\\('SUBSCRIPTION', 'UPDATE'\\),`);
        assert.match(paymentRoutes, registration,
          `POST /api/payments${route} must keep authenticate + requirePermission('SUBSCRIPTION','UPDATE')`);
      }
      assert.match(paymentRoutes, /router\.post\('\/webhook',\s*express\.raw\(\{ type: 'application\/json' \}\),\s*paymentController\.handleWebhook\s*\)/,
        'the signature-validated webhook is the server-side actor that applies a paid change');

      // …and it still reaches the same service the routes call, so a paid
      // upgrade is not blocked by the route guard the tenant cannot satisfy.
      assert.match(paymentService, /subscriptionService\.changePlan\(/,
        'the webhook must still apply the purchased plan through the subscription service');
      assert.strictEqual(typeof subscriptionService.changePlan, 'function');
      assert.strictEqual(typeof subscriptionService.setExtraUsers, 'function');
    });

    it('A8. states the platform.admin boundary without overstating it (F2 claim correction)', () => {
      const header = fs.readFileSync(ROUTES_FILE, 'utf8');

      assert.doesNotMatch(header, /FAIL-CLOSED for every human principal/,
        'the false claim that every human principal is refused must be gone');
      assert.doesNotMatch(header,
        /so\s+organization creation, cross-tenant listing and subscription change are/,
        'the overstated causal claim must be gone');

      // The phrase may appear ONLY inside the sentence that corrects it.
      const mentions = (header.match(/all human organization creation is prohibited/gi) || []).length;
      assert.strictEqual(mentions, 1,
        'the overstatement may survive only as the quoted correction, never as an assertion');
      assert.match(header, /It is NOT true that "all human organization creation is prohibited in V1"/);

      // The corrected claim must be the narrow one AND must name the preserved
      // approved self-service endpoint, so a reader cannot re-derive the
      // overstatement from this file.
      assert.match(header, /NOT true that "all human organization creation is prohibited in V1"/);
      assert.match(header, /POST \/api\/auth\/organization-signup/);
      assert.match(header, /self-service tenant-registration endpoint/);

      // The preserved endpoint really is anonymous, really is mounted, and really
      // is a different route from the restricted administrative one.
      const authRoutes = fs.readFileSync(path.join(REPO_ROOT, 'src', 'routes', 'auth.routes.js'), 'utf8');
      assert.match(authRoutes, /router\.post\('\/organization-signup', authController\.organizationSignup\)/,
        'the approved self-service registration endpoint must stay mounted and unauthenticated');
      assert.doesNotMatch(header, /organization-signup'\)/,
        'the organization route family must not try to re-guard the self-service endpoint');
    });

    it('A9. states the signup endpoint\u2019s OBSERVED behaviour, not the unsupported claim (R3 claim correction)', () => {
      const routeHeader = fs.readFileSync(ROUTES_FILE, 'utf8');
      const controllerHeader = fs.readFileSync(
        path.join(REPO_ROOT, 'src', 'controllers', 'auth.controller.js'), 'utf8');

      // The removed claim said signup "creates an organization, its first
      // administrator (role='admin', is_organization_admin=true) and a default
      // Free subscription". It may survive ONLY inside the block that quotes it
      // in order to correct it (the same convention as the F2 overstatement).
      const quotedClaim = (routeHeader.match(/creates an organization, its first administrator/g) || []).length;
      assert.strictEqual(quotedClaim, 1,
        'the unsupported signup claim may survive only as the quoted correction');
      assert.doesNotMatch(routeHeader,
        /subscription, and it neither requires nor should require/,
        'the ASSERTION form of the removed signup claim must be gone');
      assert.match(routeHeader, /CORRECTED CLAIM \(ATM-001-SEC-104-R3\)/);

      // ATM-001-SEC-B3D condition 2 — THIS PIN IS INVERTED. The assertions below
      // previously required the documents to record D-1 as OPEN and "NOT
      // repaired". Defect D-1 IS repaired in the integrated tree (ATM-001-SEC-D1),
      // so requiring the open-defect wording would pin a false statement. The
      // historical measurement is still required to be present and quotable; what
      // is now required is that the documents state the REPAIR.
      assert.match(routeHeader, /HTTP 500/);
      assert.match(routeHeader, /PERSISTS ONE ORGANIZATION/);
      assert.match(routeHeader, /ZERO USERS AND ZERO SUBSCRIPTIONS/);
      assert.match(routeHeader, /result\.insertId/);
      assert.match(routeHeader, /tests\/organization-signup\.integration\.test\.js/);
      assert.match(routeHeader, /ATM-001-SEC-D1/,
        'D-1 must be recorded as REPAIRED by ATM-001-SEC-D1 in the integrated tree');
      assert.doesNotMatch(routeHeader, /NOT repaired/,
        'the stale "NOT repaired" claim must be gone once D-1 is repaired');

      // The controller records intended vs repaired behaviour the same way.
      assert.match(controllerHeader, /INTENDED contract/);
      assert.match(controllerHeader, /DEFECT D-1 \(repaired\)/,
        'the controller header must record the repair, not the open defect');
      assert.match(controllerHeader, /D-1/);
      assert.doesNotMatch(controllerHeader, /^ \* Creates a new organization with the first user as admin$/m,
        'the bare assertion of the intended contract must not remain unqualified');

      // A claim correction is not a policy-1 removal: the approved self-service
      // endpoint stays mounted and anonymous.
      const authRoutes = fs.readFileSync(path.join(REPO_ROOT, 'src', 'routes', 'auth.routes.js'), 'utf8');
      assert.match(authRoutes, /router\.post\('\/organization-signup', authController\.organizationSignup\)/,
        'the approved self-service signup endpoint must stay mounted and unauthenticated');
    });
  });

  // ------------------------------------------------------------------
  // B. Policy 1 — creation restricted to platform.admin
  // ------------------------------------------------------------------

  describe('B. policy 1: organization creation', () => {
    it('B1. denies every tenant role and persists nothing', async () => {
      const before = await createdOrganizationCount();
      assert.strictEqual(before, 0, 'no fixture organization may exist before the attempts');

      for (const [label, userId] of [
        ['tenant administrator', USER_ADMIN_A],
        ['tenant supervisor', USER_SUP_A],
        ['tenant operator', USER_OP_A]
      ]) {
        const suffix = label.replace(/\s+/g, '-');
        const res = await post('/api/organizations', createBody(suffix), { userId });

        assert.strictEqual(res.status, 403, `${label} must be denied organization creation`);
        assert.strictEqual(res.json.success, false);
        assert.match(res.json.message, /platform\.admin/,
          `${label} must be denied by the platform-scoped capability, not incidentally`);
        assert.strictEqual(await createdOrganizationCount(), 0,
          `${label}: no organization row may be persisted`);
        assert.strictEqual(await createdUserCount(suffix), 0,
          `${label}: no first-administrator user row may be persisted`);
      }
    });

    it('B2. denies an unauthenticated creation and persists nothing', async () => {
      const res = await post('/api/organizations', createBody('anonymous'));
      assert.strictEqual(res.status, 401);
      assert.strictEqual(await createdOrganizationCount(), 0);
      assert.strictEqual(await createdUserCount('anonymous'), 0);
    });

    it('B3. no principal the system can resolve holds platform.admin', async () => {
      for (const userId of [USER_ADMIN_A, USER_SUP_A, USER_OP_A, USER_ADMIN_B, USER_OP_B]) {
        const resolved = await resolveCapabilities({ id: userId });
        assert.ok(!resolved.capabilities.has('platform.admin'),
          `user ${userId} (${resolved.mode}) must not hold platform.admin`);
      }
    });
  });

  // ------------------------------------------------------------------
  // C. Policies 2 and 3 — profile update authority and field allowlist
  // ------------------------------------------------------------------

  describe('C. policies 2 and 3: organization profile update', () => {
    it('C1. admits the own organization administrator and persists the allowed fields', async () => {
      const before = await orgRow(ORG_A);
      const payload = {
        organization_name: `${TAG} Renamed`,
        industry: 'wastewater',
        billing_email: `sec104-${RUN}-billing@test.local`,
        phone: '+639170000000'
      };

      const res = await put(`/api/organizations/${ORG_A}`, payload, { userId: USER_ADMIN_A });
      assert.strictEqual(res.status, 200, `expected the authorized profile update to succeed: ${res.text}`);

      const after = await orgRow(ORG_A);
      assert.strictEqual(after.organization_name, payload.organization_name, 'database effect: name updated');
      assert.strictEqual(after.industry, payload.industry, 'database effect: industry updated');
      assert.strictEqual(after.billing_email, payload.billing_email, 'database effect: billing email updated');
      assert.strictEqual(after.phone, payload.phone, 'database effect: phone updated');

      assert.strictEqual(after.subscription_plan, before.subscription_plan, 'subscription plan untouched');
      assert.strictEqual(after.subscription_status, before.subscription_status, 'subscription status untouched');
      assert.strictEqual(after.max_users, before.max_users, 'max_users untouched');
      assert.strictEqual(after.max_facilities, before.max_facilities, 'max_facilities untouched');
      assert.strictEqual(after.max_equipment, before.max_equipment, 'max_equipment untouched');
    });

    it('C2. denies a supervisor of the same tenant and persists nothing', async () => {
      const before = await orgSnapshot(ORG_A);
      const res = await put(`/api/organizations/${ORG_A}`, { organization_name: `${TAG} Supervisor Edit` },
        { userId: USER_SUP_A });

      assert.strictEqual(res.status, 403, 'a supervisor does not hold org.config_admin');
      assert.match(res.json.message, /org\.config_admin/);
      assert.strictEqual(await orgSnapshot(ORG_A), before,
        'database effect: the row must be byte-identical after a denied update');
    });

    it('C3. denies an operator of the same tenant and persists nothing', async () => {
      const before = await orgSnapshot(ORG_A);
      const res = await put(`/api/organizations/${ORG_A}`, { organization_name: `${TAG} Operator Edit` },
        { userId: USER_OP_A });

      assert.strictEqual(res.status, 403, 'an operator does not hold org.config_admin');
      assert.strictEqual(await orgSnapshot(ORG_A), before, 'database effect: unchanged');
    });

    it('C4. denies a foreign tenant administrator and persists nothing (the reproduced defect)', async () => {
      const beforeA = await orgSnapshot(ORG_A);
      const beforeB = await orgSnapshot(ORG_B);

      const res = await put(`/api/organizations/${ORG_A}`, {
        organization_name: `${TAG} Stolen`,
        max_users: 9999
      }, { userId: USER_ADMIN_B });

      assert.strictEqual(res.status, 403,
        'the removed `userRole !== "admin"` disjunct must no longer admit a foreign administrator');
      assert.strictEqual(await orgSnapshot(ORG_A), beforeA,
        'database effect: the foreign tenant row must be byte-identical');
      assert.strictEqual(await orgSnapshot(ORG_B), beforeB, 'and the caller\u2019s own row untouched too');
    });

    it('C5. admits a foreign tenant administrator to its OWN organization only', async () => {
      const beforeA = await orgSnapshot(ORG_A);
      const res = await put(`/api/organizations/${ORG_B}`, { industry: 'solar' }, { userId: USER_ADMIN_B });

      assert.strictEqual(res.status, 200, 'the tenant predicate must not deny a caller its own tenant');
      const afterB = await orgRow(ORG_B);
      assert.strictEqual(afterB.industry, 'solar', 'database effect: own tenant updated');
      assert.strictEqual(await orgSnapshot(ORG_A), beforeA, 'database effect: the other tenant untouched');
    });

    it('C6. refuses every subscription, capacity, key and server-owned field without writing', async () => {
      for (const field of FORBIDDEN_UPDATE_FIELDS) {
        const before = await orgSnapshot(ORG_A);
        const value = field === 'id' ? ORG_B
          : field === 'created_at' || field === 'updated_at' ? '2000-01-01T00:00:00.000Z'
            : field === 'subscription_status' ? 'active'
              : 424242;

        const res = await put(`/api/organizations/${ORG_A}`, { [field]: value }, { userId: USER_ADMIN_A });

        assert.strictEqual(res.status, 400, `${field} must be refused at the field level`);
        assert.strictEqual(res.json.code, 'ORGANIZATION_UPDATE_FIELD_NOT_PERMITTED');
        assert.strictEqual(await orgSnapshot(ORG_A), before,
          `database effect: ${field} must be unchanged`);
      }

      const stillThere = await orgRow(ORG_A);
      assert.ok(stillThere, 'the primary key must not have been rewritten away');
      assert.strictEqual(stillThere.id, ORG_A, 'database effect: the primary key is unchanged');
    });

    it('C7. refuses a mixed request whole rather than partially applying it', async () => {
      const before = await orgSnapshot(ORG_A);
      const res = await put(`/api/organizations/${ORG_A}`, {
        organization_name: `${TAG} Partial Edit`,
        max_users: 9999
      }, { userId: USER_ADMIN_A });

      assert.strictEqual(res.status, 400, 'a mixed request must be refused whole');
      assert.strictEqual(res.json.code, 'ORGANIZATION_UPDATE_FIELD_NOT_PERMITTED');
      assert.strictEqual(await orgSnapshot(ORG_A), before,
        'database effect: no partial application may land');
      assert.notStrictEqual((await orgRow(ORG_A)).organization_name, `${TAG} Partial Edit`);
    });

    it('C8. refuses an unexpected key, including a prototype-shaped one', async () => {
      const before = await orgSnapshot(ORG_A);
      const payload = JSON.parse(`{"organization_name":"${TAG} Proto","__proto__":{"is_organization_admin":true}}`);
      const res = await put(`/api/organizations/${ORG_A}`, payload, { userId: USER_ADMIN_A });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(await orgSnapshot(ORG_A), before, 'database effect: unchanged');
    });

    it('C9. refuses an empty profile body and an unauthenticated update without writing', async () => {
      const before = await orgSnapshot(ORG_A);

      const empty = await put(`/api/organizations/${ORG_A}`, {}, { userId: USER_ADMIN_A });
      assert.strictEqual(empty.status, 400);
      assert.strictEqual(empty.json.code, 'ORGANIZATION_UPDATE_NO_FIELDS');

      const anonymous = await put(`/api/organizations/${ORG_A}`, { organization_name: `${TAG} Anon` });
      assert.strictEqual(anonymous.status, 401);

      assert.strictEqual(await orgSnapshot(ORG_A), before, 'database effect: unchanged');
    });

    it('C10. refuses foreign, absent and malformed identifiers indistinguishably', async () => {
      const foreign = await put(`/api/organizations/${ORG_B}`, { industry: 'nuclear' }, { userId: USER_ADMIN_A });
      const absent = await put('/api/organizations/2147483000', { industry: 'nuclear' }, { userId: USER_ADMIN_A });
      const malformed = await put('/api/organizations/not-an-identifier', { industry: 'nuclear' }, { userId: USER_ADMIN_A });

      for (const res of [foreign, absent, malformed]) {
        assert.strictEqual(res.status, 403, 'every non-own identifier must be refused');
      }
      assert.strictEqual(foreign.text, absent.text,
        'non-disclosure: a foreign identifier must be indistinguishable from an absent one');
      assert.strictEqual(malformed.text, absent.text,
        'non-disclosure: a malformed identifier must be indistinguishable too');

      const orgB = await orgRow(ORG_B);
      assert.notStrictEqual(orgB.industry, 'nuclear', 'database effect: nothing was written');
    });

    it('C11. permits only the profile columns the schema actually has (allowlist is exact)', async () => {
      const columns = await rows(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'organizations'`);
      const all = columns.map((c) => c.column_name).sort();
      const allowlist = [...organizationController.TENANT_EDITABLE_ORGANIZATION_FIELDS].sort();

      assert.deepStrictEqual(all.filter((c) => !allowlist.includes(c)),
        [...FORBIDDEN_UPDATE_FIELDS].sort(),
        'every organizations column outside the allowlist must be exactly the forbidden set');

      for (const field of allowlist) {
        assert.ok(all.includes(field), `${field} must be a real organizations column`);
      }
    });
  });

  // ------------------------------------------------------------------
  // D. Policy 3 — subscription and capacity authority
  // ------------------------------------------------------------------

  describe('D. policy 3: subscription and capacity route', () => {
    it('D1. denies the own tenant administrator and persists nothing', async () => {
      const before = await orgSnapshot(ORG_A);
      const res = await put(`/api/organizations/${ORG_A}/subscription`,
        { subscription_plan: 'enterprise', max_users: 9999 }, { userId: USER_ADMIN_A });

      assert.strictEqual(res.status, 403,
        'a tenant administrator must not be able to change subscription or capacity');
      assert.match(res.json.message, /platform\.admin/);
      assert.strictEqual(await orgSnapshot(ORG_A), before, 'database effect: unchanged');
    });

    it('D2. denies a cross-tenant supervisor and persists nothing (the reproduced defect)', async () => {
      const beforeA = await orgSnapshot(ORG_A);
      const res = await put(`/api/organizations/${ORG_A}/subscription`,
        { subscription_plan: 'free', subscription_status: 'suspended', max_users: 1 }, { userId: USER_SUP_A });

      assert.strictEqual(res.status, 403, 'a supervisor must not reach another tenant\u2019s plan');
      const afterA = await orgRow(ORG_A);
      assert.strictEqual(afterA.subscription_plan, 'pro');
      assert.strictEqual(afterA.subscription_status, 'active');
      assert.strictEqual(afterA.max_users, 7);
      assert.strictEqual(await orgSnapshot(ORG_A), beforeA, 'database effect: unchanged');
    });

    it('D3. denies a foreign tenant administrator and an unauthenticated caller', async () => {
      const beforeB = await orgSnapshot(ORG_B);

      const foreign = await put(`/api/organizations/${ORG_A}/subscription`,
        { subscription_plan: 'enterprise' }, { userId: USER_ADMIN_B });
      assert.strictEqual(foreign.status, 403);

      const anonymous = await put(`/api/organizations/${ORG_A}/subscription`,
        { subscription_plan: 'enterprise' });
      assert.strictEqual(anonymous.status, 401);

      assert.strictEqual(await orgSnapshot(ORG_B), beforeB, 'database effect: unchanged');
    });

    it('D4. leaves every tenant on its own plan (no cross-tenant write exists)', async () => {
      const a = await orgRow(ORG_A);
      const b = await orgRow(ORG_B);
      assert.strictEqual(a.subscription_plan, 'pro');
      assert.strictEqual(b.subscription_plan, 'pro');
      assert.strictEqual(a.subscription_status, 'active');
      assert.strictEqual(b.subscription_status, 'active');
      assert.strictEqual(a.max_users, 7);
      assert.strictEqual(b.max_users, 7);
    });
  });

  // ------------------------------------------------------------------
  // E. Policy 4 — tenant isolation: reading, listing, statistics, logo
  // ------------------------------------------------------------------

  describe('E. policy 4: reading, listing, statistics and logo', () => {
    it('E1. admits every role of a tenant to its own organization profile', async () => {
      for (const [label, userId] of [
        ['operator', USER_OP_A], ['supervisor', USER_SUP_A], ['administrator', USER_ADMIN_A]
      ]) {
        const res = await get(`/api/organizations/${ORG_A}`, { userId });
        assert.strictEqual(res.status, 200, `${label} must still read its own organization`);
        assert.strictEqual(res.json.data.organization.id, ORG_A);
      }
    });

    it('E2. denies a foreign read to a tenant administrator in BOTH directions (the removed bypass)', async () => {
      // Both directions: the removed `userRole !== "admin"` disjunct let any
      // administrator read any tenant, so a one-directional check could pass for
      // an unrelated reason (for example the caller's own tenant being inactive).
      for (const [label, userId, target] of [
        ['A -> B', USER_ADMIN_A, ORG_B],
        ['B -> A', USER_ADMIN_B, ORG_A]
      ]) {
        const res = await get(`/api/organizations/${target}`, { userId });

        assert.strictEqual(res.status, 403,
          `${label}: the \`userRole !== "admin"\` read bypass must be gone`);
        const foreign = await orgRow(target);
        assert.ok(!res.text.includes(foreign.organization_name),
          `${label}: non-disclosure: no foreign organization name may appear`);
        assert.ok(!res.text.includes(foreign.billing_email),
          `${label}: non-disclosure: no foreign billing contact may appear`);
        assert.ok(!/max_users|max_facilities|max_equipment/.test(res.text),
          `${label}: non-disclosure: no capacity field may appear`);
      }
    });

    it('E3. denies a foreign read to an operator and refuses absent or malformed ids identically', async () => {
      const foreign = await get(`/api/organizations/${ORG_B}`, { userId: USER_OP_A });
      const absent = await get('/api/organizations/2147483000', { userId: USER_OP_A });
      const malformed = await get('/api/organizations/not-an-identifier', { userId: USER_OP_A });

      for (const res of [foreign, absent, malformed]) {
        assert.strictEqual(res.status, 403);
      }
      assert.strictEqual(foreign.text, absent.text,
        'non-disclosure: foreign and absent must be indistinguishable');
      assert.strictEqual(malformed.text, absent.text, 'non-disclosure: malformed as well');
    });

    it('E4. refuses the cross-tenant organization listing to every tenant role', async () => {
      for (const [label, userId] of [
        ['operator', USER_OP_A], ['supervisor', USER_SUP_A], ['administrator', USER_ADMIN_A]
      ]) {
        const res = await get('/api/organizations', { userId });
        assert.strictEqual(res.status, 403, `${label} must not list tenants`);
        assert.match(res.json.message, /platform\.admin/);
        assert.ok(!res.text.includes(`${TAG} Own Org`), `non-disclosure: no tenant name for ${label}`);
        assert.ok(!res.text.includes(`${TAG} Foreign Org`), `non-disclosure: no foreign tenant name for ${label}`);
      }

      const anonymous = await get('/api/organizations');
      assert.strictEqual(anonymous.status, 401);
    });

    it('E5. scopes usage statistics to the own tenant', async () => {
      const own = await get(`/api/organizations/${ORG_A}/stats`, { userId: USER_OP_A });
      assert.strictEqual(own.status, 200, 'own-tenant statistics must still work');
      assert.ok(own.json.data.stats, 'the statistics payload must be present');

      const foreign = await get(`/api/organizations/${ORG_B}/stats`, { userId: USER_ADMIN_A });
      const absent = await get('/api/organizations/2147483000/stats', { userId: USER_ADMIN_A });
      assert.strictEqual(foreign.status, 403, 'a foreign administrator must be refused');
      assert.strictEqual(foreign.text, absent.text,
        'non-disclosure: foreign statistics must be indistinguishable from absent statistics');
      assert.ok(!resContains(foreign, `${TAG} Foreign Org`), 'no foreign tenant data may leak');
    });

    it('E6. denies logo management to an operator and a supervisor without writing', async () => {
      for (const [label, userId] of [['operator', USER_OP_A], ['supervisor', USER_SUP_A]]) {
        const before = await orgSnapshot(ORG_A);
        const res = await post('/api/organizations/logo',
          { logo: `data:image/png;base64,${label}` }, { userId });

        assert.strictEqual(res.status, 403, `${label} must not manage the organization logo`);
        assert.match(res.json.message, /org\.config_admin/);
        assert.strictEqual(await orgSnapshot(ORG_A), before, `database effect: ${label} wrote nothing`);
      }
    });

    it('E7. admits the own organization administrator and writes only its own tenant', async () => {
      const beforeA = await orgSnapshot(ORG_A);
      const beforeB = await orgSnapshot(ORG_B);

      const res = await post('/api/organizations/logo', { logo: 'data:image/png;base64,SEC104-OWN' },
        { userId: USER_ADMIN_A });
      assert.strictEqual(res.status, 200, `expected the authorized logo upload to succeed: ${res.text}`);

      const afterA = await orgRow(ORG_A);
      const afterB = await orgRow(ORG_B);
      assert.strictEqual(afterA.logo_url, 'data:image/png;base64,SEC104-OWN',
        'database effect: the own tenant logo is persisted');
      assert.strictEqual(await orgSnapshot(ORG_B), beforeB,
        'database effect: the other tenant must be untouched');
      assert.notStrictEqual(beforeA, JSON.stringify(afterA), 'the update must be observable');
    });

    it('E8. writes a tenant administrator\u2019s logo to that administrator\u2019s own tenant only', async () => {
      const beforeA = await orgSnapshot(ORG_A);
      const res = await post('/api/organizations/logo', { logo: 'data:image/png;base64,SEC104-FOREIGN' },
        { userId: USER_ADMIN_B });
      assert.strictEqual(res.status, 200);

      const afterB = await orgRow(ORG_B);
      assert.strictEqual(afterB.logo_url, 'data:image/png;base64,SEC104-FOREIGN',
        'database effect: the foreign administrator updated its own tenant');
      assert.strictEqual(await orgSnapshot(ORG_A), beforeA,
        'database effect: the other tenant is untouched — logo management is tenant-isolated');
    });

    it('E9. keeps GET /my working for every role (preserved self-service)', async () => {
      for (const [label, userId] of [
        ['operator', USER_OP_A], ['supervisor', USER_SUP_A], ['administrator', USER_ADMIN_A]
      ]) {
        const res = await get('/api/organizations/my', { userId });
        assert.strictEqual(res.status, 200, `${label} must still read its own organization`);
        assert.strictEqual(res.json.data.organization.id, ORG_A);
      }
    });

    // ------------------------------------------------------------------
    // F4 — a logo request that ADDRESSES a foreign tenant through the body.
    //
    // The prior suite had a genuine coverage gap: the controller wrote
    // req.user.organization_id, so the only way to make the route cross-tenant
    // was to make it honour req.body.organization_id — and NO case attempted a
    // foreign body, so that full cross-tenant logo write left the suite green.
    // The cases below are the adversarial control: they must fail if the write
    // target ever comes from the request body.
    // ------------------------------------------------------------------

    it('E10. refuses a logo request that addresses a FOREIGN tenant and writes nothing anywhere', async () => {
      const beforeA = await orgSnapshot(ORG_A);
      const beforeB = await orgSnapshot(ORG_B);

      const res = await post('/api/organizations/logo',
        { organization_id: ORG_B, logo: 'data:image/png;base64,F4-FOREIGN' },
        { userId: USER_ADMIN_A });

      assert.strictEqual(res.status, 403,
        'a body that names another tenant must be refused, not silently redirected');
      assert.strictEqual(res.json.code, 'ORGANIZATION_LOGO_TENANT_MISMATCH');
      assert.strictEqual(res.json.success, false);

      assert.strictEqual(await orgSnapshot(ORG_A), beforeA,
        'database effect: the caller\u2019s own tenant must NOT receive the foreign-addressed logo');
      assert.strictEqual(await orgSnapshot(ORG_B), beforeB,
        'database effect: the addressed foreign tenant must be byte-identical');
      assert.ok(!res.text.includes('data:image/png'),
        'non-disclosure: the refusal must not echo a stored value');
    });

    it('E11. refuses every string form of a foreign tenant identifier on the logo route', async () => {
      const beforeA = await orgSnapshot(ORG_A);
      const beforeB = await orgSnapshot(ORG_B);

      for (const addressed of [String(ORG_B), ` ${ORG_B}`, `${ORG_B}.0`]) {
        const res = await post('/api/organizations/logo',
          { organization_id: addressed, logo: 'data:image/png;base64,F4-FOREIGN-STRING' },
          { userId: USER_ADMIN_A });

        assert.strictEqual(res.status, 403,
          `addressed organization_id ${JSON.stringify(addressed)} must be refused`);
        assert.strictEqual(res.json.code, 'ORGANIZATION_LOGO_TENANT_MISMATCH');
      }

      assert.strictEqual(await orgSnapshot(ORG_A), beforeA, 'database effect: nothing written');
      assert.strictEqual(await orgSnapshot(ORG_B), beforeB, 'database effect: foreign tenant untouched');
    });

    it('E12. still admits a logo request that omits the tenant or echoes the caller\u2019s own', async () => {
      const beforeB = await orgSnapshot(ORG_B);

      const omitted = await post('/api/organizations/logo',
        { logo: 'data:image/png;base64,F4-NO-TENANT' }, { userId: USER_ADMIN_A });
      assert.strictEqual(omitted.status, 200, `omitting organization_id must keep working: ${omitted.text}`);
      assert.strictEqual((await orgRow(ORG_A)).logo_url, 'data:image/png;base64,F4-NO-TENANT',
        'database effect: the caller\u2019s own tenant received the logo');

      const own = await post('/api/organizations/logo',
        { organization_id: String(ORG_A), logo: 'data:image/png;base64,F4-OWN-ECHO' }, { userId: USER_ADMIN_A });
      assert.strictEqual(own.status, 200, `echoing the caller\u2019s own tenant must keep working: ${own.text}`);
      assert.strictEqual((await orgRow(ORG_A)).logo_url, 'data:image/png;base64,F4-OWN-ECHO',
        'database effect: own tenant updated');

      assert.strictEqual(await orgSnapshot(ORG_B), beforeB,
        'database effect: the foreign tenant is still untouched by either request');
    });
  });

  // ------------------------------------------------------------------
  // F. Policy 5 — direct organization deletion disabled
  // ------------------------------------------------------------------

  describe('F. policy 5: organization deletion containment', () => {
    it('F1. denies every authenticated role for its own and a foreign organization', async () => {
      for (const [label, userId] of [
        ['operator', USER_OP_A], ['supervisor', USER_SUP_A], ['administrator', USER_ADMIN_A],
        ['foreign operator', USER_OP_B], ['foreign administrator', USER_ADMIN_B]
      ]) {
        for (const target of [ORG_A, ORG_B]) {
          const res = await del(`/api/organizations/${target}`, { userId });
          assert.strictEqual(res.status, 403, `${label} must be denied deletion of ${target}`);
          assert.strictEqual(res.json.code, 'ORGANIZATION_DELETION_DISABLED');
          assert.strictEqual(res.json.message, 'Organization deletion is disabled');
        }
      }
    });

    it('F2. denies an unauthenticated deletion', async () => {
      const res = await del(`/api/organizations/${ORG_A}`);
      assert.strictEqual(res.status, 401, 'authentication still applies to the denied route');
    });

    it('F3. destroys nothing and cascades to nothing', async () => {
      const beforeA = await orgSnapshot(ORG_A);
      const beforeB = await orgSnapshot(ORG_B);
      const usersA = await usersOfOrganization(ORG_A);
      const usersB = await usersOfOrganization(ORG_B);

      for (const userId of [USER_ADMIN_A, USER_SUP_A, USER_OP_A, USER_ADMIN_B]) {
        for (const target of [ORG_A, ORG_B]) {
          await del(`/api/organizations/${target}`, { userId });
        }
      }

      assert.strictEqual(await orgSnapshot(ORG_A), beforeA, 'database effect: tenant A is byte-identical');
      assert.strictEqual(await orgSnapshot(ORG_B), beforeB, 'database effect: tenant B is byte-identical');
      assert.deepStrictEqual(await usersOfOrganization(ORG_A), usersA,
        'database effect: no user of tenant A was removed by cascade');
      assert.deepStrictEqual(await usersOfOrganization(ORG_B), usersB,
        'database effect: no user of tenant B was removed by cascade');
    });

    it('F4. is identical for existing, foreign, absent and malformed identifiers', async () => {
      const own = await del(`/api/organizations/${ORG_A}`, { userId: USER_ADMIN_A });
      const foreign = await del(`/api/organizations/${ORG_B}`, { userId: USER_ADMIN_A });
      const absent = await del('/api/organizations/2147483000', { userId: USER_ADMIN_A });
      const malformed = await del('/api/organizations/not-an-identifier', { userId: USER_ADMIN_A });
      const huge = await del('/api/organizations/99999999999999999999', { userId: USER_ADMIN_A });

      for (const res of [own, foreign, absent, malformed, huge]) {
        assert.strictEqual(res.status, 403);
        assert.strictEqual(res.text, own.text,
          'non-disclosure: the denial must not vary with the identifier');
      }
      assert.ok(!resContains(own, `${TAG} Own Org`), 'no organization data may be disclosed');
    });

    it('F5. admits no platform-administrator exemption, and none can exist', async () => {
      for (const userId of [USER_ADMIN_A, USER_SUP_A, USER_OP_A, USER_ADMIN_B, USER_OP_B]) {
        const resolved = await resolveCapabilities({ id: userId });
        assert.ok(!resolved.capabilities.has('platform.admin'),
          'no resolvable principal may hold a platform capability that could exempt it');
      }

      const flat = flatCode(ROUTES_FILE);
      assert.match(flat, /const denyOrganizationDeletion = \(req, res\) => \{/,
        'the denial must be a constant function of nothing — no role or identifier branch');
      assert.doesNotMatch(flat, /ORGANIZATION_DELETION_ENABLED/);
    });

    it('F6. NEGATIVE CONTROL (mechanism): the retained operation really does destroy a tenant', async () => {
      const doomed = await withConn((conn) => conn.query(
        `INSERT INTO organizations (organization_name, subscription_status)
         VALUES ($1, 'active') RETURNING id`, [`${TAG} Doomed Org`]));
      const doomedId = Number(doomed[0].id);
      await withConn((conn) => conn.query(
        `INSERT INTO users (organization_id, username, email, password_hash, full_name, role, is_active)
         VALUES ($1, $2, $2, 'x', 'SEC104 Doomed User', 'admin', true)`,
        [doomedId, `sec104-${RUN}-doomed@test.local`]));

      const usersBefore = await usersOfOrganization(doomedId);
      assert.strictEqual(usersBefore.length, 1, 'the mechanism control needs a real cascade victim');

      await Organization.delete(doomedId);

      assert.strictEqual(await orgRow(doomedId), null,
        'the retained model operation must still be able to delete, so containment is the route and not a broken model');
      assert.strictEqual((await usersOfOrganization(doomedId)).length, 0,
        'and its ON DELETE CASCADE must still destroy the tenant users, so the containment is load-bearing');
    });
  });

  // ------------------------------------------------------------------
  // H. Policy 3, capability-wide — /api/subscriptions (R2 finding F1)
  //
  // Policy 3 was applied to PUT /api/organizations/:id/subscription but not to
  // the subscription family. Three routes wrote organization_subscriptions with
  // no role guard at all, and the two /admin routes admitted a supervisor.
  // Every case below asserts BOTH the refusal and the absence of the persisted
  // write, because the cross-tenant route used to persist and then answer 500.
  // ------------------------------------------------------------------

  describe('H. policy 3 capability-wide: subscription and capacity routes (F1)', () => {
    it('H1. denies a tenant administrator its own plan change and persists nothing', async () => {
      const before = await subscriptionSnapshot(ORG_A);
      const res = await put('/api/subscriptions/plan',
        { planId: PLAN_UPGRADE_ID, billingCycle: 'monthly' }, { userId: USER_ADMIN_A });

      assert.strictEqual(res.status, 403,
        'a tenant administrator must not change its own plan');
      assert.match(res.json.message, /platform\.admin/);
      assert.strictEqual(await subscriptionSnapshot(ORG_A), before,
        'database effect: the subscription row must be byte-identical');
    });

    it('H2. denies a tenant operator and a tenant supervisor the plan change', async () => {
      for (const [label, userId] of [['operator', USER_OP_A], ['supervisor', USER_SUP_A]]) {
        const before = await subscriptionSnapshot(ORG_A);
        const res = await put('/api/subscriptions/plan',
          { plan_code: `sec104-${RUN}-up` }, { userId });

        assert.strictEqual(res.status, 403, `${label} must not change the plan`);
        assert.match(res.json.message, /platform\.admin/, `${label} must be refused by the capability`);
        assert.strictEqual(await subscriptionSnapshot(ORG_A), before,
          `database effect: ${label} persisted nothing`);
      }
    });

    it('H3. denies the extra-users capacity lever to a tenant administrator, operator and supervisor', async () => {
      for (const [label, userId] of [
        ['administrator', USER_ADMIN_A], ['operator', USER_OP_A], ['supervisor', USER_SUP_A]
      ]) {
        const before = await subscriptionSnapshot(ORG_A);
        const res = await put('/api/subscriptions/extra-users', { extraUsers: 25 }, { userId });

        assert.strictEqual(res.status, 403, `${label} must not increase capacity`);
        assert.strictEqual(res.json.success, false);
        assert.strictEqual(await subscriptionSnapshot(ORG_A), before,
          `database effect: ${label} persisted no extra seat`);
      }

      const row = await subscriptionRow(ORG_A);
      assert.strictEqual(row.extra_users, 0, 'database effect: extra_users is still 0');
    });

    it('H4. denies a FOREIGN tenant administrator the cross-tenant update, with no write (the reproduced defect)', async () => {
      const beforeA = await subscriptionSnapshot(ORG_A);
      const beforeB = await subscriptionSnapshot(ORG_B);
      const orgBeforeA = await orgSnapshot(ORG_A);

      const res = await put(`/api/subscriptions/admin/organizations/${ORG_A}`,
        { planId: PLAN_UPGRADE_ID, extraUsers: 9, status: 'suspended' }, { userId: USER_ADMIN_B });

      assert.strictEqual(res.status, 403,
        'a foreign administrator must be refused by the platform-scoped capability');
      assert.match(res.json.message, /platform\.admin/);
      assert.notStrictEqual(res.status, 500,
        'the refusal must not be the old error: the write used to land and then answer 500');

      assert.strictEqual(await subscriptionSnapshot(ORG_A), beforeA,
        'database effect: the foreign tenant\u2019s subscription row must be byte-identical');
      assert.strictEqual(await subscriptionSnapshot(ORG_B), beforeB,
        'database effect: the caller\u2019s own subscription row must be untouched too');
      assert.strictEqual(await orgSnapshot(ORG_A), orgBeforeA,
        'database effect: the organization row must be untouched');
    });

    it('H5. denies a same-tenant administrator the cross-tenant route for its own tenant', async () => {
      const before = await subscriptionSnapshot(ORG_A);
      const res = await put(`/api/subscriptions/admin/organizations/${ORG_A}`,
        { planId: PLAN_UPGRADE_ID, status: 'suspended' }, { userId: USER_ADMIN_A });

      assert.strictEqual(res.status, 403,
        'the /admin form is platform-scoped even for the caller\u2019s own tenant');
      assert.strictEqual(await subscriptionSnapshot(ORG_A), before, 'database effect: unchanged');
    });

    it('H6. denies the cross-tenant subscription READ and discloses nothing', async () => {
      for (const [label, userId] of [
        ['foreign administrator', USER_ADMIN_B], ['tenant administrator', USER_ADMIN_A],
        ['tenant supervisor', USER_SUP_A], ['tenant operator', USER_OP_A]
      ]) {
        const res = await get(`/api/subscriptions/admin/organizations/${ORG_A}`, { userId });
        assert.strictEqual(res.status, 403,
          `${label} must not read another tenant\u2019s billing through the /admin form`);
        assert.match(res.json.message, /platform\.admin/);
        assert.ok(!/plan|billing|max_users|stripe/i.test(res.text),
          `non-disclosure: no billing field may appear for ${label}`);
      }
    });

    it('H7. denies unauthenticated subscription writes without touching the database', async () => {
      const before = await subscriptionSnapshot(ORG_A);

      assert.strictEqual((await put('/api/subscriptions/plan', { planId: PLAN_UPGRADE_ID })).status, 401);
      assert.strictEqual((await put('/api/subscriptions/extra-users', { extraUsers: 25 })).status, 401);
      assert.strictEqual((await put(`/api/subscriptions/admin/organizations/${ORG_A}`,
        { planId: PLAN_UPGRADE_ID })).status, 401);

      assert.strictEqual(await subscriptionSnapshot(ORG_A), before, 'database effect: unchanged');
    });

    it('H8. keeps the tenant\u2019s own subscription reads working (preserved self-service)', async () => {
      for (const [label, userId] of [
        ['administrator', USER_ADMIN_A], ['supervisor', USER_SUP_A], ['operator', USER_OP_A]
      ]) {
        assert.strictEqual((await get('/api/subscriptions/current', { userId })).status, 200,
          `${label} must still read its own subscription`);
        assert.strictEqual((await get('/api/subscriptions/seats', { userId })).status, 200);
        assert.strictEqual((await get('/api/subscriptions/plans', { userId })).status, 200);
      }
    });

    it('H9. NEGATIVE CONTROL (mechanism): the retained service really does change plan and capacity', async () => {
      // The protection is the route guard — not a broken service. ORG_B is used
      // so the main fixtures keep the plan the other assertions expect.
      const before = await subscriptionSnapshot(ORG_B);

      await subscriptionService.changePlan(ORG_B, PLAN_UPGRADE_ID);
      const upgraded = await subscriptionRow(ORG_B);
      assert.strictEqual(Number(upgraded.plan_id), PLAN_UPGRADE_ID,
        'the service layer must still be able to change a plan, so the guard is load-bearing');
      assert.notStrictEqual(JSON.stringify(upgraded), before);

      await subscriptionService.setExtraUsers(ORG_B, 3);
      assert.strictEqual(Number((await subscriptionRow(ORG_B)).extra_users), 3,
        'the service layer must still be able to add capacity');

      await subscriptionService.changePlan(ORG_B, PLAN_ID);
      await subscriptionService.setExtraUsers(ORG_B, 0);
      assert.strictEqual(Number((await subscriptionRow(ORG_B)).plan_id), PLAN_ID, 'restored plan');
      assert.strictEqual(Number((await subscriptionRow(ORG_B)).extra_users), 0, 'restored capacity');
    });
  });

  // ------------------------------------------------------------------
  // I. F3 — the tenant administrator with an UNRELATED explicit grant
  //
  // The mode rule discards the legacy bundle once any explicit grant exists. For
  // the tenant administrator (role admin AND is_organization_admin) that removed
  // the ability to administer its own tenant: baseline answered 200 and wrote the
  // row, the #104 candidate answered 403. These cases pin the correction in both
  // directions — with the unrelated grant, and without any grant (C1/C5/E7).
  // ------------------------------------------------------------------

  describe('I. F3: tenant administrator with unrelated explicit grants', () => {
    it('I1. resolves the R1 Tenant Administrator profile for the granted administrator, and nothing else', async () => {
      const resolved = await resolveCapabilities({ id: F3_USER_GRANTED });

      assert.strictEqual(resolved.mode, RESOLUTION_MODES.EXPLICIT_GRANTS,
        'the fixture holds a real active grant, so it must resolve in explicit mode');
      for (const capability of TENANT_ADMINISTRATOR_PROFILE) {
        assert.ok(resolved.capabilities.has(capability),
          `the tenant administrator must keep ${capability} despite the unrelated grant`);
      }
      assert.ok(resolved.capabilities.has(F3_UNRELATED_CAPABILITY), 'the grant itself must still apply');
      assert.deepStrictEqual([...resolved.capabilities].sort(),
        [F3_UNRELATED_CAPABILITY, ...TENANT_ADMINISTRATOR_PROFILE].sort(),
        'exactly the explicit grant plus the R1 Tenant Administrator profile — no union of the rest');
      assert.ok(!resolved.capabilities.has('knowledge.publish'),
        'the rest of the legacy admin bundle must NOT be restored');
      assert.ok(!resolved.capabilities.has('platform.admin'));
      assert.ok(!resolved.capabilities.has('inspection.execute'));

      assert.deepStrictEqual([...TENANT_ADMINISTRATOR_PROFILE].sort(),
        [CAPABILITIES.ORG_USER_ADMIN, CAPABILITIES.ORG_CONFIG_ADMIN].sort(),
        'the preserved profile must be exactly the R1 Tenant Administrator profile');
    });

    it('I2. keeps the flag from being an authority of its own', async () => {
      // An operator that carries is_organization_admin = true gains nothing.
      const flaggedOperator = await resolveCapabilities({ id: USER_OP_FLAGGED });
      assert.strictEqual(flaggedOperator.mode, RESOLUTION_MODES.LEGACY_COMPATIBILITY);
      assert.deepStrictEqual([...flaggedOperator.capabilities].sort(),
        [...LEGACY_COMPATIBILITY_BUNDLES.operator].sort(),
        'is_organization_admin must not add a capability to a non-admin role');
      assert.ok(!flaggedOperator.capabilities.has('org.config_admin'));

      // An administrator WITHOUT the flag is unchanged: no-suite-fixture grant,
      // legacy bundle exactly.
      const plainAdmin = await resolveCapabilities({ id: USER_ADMIN_A });
      assert.strictEqual(plainAdmin.mode, RESOLUTION_MODES.LEGACY_COMPATIBILITY);
      assert.deepStrictEqual([...plainAdmin.capabilities].sort(),
        [...LEGACY_COMPATIBILITY_BUNDLES.admin].sort(),
        'an un-granted administrator still resolves to the exact legacy bundle');
      assert.ok(plainAdmin.capabilities.has('org.config_admin'),
        'the without-grant administrator is the paired control: it already holds org.config_admin');
    });

    it('I3. admits the granted tenant administrator to its OWN organization profile and persists it', async () => {
      const before = await orgRow(F3_ORG);
      const marker = `${TAG} F3 grant-address`;

      const res = await put(`/api/organizations/${F3_ORG}`, { billing_address: marker },
        { userId: F3_USER_GRANTED });

      assert.strictEqual(res.status, 200,
        `the tenant administrator must not lose org.config_admin to an unrelated grant: ${res.text}`);

      const after = await orgRow(F3_ORG);
      assert.strictEqual(after.billing_address, marker, 'database effect: the allowed field was written');
      assert.strictEqual(after.organization_name, before.organization_name, 'the fixture identity is stable');
      assert.strictEqual(after.subscription_plan, before.subscription_plan, 'subscription plan untouched');
      assert.strictEqual(after.max_users, before.max_users, 'capacity untouched');
    });

    it('I4. admits the granted tenant administrator to the logo route for its own tenant', async () => {
      const beforeB = await orgSnapshot(ORG_B);
      const res = await post('/api/organizations/logo',
        { logo: 'data:image/png;base64,F3-GRANTED' }, { userId: F3_USER_GRANTED });

      assert.strictEqual(res.status, 200,
        `the granted tenant administrator must still manage its own logo: ${res.text}`);
      assert.strictEqual((await orgRow(F3_ORG)).logo_url, 'data:image/png;base64,F3-GRANTED',
        'database effect: the own tenant logo is persisted');
      assert.strictEqual(await orgSnapshot(ORG_B), beforeB, 'database effect: an unrelated tenant is untouched');
    });

    it('I5. does not let the preservation widen into tenant scope, subscription or capacity', async () => {
      const beforeOrg = await orgSnapshot(ORG_A);
      const beforeSub = await subscriptionSnapshot(F3_ORG);

      // Tenant scope still applies: the preserved capability is tenant-scoped
      // authority, not a licence to address another tenant.
      const foreign = await put(`/api/organizations/${ORG_A}`, { industry: 'nuclear' },
        { userId: F3_USER_GRANTED });
      assert.strictEqual(foreign.status, 403, 'a foreign tenant must still be refused');
      assert.strictEqual(await orgSnapshot(ORG_A), beforeOrg, 'database effect: no foreign write');

      // Policy 3 still applies: the preserved capability is not subscription authority.
      const subscription = await put(`/api/organizations/${F3_ORG}/subscription`,
        { subscription_plan: 'enterprise', max_users: 9999 }, { userId: F3_USER_GRANTED });
      assert.strictEqual(subscription.status, 403,
        'the preserved tenant-administration profile must not reach subscription fields');
      assert.match(subscription.json.message, /platform\.admin/);
      assert.strictEqual(await subscriptionSnapshot(F3_ORG), beforeSub,
        'database effect: the subscription row is byte-identical');
    });

    it('I6. keeps the unrelated grant a real, active, tenant-scoped row (fixture integrity)', async () => {
      const found = await rows(
        `SELECT capability, organization_id, revoked_at FROM user_capabilities
          WHERE user_id = $1 AND capability = $2 AND revoked_at IS NULL`,
        [F3_USER_GRANTED, F3_UNRELATED_CAPABILITY]);
      assert.strictEqual(found.length, 1, 'exactly one active unrelated grant must exist');
      assert.strictEqual(Number(found[0].organization_id), F3_ORG);
      assert.strictEqual(found[0].revoked_at, null);
    });
  });

  // ------------------------------------------------------------------
  // J. Residual — allowlisted field TYPE validation
  //
  // A null in a NOT NULL allowlisted column surfaced as an unhandled 500 with the
  // raw PostgreSQL constraint message; a nullable one was silently cleared. An
  // array, object, number or boolean was coerced into the column. Both are now a
  // 400 before any UPDATE, and an empty string remains the documented way to
  // clear a nullable field.
  // ------------------------------------------------------------------

  describe('J. residual: allowlisted field type validation', () => {
    it('J1. refuses null for every allowlisted field with 400 and writes nothing', async () => {
      for (const field of EXPECTED_ALLOWLIST) {
        const before = await orgSnapshot(ORG_A);
        const res = await put(`/api/organizations/${ORG_A}`, { [field]: null }, { userId: USER_ADMIN_A });

        assert.strictEqual(res.status, 400,
          `${field}: a null must be a validation failure, not an unhandled 500`);
        assert.strictEqual(res.json.code, 'ORGANIZATION_UPDATE_FIELD_TYPE_INVALID');
        assert.strictEqual(res.json.message, `The value of ${field} must be a string`);
        assert.ok(!/constraint|violates|relation/i.test(res.text),
          `${field}: no raw database error text may be disclosed`);
        assert.strictEqual(await orgSnapshot(ORG_A), before, `database effect: ${field} unchanged`);
      }
    });

    it('J2. refuses nested, array, number and boolean values for allowlisted fields', async () => {
      const cases = [
        ['industry', { nested: true }],
        ['industry', { deeply: { nested: ['x'] } }],
        ['phone', ['a', 'b']],
        ['organization_name', 12345],
        ['billing_email', true],
        ['billing_address', ['line 1']],
        ['logo_url', { url: 'x' }]
      ];

      for (const [field, value] of cases) {
        const before = await orgSnapshot(ORG_A);
        const res = await put(`/api/organizations/${ORG_A}`, { [field]: value }, { userId: USER_ADMIN_A });

        assert.strictEqual(res.status, 400,
          `${field}=${JSON.stringify(value)} must be refused as a type error`);
        assert.strictEqual(res.json.code, 'ORGANIZATION_UPDATE_FIELD_TYPE_INVALID');
        assert.strictEqual(await orgSnapshot(ORG_A), before,
          `database effect: ${field} must not be coerced into the column`);
      }
    });

    it('J3. refuses an empty organization_name and keeps a plain string working', async () => {
      const before = await orgSnapshot(ORG_A);

      const blank = await put(`/api/organizations/${ORG_A}`, { organization_name: '   ' },
        { userId: USER_ADMIN_A });
      assert.strictEqual(blank.status, 400,
        'a blank name cannot be stored in a NOT NULL column, so it must be a 400 not a 500');
      assert.strictEqual(blank.json.code, 'ORGANIZATION_UPDATE_FIELD_TYPE_INVALID');
      assert.strictEqual(await orgSnapshot(ORG_A), before, 'database effect: unchanged');

      const ok = await put(`/api/organizations/${ORG_A}`, { organization_name: `${TAG} Renamed Again` },
        { userId: USER_ADMIN_A });
      assert.strictEqual(ok.status, 200, `a real string must still update: ${ok.text}`);
      assert.strictEqual((await orgRow(ORG_A)).organization_name, `${TAG} Renamed Again`);
    });

    it('J4. keeps an empty string as the documented way to clear a nullable field', async () => {
      const seeded = await put(`/api/organizations/${ORG_A}`, { billing_address: 'to be cleared' },
        { userId: USER_ADMIN_A });
      assert.strictEqual(seeded.status, 200);
      assert.strictEqual((await orgRow(ORG_A)).billing_address, 'to be cleared');

      const cleared = await put(`/api/organizations/${ORG_A}`, { billing_address: '' },
        { userId: USER_ADMIN_A });
      assert.strictEqual(cleared.status, 200,
        `an empty string is a string and must remain usable to clear a nullable field: ${cleared.text}`);
      assert.strictEqual((await orgRow(ORG_A)).billing_address, null,
        'database effect: the field was cleared to SQL NULL');
    });

    it('J5. refuses a mixed string-and-invalid request whole, before any write', async () => {
      const before = await orgSnapshot(ORG_A);
      const res = await put(`/api/organizations/${ORG_A}`,
        { industry: 'power', phone: { evil: true } }, { userId: USER_ADMIN_A });

      assert.strictEqual(res.status, 400, 'the invalid field must refuse the whole request');
      assert.strictEqual(res.json.code, 'ORGANIZATION_UPDATE_FIELD_TYPE_INVALID');
      assert.strictEqual(await orgSnapshot(ORG_A), before,
        'database effect: no partial application — industry must not have been written either');
    });
  });

  // ------------------------------------------------------------------
  // K. Policy 3 residual (§I closed) — tenant-scoped cancel / reactivate
  //
  // At candidate b795a04 both routes were reachable with `authenticate` alone.
  // An independent reviewer reproduced a tenant OPERATOR reactivating a
  // suspended subscription (status suspended -> active) and persisting a
  // cancellation request. Every case below asserts BOTH the decision AND the
  // persisted effect read back from the database: a failed HTTP request is NOT
  // proof that the row is unchanged, and defect D-1 (a committed write behind
  // HTTP 500) means a status code alone is never evidence.
  //
  // These cases are the adversarial negative controls: remove either guard from
  // src/routes/subscription.routes.js and the corresponding case fails on the
  // status AND on the database effect (verified by mutation, section D of the
  // mission run).
  // ------------------------------------------------------------------

  describe('K. policy 3 residual: cancel and reactivate authority (§I closed)', () => {
    /** Plant a known, unambiguous subscription state so any write is visible. */
    const plantState = (organizationId, { status, cancelAtPeriodEnd, reason }) => rows(
      `UPDATE organization_subscriptions
          SET status = $2, cancel_at_period_end = $3, cancellation_reason = $4,
              cancelled_at = CASE WHEN $3 THEN NOW() ELSE NULL END, updated_at = NOW()
        WHERE organization_id = $1`,
      [organizationId, status, cancelAtPeriodEnd, reason ?? null]);

    const cancelState = async (organizationId) => {
      const row = await subscriptionRow(organizationId);
      return {
        status: row.status,
        cancelAtPeriodEnd: row.cancel_at_period_end,
        cancelledAtSet: row.cancelled_at !== null,
        reason: row.cancellation_reason
      };
    };

    it('K1. refuses a tenant OPERATOR the cancellation request and persists nothing', async () => {
      await plantState(ORG_A, { status: 'active', cancelAtPeriodEnd: false, reason: null });
      const before = await subscriptionSnapshot(ORG_A);

      const res = await post('/api/subscriptions/cancel', { reason: 'operator attempt' }, { userId: USER_OP_A });

      assert.strictEqual(res.status, 403, 'a tenant operator must not request cancellation');
      assert.strictEqual(res.json.success, false);
      assert.match(res.json.message, /CANCEL permission required for SUBSCRIPTION/,
        'the refusal must come from the approved matrix entry, not incidentally');
      assert.strictEqual(await subscriptionSnapshot(ORG_A), before,
        'database effect: the subscription row must be byte-identical');
    });

    it('K2. refuses a tenant SUPERVISOR the cancellation request and persists nothing', async () => {
      await plantState(ORG_A, { status: 'active', cancelAtPeriodEnd: false, reason: null });
      const before = await subscriptionSnapshot(ORG_A);

      const res = await post('/api/subscriptions/cancel', { reason: 'supervisor attempt' }, { userId: USER_SUP_A });

      assert.strictEqual(res.status, 403, 'a tenant supervisor must not request cancellation');
      assert.match(res.json.message, /CANCEL permission required for SUBSCRIPTION/);
      assert.strictEqual(await subscriptionSnapshot(ORG_A), before,
        'database effect: the subscription row must be byte-identical');
    });

    it('K3. PRESERVES the sanctioned tenant cancellation request and persists it', async () => {
      await plantState(ORG_A, { status: 'active', cancelAtPeriodEnd: false, reason: null });

      const res = await post('/api/subscriptions/cancel',
        { reason: 'Sanctioned SEC104 cancellation request' }, { userId: USER_ADMIN_A });

      assert.strictEqual(res.status, 200,
        'the tenant administrator workflow views/mobile/admin/subscription.ejs performs must keep working');
      assert.strictEqual(res.json.success, true);

      const after = await cancelState(ORG_A);
      assert.strictEqual(after.cancelAtPeriodEnd, true, 'database effect: cancel_at_period_end persisted');
      assert.strictEqual(after.reason, 'Sanctioned SEC104 cancellation request',
        'database effect: the cancellation reason persisted');
      assert.strictEqual(after.cancelledAtSet, true, 'database effect: cancelled_at persisted');
      assert.strictEqual(after.status, 'active',
        'database effect: a cancellation REQUEST is not a status change');
    });

    it('K4. refuses a tenant OPERATOR reactivation of a SUSPENDED subscription and leaves it suspended (the reproduced defect)', async () => {
      await plantState(ORG_A, { status: 'suspended', cancelAtPeriodEnd: true, reason: 'independent review' });
      const before = await subscriptionSnapshot(ORG_A);

      const res = await post('/api/subscriptions/reactivate', {}, { userId: USER_OP_A });

      assert.strictEqual(res.status, 403, 'a tenant operator must not reactivate a subscription');
      assert.strictEqual(res.json.success, false);
      assert.match(res.json.message, /UPDATE permission required for SUBSCRIPTION/,
        'the refusal must come from the approved matrix entry, not incidentally');
      assert.strictEqual(await subscriptionSnapshot(ORG_A), before,
        'database effect: the row must be byte-identical — status must still be suspended');
      assert.strictEqual((await subscriptionRow(ORG_A)).status, 'suspended',
        'database effect: the operator did NOT flip status suspended -> active');
    });

    it('K5. refuses a tenant SUPERVISOR reactivation and leaves the row unchanged', async () => {
      await plantState(ORG_A, { status: 'suspended', cancelAtPeriodEnd: true, reason: 'supervisor attempt' });
      const before = await subscriptionSnapshot(ORG_A);

      const res = await post('/api/subscriptions/reactivate', {}, { userId: USER_SUP_A });

      assert.strictEqual(res.status, 403, 'a tenant supervisor must not reactivate a subscription');
      assert.match(res.json.message, /UPDATE permission required for SUBSCRIPTION/);
      assert.strictEqual(await subscriptionSnapshot(ORG_A), before,
        'database effect: the row must be byte-identical');
    });

    it('K6. admits the tenant administrator and persists the reactivation', async () => {
      await plantState(ORG_A, { status: 'suspended', cancelAtPeriodEnd: true, reason: 'to be cleared' });

      const res = await post('/api/subscriptions/reactivate', {}, { userId: USER_ADMIN_A });

      assert.strictEqual(res.status, 200, 'the tenant administrator must keep the reactivation workflow');
      const after = await cancelState(ORG_A);
      assert.strictEqual(after.status, 'active', 'database effect: status persisted as active');
      assert.strictEqual(after.cancelAtPeriodEnd, false, 'database effect: cancel_at_period_end cleared');
      assert.strictEqual(after.cancelledAtSet, false, 'database effect: cancelled_at cleared');
      assert.strictEqual(after.reason, null, 'database effect: cancellation_reason cleared');
    });

    it('K7. refuses an OPERATOR that also carries is_organization_admin = true (the flag is not authority)', async () => {
      await plantState(ORG_A, { status: 'suspended', cancelAtPeriodEnd: true, reason: 'flagged operator' });
      const before = await subscriptionSnapshot(ORG_A);

      const flagRow = await rows('SELECT is_organization_admin FROM users WHERE id = $1', [USER_OP_FLAGGED]);
      assert.strictEqual(flagRow[0].is_organization_admin, true, 'the fixture must really carry the flag');

      for (const [path, action] of [['/api/subscriptions/cancel', 'CANCEL'], ['/api/subscriptions/reactivate', 'UPDATE']]) {
        const res = await post(path, { reason: 'flagged operator' }, { userId: USER_OP_FLAGGED });
        assert.strictEqual(res.status, 403,
          `an operator with is_organization_admin=true must still be refused ${path}`);
        assert.match(res.json.message, new RegExp(`${action} permission required for SUBSCRIPTION`));
      }
      assert.strictEqual(await subscriptionSnapshot(ORG_A), before,
        'database effect: neither attempt changed the row');
    });

    it('K8. admits a granted tenant administrator (explicit grants neither help nor hinder: the matrix role is the authority)', async () => {
      await plantState(F3_ORG, { status: 'suspended', cancelAtPeriodEnd: true, reason: 'granted admin' });
      try {
        const res = await post('/api/subscriptions/reactivate', {}, { userId: F3_USER_GRANTED });

        assert.strictEqual(res.status, 200,
          'the legacy-matrix authority is role-based, so a granted administrator is admitted exactly like an un-granted one');
        assert.strictEqual((await subscriptionRow(F3_ORG)).status, 'active',
          'database effect: the granted administrator reactivated its own tenant');
      } finally {
        await plantState(F3_ORG, { status: 'active', cancelAtPeriodEnd: false, reason: null });
      }
    });

    it('K9. cannot address another tenant: a body-named foreign organization is never written', async () => {
      await plantState(ORG_A, { status: 'suspended', cancelAtPeriodEnd: true, reason: 'own tenant A' });
      await plantState(ORG_B, { status: 'suspended', cancelAtPeriodEnd: true, reason: 'foreign tenant B' });
      const beforeB = await subscriptionSnapshot(ORG_B);

      const res = await post('/api/subscriptions/reactivate',
        { organizationId: ORG_B, organization_id: ORG_B }, { userId: USER_ADMIN_A });

      assert.strictEqual(res.status, 200, 'the call resolves to the caller\u2019s own tenant');
      assert.strictEqual(await subscriptionSnapshot(ORG_B), beforeB,
        'database effect: the foreign tenant row must be byte-identical');
      assert.strictEqual((await subscriptionRow(ORG_B)).status, 'suspended',
        'database effect: a body-supplied tenant identifier is not addressable');
      assert.strictEqual((await subscriptionRow(ORG_A)).status, 'active',
        'database effect: only the caller\u2019s own tenant changed');
    });

    it('K10. refuses both writes without authentication and persists nothing', async () => {
      await plantState(ORG_A, { status: 'suspended', cancelAtPeriodEnd: true, reason: 'anonymous attempt' });
      const before = await subscriptionSnapshot(ORG_A);

      assert.strictEqual((await post('/api/subscriptions/cancel', { reason: 'anonymous' })).status, 401);
      assert.strictEqual((await post('/api/subscriptions/reactivate', {})).status, 401);

      assert.strictEqual(await subscriptionSnapshot(ORG_A), before,
        'database effect: unchanged');
    });

    it('K11. consults the approved matrix by role, not the capability resolver', () => {
      const rbac = codeOnly(path.join(REPO_ROOT, 'src', 'middleware', 'rbac.js'));
      assert.match(rbac, /const role = req\.user\?\.role/,
        'requirePermission must decide from the matrix role');
      assert.doesNotMatch(rbac, /resolveCapabilities|capability\.service/,
        'requirePermission must not consult capability resolution');

      // The authority really is enumerated in the approved matrix, and the
      // approved capability vocabulary really has no subscription capability —
      // so there is nothing a grant could confer on these two routes.
      assert.deepStrictEqual(Object.keys(PERMISSIONS.SUBSCRIPTION).sort(), ['CANCEL', 'UPDATE', 'VIEW']);
      const capabilityValues = Object.values(CAPABILITIES);
      assert.ok(!capabilityValues.some((c) => c.includes('subscription')),
        'no approved capability may name subscription authority');
    });
  });

  // ------------------------------------------------------------------
  // G. Non-regression
  // ------------------------------------------------------------------

  describe('G. preserved behaviour', () => {
    it('G1. keeps the public signup directory public and minimal', async () => {
      const res = await get('/api/organizations/public');
      assert.strictEqual(res.status, 200, 'the pre-auth signup directory must keep working');

      const listed = res.json.data.organizations.find((o) => Number(o.id) === ORG_A);
      assert.ok(listed, 'a freshly created organization must appear for signup');
      assert.deepStrictEqual(Object.keys(listed).sort(), ['id', 'organization_name'],
        'the public directory must expose no subscription, capacity or contact field');
    });

    it('G2. keeps the authenticated organization reads reachable', async () => {
      for (const userId of [USER_OP_A, USER_SUP_A, USER_ADMIN_A]) {
        assert.strictEqual((await get('/api/organizations/my', { userId })).status, 200);
        assert.strictEqual((await get(`/api/organizations/${ORG_A}`, { userId })).status, 200);
      }
    });

    it('G3. leaves the organization tables intact (no schema change in this mission)', async () => {
      const columns = await rows(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'organizations'`);
      const names = columns.map((c) => c.column_name);
      for (const required of ['id', 'organization_name', 'subscription_plan', 'subscription_status',
        'max_users', 'max_facilities', 'max_equipment', 'logo_url']) {
        assert.ok(names.includes(required), `organizations must still have ${required}`);
      }
    });
  });
});

/** Whole-body containment check (never a hand-picked field list). */
function resContains(res, needle) {
  return typeof res.text === 'string' && res.text.includes(needle);
}
