/**
 * ATM-001-SEC-00D — POST /api/auth/register role-assignment authority.
 *
 * Reported defect: the route was guarded by `requireAdmin` alone, which admits a
 * supervisor (src/middleware/auth.js) and does not distinguish an organization
 * administrator from a plain administrator. The handler then took `role` from
 * the request body and persisted it, so a supervisor — or an administrator with
 * `is_organization_admin = false` — could create an ADMINISTRATOR account, with
 * a password of their own choosing, inside their own organization.
 *
 * The approved role-assignment authority already exists in this codebase as
 * `canCreateUser` (src/middleware/rbac.js) and `POST /api/users` already applies
 * it. This suite asserts that `POST /api/auth/register` applies the same
 * authority and invents no new one:
 *
 *   - a supervisor may create only `operator`, and must be assigned to a facility;
 *   - creating an `admin` requires `is_organization_admin` on the caller;
 *   - an operator may not create users at all;
 *   - the tenant is always the caller's own organization, never the request body.
 *
 * Evidence policy: the real Express app is exercised over real HTTP with real
 * JWTs against a real disposable PostgreSQL database, so authentication,
 * routing, middleware order and permission resolution are production-shaped.
 * Every claim about what did NOT happen is asserted against the database rows
 * themselves, not against the response body.
 *
 * NEGATIVE CONTROL: section A asserts the behaviours the pre-fix code violates.
 * Run unchanged against the unfixed baseline, a supervisor and a plain
 * administrator both create an administrator — those tests FAIL. That is this
 * suite's own proof that it detects the reported vulnerability.
 *
 * PRE-EXISTING DEFECT, deliberately not repaired here (D-1): `BaseModel.create`
 * issues its INSERT without `RETURNING`, so it returns null and the 201 branch
 * cannot serialise. Authorized creations therefore assert the DATABASE EFFECT
 * rather than a 201 status. Fixing D-1 is a separate bounded task and would turn
 * these responses into 201 without any change to the authorization outcome.
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * `src/config/database.js` uses to select test-database credentials, so it can
 * never run against runtime credentials.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { getConnection, isIntegrationTest } = require('../src/config/database');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating register-authorization suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'test-database credentials are used instead of runtime credentials; run it '
    + 'via `npm run test:integration`';

const JWT_SECRET = 'test-only-jwt-secret-not-for-production-000000';
const REPO_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Fixtures — every identifier is uniquely tagged per run, so this suite is safe
// on a long-lived shared test database and cannot collide with another suite.
// ---------------------------------------------------------------------------

const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`;
const seq = { n: 0 };
const tag = () => `${RUN}${(++seq.n).toString(36)}`;

/** Byte-unique bcrypt-shaped hash per fixture user, so "unchanged" is literal. */
const hashFor = (key) => `$2a$04$${`${RUN}${key}`.padEnd(53, 'y').slice(0, 53)}`;

const USERS = {};   // fixture key -> users.id
const HASHES = {};  // fixture key -> password_hash value

let ORG_A = null;
let ORG_B = null;
let FAC_A = null;

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
  const { organizationId = null, role, facilityId = null, isOrganizationAdmin = false } = options;
  const marker = hashFor(key);
  const handle = `sec00d-${key.toLowerCase()}-${tag()}`;
  const rows = await conn.query(
    `INSERT INTO users (organization_id, username, email, password_hash, full_name,
                        role, facility_id, is_active, status, is_organization_admin, is_billable)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'active', $8, true)
     RETURNING id`,
    [organizationId, handle, `${handle}@test.local`, marker, `SEC00D ${key}`,
      role, facilityId, isOrganizationAdmin]);
  USERS[key] = Number(rows[0].id);
  HASHES[key] = marker;
  return { id: USERS[key], username: handle };
}

