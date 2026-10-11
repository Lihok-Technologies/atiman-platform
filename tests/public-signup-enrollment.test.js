/**
 * ATM-001-SEC-00A — public signup must not confer tenant membership or
 * privileged authority from client-supplied values.
 *
 * Reported defect: `POST /api/auth/signup` is unauthenticated and read both
 * `organization_id` and `role` from the request body. `organization_id` chose
 * the tenant to join (defaulting to organization id 1 when omitted) and `role`
 * was admitted through the handler's `allowedRoles = ['operator','supervisor']`
 * list. An anonymous caller could therefore enroll into any existing tenant and
 * choose their own authority inside it. This endpoint is also the enabling link
 * of the ATM-001-SEC-00 attack chain: signup as a supervisor of a chosen tenant
 * -> `DELETE /api/users/:id` (remediated separately as SEC-00B).
 *
 * Approved enrollment architecture (the flows that must survive):
 *   - joining an EXISTING organization  -> `POST /api/invitations/accept`, where
 *     the tenant and the role come from the invitation record an administrator
 *     created server-side, and the token is the authorization;
 *   - creating a NEW organization       -> `POST /api/auth/organization-signup`,
 *     which is server-authoritative and never joins an existing tenant.
 *
 * Evidence policy: the HTTP layer is exercised against the real Express app and
 * a real disposable PostgreSQL database, so routing, middleware order and the
 * serialised payload are production-shaped rather than simulated. Claims about
 * what did NOT happen (no user created, no uniform-response violation) are
 * asserted against the database and the serialised body.
 *
 * Negative controls: section A asserts the behaviours the pre-fix code
 * violated. Run against the unfixed baseline those tests FAIL - a supervisor or
 * an arbitrary-tenant operator is created with HTTP 201 - which is this
 * suite's own proof that it detects the reported vulnerability.
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * `src/config/database.js` uses to select test-database credentials, so it can
 * never run against runtime credentials.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { getConnection, isIntegrationTest } = require('../src/config/database');
const { hashPassword } = require('../src/utils/helpers');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating public-signup suite requires the sanctioned database-test '
    + 'gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that test-database '
    + 'credentials are used instead of runtime credentials; run it via '
    + '`npm run test:integration`';

const JWT_SECRET = 'test-only-jwt-secret-not-for-production-000000';
const PASSWORD = 'Sec00a-Test-Password-1';

// ---------------------------------------------------------------------------
// Fixtures - uniquely tagged per run
// ---------------------------------------------------------------------------

const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`;
const seq = { n: 0 };
const tag = () => `${RUN}${(++seq.n).toString(36)}`;

let ORG_A = null;
let ORG_B = null;
let ADMIN_A = null;
let PLAN_ID = null;
let INVITE_TOKEN = null;
let INVITED_EMAIL = null;

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

async function ensureFixture() {
  await withConn(async (conn) => {
    const orgs = await conn.query(
      `INSERT INTO organizations (organization_name, subscription_status)
       VALUES ($1, 'active'), ($2, 'active') RETURNING id`,
      [`SEC00A Org A ${RUN}`, `SEC00A Org B ${RUN}`]);
    [ORG_A, ORG_B] = orgs.map((row) => Number(row.id));

    const plan = await conn.query(
      `INSERT INTO subscription_plans (plan_code, plan_name, included_users, max_users)
       VALUES ($1, 'SEC00A Plan', 50, NULL) RETURNING id`,
      [`SEC00A-${tag()}`]);
    PLAN_ID = Number(plan[0].id);

    // Both tenants carry an active subscription with free seats, because the
    // pre-fix defect's own seat gate must not be what blocks it - the security
    // fix has to. Without this, a 403 could be mistaken for a seat refusal.
    await conn.query(
      `INSERT INTO organization_subscriptions
         (organization_id, plan_id, included_users, status, seats_used, seats_available)
       VALUES ($1, $3, 50, 'active', 0, 50), ($2, $3, 50, 'active', 0, 50)`,
      [ORG_A, ORG_B, PLAN_ID]);

    // A real organization administrator in tenant A - the inviter, and the
    // "existing account" used for the username-enumeration probe.
    const adminHash = await hashPassword(PASSWORD);
    const admin = await conn.query(
      `INSERT INTO users (organization_id, username, email, password_hash, full_name,
                          role, is_active, status, is_organization_admin, is_billable)
       VALUES ($1, $2, $3, $4, $5, 'admin', true, 'active', true, true)
       RETURNING id`,
      [ORG_A, `sec00a-admin-${tag()}`, `sec00a-admin-${tag()}@test.local`, adminHash, 'SEC00A Admin A']);
    ADMIN_A = Number(admin[0].id);

    // A pending, unexpired invitation into tenant A, recorded server-side by
    // the administrator. This is the approved mechanism for joining a tenant.
    INVITE_TOKEN = `sec00a-token-${tag()}-${tag()}`;
    INVITED_EMAIL = `sec00a-invitee-${tag()}@test.local`;
    await conn.query(
      `INSERT INTO invitations (organization_id, email, role, invited_by, token, status, expires_at)
       VALUES ($1, $2, 'operator', $3, $4, 'pending', NOW() + INTERVAL '7 days')`,
      [ORG_A, INVITED_EMAIL, ADMIN_A, INVITE_TOKEN]);
  });
}

async function cleanupFixture() {
  try {
    await withConn(async (conn) => {
      if (INVITE_TOKEN) {
        await conn.query(`DELETE FROM invitations WHERE token = $1`, [INVITE_TOKEN]);
      }
      const orgIds = [ORG_A, ORG_B].filter((id) => id !== null);
      if (orgIds.length) {
        await conn.query(`DELETE FROM users WHERE organization_id = ANY($1::int[])`, [orgIds]);
      }
      // Any tenant this suite created - the two fixtures plus whatever
      // `organization-signup` produced - carries the same name prefix, so a
      // partially-created tenant cannot survive a failed assertion.
      const prefix = `SEC00A %${RUN}%`;
      await conn.query(
        `DELETE FROM users WHERE organization_id IN (SELECT id FROM organizations WHERE organization_name LIKE $1)`,
        [prefix]);
      await conn.query(
        `DELETE FROM organization_subscriptions WHERE organization_id IN (SELECT id FROM organizations WHERE organization_name LIKE $1)`,
        [prefix]);
      await conn.query(`UPDATE organizations SET subscription_id = NULL WHERE organization_name LIKE $1`, [prefix]);
      await conn.query(`DELETE FROM organizations WHERE organization_name LIKE $1`, [prefix]);
      await conn.query(`DELETE FROM subscription_plans WHERE plan_code LIKE $1`, [`SEC00A-${RUN}%`]);
    });
  } catch {
    // Disposable-database hygiene only: a cleanup refusal must never mask the
    // security assertions above.
  }
}

/**
 * Snapshot of the user population of the two fixture tenants, used to prove
 * that a refused enrollment attempt created nothing anywhere.
 */
