/**
 * ATM-001-SEC-LEGACY-01-R1 — GET /api/users/:id authorization, tenant isolation
 * and sensitive-field protection.
 *
 * Reported defect: `GET /api/users/:id` was guarded only by `canManageUser`,
 * which admitted an operator with no ownership check at all and an
 * administrator with no organization check, and its handler returned the raw
 * `SELECT *` row - including `password_hash`.
 *
 * Evidence policy: the HTTP layer is exercised against the real Express app with
 * real JWTs and a real disposable PostgreSQL database, so authentication,
 * routing, permission resolution, middleware order and the serialised payload
 * are production-shaped rather than simulated. Where a claim is about what is
 * ABSENT, the assertion is made against the serialised response body, not
 * against a hand-picked field list.
 *
 * Negative controls: sections A and B assert the behaviours the pre-fix code
 * violated - an operator reading any record, an administrator reading another
 * tenant's record, and a response carrying `password_hash`. Run against the
 * unfixed code these tests fail; that is the regression suite's own proof that
 * it detects the reported vulnerability (see the mission report).
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * src/config/database.js uses to select test-database credentials, so it can
 * never run against runtime credentials.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { getConnection, isIntegrationTest } = require('../src/config/database');
const { getRolePermissions } = require('../src/config/permissions');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating user-route suite requires the sanctioned database-test '
    + 'gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that test-database '
    + 'credentials are used instead of runtime credentials; run it via '
    + '`npm run test:integration`';

const JWT_SECRET = 'test-only-jwt-secret-not-for-production-000000';
const REPO_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
// Every identifier is uniquely tagged per run, so this suite is safe on a
// long-lived shared test database and cannot collide with another suite.

const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`;
const seq = { n: 0 };
const tag = () => `${RUN}${(++seq.n).toString(36)}`;

/**
 * A bcrypt-shaped, byte-unique password hash per fixture user. Because each
 * value is unique, "this response carries no credential material" is asserted
 * literally against the serialised body rather than against a field name.
 */
const hashFor = (key) => `$2a$04$${`${RUN}${key}`.padEnd(53, 'y').slice(0, 53)}`;

const USERS = {};   // fixture key -> users.id
const HASHES = {};  // fixture key -> that user's password_hash value

let ORG_A = null;
let ORG_B = null;
let FAC_A1 = null;
let FAC_A2 = null;
let FAC_B1 = null;

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

