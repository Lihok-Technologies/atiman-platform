/**
 * ATM-001-SEC-00E — POST /api/invitations role-assignment authority.
 *
 * Reported defect: the route was guarded by `requireAdmin` alone, which admits a
 * supervisor (src/middleware/auth.js) and does not distinguish an organization
 * administrator from a plain administrator. The handler then took `role` from
 * the request body and persisted it as the role the invitation grants
 * (invitation.controller.js), and `POST /api/invitations/accept` creates the
 * account with that role. The invitation schema admits `admin`
 * (database/postgresql/001_core.sql, `chk_invitations_role`), so a supervisor —
 * or an administrator with `is_organization_admin = false` — could issue an
 * invitation that grants administrator privileges.
 *
 * The approved role-assignment authority already exists in this codebase as
 * `canCreateUser` (src/middleware/rbac.js) and `POST /api/users` already applies
 * it. This suite asserts that `POST /api/invitations` applies the same authority
 * and invents no new one:
 *
 *   - a supervisor may invite only `operator`, and must be assigned to a facility;
 *   - inviting an `admin` requires `is_organization_admin` on the caller;
 *   - an operator may not invite anyone;
 *   - the tenant is always the caller's own organization, never the request body.
 *
 * ===========================================================================
 * THE SEAT MASK (D-2) AND THE SAFE NEGATIVE CONTROL
 * ===========================================================================
 * The remediation is a route guard that runs BEFORE the handler. Its effect is
 * therefore observable directly: a refused request is answered 403 by
 * `canCreateUser` with its own message, and the handler never runs.
 *
 * However, the baseline carries a pre-existing defect that MASKS the whole
 * invitation controller: `subscriptionService.getSeatUsage` reads the alias
 * `activeBillableUsers`, PostgreSQL folds that unquoted alias to lowercase, and
 * so the read yields `undefined` -> `availableSeats` is NaN ->
 * `canAddUser` returns `false` for every organization. Every request that
 * reaches the controller's seat check is refused with 403 "Seat limit reached",
 * INCLUDING a legitimate organization administrator.
 *
 * A 403 caused by that defect is not evidence of authorization. Section D
 * therefore asserts the masked behaviour explicitly, and the sections that must
 * observe the AUTHORIZATION outcome neutralize the defect INSIDE THIS TEST
 * PROCESS ONLY:
 *
 *     subscriptionService.canAddUser = async () => true   // this process only
 *
 * That patch is not a source change. It is applied and restored by
 * `withSeatMaskNeutralized`, it never touches a file, and it cannot weaken the
 * running application. Fixing D-2 is a separate bounded task and is explicitly
 * out of ATM-001-SEC-00E's scope.
 *
 * ===========================================================================
 * NEGATIVE CONTROL
 * ===========================================================================
 * Section B asserts the behaviours the pre-fix code violates. Run unchanged
 * against the unfixed baseline, a supervisor and a plain administrator both
 * persist an administrator invitation — those tests FAIL there. That is this
 * suite's own proof that it detects the reported vulnerability.
 *
 * PRE-EXISTING DEFECT, deliberately not repaired here (D-1): `BaseModel.create`
 * issues its INSERT without `RETURNING`, so it returns null. Authorized
 * creations therefore assert the DATABASE EFFECT and never a 201 status; the
 * 201 branch cannot serialise until D-1 is repaired, and repairing D-1 changes
 * no authorization outcome asserted here.
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
  : 'database-mutating invitation-authorization suite requires the sanctioned '
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
let FAC_B = null;

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
  const handle = `sec00e-${key.toLowerCase()}-${tag()}`;
  const rows = await conn.query(
    `INSERT INTO users (organization_id, username, email, password_hash, full_name,
                        role, facility_id, is_active, status, is_organization_admin, is_billable)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'active', $8, true)
     RETURNING id`,
    [organizationId, handle, `${handle}@test.local`, marker, `SEC00E ${key}`,
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
      [`SEC00E Org A ${RUN}`, `SEC00E Org B ${RUN}`]);
    [ORG_A, ORG_B] = orgs.map((row) => Number(row.id));

    const facilities = await conn.query(
      `INSERT INTO facilities (organization_id, name, code, facility_type)
       VALUES ($1, 'SEC00E Facility A', $2, 'WTP'),
              ($3, 'SEC00E Facility B', $4, 'WTP') RETURNING id`,
      [ORG_A, `SF-${tag()}`, ORG_B, `SF-${tag()}`]);
    [FAC_A, FAC_B] = facilities.map((row) => Number(row.id));

    // Seat fixtures: the invitation controller runs seat validation, so both
    // tenants need an active subscription exactly as production does. (The
    // subscription does not change the authorization outcome — section D shows
    // the seat check refuses regardless — but a missing row would make the
    // masked path a different refusal than the one production produces.)
    const plan = await conn.query(
      `INSERT INTO subscription_plans (plan_code, plan_name, included_users, max_users)
       VALUES ($1, 'SEC00E Plan', 50, NULL) RETURNING id`,
      [`SEC00E-${tag()}`]);
    await conn.query(
      `INSERT INTO organization_subscriptions (organization_id, plan_id, included_users, status)
       VALUES ($1, $2, 50, 'active'), ($3, $2, 50, 'active')`,
      [ORG_A, Number(plan[0].id), ORG_B]);

    // Exactly two administrators in Org A, so the approved per-organization admin
    // cap (3) leaves room for an authorized admin invitation below.
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
      await conn.query(`DELETE FROM invitations WHERE email LIKE $1`, [`sec00e-%`]);
      await conn.query(`DELETE FROM users WHERE username LIKE $1`, [`sec00e-%`]);
      const orgIds = [ORG_A, ORG_B].filter((id) => id !== null);
      if (orgIds.length) {
        await conn.query(`DELETE FROM organization_subscriptions WHERE organization_id = ANY($1::int[])`, [orgIds]);
        await conn.query(`DELETE FROM facilities WHERE organization_id = ANY($1::int[])`, [orgIds]);
        await conn.query(`DELETE FROM users WHERE organization_id = ANY($1::int[])`, [orgIds]);
        await conn.query(`DELETE FROM organizations WHERE id = ANY($1::int[])`, [orgIds]);
      }
      await conn.query(`DELETE FROM subscription_plans WHERE plan_code LIKE $1`, [`SEC00E-${RUN}%`]);
    });
  } catch {
    // Test-database hygiene only: the database is disposable, so a cleanup
    // refusal must never mask the security assertions above.
  }
}

// ---------------------------------------------------------------------------
// The seat mask (D-2) — neutralized in this process only.
// ---------------------------------------------------------------------------

const subscriptionService = require('../src/services/subscription.service');
const emailService = require('../src/services/email.service');

const REAL_CAN_ADD_USER = subscriptionService.canAddUser;
const REAL_SEND_INVITATION = emailService.sendInvitation;

let delivered = [];

/**
 * Replace the delivery call with a recorder.
 *
 * Delivery is an externally visible side effect, so the record of whether it was
 * ATTEMPTED is the assertion target. The recorder also keeps the suite from
 * opening an SMTP connection. It is a test-process seam, restored on exit.
 */
