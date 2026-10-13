/**
 * ATM-001-SEC-LEGACY-01-R3 — reconciled authorization for the single-user routes.
 *
 * Three remediations were authored independently against the same anchor:
 *
 *   - R1 (PR #85): GET /api/users/:id - USERS.VIEW, tenant scope, credential-free
 *     responses;
 *   - R2: PUT /api/users/:id - USERS.UPDATE, tenant/ownership scope;
 *   - 00B (PR #87): DELETE /api/users/:id - USERS.DELETE, tenant scope.
 *
 * Each grew its own copy of the same tenant rule, so the lane drifted and
 * DELETE shipped later than the other two. This suite exercises the RECONCILED
 * lane: one shared scope core (`authorizeUserScope`) behind three thin guards,
 * plus the OWNER-APPROVED USERS.ASSIGN_FACILITY policy on the write paths:
 *
 *   "Only explicitly authorized USERS.ASSIGN_FACILITY principals can modify
 *    facility assignments within their authorized tenant and facility scope;
 *    ordinary operators cannot assign to self/others."
 *
 * Every case drives the REAL Express app with real JWTs against rows this suite
 * creates, and asserts the DATABASE EFFECT and the LOGIN OUTCOME - not the HTTP
 * status alone. This repository has defects where a write persists behind an
 * HTTP 500 (D-1: `BaseModel.create` never populates `insertId`) and where seat
 * logic can mask a result (D-2), so a status code is never treated as proof.
 *
 * Cases an independent reviewer demonstrated against the individual branches and
 * that this suite pins:
 *
 *   - supervisor(orgA) -> DELETE orgB user            : was 200, row gone
 *   - operator self -> facility_id of another tenant  : was 200
 *   - admin same-tenant -> target in a foreign facility: was 200
 *   - omitted `is_active` -> silent reactivation of a
 *     suspended, billable user with no seat check     : was 200
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * src/config/database.js uses to select test-database credentials, so it can
 * never run against runtime credentials.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getConnection, isIntegrationTest } = require('../src/config/database');
const authConfig = require('../src/config/auth');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating user-authorization reconciliation suite requires the '
    + 'sanctioned database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) '
    + 'so that test-database credentials are used instead of runtime credentials; '
    + 'run it via `npm run test:integration`';

// The secret the application itself resolves. Read from the application's own
// config rather than trusting a literal, and asserted non-empty, so a changed
// secret cannot silently invalidate the tokens this suite mints.
const JWT_SECRET = authConfig.jwt.secret;

const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`;
const VICTIM_ORIGINAL_PASSWORD = 'Victim-Original-Pass-1!';
const ATTACKER_CHOSEN_PASSWORD = 'Attacker-Chosen-Pass-1!';
const OPERATOR_ORIGINAL_PASSWORD = 'Operator-Original-Pass-1!';
const OPERATOR_NEW_PASSWORD = 'Operator-New-Pass-1!';
const SUSPENDED_ORIGINAL_PASSWORD = 'Suspended-Original-Pass-1!';

let F = null;
let server = null;
let port = null;

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

const PASSWORD_HASH_ROUNDS = 4; // test-only: bcrypt cost is not under test here

const insertUser = async (conn, {
  username, password, role, organizationId, facilityId,
  isOrganizationAdmin = false, fullName, isBillable = false, status = 'active',
  isActive = true
}) => {
  const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);
  const rows = await conn.query(
    `INSERT INTO users (username, email, password_hash, full_name, role, facility_id,
                        is_active, status, is_billable, organization_id, is_organization_admin)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, username, email, full_name, role, facility_id, organization_id,
               is_organization_admin, is_active, status, is_billable`,
    [username, `${username}@atm001-sec.test`, passwordHash, fullName, role, facilityId,
      isActive, status, isBillable, organizationId, isOrganizationAdmin]);
  return rows[0];
};

const USER_COLUMNS = `id, username, email, full_name, role, facility_id, organization_id,
                      is_organization_admin, is_active, status, is_billable, password_hash`;

const rowOf = (id) => withConn(async (conn) => {
  const rows = await conn.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
});

const rowByUsername = (username) => withConn(async (conn) => {
  const rows = await conn.query(`SELECT ${USER_COLUMNS} FROM users WHERE username = $1`, [username]);
  return rows[0] || null;
});

/** Restore a fixture row to its declared starting state between cases. */
const resetUser = (id, {
  fullName, role, facilityId, isActive, status, isBillable, password,
  isOrganizationAdmin = false
}) => withConn(async (conn) => {
  await conn.query(
    `UPDATE users SET full_name = $2, role = $3, facility_id = $4, is_active = $5,
            status = $6, is_billable = $7, is_organization_admin = $8, password_hash = $9
     WHERE id = $1`,
    [id, fullName, role, facilityId, isActive, status, isBillable,
      isOrganizationAdmin, await bcrypt.hash(password, PASSWORD_HASH_ROUNDS)]);
});