async function insertUser(conn, key, options) {
  const {
    organizationId = null, role, facilityId = null,
    isOrganizationAdmin = false, isActive = true, status = 'active'
  } = options;
  const marker = hashFor(key);
  const handle = `sec-${key.toLowerCase()}-${tag()}`;
  const rows = await conn.query(
    `INSERT INTO users (organization_id, username, email, password_hash, full_name,
                        role, facility_id, is_active, status, is_organization_admin)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [organizationId, handle, `${handle}@test.local`, marker, `SEC ${key}`,
      role, facilityId, isActive, status, isOrganizationAdmin]);
  USERS[key] = Number(rows[0].id);
  HASHES[key] = marker;
  return USERS[key];
}

async function ensureFixture() {
  await withConn(async (conn) => {
    const orgs = await conn.query(
      `INSERT INTO organizations (organization_name, subscription_status)
       VALUES ($1, 'active'), ($2, 'active') RETURNING id`,
      [`SEC Org A ${RUN}`, `SEC Org B ${RUN}`]);
    [ORG_A, ORG_B] = orgs.map((row) => Number(row.id));

    const facilities = await conn.query(
      `INSERT INTO facilities (organization_id, name, code, facility_type)
       VALUES ($1, 'SEC Facility A1', $3, 'WTP'),
              ($1, 'SEC Facility A2', $4, 'WTP'),
              ($2, 'SEC Facility B1', $5, 'WTP')
       RETURNING id`,
      [ORG_A, ORG_B, `FA1-${tag()}`, `FA2-${tag()}`, `FB1-${tag()}`]);
    [FAC_A1, FAC_A2, FAC_B1] = facilities.map((row) => Number(row.id));

    // The create-user workflow is only reachable behind seat validation, so the
    // tenant under test needs an active subscription exactly as production does.
    const plan = await conn.query(
      `INSERT INTO subscription_plans (plan_code, plan_name, included_users, max_users)
       VALUES ($1, 'SEC Plan', 50, NULL) RETURNING id`,
      [`SEC-${tag()}`]);
    await conn.query(
      `INSERT INTO organization_subscriptions (organization_id, plan_id, included_users, status)
       VALUES ($1, $2, 50, 'active')`,
      [ORG_A, Number(plan[0].id)]);

    await insertUser(conn, 'ADMIN_A', { organizationId: ORG_A, role: 'admin', isOrganizationAdmin: true });
    await insertUser(conn, 'SUP_A1', { organizationId: ORG_A, role: 'supervisor', facilityId: FAC_A1 });
    await insertUser(conn, 'SUP_A2', { organizationId: ORG_A, role: 'supervisor', facilityId: FAC_A2 });
    await insertUser(conn, 'SUP_NO_FACILITY', { organizationId: ORG_A, role: 'supervisor' });
    await insertUser(conn, 'OPER_A1', { organizationId: ORG_A, role: 'operator', facilityId: FAC_A1 });
    await insertUser(conn, 'OPER_A2', { organizationId: ORG_A, role: 'operator', facilityId: FAC_A2 });
    await insertUser(conn, 'DOOMED_A', { organizationId: ORG_A, role: 'operator', facilityId: FAC_A1 });
    await insertUser(conn, 'ADMIN_NO_ORG', { organizationId: null, role: 'admin', isOrganizationAdmin: true });
    await insertUser(conn, 'ORPHAN_NO_ORG', { organizationId: null, role: 'operator' });
    await insertUser(conn, 'ADMIN_B', { organizationId: ORG_B, role: 'admin', isOrganizationAdmin: true });
    await insertUser(conn, 'OPER_B1', { organizationId: ORG_B, role: 'operator', facilityId: FAC_B1 });
    await insertUser(conn, 'INACTIVE_B', { organizationId: ORG_B, role: 'operator', isActive: false, status: 'suspended' });
  });
}

async function cleanupFixture() {
  try {
    await withConn(async (conn) => {
      const userIds = Object.values(USERS);
      if (userIds.length) {
        await conn.query(
          `DELETE FROM users WHERE id = ANY($1::int[])`, [userIds]);
      }
      const orgIds = [ORG_A, ORG_B].filter((id) => id !== null);
      if (orgIds.length) {
        await conn.query(`DELETE FROM organization_subscriptions WHERE organization_id = ANY($1::int[])`, [orgIds]);
        await conn.query(`DELETE FROM facilities WHERE organization_id = ANY($1::int[])`, [orgIds]);
        await conn.query(`DELETE FROM organizations WHERE id = ANY($1::int[])`, [orgIds]);
      }
      await conn.query(`DELETE FROM subscription_plans WHERE plan_code LIKE $1`, [`SEC-${RUN}%`]);
    });
  } catch {
    // Test-database hygiene only: the database is disposable, so a cleanup
    // refusal must never mask the security assertions above.
  }
}

// ---------------------------------------------------------------------------
// HTTP harness — the real application, real JWTs
// ---------------------------------------------------------------------------

let server = null;
let port = null;

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
      res.on('end', () => resolve({ status: res.statusCode, text: data }));
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

const asUser = (key) => (method, requestPath, options = {}) =>
  call(method, requestPath, { userId: USERS[key], ...options });

const getAs = (key, requestPath) => asUser(key)('GET', requestPath);

/** Every credential value this suite created. None may appear in any response. */
function assertNoCredentialMaterial(response, label) {
  for (const [key, marker] of Object.entries(HASHES)) {
    assert.ok(!response.text.includes(marker),
      `${label}: the response must not carry ${key}'s password hash`);
  }
  assert.ok(!/password_hash/i.test(response.text),
    `${label}: the response must not mention a password_hash field`);
}