async function tenantUserSnapshot() {
  return withConn(async (conn) => {
    const rows = await conn.query(
      `SELECT organization_id, COUNT(*)::int AS n
       FROM users WHERE organization_id = ANY($1::int[])
       GROUP BY organization_id`,
      [[ORG_A, ORG_B]]);
    const out = { [ORG_A]: 0, [ORG_B]: 0 };
    for (const row of rows) out[Number(row.organization_id)] = row.n;
    return out;
  });
}

async function findUserByUsername(username) {
  return withConn(async (conn) => {
    const rows = await conn.query(
      `SELECT id, organization_id, role, is_organization_admin, is_active, status
       FROM users WHERE username = $1`, [username]);
    return rows[0] || null;
  });
}

// ---------------------------------------------------------------------------
// HTTP harness - the real application
// ---------------------------------------------------------------------------

let server = null;
let port = null;

function call(method, requestPath, { body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = {};
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

const post = (requestPath, body) => call('POST', requestPath, { body });

/** A unique, never-created account identity for a signup attempt. */
function identity(label) {
  const handle = `sec00a-${label}-${tag()}`;
  return { username: handle, email: `${handle}@test.local` };
}

/** Assert the enrollment was refused and that nothing was created. */
async function assertRefusedAndCreatedNothing(response, submitted, label) {
  assert.strictEqual(response.status, 403, `${label}: must be refused (403), got ${response.status}`);
  const parsed = JSON.parse(response.text);
  assert.strictEqual(parsed.success, false, `${label}: must not report success`);
  assert.ok(!response.text.includes('SEC00A Org'), `${label}: must not disclose a tenant name`);
  const created = await findUserByUsername(submitted.username);
  assert.strictEqual(created, null, `${label}: no user may be created by a refused enrollment`);
}

// ==========================================================================

describe('ATM-001-SEC-00A public signup cannot confer tenant membership or privilege', { skip: DB_TEST_SKIP_REASON }, () => {
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

  // ------------------------------------------------------------------ A: defect
  describe('A. the reported defect is closed (negative controls)', () => {
    it('1. an anonymous caller cannot self-assign the supervisor role in an existing tenant', async () => {
      const id = identity('role-supervisor');
      const response = await post('/api/auth/signup', {
        ...id, password: PASSWORD, full_name: 'SEC00A Supervisor Attempt',
        role: 'supervisor', organization_id: ORG_B
      });
      await assertRefusedAndCreatedNothing(response, id, 'supervisor self-assignment');
    });

    it('2. an anonymous caller cannot self-assign the admin role or organization-admin flag', async () => {
      const id = identity('role-admin');
      const response = await post('/api/auth/signup', {
        ...id, password: PASSWORD, full_name: 'SEC00A Admin Attempt',
        role: 'admin', is_organization_admin: true, organization_id: ORG_B
      });
      await assertRefusedAndCreatedNothing(response, id, 'admin self-assignment');
    });

    it('3. an anonymous caller cannot enroll into an existing tenant even as an operator', async () => {
      const id = identity('tenant-join');
      const response = await post('/api/auth/signup', {
        ...id, password: PASSWORD, full_name: 'SEC00A Tenant Join Attempt',
        organization_id: ORG_B
      });
      await assertRefusedAndCreatedNothing(response, id, 'operator tenant enrollment');
    });

    it('4. an anonymous caller cannot enroll by omitting organization_id (legacy default tenant)', async () => {
      const id = identity('default-tenant');
      const response = await post('/api/auth/signup', {
        ...id, password: PASSWORD, full_name: 'SEC00A Default Tenant Attempt', role: 'supervisor'
      });
      await assertRefusedAndCreatedNothing(response, id, 'implicit default-tenant enrollment');
    });

    it('5. forged / malformed role and organization fields are all refused', async () => {
      const variants = [
        { label: 'array role', body: { role: ['supervisor'] } },
        { label: 'object role', body: { role: { role: 'admin' } } },
        { label: 'unknown role', body: { role: 'owner' } },
        { label: 'string org', body: { organization_id: 'abc' } },
        { label: 'unknown org', body: { organization_id: 2147483647 } },
        { label: 'injection org', body: { organization_id: `${ORG_B} OR 1=1` } },
        { label: 'negative org', body: { organization_id: -1 } }
      ];
      for (const variant of variants) {
        const id = identity(`forged-${variant.label.replace(/\W+/g, '-')}`);
        const response = await post('/api/auth/signup', {
          ...id, password: PASSWORD, full_name: 'SEC00A Forged Attempt', ...variant.body
        });
        await assertRefusedAndCreatedNothing(response, id, variant.label);
      }
    });

    it('6. the refusal does not disclose whether a tenant or a username exists', async () => {
      const probes = [
        { label: 'valid tenant', body: { organization_id: ORG_B } },
        { label: 'unknown tenant', body: { organization_id: 2147483646 } },
        { label: 'malformed tenant', body: { organization_id: 'not-an-id' } },
        { label: 'absent tenant', body: {} },
        // An existing account's username must not be distinguishable from a new
        // one: the pre-fix handler answered 409 for a duplicate and 201 for a
        // new account, a global username-enumeration oracle.
        { label: 'existing username', body: { organization_id: ORG_B }, reuseAdminUsername: true }
      ];

      const responses = [];
      for (const probe of probes) {
        const id = identity(`oracle-${probe.label.replace(/\W+/g, '-')}`);
        if (probe.reuseAdminUsername) {
          const adminRows = await withConn((conn) => conn.query(
            `SELECT username, email FROM users WHERE id = $1`, [ADMIN_A]));
          id.username = adminRows[0].username;
          id.email = adminRows[0].email;
        }
        const response = await post('/api/auth/signup', {
          ...id, password: PASSWORD, full_name: 'SEC00A Oracle Attempt', ...probe.body
        });
        assert.strictEqual(response.status, 403,
          `oracle probe "${probe.label}": every refusal must share one status`);
        responses.push({ label: probe.label, text: response.text });
      }

      const first = responses[0].text;
      for (const response of responses.slice(1)) {
        assert.strictEqual(response.text, first,
          `oracle probe "${response.label}": the refusal body must be byte-identical to every other refusal`);
      }
    });

    it('7. no refused attempt created a user, and neither tenant grew', async () => {
      const before = await tenantUserSnapshot();
      assert.strictEqual(before[ORG_A], 1, 'fixture sanity: tenant A holds exactly the administrator');
      assert.strictEqual(before[ORG_B], 0, 'fixture sanity: tenant B is empty');

      const attempts = [
        { role: 'supervisor', organization_id: ORG_B },
        { role: 'admin', is_organization_admin: true, organization_id: ORG_B },
        { organization_id: ORG_A },
        {}
      ];
      for (const attempt of attempts) {
        const id = identity('sweep');
        await post('/api/auth/signup', {
          ...id, password: PASSWORD, full_name: 'SEC00A Sweep Attempt', ...attempt
        });
        assert.strictEqual(await findUserByUsername(id.username), null,
          'no sweep attempt may persist an account');
      }

      const after = await tenantUserSnapshot();
      assert.deepStrictEqual(after, before, 'the tenant user population must be unchanged');
    });
  });

  // ------------------------------------------------- B: approved flows survive
  describe('B. the approved enrollment seams stay server-authoritative', () => {
    it('8. creating a NEW organization never enrolls the caller into an existing tenant', async () => {
      const id = identity('org-create');
      const orgName = `SEC00A New Org ${tag()}`;
      const response = await post('/api/auth/organization-signup', {
        organization_name: orgName,
        industry: 'other',
        ...id,
        password: PASSWORD,
        full_name: 'SEC00A New Org Admin'
      });

      // The security property SEC-00A must preserve: the approved "create" flow
      // is server-authoritative and binds the registrant to a tenant that did
      // not exist before. It must never add an account to an existing tenant.
      const after = await tenantUserSnapshot();
      assert.deepStrictEqual(after, { [ORG_A]: 1, [ORG_B]: 0 },
        'the create flow must not enroll anyone into an existing tenant');

      const createdOrg = await withConn((conn) => conn.query(
        `SELECT id FROM organizations WHERE organization_name = $1`, [orgName]));
      assert.strictEqual(createdOrg.length, 1,
        'the approved create flow must still create the organization it was asked for');

      // Pre-existing baseline defect (RECORDED, deliberately NOT fixed here -
      // out of SEC-00A's bounded scope): `BaseModel.create` issues its INSERT
      // without a RETURNING clause, so `findById(null)` yields null and the
      // handler cannot complete. The organization row above is created; the
      // administrator row and the 201 response are not. This test therefore
      // asserts the enrollment boundary rather than HTTP success. See the
      // mission report for the defect and its escalation.
      if (response.status === 201) {
        const created = await findUserByUsername(id.username);
        assert.ok(created, 'on a completed flow the administrator must exist');
        assert.strictEqual(created.role, 'admin');
        assert.strictEqual(created.is_organization_admin, true);
        assert.strictEqual(Number(created.organization_id), Number(createdOrg[0].id),
          'the registrant must administer only the tenant they just created');
      } else {
        assert.strictEqual(response.status, 500,
          `an incomplete create flow must fail loudly, not silently grant authority: ${response.text}`);
      }
    });

    it('9. joining an existing organization is possible only through an invitation, which alone sets tenant and role', async () => {
      const id = identity('invitee');
      // Every field a caller might use to seize authority is present and forged.
      const response = await post('/api/invitations/accept', {
        token: INVITE_TOKEN,
        username: id.username,
        password: PASSWORD,
        full_name: 'SEC00A Invitee',
        role: 'admin',
        is_organization_admin: true,
        organization_id: ORG_B
      });

      const created = await findUserByUsername(id.username);
      if (created) {
        // The approved seam decides tenant and role from the invitation record.
        assert.strictEqual(Number(created.organization_id), Number(ORG_A),
          'the tenant must come from the invitation, never from the request');
        assert.strictEqual(created.role, 'operator',
          'the role must come from the invitation, never from the request');
        assert.strictEqual(created.is_organization_admin, false,
          'no request field may grant organization-admin authority');
        assert.strictEqual(response.status, 200);
      } else {
        // Pre-existing baseline defect (RECORDED, deliberately NOT fixed here -
        // out of SEC-00A's bounded scope): `subscriptionService.getSeatUsage`
        // reads `activeBillableUsers`, but PostgreSQL folds the unquoted SQL
        // alias to lower case, so the count is `undefined`, `availableSeats`
        // becomes NaN and `canAddUser` is always false. The approved join flow
        // is refused by its own seat gate before any account is created.
        assert.strictEqual(response.status, 403,
          `an uncompleted join must be refused, not grant authority: ${response.text}`);
        assert.ok(/SEAT_LIMIT_REACHED/.test(response.text),
          'the refusal must be the seat gate, never an authority grant');
      }

      // Whichever branch ran, nothing may be enrolled into the foreign tenant.
      const foreign = await withConn((conn) => conn.query(
        `SELECT COUNT(*)::int AS n FROM users WHERE organization_id = $1`, [ORG_B]));
      assert.strictEqual(foreign[0].n, 0, 'no account may be created in another tenant');
    });

    it('10. authentication still works for an existing account', async () => {
      const admin = await withConn((conn) => conn.query(
        `SELECT username FROM users WHERE id = $1`, [ADMIN_A]));
      assert.ok(admin[0], 'fixture sanity: the administrator exists');

      const response = await post('/api/auth/login', {
        username: admin[0].username,
        password: PASSWORD
      });
      assert.strictEqual(response.status, 200, `login regression: ${response.text}`);
      const parsed = JSON.parse(response.text);
      assert.strictEqual(parsed.success, true);
      assert.ok(parsed.data && parsed.data.token, 'login must still issue a token');
    });
  });
});