async function ensureFixture() {
  await withConn(async (conn) => {
    const orgs = await conn.query(
      `INSERT INTO organizations (organization_name, subscription_status)
       VALUES ($1, 'active'), ($2, 'active') RETURNING id`,
      [`SEC00D Org A ${RUN}`, `SEC00D Org B ${RUN}`]);
    [ORG_A, ORG_B] = orgs.map((row) => Number(row.id));

    const facilities = await conn.query(
      `INSERT INTO facilities (organization_id, name, code, facility_type)
       VALUES ($1, 'SEC00D Facility A', $2, 'WTP') RETURNING id`,
      [ORG_A, `SF-${tag()}`]);
    [FAC_A] = facilities.map((row) => Number(row.id));

    // Seat fixtures: the sanctioned user-creation route runs seat validation, so
    // both tenants need an active subscription exactly as production does.
    const plan = await conn.query(
      `INSERT INTO subscription_plans (plan_code, plan_name, included_users, max_users)
       VALUES ($1, 'SEC00D Plan', 50, NULL) RETURNING id`,
      [`SEC00D-${tag()}`]);
    await conn.query(
      `INSERT INTO organization_subscriptions (organization_id, plan_id, included_users, status)
       VALUES ($1, $2, 50, 'active'), ($3, $2, 50, 'active')`,
      [ORG_A, Number(plan[0].id), ORG_B]);

    // Exactly two administrators in Org A, so the approved per-organization admin
    // cap (3) leaves room for exactly one authorized admin creation below.
    await insertUser(conn, 'ADMIN_A', { organizationId: ORG_A, role: 'admin', isOrganizationAdmin: true });
    await insertUser(conn, 'PLAIN_ADMIN_A', { organizationId: ORG_A, role: 'admin', isOrganizationAdmin: false });
    await insertUser(conn, 'SUP_A', { organizationId: ORG_A, role: 'supervisor', facilityId: FAC_A });
    await insertUser(conn, 'SUP_NO_FACILITY', { organizationId: ORG_A, role: 'supervisor' });
    await insertUser(conn, 'OPER_A', { organizationId: ORG_A, role: 'operator', facilityId: FAC_A });
    await insertUser(conn, 'ADMIN_B', { organizationId: ORG_B, role: 'admin', isOrganizationAdmin: true });
  });
}

async function cleanupFixture() {
  try {
    await withConn(async (conn) => {
      // Remove anything the suite created, then the fixtures themselves.
      await conn.query(`DELETE FROM users WHERE username LIKE $1`, [`sec00d-%`]);
      const orgIds = [ORG_A, ORG_B].filter((id) => id !== null);
      if (orgIds.length) {
        await conn.query(`DELETE FROM organization_subscriptions WHERE organization_id = ANY($1::int[])`, [orgIds]);
        await conn.query(`DELETE FROM facilities WHERE organization_id = ANY($1::int[])`, [orgIds]);
        await conn.query(`DELETE FROM users WHERE organization_id = ANY($1::int[])`, [orgIds]);
        await conn.query(`DELETE FROM organizations WHERE id = ANY($1::int[])`, [orgIds]);
      }
      await conn.query(`DELETE FROM subscription_plans WHERE plan_code LIKE $1`, [`SEC00D-${RUN}%`]);
    });
  } catch {
    // Test-database hygiene only: the database is disposable, so a cleanup
    // refusal must never mask the security assertions above.
  }
}

// ---------------------------------------------------------------------------
// HTTP harness
// ---------------------------------------------------------------------------

let server = null;
let port = null;

const tokenFor = (key) => jwt.sign({ userId: USERS[key], role: null }, JWT_SECRET, { expiresIn: '1h' });

function call(method, requestPath, { as = null, body = null } = {}) {
  const headers = {};
  if (as) headers.Authorization = `Bearer ${tokenFor(as)}`;
  let payload = null;
  if (body !== null) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: requestPath, headers }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

const registerAs = (as, body) => call('POST', '/api/auth/register', { as, body });
const userByUsername = (username) => withConn((conn) => conn.query(
  `SELECT id, username, role, organization_id, is_organization_admin, facility_id
     FROM users WHERE username = ?`, [username]));

/**
 * Count ONLY this suite's two fixture tenants.
 *
 * A table-wide count is NOT a valid invariant: `node --test` executes suite
 * files in parallel processes against one shared database, so an unrelated
 * suite's fixtures can land between this suite's before/after reads. Scoping the
 * count to the tenants this suite created keeps the "nothing was written"
 * assertion meaningful under the sanctioned runner as well as in isolation.
 */
const fixtureUserCount = () => withConn(async (conn) => {
  const rows = await conn.query(
    `SELECT COUNT(*)::int AS count FROM users WHERE organization_id = ? OR organization_id = ?`,
    [ORG_A, ORG_B]);
  return Number(rows[0].count);
});
const bodyContainsCredential = (response) => {
  if (/\$2[aby]\$/.test(response.text)) return true;
  return Object.values(HASHES).some((hash) => response.text.includes(hash));
};