/** No identity belonging to the other tenant may appear in a denied response. */
function assertNoForeignTenantIdentity(response, label) {
  for (const key of ['ADMIN_B', 'OPER_B1', 'INACTIVE_B']) {
    assert.ok(!response.text.includes(`sec-${key.toLowerCase()}-`),
      `${label}: a tenant B username/email must not be disclosed`);
    assert.ok(!response.text.includes(`SEC ${key}`),
      `${label}: a tenant B full name must not be disclosed`);
  }
  assert.ok(!response.text.includes(`SEC Org B ${RUN}`),
    `${label}: the other organization name must not be disclosed`);
}

// ==========================================================================

describe('ATM-001-SEC-LEGACY-01-R1 GET /api/users/:id authorization and disclosure', { skip: DB_TEST_SKIP_REASON }, () => {
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

  // ------------------------------------------------- required test 1: anonymous
  describe('A. unauthenticated access is rejected', () => {
    it('1. an anonymous request to GET /api/users/:id is 401 and carries no record', async () => {
      const response = await call('GET', `/api/users/${USERS.OPER_A1}`);
      assert.strictEqual(response.status, 401);
      assertNoCredentialMaterial(response, 'anonymous GET /:id');
      assert.ok(!response.text.includes(`SEC OPER_A1`), 'no record payload may be disclosed');
    });

    it('2. an invalid or expired bearer token is 401', async () => {
      const forged = await new Promise((resolve, reject) => {
        const req = http.request({
          host: '127.0.0.1', port, method: 'GET', path: `/api/users/${USERS.OPER_A1}`,
          headers: { Authorization: 'Bearer not-a-real-token' }
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => resolve({ status: res.statusCode, text: data }));
        });
        req.on('error', reject);
        req.end();
      });
      assert.strictEqual(forged.status, 401);
      assertNoCredentialMaterial(forged, 'forged-token GET /:id');
    });
  });

  // --------------------------- required tests 2, 3: the permission contract
  describe('B. the approved USERS.VIEW permission contract is enforced', () => {
    it('3. an operator (USERS.VIEW = none) is denied on its own record', async () => {
      const response = await getAs('OPER_A1', `/api/users/${USERS.OPER_A1}`);
      assert.strictEqual(response.status, 403,
        'NEGATIVE CONTROL: the pre-fix code returned 200 with the full row here');
      assertNoCredentialMaterial(response, 'operator self-read');
    });

    it('4. an operator is denied on another user in the same tenant', async () => {
      const response = await getAs('OPER_A1', `/api/users/${USERS.OPER_A2}`);
      assert.strictEqual(response.status, 403,
        'NEGATIVE CONTROL: the pre-fix code returned another tenant member\'s full row');
      assertNoCredentialMaterial(response, 'operator cross-user read');
    });

    it('5. an operator is denied on another tenant\'s record', async () => {
      const response = await getAs('OPER_A1', `/api/users/${USERS.OPER_B1}`);
      assert.strictEqual(response.status, 403);
      assertNoForeignTenantIdentity(response, 'operator cross-tenant read');
      assertNoCredentialMaterial(response, 'operator cross-tenant read');
    });

    it('6. an authorized administrator still reads a same-tenant record', async () => {
      const response = await getAs('ADMIN_A', `/api/users/${USERS.OPER_A1}`);
      assert.strictEqual(response.status, 200);
      const body = JSON.parse(response.text);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.user.id, USERS.OPER_A1);
      assert.strictEqual(body.data.user.role, 'operator');
    });

    it('7. an authorized administrator still reads its own record', async () => {
      const response = await getAs('ADMIN_A', `/api/users/${USERS.ADMIN_A}`);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(JSON.parse(response.text).data.user.id, USERS.ADMIN_A);
    });

    it('8. a supervisor reads a user in its own facility and its own record', async () => {
      const sameFacility = await getAs('SUP_A1', `/api/users/${USERS.OPER_A1}`);
      assert.strictEqual(sameFacility.status, 200);
      assert.strictEqual(JSON.parse(sameFacility.text).data.user.id, USERS.OPER_A1);

      const self = await getAs('SUP_A1', `/api/users/${USERS.SUP_A1}`);
      assert.strictEqual(self.status, 200);
      assert.strictEqual(JSON.parse(self.text).data.user.id, USERS.SUP_A1);
    });

    it('8b. an operator still reads its own profile through the sanctioned self-profile endpoint', async () => {
      // Denying operators on GET /api/users/:id is the approved permission
      // contract (USERS.VIEW = none), so the legitimate self-read workflow must
      // survive somewhere. That workflow is GET /api/auth/profile, which requires
      // only authentication and returns an explicitly sanitized record. This
      // proves the denial above removes no legitimate workflow.
      const response = await getAs('OPER_A1', '/api/auth/profile');
      assert.strictEqual(response.status, 200, 'the operator self-profile workflow must still work');
      const body = JSON.parse(response.text);
      assert.strictEqual(body.data.user.id, USERS.OPER_A1);
      assert.ok(!('password_hash' in body.data.user));
      assertNoCredentialMaterial(response, 'operator GET /api/auth/profile');
    });
  });

  // ------------------------------- required test 4: tenant isolation
  describe('C. tenant isolation', () => {
    it('9. an administrator cannot read another tenant\'s user', async () => {
      const response = await getAs('ADMIN_A', `/api/users/${USERS.OPER_B1}`);
      assert.strictEqual(response.status, 404,
        'NEGATIVE CONTROL: the pre-fix code returned 200 with tenant B\'s full row');
      assertNoForeignTenantIdentity(response, 'admin cross-tenant read');
      assertNoCredentialMaterial(response, 'admin cross-tenant read');
    });

    it('10. an administrator identity is not a cross-tenant grant', async () => {
      const response = await getAs('ADMIN_A', `/api/users/${USERS.ADMIN_B}`);
      assert.strictEqual(response.status, 404,
        'administrator role must not confer cross-organization access');
      assertNoCredentialMaterial(response, 'admin-to-admin cross-tenant read');
    });

    it('11. a supervisor cannot cross the tenant boundary', async () => {
      const response = await getAs('SUP_A1', `/api/users/${USERS.OPER_B1}`);
      assert.strictEqual(response.status, 404);
      assertNoCredentialMaterial(response, 'supervisor cross-tenant read');
    });

    it('12. a supervisor cannot read another facility in its own tenant', async () => {
      const response = await getAs('SUP_A1', `/api/users/${USERS.OPER_A2}`);
      assert.strictEqual(response.status, 404);
      assertNoCredentialMaterial(response, 'supervisor cross-facility read');
    });

    it('13. a caller with no organization fails closed', async () => {
      const own = await getAs('ADMIN_NO_ORG', `/api/users/${USERS.ADMIN_NO_ORG}`);
      assert.strictEqual(own.status, 200, 'a principal may still read its own record');

      const foreign = await getAs('ADMIN_NO_ORG', `/api/users/${USERS.OPER_A1}`);
      assert.strictEqual(foreign.status, 404, 'no organization means no tenant scope');

      const orphan = await getAs('ADMIN_A', `/api/users/${USERS.ORPHAN_NO_ORG}`);
      assert.strictEqual(orphan.status, 404, 'a record with no organization is not in the caller\'s tenant');
    });

    it('14. a denied cross-tenant request is indistinguishable from a missing record', async () => {
      const existing = await getAs('ADMIN_A', `/api/users/${USERS.OPER_B1}`);
      const missing = await getAs('ADMIN_A', '/api/users/2147483647');

      assert.strictEqual(existing.status, 404);
      assert.strictEqual(missing.status, 404);
      assert.deepStrictEqual(JSON.parse(existing.text), JSON.parse(missing.text),
        'status AND body must be identical, or the endpoint is an existence oracle');

      // The same must hold inside the caller's own tenant but outside the
      // caller's facility: "not yours" must not be distinguishable from "absent".
      const otherFacility = await getAs('SUP_A1', `/api/users/${USERS.OPER_A2}`);
      const supMissing = await getAs('SUP_A1', '/api/users/2147483647');
      assert.strictEqual(otherFacility.status, 404);
      assert.deepStrictEqual(JSON.parse(otherFacility.text), JSON.parse(supMissing.text));
    });

    it('14b. a supervisor with no facility cannot distinguish an existing same-tenant record from an absent one', async () => {
      // Adversarial challenge finding F3: the "no facility assigned" denial is
      // decided from the caller's own state before the record lookup, so it is
      // emitted identically for every non-self identifier and reveals nothing
      // about whether a record exists.
      const existing = await getAs('SUP_NO_FACILITY', `/api/users/${USERS.OPER_A1}`);
      const crossTenant = await getAs('SUP_NO_FACILITY', `/api/users/${USERS.OPER_B1}`);
      const missing = await getAs('SUP_NO_FACILITY', '/api/users/2147483647');

      assert.strictEqual(existing.status, 403);
      assert.strictEqual(crossTenant.status, 403);
      assert.strictEqual(missing.status, 403);
      assert.deepStrictEqual(JSON.parse(existing.text), JSON.parse(missing.text));
      assert.deepStrictEqual(JSON.parse(crossTenant.text), JSON.parse(missing.text));
      assertNoCredentialMaterial(existing, 'no-facility supervisor read');

      // A supervisor with no facility may still read its own record.
      const self = await getAs('SUP_NO_FACILITY', `/api/users/${USERS.SUP_NO_FACILITY}`);
      assert.strictEqual(self.status, 200);
      assert.strictEqual(JSON.parse(self.text).data.user.id, USERS.SUP_NO_FACILITY);
    });
  });

  // ------------------- required tests 6, 7: sensitive-field protection
  describe('D. sensitive-field protection', () => {
    it('15. a successful single-user response carries no password_hash', async () => {
      const response = await getAs('ADMIN_A', `/api/users/${USERS.OPER_A1}`);
      assert.strictEqual(response.status, 200);
      assertNoCredentialMaterial(response, 'admin GET /:id');

      const user = JSON.parse(response.text).data.user;
      assert.ok(!('password_hash' in user), 'the field must be absent, not merely empty');
      assert.strictEqual(user.id, USERS.OPER_A1);
      assert.strictEqual(user.role, 'operator');
      assert.ok(user.username.startsWith('sec-oper_a1-'), 'the ordinary record fields must survive');
    });

    it('16. the user list response carries no credential material', async () => {
      const response = await getAs('ADMIN_A', '/api/users');
      assert.strictEqual(response.status, 200);
      assertNoCredentialMaterial(response, 'admin GET /api/users');

      const users = JSON.parse(response.text).data.users;
      assert.ok(Array.isArray(users) && users.length > 0, 'the list workflow must still return users');
      for (const user of users) {
        assert.ok(!('password_hash' in user), 'no listed user may carry password_hash');
      }
    });

    it('17. the facility operator list carries no credential material', async () => {
      const response = await getAs('SUP_A1', '/api/users/facility/operators');
      assert.strictEqual(response.status, 200);
      assertNoCredentialMaterial(response, 'supervisor GET /facility/operators');

      const users = JSON.parse(response.text).data.users;
      assert.ok(users.length > 0, 'the assignment workflow must still return operators');
      for (const user of users) {
        assert.ok(!('password_hash' in user), 'no listed operator may carry password_hash');
      }
    });

    it('18. the create-user response carries no credential material', async () => {
      const handle = `sec-created-${tag()}`;
      const response = await asUser('ADMIN_A')('POST', '/api/users', {
        body: {
          username: handle,
          email: `${handle}@test.local`,
          password: 'fixture-password-not-a-secret',
          full_name: 'SEC Created User',
          role: 'operator',
          facility_id: FAC_A1
        }
      });

      assert.strictEqual(response.status, 201, `create must still work: ${response.text}`);
      assertNoCredentialMaterial(response, 'admin POST /api/users');

      const returned = JSON.parse(response.text).data.user;
      // `User.create` resolves the inserted row through BaseModel.create, which
      // cannot obtain an id from a plain INSERT on the PostgreSQL adapter, so the
      // returned record may legitimately be null. That pre-existing adapter gap is
      // recorded as an observation; what this remediation guarantees is that a
      // returned record never carries credential material.
      if (returned) {
        assert.ok(!('password_hash' in returned), 'the created record must be returned sanitized');
      }

      // Read the created row back through the database to obtain the real
      // credential value, then prove the GET path does not disclose it.
      const rows = await withConn((conn) => conn.query(
        `SELECT id, password_hash FROM users WHERE username = $1`, [handle]));
      assert.strictEqual(rows.length, 1, 'the create workflow must still persist the user');

      const createdId = Number(rows[0].id);
      const storedHash = rows[0].password_hash;
      assert.ok(storedHash && storedHash.startsWith('$2'),
        'the fixture user must have a real bcrypt hash stored');

      USERS.CREATED_A = createdId;
      HASHES.CREATED_A = storedHash;

      const single = await getAs('ADMIN_A', `/api/users/${createdId}`);
      assert.strictEqual(single.status, 200);
      assert.ok(!single.text.includes(storedHash), 'a stored bcrypt hash must never be returned');
      assertNoCredentialMaterial(single, 'GET of the created user');
    });

    it('19. the update-user response carries no credential material', async () => {
      const response = await asUser('ADMIN_A')('PUT', `/api/users/${USERS.OPER_A1}`, {
        body: { full_name: `SEC OPER_A1 renamed ${RUN}` }
      });

      assertNoCredentialMaterial(response, 'admin PUT /api/users/:id');

      // A successful response must be sanitized. The route's success branch
      // applies sanitizeUser explicitly and the router-level guard backstops it;
      // the end-to-end 200 is not asserted here because PUT currently fails
      // before its response for a pre-existing, unrelated reason (see test 28).
      if (response.status === 200) {
        assert.ok(!('password_hash' in JSON.parse(response.text).data.user),
          'a successful update response must not carry password_hash');
      }
    });

    it('20. error responses carry no credential material', async () => {
      const responses = [
        ['anonymous 401', await call('GET', `/api/users/${USERS.OPER_A1}`)],
        ['forbidden 403', await getAs('OPER_A1', `/api/users/${USERS.OPER_A1}`)],
        ['cross-tenant 404', await getAs('ADMIN_A', `/api/users/${USERS.OPER_B1}`)],
        ['invalid id 404', await getAs('ADMIN_A', '/api/users/not-a-number')],
        ['unknown route 404', await getAs('ADMIN_A', '/api/users/1/definitely-not-a-route')]
      ];

      for (const [label, response] of responses) {
        assert.ok(response.status >= 400 && response.status < 500, `${label}: expected a 4xx, got ${response.status}`);
        assertNoCredentialMaterial(response, `error path (${label})`);
        assertNoForeignTenantIdentity(response, `error path (${label})`);
      }
    });

    it('21. the JSON error handler never echoes the authenticated principal row', async () => {
      const response = await getAs('ADMIN_A', '/api/users/1/definitely-not-a-route');
      assert.strictEqual(response.status, 404);
      const body = JSON.parse(response.text);
      assert.deepStrictEqual(Object.keys(body).sort(), ['message', 'success']);
      assertNoCredentialMaterial(response, 'unmatched user route');
    });
  });

  // ----------------------------- required test 8: invalid identifiers
  describe('E. invalid identifiers fail safely', () => {
    const INVALID = [
      ['non-numeric', 'not-a-number'],
      ['zero', '0'],
      ['negative', '-1'],
      ['fractional', '1.5'],
      ['expression', '1%3BDROP%20TABLE%20users'],
      ['out of integer range', '99999999999999999999999'],
      ['above INTEGER max', '2147483648'],
      ['blank', '%20']
    ];

    for (const [label, value] of INVALID) {
      it(`22. rejects an ${label} identifier with a clean 404`, async () => {
        const response = await getAs('ADMIN_A', `/api/users/${value}`);
        assert.strictEqual(response.status, 404, `${label} must not reach the database as an error`);
        assertNoCredentialMaterial(response, `invalid identifier (${label})`);
      });
    }

    it('23. every invalid identifier produces the identical 404 as an absent record', async () => {
      const baseline = JSON.parse((await getAs('ADMIN_A', '/api/users/2147483647')).text);
      for (const [, value] of INVALID) {
        const response = await getAs('ADMIN_A', `/api/users/${value}`);
        assert.deepStrictEqual(JSON.parse(response.text), baseline,
          `identifier "${value}" must be indistinguishable from an absent record`);
      }
    });
  });

  // --------------------------- required test 9: no workflow regression
  describe('F. existing user-management workflows do not regress', () => {
    it('24. the administrator user list still returns only its own tenant', async () => {
      const response = await getAs('ADMIN_A', '/api/users');
      assert.strictEqual(response.status, 200);
      const users = JSON.parse(response.text).data.users;
      assert.ok(users.some((user) => user.id === USERS.OPER_A1), 'tenant A users must still be listed');
      assertNoForeignTenantIdentity(response, 'admin user list');
      assert.ok(!users.some((user) => user.id === USERS.OPER_B1), 'tenant B users must not be listed');
    });

    it('25. the supervisor user list is still facility-scoped', async () => {
      const response = await getAs('SUP_A1', '/api/users');
      assert.strictEqual(response.status, 200);
      const users = JSON.parse(response.text).data.users;
      assert.ok(users.some((user) => user.id === USERS.OPER_A1));
      assert.ok(!users.some((user) => user.id === USERS.OPER_A2), 'another facility must not be listed');
    });

    it('26. the facility operator list is still facility-scoped', async () => {
      const response = await getAs('SUP_A1', '/api/users/facility/operators');
      assert.strictEqual(response.status, 200);
      const users = JSON.parse(response.text).data.users;
      assert.ok(users.some((user) => user.id === USERS.OPER_A1));
      assert.ok(!users.some((user) => user.id === USERS.OPER_A2));
    });

    it('27. the legacy permission matrix presentation is unchanged', async () => {
      const response = await getAs('OPER_A1', '/api/users/me/permissions');
      assert.strictEqual(response.status, 200);
      const body = JSON.parse(response.text);
      assert.strictEqual(body.data.role, 'operator');
      assert.deepStrictEqual(body.data.permissions, getRolePermissions('operator'),
        'response redaction must not alter the approved permission presentation');
    });

    it('28. the PUT route behaves exactly as the pre-fix baseline did', async () => {
      // PRE-EXISTING DEFECT, verified on origin/main and NOT introduced here:
      // user.routes.js declares its body as
      //   { username, email, full_name, role, facility_id, is_active, password, is_organization_admin }
      // but the reactivation check then reads an undeclared `status`, so every
      // PUT /api/users/:id throws ReferenceError before any response is built.
      // This remediation changes only the response sanitisation of that route, so
      // the observable behaviour must be unchanged: either the same pre-existing
      // failure, or - if the defect is repaired independently - a sanitized 200.
      const response = await asUser('ADMIN_A')('PUT', `/api/users/${USERS.OPER_A2}`, {
        body: { full_name: `SEC OPER_A2 renamed ${RUN}` }
      });

      assertNoCredentialMaterial(response, 'admin PUT /api/users/:id');

      if (response.status === 200) {
        assert.strictEqual(JSON.parse(response.text).data.user.full_name, `SEC OPER_A2 renamed ${RUN}`);
      } else {
        assert.strictEqual(response.status, 500, 'the pre-existing failure must not become a different failure');
        assert.match(response.text, /status is not defined/,
          'the pre-existing PUT defect must be reported, not masked');
      }
    });

    it('29. the administrator delete workflow still works', async () => {
      const response = await asUser('ADMIN_A')('DELETE', `/api/users/${USERS.DOOMED_A}`);
      assert.strictEqual(response.status, 200, `delete must still work: ${response.text}`);
      assert.strictEqual(JSON.parse(response.text).success, true);
      assertNoCredentialMaterial(response, 'admin DELETE /api/users/:id');
    });
  });

  // ----------------------- required test 10: adjacent exposure assessment
  describe('G. adjacent endpoint exposure is assessed, not assumed', () => {
    it('30. every user-record response produced by this router is credential-free', async () => {
      const observed = [
        ['GET /api/users', await getAs('ADMIN_A', '/api/users')],
        ['GET /api/users as supervisor', await getAs('SUP_A1', '/api/users')],
        ['GET /api/users/facility/operators', await getAs('SUP_A1', '/api/users/facility/operators')],
        ['GET /api/users/:id', await getAs('ADMIN_A', `/api/users/${USERS.SUP_A1}`)],
        ['GET /api/users/me/permissions', await getAs('ADMIN_A', '/api/users/me/permissions')],
        ['GET /api/users/me/capabilities', await getAs('ADMIN_A', '/api/users/me/capabilities')]
      ];

      for (const [label, response] of observed) {
        assert.ok(response.status < 400, `${label} must be reachable for an administrator`);
        assertNoCredentialMaterial(response, label);
      }
    });

    it('31. the deferred PUT and DELETE authorization findings are recorded, not silently changed', () => {
      // ATM-001-SEC-LEGACY-01-R1 is bounded to the reported GET endpoint plus
      // response sanitisation. PUT and DELETE share legacy guards whose repair is
      // a separate authorization/business-rule decision, so they must be recorded
      // as open findings and left observably unchanged rather than silently
      // altered or silently ignored.
      const source = fs.readFileSync(path.join(REPO_ROOT, 'src', 'routes', 'user.routes.js'), 'utf8');

      assert.match(source, /router\.put\('\/:id', canManageUser,/,
        'the PUT guard must not be changed silently inside this remediation');
      assert.match(source, /router\.delete\('\/:id', requireAdmin,/,
        'the DELETE guard must not be changed silently inside this remediation');

      const recorded = source.match(/ATM-001-SEC-LEGACY-01-R1 FINDING/g) || [];
      assert.ok(recorded.length >= 2,
        `both the PUT and the DELETE open findings must be documented in place (found ${recorded.length})`);
      assert.match(source, /USERS\.DELETE/, 'the DELETE finding must name the contract it departs from');

      assert.match(source, /router\.get\('\/:id', requirePermission\('USERS', 'VIEW'\), canViewUser,/,
        'the reported GET endpoint must carry both the permission gate and the tenant guard');
    });

    it('32. the router-level response guard is present as defence in depth', () => {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'src', 'routes', 'user.routes.js'), 'utf8');
      assert.match(source, /redactSensitiveFields/,
        'the router must apply the redaction primitive');
      assert.match(source, /res\.json = \(body\) =>/,
        'the router must intercept res.json so a future handler cannot leak by omission');
      // The PUT success branch cannot be reached end to end while the
      // pre-existing `status` defect stands, so its explicit sanitisation is
      // asserted structurally: GET, POST and PUT each sanitize the single record.
      const explicit = source.match(/sanitizeUser\(user\)/g) || [];
      assert.ok(explicit.length >= 3,
        `every single-record response branch must sanitize explicitly (found ${explicit.length})`);
    });
  });
});