function installDeliveryRecorder() {
  delivered = [];
  emailService.sendInvitation = async (options) => { delivered.push(options); };
}

/**
 * Neutralize the D-2 seat defect for the duration of one test, in this process
 * only, so the AUTHORIZATION outcome underneath it can be observed.
 *
 * With the defect in force `canAddUser` answers `false` for every organization,
 * and the controller refuses every request — authorized or not — before the
 * authority under test can be distinguished from the defect.
 */
async function withSeatMaskNeutralized(fn) {
  subscriptionService.canAddUser = async () => true;
  try {
    return await fn();
  } finally {
    subscriptionService.canAddUser = REAL_CAN_ADD_USER;
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

const invite = (as, body) => call('POST', '/api/invitations', { as, body });

const newEmail = (suffix) => `sec00e-${suffix}-${tag()}@test.local`;

/**
 * Every invitation this suite could have created, scoped to the two fixture
 * tenants.
 *
 * A table-wide count is NOT a valid invariant: `node --test` executes suite
 * files in parallel processes against one shared database, so an unrelated
 * suite's fixtures can land between reads. Scoping to the tenants this suite
 * created keeps the "nothing was written" assertion meaningful under the
 * sanctioned runner as well as in isolation.
 */
const fixtureInvitations = () => withConn((conn) => conn.query(
  `SELECT id, email, role, organization_id, status, token
     FROM invitations WHERE organization_id = ? OR organization_id = ?`,
  [ORG_A, ORG_B]));

const invitationFor = (email) => withConn((conn) => conn.query(
  `SELECT id, email, role, organization_id, status, token
     FROM invitations WHERE email = ?`, [email]));

/** A usable invitation token is 32 random bytes rendered as 64 hex characters. */
const TOKEN_SHAPE = /\b[0-9a-f]{64}\b/;

/**
 * Assert that a REFUSED request left no invitation, no token and no delivery.
 *
 * The discriminating assertions are the 403 and the ABSENT ROW: D-1 also
 * prevents delivery on every path today, so `delivered.length === 0` alone
 * would not distinguish a refusal from the pre-existing defect. The row
 * assertion is what proves the handler never ran.
 */
async function assertNothingIssued(response, email, label) {
  assert.strictEqual(response.status, 403, `${label}: expected 403, got ${response.status} ${response.text}`);
  assert.strictEqual((await invitationFor(email)).length, 0,
    `${label}: a refused request must persist no invitation row`);
  assert.strictEqual(delivered.length, 0,
    `${label}: a refused request must trigger no delivery`);
  assert.ok(!TOKEN_SHAPE.test(response.text),
    `${label}: a refusal must not carry a usable invitation token`);
}

const inviteBody = (email, overrides = {}) => ({ email, role: 'operator', ...overrides });

// ===========================================================================
// Executable security regression
//
// The whole file is gated on the sanctioned database-test predicate, including
// the structural assertions below, because tests/database-test-guard.test.js
// requires a database-mutating suite to execute ZERO tests without that gate.
// ===========================================================================

describe('ATM-001-SEC-00E POST /api/invitations role-assignment authority', { skip: DB_TEST_SKIP_REASON }, () => {
  // ---------------------------------------------------------- structural
  describe('0. route wiring and scope containment (source assertions)', () => {
    it('1. the invitation chain applies the approved role-assignment authority', () => {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'src', 'routes', 'invitation.routes.js'), 'utf8');
      assert.match(
        source,
        /router\.post\('\/', requireAdmin, canCreateUser, invitationController\.create\)/,
        'the invitation route must apply canCreateUser, the authority POST /api/users already uses');
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

    it('3. the invitation schema still admits exactly the three approved roles', () => {
      const schema = fs.readFileSync(path.join(REPO_ROOT, 'database', 'postgresql', '001_core.sql'), 'utf8');
      assert.match(schema,
        /chk_invitations_role CHECK \(role IN \('operator','supervisor','admin'\)\)/,
        'SEC-00E changes no schema: the role vocabulary is enforced in the application layer, not by migration');
    });

    it('4. the invitation handler never reads a tenant or an admin flag from the body', () => {
      const controller = fs.readFileSync(path.join(REPO_ROOT, 'src', 'controllers', 'invitation.controller.js'), 'utf8');
      const handler = controller.slice(controller.indexOf('async create(req, res, next)'));
      const body = handler.slice(0, handler.indexOf('async cancel(req, res, next)'));
      assert.doesNotMatch(body, /organization_id\s*=\s*req\.body|req\.body\.organization_id/,
        'the tenant must come from the authenticated session, never the request body');
      assert.match(body, /const organizationId = req\.user\?\.organization_id;/,
        'the tenant must be the caller’s own organization');
      assert.doesNotMatch(body, /req\.body\.is_organization_admin/,
        'the organization-administrator flag must come from the session, never the request body');
    });

    it('5. the public signup and registration workflow is not touched by this change', () => {
      const authRoutes = fs.readFileSync(path.join(REPO_ROOT, 'src', 'routes', 'auth.routes.js'), 'utf8');
      assert.match(authRoutes, /router\.post\('\/signup', authController\.signup\)/,
        'the public signup route must be unchanged');
      assert.match(authRoutes, /router\.post\('\/organization-signup', authController\.organizationSignup\)/,
        'the organization signup route must be unchanged');
      // SEC-00E is an invitation-route remediation only. It neither introduces
      // nor removes registration authority, so the register chain must remain
      // exactly what the baseline carries.
      assert.doesNotMatch(authRoutes, /invitation/i,
        'no invitation authority may be introduced into the authentication routes');
    });
  });

  before(async () => {
    await ensureFixture();
    installDeliveryRecorder();
    process.env.JWT_SECRET = JWT_SECRET;
    const app = require('../src/app');
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    emailService.sendInvitation = REAL_SEND_INVITATION;
    subscriptionService.canAddUser = REAL_CAN_ADD_USER;
    await cleanupFixture();
  });

  // =====================================================================
  // A. Admission control — runs with the seat mask in force, because these
  //    refusals happen before the handler and are therefore unaffected by it.
  // =====================================================================
  describe('A. authentication and role admission', () => {
    it('6. an unauthenticated request cannot create an invitation', async () => {
      const email = newEmail('anon');
      delivered = [];
      const response = await call('POST', '/api/invitations', { body: inviteBody(email, { role: 'admin' }) });
      assert.strictEqual(response.status, 401, 'authentication is required before any authority is consulted');
      assert.strictEqual((await invitationFor(email)).length, 0, 'no invitation may be persisted');
      assert.strictEqual(delivered.length, 0, 'no delivery may be attempted');
    });

    it('7. an OPERATOR cannot create an invitation', async () => {
      const email = newEmail('oper');
      delivered = [];
      const response = await invite('OPER_A', inviteBody(email, { role: 'admin' }));
      await assertNothingIssued(response, email, 'operator');
    });
  });

  // =====================================================================
  // B. The AUTHORIZATION outcome, with the D-2 seat mask neutralized in this
  //    process only. This section is the negative control: on the unfixed
  //    baseline the supervisor and plain-administrator cases persist an
  //    administrator invitation and FAIL here.
  // =====================================================================
  describe('B. role-assignment authority (D-2 seat mask neutralized in-process)', () => {
    it('8. a SUPERVISOR cannot issue an administrator invitation', async () => {
      const email = newEmail('sup-admin');
      delivered = [];
      const response = await withSeatMaskNeutralized(() => invite('SUP_A', inviteBody(email, { role: 'admin' })));
      await assertNothingIssued(response, email, 'supervisor -> admin');
      assert.match(response.text, /Can only create operator users/,
        'the refusal must come from canCreateUser, the approved authority');
    });

    it('9. a supervisor cannot issue an administrator invitation with a forged is_organization_admin flag', async () => {
      const email = newEmail('sup-forged-orgadmin');
      delivered = [];
      const response = await withSeatMaskNeutralized(() => invite('SUP_A',
        inviteBody(email, { role: 'admin', is_organization_admin: true })));
      await assertNothingIssued(response, email, 'supervisor + forged is_organization_admin');
    });

    it('10. a supervisor cannot issue an administrator invitation with a forged organization_id', async () => {
      const email = newEmail('sup-forged-org');
      delivered = [];
      const response = await withSeatMaskNeutralized(() => invite('SUP_A',
        inviteBody(email, { role: 'admin', organization_id: ORG_B })));
      await assertNothingIssued(response, email, 'supervisor + forged organization_id');
    });

    it('11. a PLAIN administrator cannot issue an administrator invitation', async () => {
      const email = newEmail('plainadmin-admin');
      delivered = [];
      const response = await withSeatMaskNeutralized(() => invite('PLAIN_ADMIN_A', inviteBody(email, { role: 'admin' })));
      await assertNothingIssued(response, email, 'plain administrator -> admin');
      assert.match(response.text, /Only organization administrators can create admin accounts/,
        'the refusal must come from canCreateUser, the approved authority');
    });

    it('12. a plain administrator cannot elevate by forging is_organization_admin in the body', async () => {
      const email = newEmail('plainadmin-forged');
      delivered = [];
      const response = await withSeatMaskNeutralized(() => invite('PLAIN_ADMIN_A',
        inviteBody(email, { role: 'admin', is_organization_admin: true })));
      await assertNothingIssued(response, email, 'plain administrator + forged flag');
      assert.match(response.text, /Only organization administrators can create admin accounts/,
        'the organization-administrator flag must be read from the session, not the body');
    });

    it('13. a supervisor cannot issue a supervisor invitation', async () => {
      const email = newEmail('sup-sup');
      delivered = [];
      const response = await withSeatMaskNeutralized(() => invite('SUP_A', inviteBody(email, { role: 'supervisor' })));
      await assertNothingIssued(response, email, 'supervisor -> supervisor');
    });

    // OWNER ruling, ATM-001-SEC-00E: align with canCreateUser. A supervisor with
    // no facility may not invite anyone, exactly as `POST /api/users` and
    // `POST /api/auth/register` already refuse. Reported as a deliberate
    // tightening, never hidden.
    it('14. a supervisor with no facility cannot invite even an operator', async () => {
      const email = newEmail('sup-nofac');
      delivered = [];
      const response = await withSeatMaskNeutralized(() => invite('SUP_NO_FACILITY', inviteBody(email, { role: 'operator' })));
      await assertNothingIssued(response, email, 'supervisor without facility -> operator');
      assert.match(response.text, /Supervisor must be assigned to a facility/,
        'the refusal must come from canCreateUser, the approved authority');
    });

    it('15. an invalid role value is refused and persists nothing', async () => {
      const email = newEmail('sup-badrole');
      delivered = [];
      const response = await withSeatMaskNeutralized(() => invite('SUP_A', inviteBody(email, { role: 'superadmin' })));
      await assertNothingIssued(response, email, 'supervisor -> invalid role');
    });

    it('16. malformed role values are refused and persist nothing', async () => {
      const cases = [
        { role: 'Admin' },
        { role: ['admin'] },
        { role: { role: 'admin' } },
        { role: ' admin' },
        { role: 'admin\n' }
      ];
      for (const overrides of cases) {
        const email = newEmail('malformed');
        delivered = [];
        const response = await withSeatMaskNeutralized(() => invite('SUP_A', inviteBody(email, overrides)));
        await assertNothingIssued(response, email,
          `supervisor -> malformed role ${JSON.stringify(overrides.role)}`);
      }
    });

    // Adversarial challenge: the cases above are refused by canCreateUser. These
    // assert the SECOND gate — a role outside the approved vocabulary must never
    // be persisted even where the authority gate PASSES, so the refusal cannot
    // depend on canCreateUser alone.
    it('16a. an organization administrator cannot persist a role outside the approved vocabulary', async () => {
      for (const role of ['superadmin', 'ADMIN', 'admin ', 'owner', 'root']) {
        const email = newEmail('orgadmin-invalid');
        delivered = [];
        const response = await withSeatMaskNeutralized(() => invite('ADMIN_A', inviteBody(email, { role })));

        assert.notStrictEqual(response.status, 201,
          `role ${JSON.stringify(role)} must never be accepted`);
        assert.strictEqual((await invitationFor(email)).length, 0,
          `role ${JSON.stringify(role)} must never be persisted`);
        assert.ok(!TOKEN_SHAPE.test(response.text),
          `role ${JSON.stringify(role)} must never yield a usable token`);
      }
    });

    it('16b. an organization administrator cannot persist a malformed role value', async () => {
      for (const role of [['admin'], { role: 'admin' }, 1, true]) {
        const email = newEmail('orgadmin-malformed');
        delivered = [];
        const response = await withSeatMaskNeutralized(() => invite('ADMIN_A', inviteBody(email, { role })));

        assert.notStrictEqual(response.status, 201,
          `malformed role ${JSON.stringify(role)} must never be accepted`);
        assert.strictEqual((await invitationFor(email)).length, 0,
          `malformed role ${JSON.stringify(role)} must never be persisted`);
      }
    });

    it('17. every refused supervisor or plain-administrator attempt left the invitation population unchanged', async () => {
      const before = await fixtureInvitations();
      const attempts = [
        ['SUP_A', { role: 'admin' }],
        ['SUP_A', { role: 'supervisor' }],
        ['SUP_NO_FACILITY', { role: 'operator' }],
        ['PLAIN_ADMIN_A', { role: 'admin' }],
        ['OPER_A', { role: 'operator' }]
      ];
      for (const [as, overrides] of attempts) {
        await withSeatMaskNeutralized(() => invite(as, inviteBody(newEmail('sweep'), overrides)));
      }
      const after = await fixtureInvitations();
      assert.strictEqual(after.length, before.length,
        'no refused request may add an invitation row');
      assert.strictEqual(await withConn((conn) => conn.query(
        `SELECT COUNT(*)::int AS count FROM invitations
          WHERE (organization_id = ? OR organization_id = ?) AND role = 'admin'`,
        [ORG_A, ORG_B]).then((rows) => Number(rows[0].count))), 0,
      'no administrator invitation may exist yet: every attempt so far was refused '
      + 'and no authorized creator has acted at this point in the suite');
    });
  });

  // =====================================================================
  // C. Legitimate authority is preserved, and the tenant never comes from the
  //    request body.
  // =====================================================================
  describe('C. legitimate invitations and tenant authority', () => {
    it('18. a supervisor with a facility may still invite an operator', async () => {
      const email = newEmail('sup-operator');
      delivered = [];
      const response = await withSeatMaskNeutralized(() => invite('SUP_A', inviteBody(email, { role: 'operator' })));
      assert.notStrictEqual(response.status, 403, 'an authorized caller must not be refused');

      const rows = await invitationFor(email);
      assert.strictEqual(rows.length, 1, 'the ordinary-user invitation must persist');
      assert.strictEqual(rows[0].role, 'operator', 'the invited role must be operator');
      assert.strictEqual(Number(rows[0].organization_id), ORG_A, 'the tenant must be the caller’s organization');
      assert.match(String(rows[0].token), TOKEN_SHAPE, 'an authorized invitation must carry a usable token');
      // D-1: `Invitation.createInvitation` throws at `result.id` AFTER the INSERT
      // commits, so the handler never reaches the delivery call on ANY path
      // today. Recorded, not assumed. The delivery assertion that carries
      // security weight is therefore the refusal case in section B — a refused
      // request must attempt no delivery — and it is asserted there.
      // INVERTED (ATM-001-SEC-B3D condition 2). D-1 is repaired in this tree, so
      // the create handler now reaches the delivery call on the authorized path.
      assert.strictEqual(delivered.length, 1,
        'D-1 repaired: the authorized create path reaches exactly one delivery call');
    });

    it('19. a missing role still defaults to operator for an authorized supervisor', async () => {
      const email = newEmail('sup-default');
      delivered = [];
      const response = await withSeatMaskNeutralized(() => invite('SUP_A', { email }));
      assert.notStrictEqual(response.status, 403, 'the ordinary-user invitation path must be preserved');
      const rows = await invitationFor(email);
      assert.strictEqual(rows.length, 1, 'the invitation must persist');
      assert.strictEqual(rows[0].role, 'operator', 'an omitted role defaults to operator, as before');
    });

    it('20. a forged organization_id cannot redirect a supervisor invitation', async () => {
      const email = newEmail('sup-forged-tenant');
      delivered = [];
      await withSeatMaskNeutralized(() => invite('SUP_A',
        inviteBody(email, { role: 'operator', organization_id: ORG_B })));
      const rows = await invitationFor(email);
      assert.strictEqual(rows.length, 1, 'the invitation must persist in the caller’s tenant');
      assert.strictEqual(Number(rows[0].organization_id), ORG_A,
        'the tenant must be the authenticated session, never the request body');
      assert.strictEqual(await withConn((conn) => conn.query(
        `SELECT COUNT(*)::int AS count FROM invitations WHERE organization_id = ?`, [ORG_B])
        .then((r) => Number(r[0].count))), 0,
      'no invitation may be written into another tenant');
    });

    it('21. an organization administrator may issue an administrator invitation', async () => {
      const email = newEmail('orgadmin-admin');
      delivered = [];
      const response = await withSeatMaskNeutralized(() => invite('ADMIN_A', inviteBody(email, { role: 'admin' })));
      assert.notStrictEqual(response.status, 403,
        'an organization administrator holds the approved administrator-assignment authority');

      const rows = await invitationFor(email);
      assert.strictEqual(rows.length, 1, 'the authorized administrator invitation must persist');
      assert.strictEqual(rows[0].role, 'admin', 'the granted role must be admin');
      assert.strictEqual(Number(rows[0].organization_id), ORG_A, 'the tenant must be the caller’s organization');
    });

    it('22. an organization administrator may issue an operator invitation', async () => {
      const email = newEmail('orgadmin-operator');
      delivered = [];
      await withSeatMaskNeutralized(() => invite('ADMIN_A', inviteBody(email, { role: 'operator' })));
      const rows = await invitationFor(email);
      assert.strictEqual(rows.length, 1, 'the authorized invitation must persist');
      assert.strictEqual(rows[0].role, 'operator', 'the granted role must be operator');
    });

    it('23. a cross-tenant administrator cannot write into another tenant', async () => {
      const email = newEmail('cross-tenant');
      delivered = [];
      await withSeatMaskNeutralized(() => invite('ADMIN_B',
        inviteBody(email, { role: 'operator', organization_id: ORG_A })));
      const rows = await invitationFor(email);
      assert.strictEqual(rows.length, 1, 'the invitation must persist in the caller’s own tenant');
      assert.strictEqual(Number(rows[0].organization_id), ORG_B,
        'a tenant identifier in the body must never select the write target');
      assert.strictEqual(await withConn((conn) => conn.query(
        `SELECT COUNT(*)::int AS count FROM invitations WHERE organization_id = ? AND email = ?`, [ORG_A, email])
        .then((r) => Number(r[0].count))), 0,
      'the other tenant must remain untouched');
    });
  });

  // =====================================================================
  // D. The masking defect, asserted honestly.
  // =====================================================================
  describe('D. the pre-existing seat defect (D-2) masks the controller', () => {
    it('24. with the defect in force the seat check refuses even an authorized organization administrator', async () => {
      const email = newEmail('masked-orgadmin');
      delivered = [];
      const response = await invite('ADMIN_A', inviteBody(email, { role: 'operator' }));
      assert.strictEqual(response.status, 403,
        'the D-2 seat defect refuses every request that reaches the controller');
      assert.match(response.text, /Seat limit reached/,
        'the refusal must be the seat gate, NOT the role-assignment authority');
      assert.strictEqual((await invitationFor(email)).length, 0,
        'the masked path persists nothing');

      // The point of this test: a 403 produced by D-2 is NOT evidence that the
      // authorization boundary holds. Section B neutralizes D-2 to observe the
      // authority itself.
      assert.strictEqual(await subscriptionService.canAddUser(ORG_A), false,
        'canAddUser must be false on the baseline, which is why section B neutralizes it');
    });
  });

  // =====================================================================
  // E. Acceptance semantics are preserved.
  // =====================================================================
  describe('E. invitation acceptance remains functional', () => {
    it('25. an authorized operator invitation can still be accepted, and grants the invited role only', async () => {
      const email = newEmail('accept-operator');
      delivered = [];
      await withSeatMaskNeutralized(() => invite('SUP_A', inviteBody(email, { role: 'operator' })));
      const [invitation] = await invitationFor(email);
      assert.ok(invitation, 'the invitation must exist before acceptance');

      const username = `sec00e-accepted-${tag()}`;
      const response = await withSeatMaskNeutralized(() => call('POST', '/api/invitations/accept', {
        body: { token: invitation.token, username, password: 'Sec00e-Password-123', full_name: 'SEC00E Accepted' }
      }));

      // D-1: `User.create` commits the INSERT but returns null, so the handler
      // cannot serialise. The security property is the DATABASE EFFECT.
      const rows = await withConn((conn) => conn.query(
        `SELECT id, username, role, organization_id, status, is_organization_admin
           FROM users WHERE username = ?`, [username]));
      assert.strictEqual(rows.length, 1, 'acceptance must still create the account');
      assert.strictEqual(rows[0].role, 'operator', 'acceptance grants the invited role');
      assert.strictEqual(Number(rows[0].organization_id), ORG_A, 'acceptance joins the inviting tenant');
      assert.strictEqual(rows[0].is_organization_admin, false,
        'acceptance must never confer organization-administrator authority');
      assert.notStrictEqual(response.status, 201,
        'D-1 is expected to prevent the serialised 201; this is asserted, not assumed');
    });

    it('26. an administrator invitation accepted by its invitee grants admin, as designed', async () => {
      const email = newEmail('accept-admin');
      delivered = [];
      await withSeatMaskNeutralized(() => invite('ADMIN_B', inviteBody(email, { role: 'admin' })));
      const [invitation] = await invitationFor(email);
      assert.ok(invitation, 'the authorized administrator invitation must exist');

      const username = `sec00e-accepted-admin-${tag()}`;
      await withSeatMaskNeutralized(() => call('POST', '/api/invitations/accept', {
        body: { token: invitation.token, username, password: 'Sec00e-Password-123', full_name: 'SEC00E Accepted Admin' }
      }));

      const rows = await withConn((conn) => conn.query(
        `SELECT role, organization_id, is_organization_admin FROM users WHERE username = ?`, [username]));
      assert.strictEqual(rows.length, 1, 'acceptance must create the account');
      assert.strictEqual(rows[0].role, 'admin',
        'acceptance preserves the invited role — which is why creation-time authority is the control point');
      assert.strictEqual(Number(rows[0].organization_id), ORG_B, 'the invited tenant is preserved');
      assert.strictEqual(rows[0].is_organization_admin, false,
        'acceptance confers the role but not the organization-administrator flag');
    });

    // ---------------------------------------------------------------------
    // RESIDUAL — this test asserts a LIMITATION, not a control.
    //
    // SEC-00E gates invitation CREATION. It deliberately does not change
    // acceptance (mission §6.10), and it introduces no migration (mission §7).
    // An administrator invitation that a supervisor persisted BEFORE this
    // change is therefore still acceptable by the unchanged acceptance path.
    //
    // This is recorded so that nobody reads the fix as retroactive. Closing it
    // requires an OWNER decision about existing rows, and would exceed SEC-00E:
    // the permitted scope carries no data remediation and no schema change.
    // ---------------------------------------------------------------------
    it('28. RESIDUAL: a pre-existing pending administrator invitation is still acceptable', async () => {
      const email = newEmail('preexisting-admin');
      const username = `sec00e-accepted-preexisting-${tag()}`;

      // Insert the row directly, exactly as the pre-fix code would have left it.
      await withConn((conn) => conn.query(
        `INSERT INTO invitations (organization_id, email, role, invited_by, token, status, expires_at)
         VALUES ($1, $2, 'admin', $3, $4, 'pending', NOW() + INTERVAL '7 days')`,
        [ORG_B, email, USERS.ADMIN_B, 'f'.repeat(64)]));

      await withSeatMaskNeutralized(() => call('POST', '/api/invitations/accept', {
        body: {
          token: 'f'.repeat(64), username,
          password: 'Sec00e-Password-123', full_name: 'SEC00E Pre-existing'
        }
      }));

      const rows = await withConn((conn) => conn.query(
        `SELECT role, organization_id FROM users WHERE username = ?`, [username]));
      assert.strictEqual(rows.length, 1,
        'RESIDUAL: the unchanged acceptance path still creates the account');
      assert.strictEqual(rows[0].role, 'admin',
        'RESIDUAL: and still grants the invited role — creation is the ONLY control point');
    });
  });

  // =====================================================================
  // F. No credential disclosure (the invitation response is not a credential
  //    channel) — asserted because the response is new surface under test.
  // =====================================================================
  describe('F. the invitation response discloses no credential', () => {
    it('29. no password hash is present in any invitation response', async () => {
      const email = newEmail('no-credential');
      delivered = [];
      const response = await withSeatMaskNeutralized(() => invite('ADMIN_A', inviteBody(email, { role: 'operator' })));
      assert.ok(!/\$2[aby]\$/.test(response.text), 'no bcrypt hash may appear in the response');
      assert.ok(!Object.values(HASHES).some((hash) => response.text.includes(hash)),
        'no fixture credential material may appear in the response');
      assert.ok(!/password_hash/.test(response.text), 'no password field may appear in the response');
    });
  });
});