async function ensureFixture() {
  await withConn(async (conn) => {
    // The suite owns every row it touches: all three tenants are created here so
    // the result never depends on seeded data.
    const orgs = await conn.query(
      `INSERT INTO organizations (organization_name, industry, subscription_status)
       VALUES ($1, 'other', 'active'), ($2, 'other', 'active'), ($3, 'other', 'active')
       RETURNING id`,
      [`ATM001 SEC R3 Home Org ${RUN}`, `ATM001 SEC R3 Foreign Org ${RUN}`,
        `ATM001 SEC R3 Seat Org ${RUN}`]);
    const [homeOrgId, foreignOrgId, seatOrgId] = orgs.map((row) => Number(row.id));

    const facilities = await conn.query(
      `INSERT INTO facilities (organization_id, name, code, facility_type)
       VALUES ($1, $2, $3, 'WTP'), ($4, $5, $6, 'WTP'), ($1, $7, $8, 'WTP'),
              ($9, $10, $11, 'WTP'), ($9, $12, $13, 'WTP')
       RETURNING id`,
      [homeOrgId, `ATM001 SEC R3 Home A ${RUN}`, `AR3HA-${RUN}`,
        foreignOrgId, `ATM001 SEC R3 Foreign ${RUN}`, `AR3F-${RUN}`,
        `ATM001 SEC R3 Home B ${RUN}`, `AR3HB-${RUN}`,
        seatOrgId, `ATM001 SEC R3 Seat ${RUN}`, `AR3S-${RUN}`,
        `ATM001 SEC R3 Seat B ${RUN}`, `AR3SB-${RUN}`]);
    const [homeFacilityAId, foreignFacilityId, homeFacilityBId, seatFacilityId, seatFacilityBId] =
      facilities.map((row) => Number(row.id));

    // Subscriptions: the seat control is exercised against real
    // organization_subscriptions rows, and validateAvailableSeats on POST needs
    // an active subscription for the home tenant.
    const plans = await conn.query(
      `INSERT INTO subscription_plans (plan_code, plan_name, included_users, base_price)
       VALUES ($1, 'ATM001 SEC R3 plan', 10, 0) RETURNING id`,
      [`ar3-${RUN}`]);
    const planId = Number(plans[0].id);

    await conn.query(
      `INSERT INTO organization_subscriptions
         (organization_id, plan_id, included_users, extra_users, max_users, base_price, status)
       VALUES ($1, $4, 10, 0, 20, 0, 'active'),
              ($2, $4, 10, 0, 20, 0, 'active'),
              ($3, $4, 1, 0, 20, 0, 'active')`,
      [homeOrgId, foreignOrgId, seatOrgId, planId]);

    const victim = await insertUser(conn, {
      username: `atm001sec3_victim_${RUN}`, password: VICTIM_ORIGINAL_PASSWORD, role: 'operator',
      organizationId: foreignOrgId, facilityId: foreignFacilityId,
      fullName: `ATM001 SEC R3 Victim ${RUN}`
    });
    const operator = await insertUser(conn, {
      username: `atm001sec3_op_${RUN}`, password: OPERATOR_ORIGINAL_PASSWORD, role: 'operator',
      organizationId: homeOrgId, facilityId: homeFacilityAId,
      fullName: `ATM001 SEC R3 Operator ${RUN}`
    });
    const colleague = await insertUser(conn, {
      username: `atm001sec3_col_${RUN}`, password: 'Colleague-Pass-1!', role: 'operator',
      organizationId: homeOrgId, facilityId: homeFacilityAId,
      fullName: `ATM001 SEC R3 Colleague ${RUN}`
    });
    const otherFacilityUser = await insertUser(conn, {
      username: `atm001sec3_other_${RUN}`, password: 'Other-Facility-Pass-1!', role: 'operator',
      organizationId: homeOrgId, facilityId: homeFacilityBId,
      fullName: `ATM001 SEC R3 Other Facility ${RUN}`
    });
    const deleteTarget = await insertUser(conn, {
      username: `atm001sec3_del_${RUN}`, password: 'Delete-Target-Pass-1!', role: 'operator',
      organizationId: homeOrgId, facilityId: homeFacilityAId,
      fullName: `ATM001 SEC R3 Delete Target ${RUN}`
    });
    const admin = await insertUser(conn, {
      username: `atm001sec3_admin_${RUN}`, password: 'Admin-Pass-1!', role: 'admin',
      organizationId: homeOrgId, facilityId: null,
      fullName: `ATM001 SEC R3 Admin ${RUN}`, isOrganizationAdmin: true
    });
    const supervisor = await insertUser(conn, {
      username: `atm001sec3_sup_${RUN}`, password: 'Supervisor-Pass-1!', role: 'supervisor',
      organizationId: homeOrgId, facilityId: homeFacilityAId,
      fullName: `ATM001 SEC R3 Supervisor ${RUN}`
    });
    const foreignAdmin = await insertUser(conn, {
      username: `atm001sec3_fadmin_${RUN}`, password: 'Foreign-Admin-Pass-1!', role: 'admin',
      organizationId: foreignOrgId, facilityId: null,
      fullName: `ATM001 SEC R3 Foreign Admin ${RUN}`, isOrganizationAdmin: true
    });
    const supervisorNoFacility = await insertUser(conn, {
      username: `atm001sec3_supnf_${RUN}`, password: 'Supervisor-No-Facility-Pass-1!',
      role: 'supervisor', organizationId: homeOrgId, facilityId: null,
      fullName: `ATM001 SEC R3 Supervisor No Facility ${RUN}`
    });
    const seatAdmin = await insertUser(conn, {
      username: `atm001sec3_sadmin_${RUN}`, password: 'Seat-Admin-Pass-1!', role: 'admin',
      organizationId: seatOrgId, facilityId: null,
      fullName: `ATM001 SEC R3 Seat Admin ${RUN}`, isOrganizationAdmin: true
    });
    // One active billable user fills the seat org's single seat.
    const seatFiller = await insertUser(conn, {
      username: `atm001sec3_filler_${RUN}`, password: 'Seat-Filler-Pass-1!', role: 'operator',
      organizationId: seatOrgId, facilityId: seatFacilityId, isBillable: true,
      fullName: `ATM001 SEC R3 Seat Filler ${RUN}`
    });
    // A suspended, billable user: the reactivation target.
    const seatSuspended = await insertUser(conn, {
      username: `atm001sec3_susp_${RUN}`, password: SUSPENDED_ORIGINAL_PASSWORD, role: 'operator',
      organizationId: seatOrgId, facilityId: seatFacilityId, isBillable: true,
      status: 'suspended', isActive: false,
      fullName: `ATM001 SEC R3 Suspended ${RUN}`
    });

    F = {
      homeOrgId, foreignOrgId, seatOrgId, planId,
      homeFacilityAId, foreignFacilityId, homeFacilityBId, seatFacilityId, seatFacilityBId,
      victim, operator, colleague, otherFacilityUser, deleteTarget, admin, supervisor,
      foreignAdmin, supervisorNoFacility, seatAdmin, seatFiller, seatSuspended
    };
  });
}