const newUsername = (suffix) => `sec00d-reg-${suffix}-${tag()}`;
const registerBody = (username, overrides = {}) => ({
  username,
  email: `${username}@test.local`,
  password: 'Sec00d-Password-123',
  full_name: 'SEC00D Register Target',
  ...overrides
});

// ===========================================================================
// Executable security regression
//
// The whole file is gated on the sanctioned database-test predicate, including
// the structural assertions below, because tests/database-test-guard.test.js
// requires a database-mutating suite to execute ZERO tests without that gate.
// ===========================================================================

describe('ATM-001-SEC-00D POST /api/auth/register role-assignment authority', { skip: DB_TEST_SKIP_REASON }, () => {
  // ---------------------------------------------------------- structural
  describe('0. route wiring (source assertions)', () => {
    it('1. the register chain applies the approved role-assignment authority', () => {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'src', 'routes', 'auth.routes.js'), 'utf8');
      assert.match(
        source,
        /router\.post\('\/register', authenticate, requireAdmin, canCreateUser, registerValidation,/,
        'the register route must apply canCreateUser, the authority POST /api/users already uses');
      assert.match(
        source,
        /const \{ canCreateUser \} = require\('\.\.\/middleware\/rbac'\)/,
        'canCreateUser must be imported from the RBAC middleware, not reimplemented');
    });

    it('2. no new role, permission or capability was introduced', () => {
      const permissions = fs.readFileSync(path.join(REPO_ROOT, 'src', 'config', 'permissions.js'), 'utf8');
      const capabilities = fs.readFileSync(path.join(REPO_ROOT, 'src', 'config', 'capabilities.js'), 'utf8');
      // USERS.CREATE keeps its approved shape (this change consumes it, never edits it).
      assert.match(permissions, /CREATE: \{ admin: 'all', supervisor: 'all', operator: 'none' \}/,
        'the approved USERS.CREATE contract must be unchanged');
      assert.match(capabilities, /ORG_USER_ADMIN: 'org\.user_admin'/,
        'the approved capability vocabulary must be unchanged');
    });

    it('3. the register handler never reads a tenant or an admin flag from the body', () => {
      const controller = fs.readFileSync(path.join(REPO_ROOT, 'src', 'controllers', 'auth.controller.js'), 'utf8');
      const handler = controller.slice(controller.indexOf('const register = async'));
      const body = handler.slice(0, handler.indexOf('const logout'));
      assert.doesNotMatch(body, /req\.body\.organization_id|organization_id\s*=\s*req\.body/,
        'the tenant must come from the authenticated session, never the request body');
      assert.match(body, /const organizationId = req\.user\.organization_id;/,
        'the tenant must be the caller’s own organization');
    });
  });

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

  // ---------------------------------------------------------------- section A
  describe('A. privilege escalation is refused (negative controls)', () => {
    it('4. a SUPERVISOR cannot create an administrator', async () => {
      const username = newUsername('sup-admin');
      const before = await fixtureUserCount();

      const response = await registerAs('SUP_A', registerBody(username, { role: 'admin' }));

      assert.strictEqual(response.status, 403,
        'NEGATIVE CONTROL: the pre-fix code created an administrator here');
      assert.match(response.text, /Can only create operator users/,
        'the refusal must come from canCreateUser, the approved authority');
      assert.strictEqual((await userByUsername(username)).length, 0,
        'no administrator row may exist after the refusal');
      assert.strictEqual(await fixtureUserCount(), before, 'no record may be created');
      assert.ok(!bodyContainsCredential(response), 'no credential material in the refusal');
    });

    it('5. a supervisor cannot create an administrator even with a forged is_organization_admin flag', async () => {
      const username = newUsername('sup-forged');
      const response = await registerAs('SUP_A', registerBody(username, {
        role: 'admin',
        is_organization_admin: true,
        organization_id: ORG_B
      }));

      assert.strictEqual(response.status, 403,
        'NEGATIVE CONTROL: the pre-fix code honoured the forged body');
      assert.strictEqual((await userByUsername(username)).length, 0);
    });

    it('6. a supervisor with no facility cannot create an administrator', async () => {
      const username = newUsername('sup-nofac');
      const response = await registerAs('SUP_NO_FACILITY', registerBody(username, { role: 'admin' }));

      assert.strictEqual(response.status, 403,
        'NEGATIVE CONTROL: the pre-fix code created an administrator here');
      assert.match(response.text, /facility/i,
        'a supervisor without a facility is refused for that reason');
      assert.strictEqual((await userByUsername(username)).length, 0);
    });

    it('6b. a supervisor with no facility cannot create even an operator (approved contract already denies this on POST /api/users)', async () => {
      const username = newUsername('sup-nofac-operator');
      const response = await registerAs('SUP_NO_FACILITY', registerBody(username, { role: 'operator' }));

      assert.strictEqual(response.status, 403);
      assert.match(response.text, /facility/i);
      assert.strictEqual((await userByUsername(username)).length, 0);
    });

    it('7. a PLAIN administrator (is_organization_admin = false) cannot create an administrator', async () => {
      const username = newUsername('plain-admin');
      const response = await registerAs('PLAIN_ADMIN_A', registerBody(username, { role: 'admin' }));

      assert.strictEqual(response.status, 403,
        'NEGATIVE CONTROL: the pre-fix code created an administrator here');
      assert.match(response.text, /organization administrator/i,
        'only an organization administrator may create an administrator');
      assert.strictEqual((await userByUsername(username)).length, 0);
    });

    it('8. an OPERATOR cannot create an administrator', async () => {
      const username = newUsername('oper-admin');
      const before = await fixtureUserCount();
      const response = await registerAs('OPER_A', registerBody(username, { role: 'admin' }));

      assert.strictEqual(response.status, 403);
      assert.strictEqual((await userByUsername(username)).length, 0);
      assert.strictEqual(await fixtureUserCount(), before);
    });

    it('9. unauthenticated registration is refused and changes nothing', async () => {
      const username = newUsername('anon');
      const before = await fixtureUserCount();
      const response = await call('POST', '/api/auth/register', { body: registerBody(username, { role: 'admin' }) });

      assert.strictEqual(response.status, 401);
      assert.strictEqual((await userByUsername(username)).length, 0);
      assert.strictEqual(await fixtureUserCount(), before);
    });
  });

  // ---------------------------------------------------------------- section B
  describe('B. tenant boundary is server-authoritative', () => {
    it('10. a request-body organization_id cannot move the new record to another tenant', async () => {
      const username = newUsername('cross-tenant');

      const response = await registerAs('ADMIN_A', registerBody(username, {
        role: 'operator',
        organization_id: ORG_B
      }));

      const rows = await userByUsername(username);
      assert.strictEqual(rows.length, 1, 'the authorized creation is permitted');
      assert.strictEqual(Number(rows[0].organization_id), ORG_A,
        'the record must belong to the CALLER’s organization, not the body value');
      assert.notStrictEqual(Number(rows[0].organization_id), ORG_B);
      assert.notStrictEqual(response.status, 403, 'an authorized caller must not be refused');
      assert.ok(!bodyContainsCredential(response), 'no credential material in the response');
    });

    it('11. malformed and out-of-range organization identifiers cannot change the tenant', async () => {
      for (const bad of ['abc', 0, -1, 999999999, null, undefined]) {
        const username = newUsername(`bad-org-${String(bad).replace(/[^a-z0-9]/gi, '')}`);

        await registerAs('ADMIN_A', registerBody(username, { role: 'operator', organization_id: bad }));

        const rows = await userByUsername(username);
        if (rows.length) {
          assert.strictEqual(Number(rows[0].organization_id), ORG_A,
            `organization_id=${JSON.stringify(bad)} must not redirect the tenant`);
        }
      }
    });

    it('12. a cross-tenant administrator cannot create a user in another tenant', async () => {
      const username = newUsername('admin-b');

      await registerAs('ADMIN_B', registerBody(username, {
        role: 'operator',
        organization_id: ORG_A
      }));

      const rows = await userByUsername(username);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(Number(rows[0].organization_id), ORG_B,
        'an administrator of Org B may only create inside Org B');
    });
  });

  // ---------------------------------------------------------------- section C
  describe('C. approved workflows still function', () => {
    it('13. an organization administrator still creates an operator in their own tenant', async () => {
      const username = newUsername('legit-operator');
      const response = await registerAs('ADMIN_A', registerBody(username, { role: 'operator' }));

      assert.notStrictEqual(response.status, 403, 'an authorized creation must not be refused');
      const rows = await userByUsername(username);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].role, 'operator');
      assert.strictEqual(Number(rows[0].organization_id), ORG_A);
      assert.ok(!bodyContainsCredential(response), 'no credential material in the response');
    });

    it('14. an organization administrator still creates an administrator', async () => {
      const username = newUsername('legit-admin');
      const response = await registerAs('ADMIN_A', registerBody(username, { role: 'admin' }));

      assert.notStrictEqual(response.status, 403,
        'the approved organization-administrator workflow must be preserved');
      const rows = await userByUsername(username);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].role, 'admin');
      assert.strictEqual(Number(rows[0].organization_id), ORG_A);
    });

    it('15. a missing role is treated as operator, never as an administrator', async () => {
      const username = newUsername('no-role');
      await registerAs('ADMIN_A', registerBody(username));

      const rows = await userByUsername(username);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].role, 'operator');
    });

    it('16. a malformed role is rejected before any record is written', async () => {
      const username = newUsername('bad-role');
      const before = await fixtureUserCount();
      const response = await registerAs('ADMIN_A', registerBody(username, { role: 'superadmin' }));

      assert.strictEqual(response.status, 400);
      assert.strictEqual((await userByUsername(username)).length, 0);
      assert.strictEqual(await fixtureUserCount(), before);
    });

    it('17. the sanctioned user-creation route is unchanged', async () => {
      const username = newUsername('via-users-route');
      const response = await call('POST', '/api/users', {
        as: 'SUP_A',
        body: {
          username,
          email: `${username}@test.local`,
          password: 'Sec00d-Password-123',
          full_name: 'SEC00D Via Users Route',
          role: 'operator'
        }
      });

      assert.strictEqual(response.status, 201,
        'the approved supervisor -> operator workflow on POST /api/users must still work');
      const rows = await userByUsername(username);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].role, 'operator');
    });

    it('17b. the sanctioned route still refuses supervisor -> administrator', async () => {
      const username = newUsername('via-users-route-sup-admin');
      const response = await call('POST', '/api/users', {
        as: 'SUP_A',
        body: {
          username,
          email: `${username}@test.local`,
          password: 'Sec00d-Password-123',
          full_name: 'SEC00D Sup Admin',
          role: 'admin'
        }
      });

      assert.strictEqual(response.status, 403);
      assert.strictEqual((await userByUsername(username)).length, 0);
    });

    it('18. invitation-based enrolment is untouched by this change', async () => {
      const response = await call('POST', '/api/invitations/accept', {
        body: {
          token: 'not-a-real-invitation-token',
          username: newUsername('invite'),
          password: 'Sec00d-Password-123',
          full_name: 'SEC00D Invite'
        }
      });

      assert.strictEqual(response.status, 404,
        'the invitation route must still be reachable and reject an unknown token');
    });

    it('19. SEC-00D opens no second account-creation path through public signup', async () => {
      const username = newUsername('signup');
      const before = await fixtureUserCount();

      await call('POST', '/api/auth/signup', {
        body: {
          username,
          email: `${username}@test.local`,
          password: 'Sec00d-Password-123',
          full_name: 'SEC00D Signup',
          role: 'admin',
          organization_id: ORG_A
        }
      });

      // SEC-00A containment itself lives in PR #86 and is NOT part of this
      // branch's baseline. What this change must guarantee is that it creates no
      // additional way to obtain an account.
      assert.strictEqual((await userByUsername(username)).length, 0,
        'SEC-00D must not make public signup able to create an account');
      assert.strictEqual(await fixtureUserCount(), before);
    });
  });

  // ---------------------------------------------------------------- section D
  describe('D. no administrator can be created without approved authority', () => {
    it('20. every supervisor/plain-admin attempt left the administrator population unchanged', async () => {
      const rows = await withConn((conn) => conn.query(
        `SELECT role, COUNT(*)::int AS count FROM users
          WHERE organization_id = ? GROUP BY role`, [ORG_A]));
      const byRole = Object.fromEntries(rows.map((row) => [row.role, Number(row.count)]));

      // 1 org admin + 1 plain admin + exactly 1 authorized admin from test 14.
      assert.strictEqual(byRole.admin, 3,
        `Org A must hold exactly the 2 fixture admins plus the 1 authorized admin; got ${JSON.stringify(byRole)}`);
    });

    it('21. no supervisor or plain-admin-created administrator exists anywhere', async () => {
      const rows = await withConn((conn) => conn.query(
        `SELECT id FROM users WHERE username LIKE ?`, [`sec00d-reg-sup-%`]));
      const forged = await withConn((conn) => conn.query(
        `SELECT id FROM users WHERE username LIKE ?`, [`sec00d-reg-plain-admin%`]));

      assert.strictEqual(rows.length, 0, 'no supervisor-originated registration may exist');
      assert.strictEqual(forged.length, 0, 'no plain-administrator-originated registration may exist');
    });
  });
});
