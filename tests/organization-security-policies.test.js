/**
 * ATM-001-SEC-104 — the five OWNER-approved V1 organization security policies.
 *
 *   1. Organization creation is restricted to `platform.admin`.
 *   2. Organization profile updates require `org.config_admin` AND strict tenant
 *      scope (the caller's own organization only).
 *   3. Tenant administrators cannot change subscription or capacity fields: the
 *      writable profile columns are an explicit allowlist and
 *      `subscription_*`, `max_*` and the primary key are unrepresentable.
 *   4. Tenant isolation covers organization reading, listing, statistics and
 *      logo management.
 *   5. Direct organization deletion is disabled (fail-closed), preserving
 *      ATM-001-SEC-00C / PR #88 containment intent.
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
 * Explicit capability grants are deliberately NOT created here: migration 022
 * makes a grant a permanent record (DELETE raises by trigger), so a suite that
 * created one could never clean it up. Capability resolution — including
 * explicit-grant precedence — is covered by tests/capability-grants.test.js;
 * this suite proves the route-level authority this mission changed, using the
 * legacy-role bundles that every V1 principal without a grant actually resolves
 * through.
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
  CAPABILITIES, V1_HUMAN_GRANTABLE, NON_HUMAN_GRANTABLE, LEGACY_COMPATIBILITY_BUNDLES
} = require('../src/config/capabilities');
const { resolveCapabilities } = require('../src/services/capability.service');
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

let USER_OP_A = null;      // operator,   ORG_A
let USER_SUP_A = null;     // supervisor, ORG_A, is_organization_admin = true
let USER_ADMIN_A = null;   // admin,      ORG_A, is_organization_admin = true
let USER_ADMIN_B = null;   // admin,      ORG_B, is_organization_admin = true
let USER_OP_B = null;      // operator,   ORG_B

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
              ($2, $7, $7, 'x', 'SEC104 Operator B', 'operator', true, false)
       RETURNING id`,
      [ORG_A, ORG_B,
        `sec104-${RUN}-op-a@test.local`, `sec104-${RUN}-sup-a@test.local`,
        `sec104-${RUN}-admin-a@test.local`, `sec104-${RUN}-admin-b@test.local`,
        `sec104-${RUN}-op-b@test.local`]);
    [USER_OP_A, USER_SUP_A, USER_ADMIN_A, USER_ADMIN_B, USER_OP_B] = users.map((row) => Number(row.id));

    // A paid plan for both tenants, so the logo route's own paid-plan admission
    // is satisfied and the capability gate is the only thing under test.
    const plans = await conn.query(
      `INSERT INTO subscription_plans (plan_code, plan_name, base_price, max_facilities, max_equipment)
       VALUES ($1, 'SEC104 Pro', 10.00, 20, 200) RETURNING id`,
      [`sec104-${RUN}-pro`]);
    PLAN_ID = Number(plans[0].id);

    for (const orgId of [ORG_A, ORG_B]) {
      await conn.query(
        `INSERT INTO organization_subscriptions (organization_id, plan_id, status, base_price)
         VALUES ($1, $2, 'active', 10.00)`,
        [orgId, PLAN_ID]);
    }
  });
}

async function cleanupFixture() {
  await withConn(async (conn) => {
    // Prefix-based, so rows left behind by an unexpectedly successful write
    // (which is exactly what the negative control produces) are removed too.
    await conn.query(
      `DELETE FROM organization_subscriptions
        WHERE organization_id IN (SELECT id FROM organizations WHERE organization_name LIKE $1)`,
      [`${TAG}%`]);
    await conn.query('DELETE FROM subscription_plans WHERE plan_code LIKE $1', [`sec104-${RUN}%`]);
    await conn.query('DELETE FROM users WHERE username LIKE $1', [`sec104-${RUN}%`]);
    await conn.query(
      `DELETE FROM organizations
        WHERE organization_name LIKE $1
           OR organization_name LIKE $2`,
      [`${TAG}%`, `sec104-${RUN}%`]);
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