async function destroyFixture() {
  if (!F) return;
  await withConn(async (conn) => {
    await conn.query('DELETE FROM users WHERE organization_id = ANY($1::int[])',
      [[F.homeOrgId, F.foreignOrgId, F.seatOrgId]]);
    await conn.query('DELETE FROM organization_subscriptions WHERE organization_id = ANY($1::int[])',
      [[F.homeOrgId, F.foreignOrgId, F.seatOrgId]]);
    await conn.query('DELETE FROM facilities WHERE organization_id = ANY($1::int[])',
      [[F.homeOrgId, F.foreignOrgId, F.seatOrgId]]);
    await conn.query('DELETE FROM organizations WHERE id = ANY($1::int[])',
      [[F.homeOrgId, F.foreignOrgId, F.seatOrgId]]);
    await conn.query('DELETE FROM subscription_plans WHERE id = $1', [F.planId]);
  });
}

// ------------------------------------------------------------------- HTTP
const tokenFor = (userId) => jwt.sign({ userId }, JWT_SECRET, { expiresIn: '1h' });

function call(method, requestPath, { userId, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: requestPath,
      headers: {
        ...(userId ? { Authorization: `Bearer ${tokenFor(userId)}` } : {}),
        ...(payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, json, text: data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const login = (username, password) => call('POST', '/api/auth/login', { body: { username, password } });

/** The attacker re-sends the victim's own identity, with a chosen password. */
const takeoverBody = (target) => ({
  username: target.username,
  email: target.email,
  full_name: target.full_name,
  password: ATTACKER_CHOSEN_PASSWORD
});

const seatUsage = () => withConn(async (conn) => {
  const rows = await conn.query(
    'SELECT seats_used, included_users, extra_users FROM organization_subscriptions WHERE organization_id = $1',
    [F.seatOrgId]);
  return rows[0];
});

/** The seat count the subscription model itself would compute. */
const billableSeatCount = () => withConn(async (conn) => {
  const rows = await conn.query(
    `SELECT COUNT(*)::int AS count FROM users
     WHERE organization_id = $1 AND is_billable = TRUE AND status IN ('active', 'invited')`,
    [F.seatOrgId]);
  return Number(rows[0].count);
});

// ==========================================================================

describe('ATM-001-SEC-LEGACY-01-R3 reconciled /api/users/:id authorization',
  { skip: DB_TEST_SKIP_REASON }, () => {
    before(async () => {
      await ensureFixture();
      assert.ok(JWT_SECRET, 'the application must resolve a JWT secret for the test environment');
      const app = require('../src/app');
      server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      port = server.address().port;
    });

    after(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
      await destroyFixture();
    });

    // ------------------------------------------------- authentication / ids
    describe('identifier handling and authentication', () => {
      it('1. rejects an unauthenticated request on every method without touching the row', async () => {
        const before = await rowOf(F.victim.id);

        for (const method of ['GET', 'PUT', 'DELETE']) {
          const response = await call(method, `/api/users/${F.victim.id}`, {
            body: method === 'PUT' ? { password: ATTACKER_CHOSEN_PASSWORD } : undefined
          });
          assert.strictEqual(response.status, 401, `${method} must require authentication`);
        }

        const after = await rowOf(F.victim.id);
        assert.strictEqual(after.password_hash, before.password_hash);
      });

      it('2. refuses a malformed identifier as absent on GET, PUT and DELETE', async () => {
        for (const raw of ['abc', '1abc', '0', '-1', '99999999999', '1.5', ' 2']) {
          const viaAdminGet = await call('GET', `/api/users/${encodeURIComponent(raw)}`, { userId: F.admin.id });
          const viaAdminDelete = await call('DELETE', `/api/users/${encodeURIComponent(raw)}`, { userId: F.admin.id });
          const viaOperatorPut = await call('PUT', `/api/users/${encodeURIComponent(raw)}`, {
            userId: F.operator.id, body: { password: ATTACKER_CHOSEN_PASSWORD }
          });
          assert.strictEqual(viaAdminGet.status, 404, `GET ${raw}`);
          assert.strictEqual(viaAdminDelete.status, 404, `DELETE ${raw}`);
          assert.strictEqual(viaOperatorPut.status, 404, `PUT ${raw}`);
          assert.strictEqual(viaAdminGet.json.message, 'User not found');
          assert.strictEqual(viaAdminDelete.json.message, 'User not found');
          assert.strictEqual(viaOperatorPut.json.message, 'User not found');
        }
      });

      it('3. does not distinguish a foreign-tenant record from an absent one', async () => {
        for (const method of ['GET', 'PUT', 'DELETE']) {
          const foreign = await call(method, `/api/users/${F.victim.id}`, {
            userId: F.admin.id, body: method === 'PUT' ? takeoverBody(F.victim) : undefined
          });
          const absent = await call(method, `/api/users/${F.victim.id + 2000000000}`, {
            userId: F.admin.id, body: method === 'PUT' ? takeoverBody(F.victim) : undefined
          });
          assert.strictEqual(foreign.status, 404, `${method} foreign`);
          assert.strictEqual(absent.status, 404, `${method} absent`);
          assert.deepStrictEqual(foreign.json, absent.json,
            `${method}: foreign and absent must be indistinguishable`);
        }
      });
    });

    // ------------------------------------------------------------ cross tenant
    describe('cross-tenant access is refused on every route', () => {
      it('4. an operator cannot take over a foreign-tenant user (the reported vulnerability)', async () => {
        const before = await rowOf(F.victim.id);
        const response = await call('PUT', `/api/users/${F.victim.id}`, {
          userId: F.operator.id, body: takeoverBody(F.victim)
        });
        const after = await rowOf(F.victim.id);

        assert.strictEqual(response.status, 404);
        assert.strictEqual(after.password_hash, before.password_hash);
        assert.strictEqual(after.role, before.role);
        assert.strictEqual(after.facility_id, before.facility_id);
        assert.strictEqual(after.username, before.username);

        // The effect, not the status code.
        assert.ok(await bcrypt.compare(VICTIM_ORIGINAL_PASSWORD, after.password_hash));
        assert.ok(!(await bcrypt.compare(ATTACKER_CHOSEN_PASSWORD, after.password_hash)));
        assert.strictEqual((await login(F.victim.username, VICTIM_ORIGINAL_PASSWORD)).status, 200);
        assert.strictEqual((await login(F.victim.username, ATTACKER_CHOSEN_PASSWORD)).status, 401);
      });

      it('5. an administrator is not a cross-tenant grant on PUT', async () => {
        const before = await rowOf(F.victim.id);
        const response = await call('PUT', `/api/users/${F.victim.id}`, {
          userId: F.admin.id, body: takeoverBody(F.victim)
        });
        const after = await rowOf(F.victim.id);

        assert.strictEqual(response.status, 404);
        assert.strictEqual(after.password_hash, before.password_hash);
        assert.ok(await bcrypt.compare(VICTIM_ORIGINAL_PASSWORD, after.password_hash));
      });

      it('6. a supervisor cannot PUT, GET or DELETE a foreign-tenant user', async () => {
        const before = await rowOf(F.victim.id);

        const put = await call('PUT', `/api/users/${F.victim.id}`, {
          userId: F.supervisor.id, body: takeoverBody(F.victim)
        });
        const get = await call('GET', `/api/users/${F.victim.id}`, { userId: F.supervisor.id });
        const del = await call('DELETE', `/api/users/${F.victim.id}`, { userId: F.supervisor.id });

        const after = await rowOf(F.victim.id);

        assert.strictEqual(put.status, 404, 'supervisor PUT foreign');
        assert.strictEqual(get.status, 404, 'supervisor GET foreign');
        // USERS.DELETE is 'none' for a supervisor, so the permission gate refuses
        // before any lookup - identically for every identifier.
        assert.strictEqual(del.status, 403, 'supervisor DELETE foreign');
        assert.ok(after, 'the foreign user must still exist');
        assert.strictEqual(after.password_hash, before.password_hash);
      });

      it('7. an operator may read its own record but has no USERS.VIEW, and an administrator DELETE cannot cross tenants', async () => {
        // MISSION #107 / R-1 - THE HISTORICAL CONTRADICTION, PRESERVED.
        //
        // As accepted by #102/R3, this case asserted the OPPOSITE of
        // `tests/user-credential-disclosure.test.js` test 7 for the very same
        // call. Its original assertion was, verbatim:
        //
        //     const operatorGetOwn = await call('GET', `/api/users/${F.operator.id}`,
        //       { userId: F.operator.id });
        //     assert.strictEqual(operatorGetOwn.status, 403,
        //       'USERS.VIEW is none for an operator, so the permission gate refuses
        //        every identifier alike');
        //
        // That sentence was true of the capability gate alone, and it is STILL
        // true for every identifier except one. The OWNER-approved R-1 policy
        // narrows the case rather than deleting it: an authenticated operator may
        // read its OWN sanitized record (HTTP 200), and viewing that record
        // confers no USERS.VIEW, no `org.user_admin`, no `org.config_admin` and
        // no other elevated capability. The contradiction is therefore resolved
        // in favour of the assertion that was failing (B3-B test 7), and this
        // comment records the superseded assertion instead of erasing it.
        //
        // The "USERS.VIEW is none for an operator" claim is re-asserted
        // POSITIVELY below - against a same-tenant colleague, against a
        // foreign-tenant record, and against the list route - so the own-record
        // exemption cannot have become a capability without this case failing.
        const operatorOwnBefore = await rowOf(F.operator.id);

        const operatorGetOwn = await call('GET', `/api/users/${F.operator.id}`, { userId: F.operator.id });
        assert.strictEqual(operatorGetOwn.status, 200,
          'R-1: an operator may read its own sanitized record');
        assert.strictEqual(Number(operatorGetOwn.json.data.user.id), F.operator.id,
          'the record returned must be the principal itself');
        assert.ok(!('password_hash' in operatorGetOwn.json.data.user),
          'the own record must be sanitized');
        assert.notStrictEqual(operatorGetOwn.json.data.user.username, undefined,
          'a legitimate field must survive on a successful own-record read');

        // Non-effect: a read must not alter the row it read.
        const operatorOwnAfter = await rowOf(F.operator.id);
        assert.deepStrictEqual(operatorOwnAfter, operatorOwnBefore,
          'an own-record GET must not change the row');

        // USERS.VIEW is still 'none' for an operator. A same-tenant colleague and
        // a foreign-tenant record are refused identically by the unchanged gate.
        const operatorGetColleague = await call('GET', `/api/users/${F.colleague.id}`, { userId: F.operator.id });
        const operatorGetForeign = await call('GET', `/api/users/${F.victim.id}`, { userId: F.operator.id });
        assert.strictEqual(operatorGetColleague.status, 403,
          'USERS.VIEW is none for an operator: a colleague is still refused');
        assert.strictEqual(operatorGetForeign.status, 403,
          'USERS.VIEW is none for an operator: a foreign record is still refused');
        assert.deepStrictEqual(operatorGetColleague.json, operatorGetForeign.json,
          'the denial must not vary with the target - no existence oracle');

        // The list route still requires USERS.VIEW, so the exemption did not
        // widen into "view users".
        const operatorList = await call('GET', '/api/users', { userId: F.operator.id });
        assert.strictEqual(operatorList.status, 403,
          'the user list still requires USERS.VIEW for an operator');

        const before = await rowOf(F.victim.id);
        const crossTenantDelete = await call('DELETE', `/api/users/${F.victim.id}`, { userId: F.admin.id });
        const after = await rowOf(F.victim.id);

        assert.strictEqual(crossTenantDelete.status, 404);
        assert.ok(after, 'the cross-tenant DELETE must not remove the row');
        assert.strictEqual(after.organization_id, before.organization_id);
        assert.strictEqual((await login(F.victim.username, VICTIM_ORIGINAL_PASSWORD)).status, 200);
      });

      it('8. a supervisor with no facility is refused from its own state, not from the target', async () => {
        const existing = await call('GET', `/api/users/${F.colleague.id}`, { userId: F.supervisorNoFacility.id });
        const absent = await call('GET', '/api/users/2147483000', { userId: F.supervisorNoFacility.id });

        assert.strictEqual(existing.status, 403);
        assert.strictEqual(absent.status, 403);
        assert.deepStrictEqual(existing.json, absent.json,
          'the caller-state denial must not vary with the target');
      });
    });

    // ---------------------------------------------------------- same tenant
    describe('the USERS.UPDATE contract bounds same-tenant writes', () => {
      it('9. an operator cannot write a same-tenant colleague', async () => {
        const before = await rowOf(F.colleague.id);
        const response = await call('PUT', `/api/users/${F.colleague.id}`, {
          userId: F.operator.id,
          body: {
            username: F.colleague.username, email: F.colleague.email,
            full_name: F.colleague.full_name, password: ATTACKER_CHOSEN_PASSWORD
          }
        });
        const after = await rowOf(F.colleague.id);

        assert.strictEqual(response.status, 404);
        assert.strictEqual(after.password_hash, before.password_hash);
        assert.strictEqual(after.full_name, before.full_name);
      });

      it('10. a supervisor keeps the same-facility boundary', async () => {
        await resetUser(F.colleague.id, {
          fullName: F.colleague.full_name, role: 'operator', facilityId: F.homeFacilityAId,
          isActive: true, status: 'active', isBillable: false, password: 'Colleague-Pass-1!'
        });

        const allowed = await call('PUT', `/api/users/${F.colleague.id}`, {
          userId: F.supervisor.id,
          body: {
            username: F.colleague.username, email: F.colleague.email,
            full_name: `Supervisor Touched ${RUN}`, role: 'operator',
            facility_id: F.homeFacilityAId, is_active: true
          }
        });
        assert.strictEqual(allowed.status, 200);
        assert.strictEqual((await rowOf(F.colleague.id)).full_name, `Supervisor Touched ${RUN}`);

        const otherFacility = await call('PUT', `/api/users/${F.otherFacilityUser.id}`, {
          userId: F.supervisor.id,
          body: { full_name: `Nope ${RUN}` }
        });
        assert.strictEqual(otherFacility.status, 404, 'a supervisor may not reach another facility');
        assert.strictEqual((await rowOf(F.otherFacilityUser.id)).full_name,
          F.otherFacilityUser.full_name);
      });

      it('11. an administrator may still update a same-tenant colleague', async () => {
        await resetUser(F.colleague.id, {
          fullName: F.colleague.full_name, role: 'operator', facilityId: F.homeFacilityAId,
          isActive: true, status: 'active', isBillable: false, password: 'Colleague-Pass-1!'
        });

        const response = await call('PUT', `/api/users/${F.colleague.id}`, {
          userId: F.admin.id,
          body: {
            username: F.colleague.username, email: F.colleague.email,
            full_name: `Admin Touched ${RUN}`, role: 'operator',
            facility_id: F.homeFacilityAId, is_active: true
          }
        });
        const after = await rowOf(F.colleague.id);

        assert.strictEqual(response.status, 200);
        assert.strictEqual(after.full_name, `Admin Touched ${RUN}`);
      });
    });

    // ------------------------------------------------------- facility policy
    describe('the approved USERS.ASSIGN_FACILITY policy on the write paths', () => {
      it('12. an operator cannot repoint its own facility to another facility of its own tenant', async () => {
        await resetUser(F.operator.id, {
          fullName: F.operator.full_name, role: 'operator', facilityId: F.homeFacilityAId,
          isActive: true, status: 'active', isBillable: false, password: OPERATOR_ORIGINAL_PASSWORD
        });

        const response = await call('PUT', `/api/users/${F.operator.id}`, {
          userId: F.operator.id,
          body: {
            username: F.operator.username, email: F.operator.email,
            full_name: F.operator.full_name, role: 'operator',
            facility_id: F.homeFacilityBId, is_active: true
          }
        });
        const after = await rowOf(F.operator.id);

        assert.strictEqual(response.status, 403);
        assert.strictEqual(after.facility_id, F.homeFacilityAId, 'the stored assignment is untouched');
      });

      it('13. an operator cannot repoint itself to a FACILITY OF ANOTHER TENANT', async () => {
        const response = await call('PUT', `/api/users/${F.operator.id}`, {
          userId: F.operator.id,
          body: {
            username: F.operator.username, email: F.operator.email,
            full_name: F.operator.full_name, role: 'operator',
            facility_id: F.foreignFacilityId, is_active: true
          }
        });
        const after = await rowOf(F.operator.id);

        assert.strictEqual(response.status, 403);
        assert.strictEqual(after.facility_id, F.homeFacilityAId);
        assert.strictEqual(after.organization_id, F.homeOrgId);
        assert.strictEqual((await login(F.operator.username, OPERATOR_ORIGINAL_PASSWORD)).status, 200);
      });

      it('14. re-sending the current facility is not a modification, so an operator self-update still works', async () => {
        const before = await rowOf(F.operator.id);
        const response = await call('PUT', `/api/users/${F.operator.id}`, {
          userId: F.operator.id,
          body: {
            username: F.operator.username, email: F.operator.email,
            full_name: `Operator Self Kept Facility ${RUN}`, role: 'operator',
            facility_id: F.homeFacilityAId, is_active: true
          }
        });
        const after = await rowOf(F.operator.id);

        assert.strictEqual(response.status, 200);
        assert.strictEqual(after.full_name, `Operator Self Kept Facility ${RUN}`);
        assert.strictEqual(after.facility_id, before.facility_id);
      });

      it('15. a supervisor cannot modify a facility assignment either', async () => {
        await resetUser(F.colleague.id, {
          fullName: F.colleague.full_name, role: 'operator', facilityId: F.homeFacilityAId,
          isActive: true, status: 'active', isBillable: false, password: 'Colleague-Pass-1!'
        });

        const response = await call('PUT', `/api/users/${F.colleague.id}`, {
          userId: F.supervisor.id,
          body: {
            username: F.colleague.username, email: F.colleague.email,
            full_name: `Supervisor Facility Attempt ${RUN}`,
            facility_id: F.homeFacilityBId, is_active: true
          }
        });
        const after = await rowOf(F.colleague.id);

        assert.strictEqual(response.status, 403);
        assert.strictEqual(after.facility_id, F.homeFacilityAId);
        assert.notStrictEqual(after.full_name, `Supervisor Facility Attempt ${RUN}`,
          'the refused request must not partially apply');
      });

      it('16. an administrator cannot attach a same-tenant target to a FOREIGN facility', async () => {
        await resetUser(F.colleague.id, {
          fullName: F.colleague.full_name, role: 'operator', facilityId: F.homeFacilityAId,
          isActive: true, status: 'active', isBillable: false, password: 'Colleague-Pass-1!'
        });

        const response = await call('PUT', `/api/users/${F.colleague.id}`, {
          userId: F.admin.id,
          body: { facility_id: F.foreignFacilityId }
        });
        const after = await rowOf(F.colleague.id);

        assert.strictEqual(response.status, 404, 'a foreign facility is reported as absent');
        assert.strictEqual(after.facility_id, F.homeFacilityAId);
        assert.strictEqual(after.organization_id, F.homeOrgId);
      });

      it('17. an administrator may assign a same-tenant facility, and may clear it', async () => {
        await resetUser(F.colleague.id, {
          fullName: F.colleague.full_name, role: 'operator', facilityId: F.homeFacilityAId,
          isActive: true, status: 'active', isBillable: false, password: 'Colleague-Pass-1!'
        });

        const assign = await call('PUT', `/api/users/${F.colleague.id}`, {
          userId: F.admin.id, body: { facility_id: F.homeFacilityBId }
        });
        assert.strictEqual(assign.status, 200);
        assert.strictEqual((await rowOf(F.colleague.id)).facility_id, F.homeFacilityBId);

        const clear = await call('PUT', `/api/users/${F.colleague.id}`, {
          userId: F.admin.id, body: { facility_id: null }
        });
        assert.strictEqual(clear.status, 200);
        assert.strictEqual((await rowOf(F.colleague.id)).facility_id, null);
      });

      it('18. a malformed facility_id is refused without a write', async () => {
        await resetUser(F.colleague.id, {
          fullName: F.colleague.full_name, role: 'operator', facilityId: F.homeFacilityAId,
          isActive: true, status: 'active', isBillable: false, password: 'Colleague-Pass-1!'
        });

        const response = await call('PUT', `/api/users/${F.colleague.id}`, {
          userId: F.admin.id, body: { facility_id: 'not-a-facility' }
        });

        assert.strictEqual(response.status, 400);
        assert.strictEqual((await rowOf(F.colleague.id)).facility_id, F.homeFacilityAId);
      });

      it('19. creation cannot attach a new user to another tenant’s facility', async () => {
        const username = `atm001sec3_created_bad_${RUN}`;
        const response = await call('POST', '/api/users', {
          userId: F.admin.id,
          body: {
            username, email: `${username}@atm001-sec.test`, password: 'Created-Pass-1!',
            full_name: `ATM001 SEC R3 Created Bad ${RUN}`, role: 'operator',
            facility_id: F.foreignFacilityId
          }
        });

        assert.strictEqual(response.status, 404);
        assert.strictEqual(await rowByUsername(username), null, 'no row may be created');
      });

      it('20. creation within the creator’s tenant persists (D-1: the response body is not the proof)', async () => {
        const username = `atm001sec3_created_ok_${RUN}`;
        const response = await call('POST', '/api/users', {
          userId: F.admin.id,
          body: {
            username, email: `${username}@atm001-sec.test`, password: 'Created-Pass-1!',
            full_name: `ATM001 SEC R3 Created Ok ${RUN}`, role: 'operator',
            facility_id: F.homeFacilityBId
          }
        });

        const created = await rowByUsername(username);
        assert.strictEqual(response.status, 201);
        assert.ok(created, 'the row must exist regardless of the response payload');
        assert.strictEqual(created.facility_id, F.homeFacilityBId);
        assert.strictEqual(created.organization_id, F.homeOrgId);
        assert.strictEqual((await login(username, 'Created-Pass-1!')).status, 200);
      });
    });

    // ------------------------------------------------------- privilege paths
    describe('privilege changes through this route', () => {
      it('21. an operator cannot promote itself or grant itself organization admin', async () => {
        const roleAttempt = await call('PUT', `/api/users/${F.operator.id}`, {
          userId: F.operator.id,
          body: { username: F.operator.username, email: F.operator.email, role: 'admin' }
        });
        assert.strictEqual(roleAttempt.status, 403);
        assert.strictEqual((await rowOf(F.operator.id)).role, 'operator');

        const orgAdminAttempt = await call('PUT', `/api/users/${F.operator.id}`, {
          userId: F.operator.id,
          body: {
            username: F.operator.username, email: F.operator.email,
            is_organization_admin: true
          }
        });
        assert.strictEqual(orgAdminAttempt.status, 403);
        assert.strictEqual((await rowOf(F.operator.id)).is_organization_admin, false);
      });

      it('22. an operator cannot reach a colleague to escalate it', async () => {
        await resetUser(F.colleague.id, {
          fullName: F.colleague.full_name, role: 'operator', facilityId: F.homeFacilityAId,
          isActive: true, status: 'active', isBillable: false, password: 'Colleague-Pass-1!'
        });

        const response = await call('PUT', `/api/users/${F.colleague.id}`, {
          userId: F.operator.id,
          body: {
            username: F.colleague.username, email: F.colleague.email,
            is_organization_admin: true, role: 'admin'
          }
        });
        const after = await rowOf(F.colleague.id);

        assert.strictEqual(response.status, 404);
        assert.strictEqual(after.role, 'operator');
        assert.strictEqual(after.is_organization_admin, false);
      });

      it('23. RECORDED (OWNER decision pending): the pre-existing org-admin grant rule is unchanged', async () => {
        // The approved permission matrix has no ASSIGN_ORGANIZATION_ADMIN action,
        // so this reconciliation deliberately invents none. What is asserted is
        // that the operator path above is closed by the shared guard, and that the
        // surviving grant still requires an organization administrator.
        const granted = await call('PUT', `/api/users/${F.otherFacilityUser.id}`, {
          userId: F.admin.id, body: { is_organization_admin: true }
        });
        assert.strictEqual(granted.status, 200,
          'pre-existing rule: an organization administrator may grant the flag');

        const revoked = await call('PUT', `/api/users/${F.otherFacilityUser.id}`, {
          userId: F.admin.id, body: { is_organization_admin: false }
        });
        assert.strictEqual(revoked.status, 200);

        const nonOrgAdminGrant = await call('PUT', `/api/users/${F.supervisor.id}`, {
          userId: F.supervisor.id, body: { is_organization_admin: true }
        });
        assert.strictEqual(nonOrgAdminGrant.status, 403,
          'a caller that is not an organization administrator cannot grant the flag');
      });
    });

    // ---------------------------------------------------------- body hygiene
    describe('partial bodies, self-service and input typing', () => {
      it('24. an omitted field is not written as NULL (the partial-body wipe)', async () => {
        const before = await rowOf(F.colleague.id);

        const response = await call('PUT', `/api/users/${F.colleague.id}`, {
          userId: F.admin.id, body: { full_name: `Only Name ${RUN}` }
        });
        const after = await rowOf(F.colleague.id);

        assert.strictEqual(response.status, 200);
        assert.strictEqual(after.full_name, `Only Name ${RUN}`);
        assert.strictEqual(after.role, before.role, 'role must survive an omitted field');
        assert.strictEqual(after.facility_id, before.facility_id, 'facility_id must survive an omitted field');
        assert.strictEqual(after.username, before.username);
        assert.strictEqual(after.email, before.email);
      });

      it('25. an empty body is refused rather than producing an empty UPDATE', async () => {
        const before = await rowOf(F.colleague.id);
        const response = await call('PUT', `/api/users/${F.colleague.id}`, {
          userId: F.admin.id, body: {}
        });
        const after = await rowOf(F.colleague.id);

        assert.strictEqual(response.status, 400);
        assert.deepStrictEqual(
          [after.full_name, after.role, after.facility_id, after.is_active],
          [before.full_name, before.role, before.facility_id, before.is_active]
        );
      });

      it('26. a non-boolean is_active is refused instead of being coerced', async () => {
        await resetUser(F.operator.id, {
          fullName: F.operator.full_name, role: 'operator', facilityId: F.homeFacilityAId,
          isActive: true, status: 'active', isBillable: false, password: OPERATOR_ORIGINAL_PASSWORD
        });

        const response = await call('PUT', `/api/users/${F.operator.id}`, {
          userId: F.admin.id, body: { is_active: 'yes' }
        });

        assert.strictEqual(response.status, 400);
        assert.strictEqual((await rowOf(F.operator.id)).is_active, true);
      });

      it('27. string boolean spellings cannot bypass the self-controls', async () => {
        await resetUser(F.operator.id, {
          fullName: F.operator.full_name, role: 'operator', facilityId: F.homeFacilityAId,
          isActive: true, status: 'active', isBillable: false, password: OPERATOR_ORIGINAL_PASSWORD
        });

        const selfDeactivate = await call('PUT', `/api/users/${F.operator.id}`, {
          userId: F.operator.id, body: { is_active: 'false' }
        });
        assert.strictEqual(selfDeactivate.status, 403,
          'a coerced is_active must not slip past the self-deactivation guard');
        assert.strictEqual((await rowOf(F.operator.id)).is_active, true);

        const selfDemote = await call('PUT', `/api/users/${F.admin.id}`, {
          userId: F.admin.id, body: { is_organization_admin: 'false' }
        });
        assert.strictEqual(selfDemote.status, 403,
          'a coerced is_organization_admin must not slip past the self-demotion guard');
        assert.strictEqual((await rowOf(F.admin.id)).is_organization_admin, true);

        const invalidOrgAdmin = await call('PUT', `/api/users/${F.colleague.id}`, {
          userId: F.admin.id, body: { is_organization_admin: 'yes' }
        });
        assert.strictEqual(invalidOrgAdmin.status, 400);
        assert.strictEqual((await rowOf(F.colleague.id)).is_organization_admin, false);
      });

      it('28. an authorized self-update still works, proved by the persisted hash and login', async () => {
        const before = await rowOf(F.operator.id);

        const response = await call('PUT', `/api/users/${F.operator.id}`, {
          userId: F.operator.id,
          body: {
            username: F.operator.username, email: F.operator.email,
            full_name: `Self Renamed ${RUN}`, role: 'operator',
            facility_id: F.operator.facility_id, is_active: true,
            password: OPERATOR_NEW_PASSWORD
          }
        });
        const after = await rowOf(F.operator.id);

        assert.strictEqual(response.status, 200);
        assert.strictEqual(after.full_name, `Self Renamed ${RUN}`);
        assert.notStrictEqual(after.password_hash, before.password_hash);
        assert.ok(await bcrypt.compare(OPERATOR_NEW_PASSWORD, after.password_hash));
        assert.strictEqual((await login(F.operator.username, OPERATOR_NEW_PASSWORD)).status, 200);
        assert.strictEqual((await login(F.operator.username, OPERATOR_ORIGINAL_PASSWORD)).status, 401);

        await resetUser(F.operator.id, {
          fullName: F.operator.full_name, role: 'operator', facilityId: F.homeFacilityAId,
          isActive: true, status: 'active', isBillable: false, password: OPERATOR_ORIGINAL_PASSWORD
        });
      });

      it('29. the response never carries credential material', async () => {
        const response = await call('GET', `/api/users/${F.colleague.id}`, { userId: F.admin.id });

        assert.strictEqual(response.status, 200);
        const serialised = JSON.stringify(response.json);
        assert.ok(!serialised.includes('password_hash'), 'password_hash must not be serialised');
        assert.ok(!Object.prototype.hasOwnProperty.call(response.json.data.user, 'password_hash'));
      });
    });

    // ------------------------------------------------------ reactivation/seat
    describe('the reactivation and seat branch (previously untested)', () => {
      it('30. an omitted is_active does not silently reactivate a suspended billable user', async () => {
        const before = await rowOf(F.seatSuspended.id);
        assert.strictEqual(before.is_active, false);
        assert.strictEqual(before.status, 'suspended');
        assert.strictEqual((await login(F.seatSuspended.username, SUSPENDED_ORIGINAL_PASSWORD)).status, 401);

        const response = await call('PUT', `/api/users/${F.seatSuspended.id}`, {
          userId: F.seatAdmin.id, body: { full_name: `Still Suspended ${RUN}` }
        });
        const after = await rowOf(F.seatSuspended.id);

        assert.strictEqual(response.status, 200);
        assert.strictEqual(after.is_active, false, 'omission must not activate the account');
        assert.strictEqual(after.status, 'suspended');
        assert.strictEqual((await login(F.seatSuspended.username, SUSPENDED_ORIGINAL_PASSWORD)).status, 401,
          'the demonstrated bypass must be closed');
      });

      it('31. an explicit reactivation is refused when no seat is available', async () => {
        assert.strictEqual(await billableSeatCount(), 1,
          'the seat tenant has exactly one billable active user (its single seat)');

        const response = await call('PUT', `/api/users/${F.seatSuspended.id}`, {
          userId: F.seatAdmin.id, body: { is_active: true }
        });
        const after = await rowOf(F.seatSuspended.id);
        const usageAfter = await seatUsage();

        assert.strictEqual(response.status, 403);
        assert.strictEqual(response.json.code, 'SEAT_LIMIT_REACHED');
        assert.strictEqual(after.is_active, false, 'a refused reactivation must not activate');
        assert.strictEqual(after.status, 'suspended');
        // The seat refresh ran; the refused request consumed nothing.
        assert.strictEqual(usageAfter.seats_used, await billableSeatCount());
        assert.strictEqual(usageAfter.seats_used, 1);
        assert.strictEqual((await login(F.seatSuspended.username, SUSPENDED_ORIGINAL_PASSWORD)).status, 401);
      });

      it('32. a string `true` cannot bypass the seat check', async () => {
        const response = await call('PUT', `/api/users/${F.seatSuspended.id}`, {
          userId: F.seatAdmin.id, body: { is_active: 'true' }
        });

        assert.strictEqual(response.status, 403);
        assert.strictEqual(response.json.code, 'SEAT_LIMIT_REACHED');
        assert.strictEqual((await rowOf(F.seatSuspended.id)).is_active, false);
      });

      it('33. RECORDED (OWNER decision pending): a permitted reactivation does not consume a seat', async () => {
        // Give the tenant room, then reactivate for real.
        await withConn(async (conn) => {
          await conn.query(
            'UPDATE organization_subscriptions SET included_users = 3 WHERE organization_id = $1',
            [F.seatOrgId]);
        });

        const usageBefore = await seatUsage();
        const response = await call('PUT', `/api/users/${F.seatSuspended.id}`, {
          userId: F.seatAdmin.id, body: { is_active: true }
        });
        const after = await rowOf(F.seatSuspended.id);
        const usageAfter = await seatUsage();

        assert.strictEqual(response.status, 200);
        assert.strictEqual(after.is_active, true, 'the account is active');
        assert.strictEqual((await login(F.seatSuspended.username, SUSPENDED_ORIGINAL_PASSWORD)).status, 200,
          'and it can log in');

        // RESIDUAL, RECORDED: `status` is not advanced by this route, and seat
        // usage counts `status IN ('active','invited')`, so the reactivated row
        // consumes no seat. The seat check ran; the consumption did not.
        assert.strictEqual(after.status, 'suspended');
        assert.strictEqual(usageAfter.seats_used, usageBefore.seats_used,
          'the reactivation control remains incomplete (recorded finding)');
        assert.strictEqual(usageAfter.seats_used, await billableSeatCount());
        assert.strictEqual(await billableSeatCount(), 1,
          'the active billable count is unchanged: no seat was consumed');

        await withConn(async (conn) => {
          await conn.query(
            'UPDATE organization_subscriptions SET included_users = 1 WHERE organization_id = $1',
            [F.seatOrgId]);
        });
      });

      it('34. the dedicated self-service profile route is unaffected', async () => {
        const response = await call('PUT', '/api/auth/profile', {
          userId: F.operator.id, body: { full_name: `Profile Renamed ${RUN}` }
        });

        assert.strictEqual(response.status, 200);
        assert.strictEqual((await rowOf(F.operator.id)).full_name, `Profile Renamed ${RUN}`);

        await resetUser(F.operator.id, {
          fullName: F.operator.full_name, role: 'operator', facilityId: F.homeFacilityAId,
          isActive: true, status: 'active', isBillable: false, password: OPERATOR_ORIGINAL_PASSWORD
        });
      });
    });

    // ----------------------------------------------------------------- delete
    describe('deletion is tenant-scoped and administrator-only', () => {
      it('35. a supervisor DELETE is refused by the permission contract', async () => {
        const response = await call('DELETE', `/api/users/${F.deleteTarget.id}`, {
          userId: F.supervisor.id
        });

        assert.strictEqual(response.status, 403);
        assert.ok(await rowOf(F.deleteTarget.id), 'the row must survive');
      });

      it('36. an administrator may delete within its tenant, and the effect is a missing row', async () => {
        const username = F.deleteTarget.username;

        const response = await call('DELETE', `/api/users/${F.deleteTarget.id}`, {
          userId: F.admin.id
        });

        assert.strictEqual(response.status, 200);
        assert.strictEqual(await rowOf(F.deleteTarget.id), null, 'the row must be gone');
        assert.strictEqual((await login(username, 'Delete-Target-Pass-1!')).status, 401);
      });

      it('37. deleting an already-absent record yields the shared 404', async () => {
        const response = await call('DELETE', `/api/users/${F.deleteTarget.id}`, {
          userId: F.admin.id
        });
        assert.strictEqual(response.status, 404);
      });

      it('38. an administrator cannot delete its own account through this route', async () => {
        const response = await call('DELETE', `/api/users/${F.admin.id}`, { userId: F.admin.id });

        assert.strictEqual(response.status, 400);
        assert.ok(await rowOf(F.admin.id), 'the row must survive');
      });
    });
  });
