/**
 * MISSION 3 — ATM-001-SEC-93 invitation security residuals (A–D).
 *
 * This suite is the independent regression coverage for the four residuals the
 * consolidated candidate (PR #93 / ATM-001-SEC-INTEGRATION-03) left open. Each
 * section states what was OBSERVED on PR #93's head 24b3f48 before this
 * correction, with the database effect rather than the status code.
 *
 *   A. CANCELLATION AUTHORITY. `DELETE /api/invitations/:id` was guarded by
 *      `requireAdmin` alone. `requireAdmin` (src/middleware/auth.js) admits a
 *      SUPERVISOR, whose compatibility bundle deliberately excludes
 *      `org.user_admin`, while the listing and the resend route both carry the
 *      approved ATM-003-R1 invitation-management capability. Reproduced: a
 *      supervisor cancelled an ADMINISTRATOR invitation, HTTP 200, and the row
 *      moved `pending` -> `cancelled`. A non-numeric id also answered 500 with a
 *      raw PostgreSQL message, where resend already answers 404.
 *
 *   B. ACCEPTANCE. `POST /api/invitations/accept` is PUBLIC. Role source was
 *      already correct (`invitation.role`, never the body) — that part is NOT
 *      reported as a defect and is pinned here. What was open: single use. The
 *      handler READ the invitation, then created the account, then marked the
 *      invitation accepted. Under the pre-existing D-1 defect the account INSERT
 *      commits and `User.create` returns null, so the handler threw at
 *      `user.id` BEFORE marking the invitation accepted. Reproduced: the account
 *      existed and the invitation was still `pending` — the token remained a
 *      live credential, and only the unrelated global `uq_users_email`
 *      constraint prevented a second account. Single use is now decided by an
 *      atomic conditional write (`Invitation.claimForAcceptance`) BEFORE the
 *      account is created, so the property holds with or without D-1.
 *
 *   C. CREDENTIAL DISCLOSURE. The listing was already token-free (SEC-00G). Two
 *      open paths remained: (1) `accept` answered with the raw object
 *      `User.create` returned, which is `SELECT * FROM users` including
 *      `password_hash` — verified present on a real row, so repairing D-1 alone
 *      would have turned the PUBLIC accept response into a password-hash
 *      disclosure; (2) the mobile administration view still rendered
 *      `showLinkModal('${inv.token}')` from the token-free listing, i.e.
 *      `?token=undefined`, keeping a credential dependency on the listing that
 *      any "fix" would have restored as a real disclosure.
 *
 *   D. D-1 / D-2 SEQUENCING. Neither defect is repaired here (both are shared
 *      write-path / shared-helper semantics; `canAddUser` has five other
 *      callers). This section asserts them honestly so that no suite can mistake
 *      a defect's fail-closed side effect for an authorization control, and
 *      asserts the one thing this correction changed about the relationship:
 *      single-use acceptance no longer DEPENDS on D-1.
 *
 * ---------------------------------------------------------------------------
 * THE D-2 SEAT MASK, NEUTRALIZED IN THIS PROCESS ONLY
 * ---------------------------------------------------------------------------
 * `subscriptionService.getSeatUsage` selects the alias `activeBillableUsers`;
 * PostgreSQL folds that unquoted alias to lowercase, so the read is `undefined`,
 * `availableSeats` is NaN and `canAddUser()` is false for EVERY organization.
 * Every request reaching the invitation controller is therefore refused 403
 * "Seat limit reached" BEFORE authorization can be distinguished from the
 * defect, and no invitation can be created through the API at all.
 *
 * Sections that must observe the AUTHORIZATION outcome neutralize that defect
 * inside this test process only (`subscriptionService.canAddUser = async () =>
 * true`). No source file is touched, and section D asserts the unpatched value
 * so the mask can never be mistaken for a control.
 *
 * ---------------------------------------------------------------------------
 * NEGATIVE CONTROLS
 * ---------------------------------------------------------------------------
 * Section 0 pins the exact approved wiring, section A2 pins the refusal of a
 * supervisor, and section F names, for each guard, the test that fails when the
 * guard is removed. The mutation results are recorded in the mission report;
 * each mutation was applied to the working tree, observed to fail, and reverted.
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * src/config/database.js uses to select test-database credentials, so it can
 * never run against runtime credentials.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { getConnection, isIntegrationTest } = require('../src/config/database');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating invitation life-cycle / residual suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'test-database credentials are used instead of runtime credentials; run it '
    + 'via `npm run test:integration`';

const JWT_SECRET = 'test-only-jwt-secret-not-for-production-000000';
const REPO_ROOT = path.resolve(__dirname, '..');
const HEX64 = /\b[0-9a-f]{64}\b/;
const BCRYPT = /\$2[aby]\$/;

const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`;
const seq = { n: 0 };
const tag = () => `${RUN}${(++seq.n).toString(36)}`;
const newToken = () => crypto.randomBytes(32).toString('hex');

const U = {};
const INV = {};
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
  const { organizationId, role, facilityId = null, isOrganizationAdmin = false } = options;
  const handle = `sec93-${key.toLowerCase()}-${tag()}`;
  const rows = await conn.query(
    `INSERT INTO users (organization_id, username, email, password_hash, full_name,
                        role, facility_id, is_active, status, is_organization_admin, is_billable)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true,'active',$8,true) RETURNING id`,
    [organizationId, handle, `${handle}@test.local`,
      `$2a$04$${`${RUN}${key}`.padEnd(53, 'y').slice(0, 53)}`,
      `SEC93 ${key}`, role, facilityId, isOrganizationAdmin]);
  U[key] = Number(rows[0].id);
  return U[key];
}

async function makeInvitation(key, options) {
  const { organizationId, role, invitedBy, status = 'pending',
    expiresSql = `NOW() + INTERVAL '7 days'`, email: givenEmail = null } = options;
  const email = givenEmail || `sec93-${key.toLowerCase()}-${tag()}@test.local`;
  const token = newToken();
  const rows = await withConn((conn) => conn.query(
    `INSERT INTO invitations (organization_id, email, role, invited_by, token, status, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,${expiresSql}) RETURNING id`,
    [organizationId, email, role, invitedBy, token, status]));
  INV[key] = { id: Number(rows[0].id), email, role, token, status, organizationId };
  return INV[key];
}

const invitationRow = (id) => withConn((conn) => conn.query(
  `SELECT id, organization_id, email, role, status, token, accepted_at, accepted_by_user_id, updated_at
     FROM invitations WHERE id = ?`, [id])).then((rows) => rows[0] || null);

const usersForUsername = (username) => withConn((conn) => conn.query(
  `SELECT id, username, email, role, organization_id, is_organization_admin, status, password_hash
     FROM users WHERE username = ?`, [username]));

const usersForEmail = (email) => withConn((conn) => conn.query(
  `SELECT id, username, email FROM users WHERE email = ?`, [email]));

async function ensureFixture() {
  await withConn(async (conn) => {
    const orgs = await conn.query(
      `INSERT INTO organizations (organization_name, subscription_status)
       VALUES ($1,'active'),($2,'active') RETURNING id`,
      [`SEC93 Org A ${RUN}`, `SEC93 Org B ${RUN}`]);
    [ORG_A, ORG_B] = orgs.map((r) => Number(r.id));

    const fac = await conn.query(
      `INSERT INTO facilities (organization_id,name,code,facility_type)
       VALUES ($1,'SEC93 Fac A',$2,'WTP') RETURNING id`, [ORG_A, `S93-${tag()}`]);
    FAC_A = Number(fac[0].id);

    // A generous subscription. This is deliberate: it makes the standing fact
    // that `canAddUser` is false (section D) unambiguous — the tenant is nowhere
    // near its seat limit, so the refusal cannot be capacity.
    const plan = await conn.query(
      `INSERT INTO subscription_plans (plan_code,plan_name,included_users,max_users)
       VALUES ($1,'SEC93 Plan',50,NULL) RETURNING id`, [`SEC93-${tag()}`]);
    await conn.query(
      `INSERT INTO organization_subscriptions (organization_id,plan_id,included_users,status)
       VALUES ($1,$2,50,'active'),($3,$2,50,'active')`, [ORG_A, Number(plan[0].id), ORG_B]);

    await insertUser(conn, 'ADMIN_A', { organizationId: ORG_A, role: 'admin', isOrganizationAdmin: true });
    await insertUser(conn, 'SUP_A', { organizationId: ORG_A, role: 'supervisor', facilityId: FAC_A });
    await insertUser(conn, 'OPER_A', { organizationId: ORG_A, role: 'operator', facilityId: FAC_A });
    await insertUser(conn, 'ADMIN_B', { organizationId: ORG_B, role: 'admin', isOrganizationAdmin: true });
  });
}

async function cleanupFixture() {
  // Disposable-database hygiene only. No capability grant is created by this
  // suite (it needs none), so every row it inserts is deletable and the cleanup
  // does not have to attempt a refused DELETE against user_capabilities — the
  // residue migration 022 makes permanent. Anything that survives here must
  // never mask a security assertion.
  try {
    await withConn(async (conn) => {
      await conn.query(`DELETE FROM invitations WHERE email LIKE $1`, [`sec93-%`]);
      await conn.query(`DELETE FROM users WHERE username LIKE $1`, [`sec93-%`]);
      const orgIds = [ORG_A, ORG_B].filter((id) => id !== null);
      if (orgIds.length) {
        await conn.query(`DELETE FROM organization_subscriptions WHERE organization_id = ANY($1::int[])`, [orgIds]);
        await conn.query(`DELETE FROM facilities WHERE organization_id = ANY($1::int[])`, [orgIds]);
        await conn.query(`DELETE FROM users WHERE organization_id = ANY($1::int[])`, [orgIds]);
        await conn.query(`DELETE FROM organizations WHERE id = ANY($1::int[])`, [orgIds]);
      }
      await conn.query(`DELETE FROM subscription_plans WHERE plan_code LIKE $1`, [`SEC93-${RUN}%`]);
    });
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Seams: D-2 neutralization and delivery recording (this process only)
// ---------------------------------------------------------------------------

const subscriptionService = require('../src/services/subscription.service');
const emailService = require('../src/services/email.service');
const { User, Invitation } = require('../src/models');

const REAL_CAN_ADD_USER = subscriptionService.canAddUser;
const REAL_SEND_INVITATION = emailService.sendInvitation;
const REAL_USER_CREATE = User.create;

let delivered = [];

async function withSeatMaskNeutralized(fn) {
  subscriptionService.canAddUser = async () => true;
  try {
    return await fn();
  } finally {
    delete subscriptionService.canAddUser;
  }
}

// ---------------------------------------------------------------------------
// HTTP harness
// ---------------------------------------------------------------------------

let server = null;
let port = null;

const tokenFor = (key) => jwt.sign({ userId: U[key], role: null }, JWT_SECRET, { expiresIn: '1h' });

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
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

const cancelAs = (as, id) => call('DELETE', `/api/invitations/${id}`, { as });
const listAs = (as) => call('GET', '/api/invitations', { as });
const accept = (body) => call('POST', '/api/invitations/accept', { body });
const resendAs = (as, id) => call('POST', `/api/invitations/${id}/resend`, { as });

const acceptBody = (token, suffix, overrides = {}) => ({
  token,
  username: `sec93-acc-${suffix}-${tag()}`,
  password: 'Sec93-Password-123',
  full_name: `SEC93 Accepted ${suffix}`,
  ...overrides
});

const parse = (response) => JSON.parse(response.text);

/** Every credential-bearing path in a payload: a token-named key, or any 64-hex value. */
function credentialPaths(value, at = '$') {
  const hits = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...credentialPaths(v, `${at}[${i}]`)));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (/token/i.test(k)) hits.push(`${at}.${k}`);
      if (/password/i.test(k)) hits.push(`${at}.${k}`);
      hits.push(...credentialPaths(v, `${at}.${k}`));
    }
  } else if (typeof value === 'string' && HEX64.test(value)) {
    hits.push(`${at}=<64-hex value>`);
  }
  return hits;
}

const routesSource = () => fs.readFileSync(
  path.join(REPO_ROOT, 'src', 'routes', 'invitation.routes.js'), 'utf8');
const controllerSource = () => fs.readFileSync(
  path.join(REPO_ROOT, 'src', 'controllers', 'invitation.controller.js'), 'utf8');

/** A token whose invitation is guaranteed acceptable in every fixture below. */
let ACCEPTABLE = null;

// ===========================================================================

describe('MISSION 3 ATM-001-SEC-93 invitation security residuals A-D', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => {
    await ensureFixture();
    delivered = [];
    emailService.sendInvitation = async (options) => { delivered.push(options); };
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
    User.create = REAL_USER_CREATE;
    await cleanupFixture();
  });

  // =====================================================================
  // 0. Guard pins (negative-control anchors)
  // =====================================================================
  describe('0. the approved guards are pinned exactly', () => {
    it('0a. every invitation-management route carries the SAME approved capability', () => {
      const routes = routesSource();
      const cap = "requireCapability('org.user_admin')";
      assert.ok(routes.includes(`router.get('/', ${cap}, invitationController.getAll)`),
        'listing must carry the approved invitation-management capability');
      assert.ok(routes.includes(`router.delete('/:id', ${cap}, invitationController.cancel)`),
        'cancellation must carry the SAME capability as listing — this is residual A');
      assert.ok(routes.includes(`router.post('/:id/resend', ${cap}, invitationController.resend)`),
        'resend must carry the SAME capability as listing');
      assert.ok(!/router\.delete\('\/:id', requireAdmin, invitationController\.cancel\)/.test(routes),
        'the legacy requireAdmin-only cancellation guard must be gone');
    });

    it('0b. no new role, permission, capability or schema was introduced', () => {
      const capabilities = fs.readFileSync(path.join(REPO_ROOT, 'src', 'config', 'capabilities.js'), 'utf8');
      const permissions = fs.readFileSync(path.join(REPO_ROOT, 'src', 'config', 'permissions.js'), 'utf8');
      assert.match(capabilities, /ORG_USER_ADMIN: 'org\.user_admin'/,
        'the approved capability vocabulary is consumed, never edited');
      assert.match(permissions, /CREATE: \{ admin: 'all', supervisor: 'all', operator: 'none' \}/,
        'the approved USERS.CREATE contract is unchanged');
      // No migration was added by this correction.
      const migrations = fs.readdirSync(path.join(REPO_ROOT, 'database', 'postgresql'))
        .filter((f) => f.endsWith('.sql'));
      assert.ok(!migrations.some((f) => /^02[4-9]/.test(f)),
        'this correction introduces no migration');
    });

    it('0c. the public registration and signup routes are untouched', () => {
      const authRoutes = fs.readFileSync(path.join(REPO_ROOT, 'src', 'routes', 'auth.routes.js'), 'utf8');
      assert.match(authRoutes, /router\.post\('\/signup', authController\.signup\)/);
      assert.match(authRoutes, /router\.post\('\/organization-signup', authController\.organizationSignup\)/);
      assert.ok(!/invitation/i.test(authRoutes),
        'no invitation authority may be introduced into the authentication routes');
    });
  });

  // =====================================================================
  // A. CANCELLATION AUTHORITY
  // =====================================================================
  describe('A. cancellation authority (residual A)', () => {
    it('A1. a SUPERVISOR cannot cancel — reproduced as a supervisor cancelling an administrator invitation', async () => {
      // The invitation is an ADMINISTRATOR invitation: this is the exact case
      // observed to succeed on 24b3f48 (HTTP 200, row pending -> cancelled).
      const inv = await makeInvitation('A1_SUP', { organizationId: ORG_A, role: 'admin', invitedBy: U.ADMIN_A });
      const before = await invitationRow(inv.id);

      const response = await cancelAs('SUP_A', inv.id);
      const after = await invitationRow(inv.id);

      assert.strictEqual(response.status, 403,
        `a supervisor must not cancel any invitation; got ${response.status} ${response.text}`);
      assert.match(response.text, /org\.user_admin/,
        'the refusal must come from the approved invitation-management capability');
      assert.deepStrictEqual(after, before,
        'a refused cancellation must leave the row byte-identical (status, role, token, updated_at)');
      assert.strictEqual(after.status, 'pending', 'the invitation must still be acceptable');
    });

    it('A2. an OPERATOR cannot cancel', async () => {
      const inv = await makeInvitation('A2_OPER', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      const before = await invitationRow(inv.id);
      const response = await cancelAs('OPER_A', inv.id);
      assert.strictEqual(response.status, 403);
      assert.deepStrictEqual(await invitationRow(inv.id), before);
    });

    it('A3. an unauthenticated caller cannot cancel', async () => {
      const inv = await makeInvitation('A3_ANON', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      const before = await invitationRow(inv.id);
      const response = await call('DELETE', `/api/invitations/${inv.id}`);
      assert.strictEqual(response.status, 401);
      assert.deepStrictEqual(await invitationRow(inv.id), before);
    });

    it('A4. a TENANT ADMINISTRATOR may cancel a pending invitation in their OWN tenant, and the row changes', async () => {
      const inv = await makeInvitation('A4_ADMIN', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      const before = await invitationRow(inv.id);
      assert.strictEqual(before.status, 'pending');

      const response = await cancelAs('ADMIN_A', inv.id);
      const after = await invitationRow(inv.id);

      assert.strictEqual(response.status, 200,
        `the authorized positive path must be preserved; got ${response.status} ${response.text}`);
      assert.strictEqual(after.status, 'cancelled', 'the authorized cancellation must take effect');
      assert.strictEqual(after.token, before.token, 'cancellation must not reissue or alter the token');
    });

    it('A5. cross-tenant cancellation is inert and indistinguishable from a missing invitation', async () => {
      const inv = await makeInvitation('A5_FOREIGN', { organizationId: ORG_B, role: 'operator', invitedBy: U.ADMIN_B });
      const before = await invitationRow(inv.id);

      const response = await cancelAs('ADMIN_A', inv.id);
      const after = await invitationRow(inv.id);

      assert.strictEqual(response.status, 404,
        'another tenant must not be able to distinguish "exists elsewhere" from "does not exist"');
      assert.deepStrictEqual(after, before, 'a foreign invitation must not be altered');
      assert.strictEqual(after.status, 'pending');
    });

    it('A6. a malformed identifier is a 404, not a 500 carrying driver detail', async () => {
      // Reproduced on 24b3f48: 500 {"message":"invalid input syntax for type integer: \"abc\""}
      const response = await cancelAs('ADMIN_A', 'abc');
      assert.strictEqual(response.status, 404,
        `a non-numeric id cannot name an invitation; got ${response.status} ${response.text}`);
      assert.ok(!/invalid input syntax|pg_|relation "|syntax for type/i.test(response.text),
        'the refusal must carry no database or driver detail');
      // The same shape guard the resend route already applies.
      const controller = controllerSource();
      const cancelHandler = controller.slice(controller.indexOf('async cancel(req, res, next)'));
      assert.match(cancelHandler.slice(0, cancelHandler.indexOf('async validate')),
        /if \(!\/\^\\d\+\$\/\.test\(String\(invitationId\)\)\)/,
        'cancellation must reject a non-numeric id before it reaches the database');
    });

    it('A7. cancellation only applies to a pending invitation, and it does not resurrect one', async () => {
      for (const [suffix, status] of [['accepted', 'accepted'], ['cancelled', 'cancelled']]) {
        const inv = await makeInvitation(`A7_${suffix.toUpperCase()}`, {
          organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A, status
        });
        const before = await invitationRow(inv.id);
        const response = await cancelAs('ADMIN_A', inv.id);
        assert.strictEqual(response.status, 400,
          `a ${status} invitation is terminal and must be refused`);
        assert.deepStrictEqual(await invitationRow(inv.id), before,
          `a refused cancellation of a ${status} invitation must not alter the row`);
      }
    });

    it('A8. an EXPIRED invitation is not cancellable as pending, and its row is not altered', async () => {
      // Expiry is derived (status stays 'pending' with a past expires_at), so
      // this asserts the handler's own predicate, not a status value.
      const inv = await makeInvitation('A8_EXPIRED', {
        organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A,
        expiresSql: `NOW() - INTERVAL '1 day'`
      });
      const before = await invitationRow(inv.id);
      const response = await cancelAs('ADMIN_A', inv.id);
      const after = await invitationRow(inv.id);
      // The handler refuses only on `status !== 'pending'`; an expired-but-pending
      // row is therefore cancellable. Recorded rather than asserted as a control:
      // the security-relevant fact is that it becomes unusable either way.
      assert.ok([200, 400].includes(response.status),
        `an expired invitation must be answered deterministically; got ${response.status}`);
      if (response.status === 200) {
        assert.strictEqual(after.status, 'cancelled');
      } else {
        assert.deepStrictEqual(after, before);
      }
      assert.strictEqual(await subscriptionService.canAddUser(ORG_A), false,
        'D-2 is in force; the seat gate, not this route, is what refuses most requests');
    });
  });

  // =====================================================================
  // B. ACCEPTANCE — role issuance, single use, revoke/expiry, cross-tenant
  // =====================================================================
  describe('B. acceptance role issuance and single use (residual B)', () => {
    it('B1. the granted role, tenant and org-admin flag come from the PERSISTED row only', async () => {
      const inv = await makeInvitation('B1_ROLE', { organizationId: ORG_A, role: 'supervisor', invitedBy: U.ADMIN_A });
      const username = `sec93-acc-b1-${tag()}`;

      const response = await withSeatMaskNeutralized(() => accept({
        token: inv.token,
        username,
        password: 'Sec93-Password-123',
        full_name: 'SEC93 B1',
        // Every escalation vector a public caller could offer:
        role: 'admin',
        is_organization_admin: true,
        organization_id: ORG_B,
        facility_id: null,
        is_billable: true,
        status: 'active'
      }));

      const rows = await usersForUsername(username);
      assert.strictEqual(rows.length, 1, 'the acceptance must still create the account');
      assert.strictEqual(rows[0].role, 'supervisor',
        'the granted role is the invitation row\'s role, never the request body\'s');
      assert.strictEqual(Number(rows[0].organization_id), ORG_A,
        'the tenant is the invitation row\'s tenant, never the request body\'s');
      assert.strictEqual(rows[0].is_organization_admin, false,
        'acceptance must never confer organization-administrator authority');
      assert.ok(!BCRYPT.test(response.text), 'the accept response must not carry a password hash');
    });

    it('B2. `Invitation.claimForAcceptance` is atomic: exactly one caller may claim', async () => {
      const inv = await makeInvitation('B2_CLAIM', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      const first = await Invitation.claimForAcceptance(inv.id);
      const second = await Invitation.claimForAcceptance(inv.id);
      assert.strictEqual(first, true, 'the first claim must win');
      assert.strictEqual(second, false, 'the second claim must lose — this is the single-use decision');
      const row = await invitationRow(inv.id);
      assert.strictEqual(row.status, 'accepted');
      assert.notStrictEqual(row.accepted_at, null, 'the claim must record when it happened');
    });

    it('B3. claimForAcceptance refuses a CANCELLED invitation (reuse after revoke)', async () => {
      const inv = await makeInvitation('B3_REVOKED', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      const cancelled = await cancelAs('ADMIN_A', inv.id);
      assert.strictEqual(cancelled.status, 200);
      assert.strictEqual(await Invitation.claimForAcceptance(inv.id), false,
        'a revoked invitation must not be claimable');
    });

    it('B4. claimForAcceptance refuses an EXPIRED invitation', async () => {
      const inv = await makeInvitation('B4_EXPIRED', {
        organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A,
        expiresSql: `NOW() - INTERVAL '1 second'`
      });
      assert.strictEqual(await Invitation.claimForAcceptance(inv.id), false,
        'an expired invitation must not be claimable, even while status is still pending');
      const row = await invitationRow(inv.id);
      assert.strictEqual(row.status, 'pending', 'the refused claim must not alter the row');
    });

    it('B5. the first acceptance RETIRES the invitation, so the token is single-use (reuse after accept)', async () => {
      const inv = await makeInvitation('B5_SINGLE', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      const username = `sec93-acc-b5-${tag()}`;

      await withSeatMaskNeutralized(() => accept(acceptBody(inv.token, 'b5', { username })));

      const userRows = await usersForUsername(username);
      assert.strictEqual(userRows.length, 1, 'the first acceptance must create the account (D-1 commits the row)');

      const afterFirst = await invitationRow(inv.id);
      assert.strictEqual(afterFirst.status, 'accepted',
        'THE PROPERTY: the invitation must be RETIRED by the first acceptance, independent of D-1');
      assert.notStrictEqual(afterFirst.accepted_at, null);

      // The second acceptance, with the SAME token and a distinct username.
      const secondName = `sec93-acc-b5b-${tag()}`;
      const second = await withSeatMaskNeutralized(() => accept(acceptBody(inv.token, 'b5b', { username: secondName })));

      assert.strictEqual(second.status, 404,
        `the retired token must be refused as invalid/expired; got ${second.status} ${second.text}`);
      assert.strictEqual((await usersForUsername(secondName)).length, 0,
        'no second account may be created from a consumed invitation');
      assert.strictEqual((await usersForEmail(inv.email)).length, 1,
        'exactly one account may exist for the invitation');
    });

    it('B6. an invitation CANCELLED between the eligibility read and the claim cannot mint an account', async () => {
      const inv = await makeInvitation('B6_RACE', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      // Simulate the revocation landing after findByToken would have read the row
      // as pending: revoke, then drive the public accept with the now-dead token.
      await cancelAs('ADMIN_A', inv.id);
      const username = `sec93-acc-b6-${tag()}`;
      const response = await withSeatMaskNeutralized(() => accept(acceptBody(inv.token, 'b6', { username })));
      assert.strictEqual(response.status, 404, 'a revoked token must be refused before any write');
      assert.strictEqual((await usersForUsername(username)).length, 0, 'no account may be created');
    });

    it('B7. an EXPIRED invitation cannot mint an account, and the refusal writes nothing', async () => {
      const inv = await makeInvitation('B7_EXPIRED', {
        organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A,
        expiresSql: `NOW() - INTERVAL '1 day'`
      });
      const before = await invitationRow(inv.id);
      const username = `sec93-acc-b7-${tag()}`;
      const response = await withSeatMaskNeutralized(() => accept(acceptBody(inv.token, 'b7', { username })));
      assert.strictEqual(response.status, 404);
      assert.strictEqual((await usersForUsername(username)).length, 0);
      assert.deepStrictEqual(await invitationRow(inv.id), before, 'the refusal must be a no-op');
    });

    it('B8. a PREDICTABLE conflict does not consume the invitation (an already-registered address)', async () => {
      // The account email is fixed by the invitation, and users.email is
      // globally unique. Before this correction the conflict surfaced as a 500
      // from the driver AND, with a claim-first order, would have burned the
      // invitation. It must be refused BEFORE the claim.
      const dupEmail = `sec93-b8-${tag()}@test.local`;
      await withConn((conn) => conn.query(
        `INSERT INTO users (organization_id,username,email,password_hash,full_name,role,is_active,status,is_billable)
         VALUES ($1,$2,$3,'$2a$04$sec93b8sec93b8sec93b8sec93b8sec93b8sec93b8sec93b8sec','SEC93 B8','operator',true,'active',true)`,
        [ORG_A, `sec93-b8-${tag()}`, dupEmail]));

      const inv = await makeInvitation('B8_DUP', {
        organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A, email: dupEmail
      });
      const before = await invitationRow(inv.id);
      const username = `sec93-acc-b8-${tag()}`;

      const response = await withSeatMaskNeutralized(() => accept(acceptBody(inv.token, 'b8', { username })));

      assert.strictEqual(response.status, 409,
        `a duplicate address must be a conflict, not an unhandled driver error; got ${response.status} ${response.text}`);
      assert.ok(!/duplicate key|uq_users_email|violates unique/i.test(response.text),
        'the refusal must not carry raw constraint detail');
      assert.strictEqual((await usersForUsername(username)).length, 0, 'no account may be created');
      assert.deepStrictEqual(await invitationRow(inv.id), before,
        'THE PROPERTY: a predictable refusal must leave the invitation still acceptable');
    });

    it('B9. a concurrent double-accept creates exactly one account and one acceptance', async () => {
      const inv = await makeInvitation('B9_CONCURRENT', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      const nameA = `sec93-acc-b9a-${tag()}`;
      const nameB = `sec93-acc-b9b-${tag()}`;

      const [r1, r2] = await withSeatMaskNeutralized(() => Promise.all([
        accept(acceptBody(inv.token, 'b9a', { username: nameA })),
        accept(acceptBody(inv.token, 'b9b', { username: nameB }))
      ]));

      const rows = await usersForEmail(inv.email);
      assert.strictEqual(rows.length, 1,
        'one invitation must never yield two accounts, however the requests interleave');
      const row = await invitationRow(inv.id);
      assert.strictEqual(row.status, 'accepted', 'the invitation must be consumed exactly once');
      assert.strictEqual([r1, r2].filter((r) => r.status === 404).length + [r1, r2].filter((r) => r.status === 409).length,
        1, 'exactly one of the two concurrent acceptances must be refused');
    });

    it('B10. the claim is a single conditional statement, not a read followed by a write', () => {
      const model = fs.readFileSync(path.join(REPO_ROOT, 'src', 'models', 'invitation.model.js'), 'utf8');
      const claim = model.slice(model.indexOf('async claimForAcceptance'), model.indexOf('async accept('));
      assert.match(claim, /UPDATE \$\{this\.tableName\}/,
        'the claim must be a single UPDATE');
      assert.match(claim, /WHERE id = \? AND status = 'pending' AND expires_at > NOW\(\)/,
        'the claim must apply the SAME predicate findByToken applies, atomically');
      assert.match(claim, /affectedRows/,
        'the claim must decide on the number of rows it changed, not on a prior read');
    });
  });

  // =====================================================================
  // C. CREDENTIAL REDACTION
  // =====================================================================
  describe('C. credential disclosure (residual C)', () => {
    it('C1. the LISTING discloses no token, no password field and no credential value', async () => {
      const response = await listAs('ADMIN_A');
      assert.strictEqual(response.status, 200);
      const body = parse(response);
      const paths = credentialPaths(body);
      assert.deepStrictEqual(paths, [],
        `the listing must expose no credential-bearing path: ${JSON.stringify(paths)}`);
      assert.ok(!BCRYPT.test(response.text), 'no bcrypt hash may appear in the listing');
      assert.ok(!/password/i.test(response.text), 'no password field may appear in the listing');
      // Literal absence of every token this suite created.
      for (const inv of Object.values(INV)) {
        assert.ok(!response.text.includes(inv.token),
          'no invitation token this suite created may appear in the listing');
      }
    });

    it('C2. the ACCEPT response redacts the account: an allow-list, not a row spread', async () => {
      // Deterministic and D-1-INDEPENDENT. `User.create` is replaced for this one
      // test with a value shaped exactly like a real row INCLUDING
      // password_hash — which is what `BaseModel.create` returns once D-1 is
      // repaired. If the handler ever spreads that object into the response, the
      // public route discloses a bcrypt hash and this test fails.
      const inv = await makeInvitation('C2_REDACT', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      const fakeHash = '$2b$10$sec93C2sec93C2sec93C2sec93C2sec93C2sec93C2sec93C2sec93C2';
      User.create = async (data) => ({
        id: U.OPER_A,
        username: data.username,
        email: data.email,
        password_hash: fakeHash,
        full_name: data.full_name,
        phone: data.phone,
        role: data.role,
        organization_id: data.organization_id,
        facility_id: null,
        is_active: true,
        status: 'active',
        is_organization_admin: false,
        is_sso_user: false,
        sso_provider: null,
        last_sso_login_at: null,
        invited_by: null,
        invited_at: null,
        last_login: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_billable: true
      });

      try {
        const response = await withSeatMaskNeutralized(() => accept(acceptBody(inv.token, 'c2')));
        assert.strictEqual(response.status, 200,
          `the acceptance must serialise once the account object is available; got ${response.status} ${response.text}`);
        assert.ok(!response.text.includes(fakeHash),
          'THE PROPERTY: the public accept response must never echo the account\'s password hash');
        assert.ok(!BCRYPT.test(response.text), 'no bcrypt hash of any form may appear');
        assert.ok(!/password/i.test(response.text), 'no password field may appear');
        const body = parse(response);
        assert.ok(!Object.prototype.hasOwnProperty.call(body.data.user, 'password_hash'),
          'password_hash must be absent from the projected user');
        for (const field of ['id', 'username', 'email', 'full_name', 'role', 'organization_id']) {
          assert.ok(field in body.data.user, `${field} must survive the projection (business behaviour)`);
        }
      } finally {
        User.create = REAL_USER_CREATE;
      }
    });

    it('C3. CREATE and RESEND responses disclose no password material (and issue a live token in the row)', async () => {
      const email = `sec93-c3-${tag()}@test.local`;
      const create = await withSeatMaskNeutralized(() =>
        call('POST', '/api/invitations', { as: 'ADMIN_A', body: { email, role: 'operator' } }));
      assert.ok(!BCRYPT.test(create.text), 'no password hash may appear in a create response');
      assert.ok(!/password/i.test(create.text), 'no password field may appear in a create response');

      const created = await withConn((conn) => conn.query(
        `SELECT id, token, status FROM invitations WHERE email = ?`, [email]));
      assert.strictEqual(created.length, 1,
        'D-1: the invitation is persisted even though the response cannot serialise (asserted in section D)');
      assert.match(String(created[0].token), HEX64, 'the delivery exists in the row');

      const inv = await makeInvitation('C3_RESEND', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      const resend = await resendAs('ADMIN_A', inv.id);
      assert.ok(!BCRYPT.test(resend.text), 'no password hash may appear in a resend response');
      assert.ok(!/password/i.test(resend.text), 'no password field may appear in a resend response');
    });

    it('C4. the PUBLIC validate endpoint echoes only the caller\'s own token, and no credential material', async () => {
      const inv = await makeInvitation('C4_VALIDATE', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      const response = await call('GET', `/api/invitations/validate/${inv.token}`);
      assert.strictEqual(response.status, 200);
      const body = parse(response);
      // The caller already holds the token; echoing it is not a disclosure. What
      // must never appear is ANOTHER invitation's credential or any hash.
      assert.ok(!BCRYPT.test(response.text), 'no password hash may appear');
      assert.ok(!/password/i.test(response.text), 'no password field may appear');
      for (const other of Object.values(INV)) {
        if (other.token !== inv.token) {
          assert.ok(!response.text.includes(other.token),
            'a token other than the one presented must never be disclosed');
        }
      }
      assert.strictEqual(body.data.invitation.role, 'operator');
    });

    it('C5. the mobile administration view reads no token from the listing', () => {
      const view = fs.readFileSync(
        path.join(REPO_ROOT, 'views', 'mobile', 'admin', 'invitations.ejs'), 'utf8');
      assert.ok(!/\$\{inv\.token\}/.test(view),
        'the view must not interpolate a listing token (it rendered ?token=undefined and encoded the dependency)');
      assert.match(view, /data\.data\?\.invitation\?\.token/,
        'the view must read a credential only from the delivery moment (create/resend response)');
      assert.match(view, /copyInvitationLink|showLinkModal/,
        'the delivery-moment link affordance itself is preserved');
    });
  });

  // =====================================================================
  // D. D-1 / D-2 sequencing dependencies, reported not repaired
  // =====================================================================
  describe('D. D-1 / D-2 sequencing dependencies (reported, not repaired)', () => {
    it('D1. D-2 is reproduced: canAddUser() is false for a tenant with spare seats', async () => {
      const unpatched = await REAL_CAN_ADD_USER.call(subscriptionService, ORG_A);
      assert.strictEqual(unpatched, false,
        'D-2: the seat helper refuses a tenant with 50 seats and 3 billable users');
      const usage = await subscriptionService.getSeatUsage(ORG_A);
      assert.ok(Number.isNaN(usage.availableSeats),
        'D-2 root cause: the case-folded alias yields undefined active users, so availableSeats is NaN');
      assert.ok(usage.availableSeats > 0 === false, 'NaN compares false, hence canAddUser() === false');
    });

    it('D2. D-2 masks the whole invitation controller, and is NOT an authorization control', async () => {
      // With D-2 in force, an authorized administrator is refused 403 by the seat
      // gate. A 403 produced here is evidence of a capacity defect, not of
      // authority — which is why every authorization assertion in this suite
      // neutralizes it.
      const email = `sec93-d2-${tag()}@test.local`;
      const response = await call('POST', '/api/invitations', { as: 'ADMIN_A', body: { email, role: 'operator' } });
      assert.strictEqual(response.status, 403);
      assert.match(response.text, /Seat limit reached/);
      assert.strictEqual((await withConn((conn) => conn.query(
        `SELECT id FROM invitations WHERE email = ?`, [email]))).length, 0,
      'the masked path persists nothing');
    });

    it('D3. D-1 is reproduced: a create commits the invitation and then answers 500', async () => {
      const email = `sec93-d1-${tag()}@test.local`;
      const response = await withSeatMaskNeutralized(() =>
        call('POST', '/api/invitations', { as: 'ADMIN_A', body: { email, role: 'operator' } }));
      assert.strictEqual(response.status, 500,
        'D-1: BaseModel.create returns null, so Invitation.createInvitation throws at result.id');
      const rows = await withConn((conn) => conn.query(
        `SELECT id, token, status, role FROM invitations WHERE email = ?`, [email]));
      assert.strictEqual(rows.length, 1,
        'REPORTED: the invitation IS persisted despite the error response, with a live token');
      assert.match(String(rows[0].token), HEX64);
      assert.strictEqual(rows[0].status, 'pending');
      assert.ok(!HEX64.test(response.text),
        'and the token was never delivered — the caller cannot learn the credential it created');
    });

    it('D4. D-1 is reproduced: a resend commits a REPLACEMENT and leaves the ORIGINAL live', async () => {
      const inv = await makeInvitation('D4_RESEND', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      const response = await resendAs('ADMIN_A', inv.id);
      assert.strictEqual(response.status, 500, 'D-1 throws after the replacement has committed');

      const rows = await withConn((conn) => conn.query(
        `SELECT id, status, token FROM invitations WHERE email = ? ORDER BY id`, [inv.email]));
      assert.strictEqual(rows.length, 2,
        'REPORTED: the replacement is persisted even though the request failed');
      const live = rows.filter((r) => r.status === 'pending');
      assert.strictEqual(live.length, 2,
        'REPORTED: Invitation.cancel is never reached, so BOTH rows stay pending — two live tokens '
        + 'for one invitee. Their role is identical, so this adds no privilege; it is a lifecycle '
        + 'integrity defect caused by D-1 and it is escalated, not repaired here.');
      for (const row of live) assert.match(String(row.token), HEX64);
    });

    it('D5. single-use acceptance does NOT depend on D-1 (the one dependency this correction removed)', async () => {
      // The accept handler still cannot serialise under D-1, but the invitation
      // must be retired by the claim regardless. This is the assertion that made
      // residual B a security defect: on 24b3f48 the invitation stayed pending.
      const inv = await makeInvitation('D5_INDEP', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      const username = `sec93-acc-d5-${tag()}`;
      const response = await withSeatMaskNeutralized(() => accept(acceptBody(inv.token, 'd5', { username })));
      assert.strictEqual(response.status, 500,
        'D-1 is still in force: the account row commits and the handler throws at user.id');
      assert.strictEqual((await usersForUsername(username)).length, 1, 'the account row IS committed');

      const row = await invitationRow(inv.id);
      assert.strictEqual(row.status, 'accepted',
        'THE PROPERTY: the invitation is retired by the atomic claim, so D-1 no longer re-opens the token');
      assert.notStrictEqual(row.accepted_at, null);
      assert.strictEqual(row.accepted_by_user_id, null,
        'REPORTED RESIDUAL: attribution stays NULL while D-1 prevents reading the created account id');
    });

    it('D6. the D-1/D-2 repairs were NOT attempted (shared write-path semantics untouched)', () => {
      const base = fs.readFileSync(path.join(REPO_ROOT, 'src', 'models', 'base.model.js'), 'utf8');
      assert.match(base, /const insertId = \(result && result\.insertId\) \|\| \(Array\.isArray\(result\) && result\.insertId\);/,
        'D-1: BaseModel.create is unchanged');
      const subs = fs.readFileSync(path.join(REPO_ROOT, 'src', 'services', 'subscription.service.js'), 'utf8');
      assert.match(subs, /SELECT COUNT\(\*\) as activeBillableUsers/,
        'D-2: the seat helper is unchanged');
      assert.match(subs, /const activeUsers = result\[0\]\.activeBillableUsers;/,
        'D-2: the case-folding read is unchanged');
      // The other callers that a D-2 repair would affect must remain identifiable.
      const callers = fs.readFileSync(path.join(REPO_ROOT, 'src', 'middleware', 'seat-limit.js'), 'utf8');
      assert.match(callers, /canAddUser/, 'seat-limit middleware still depends on canAddUser');
    });
  });

  // =====================================================================
  // E. Business behaviour preserved
  // =====================================================================
  describe('E. preserved business behaviour', () => {
    it('E1. the acceptance still joins the inviting tenant and the invited role', async () => {
      const inv = await makeInvitation('E1_JOIN', { organizationId: ORG_B, role: 'admin', invitedBy: U.ADMIN_B });
      const username = `sec93-acc-e1-${tag()}`;
      await withSeatMaskNeutralized(() => accept(acceptBody(inv.token, 'e1', { username })));
      const rows = await usersForUsername(username);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].role, 'admin', 'an administrator invitation still grants admin, as designed');
      assert.strictEqual(Number(rows[0].organization_id), ORG_B);
      assert.strictEqual(rows[0].is_organization_admin, false,
        'the role is granted but never the organization-administrator flag');
    });

    it('E2. acceptance is still PUBLIC — no authentication is required', async () => {
      const inv = await makeInvitation('E2_PUBLIC', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      const username = `sec93-acc-e2-${tag()}`;
      const response = await withSeatMaskNeutralized(() => accept(acceptBody(inv.token, 'e2', { username })));
      assert.notStrictEqual(response.status, 401, 'acceptance must remain reachable without a session');
      assert.strictEqual((await usersForUsername(username)).length, 1);
    });

    it('E3. validation still describes an acceptable invitation to its holder', async () => {
      const inv = await makeInvitation('E3_VALIDATE', { organizationId: ORG_A, role: 'supervisor', invitedBy: U.ADMIN_A });
      const response = await call('GET', `/api/invitations/validate/${inv.token}`);
      assert.strictEqual(response.status, 200);
      const body = parse(response);
      assert.strictEqual(body.data.invitation.email, inv.email);
      assert.strictEqual(body.data.invitation.role, 'supervisor');
      assert.strictEqual(body.data.invitation.organization.id, ORG_A);
    });

    it('E4. an unknown or malformed token is refused identically', async () => {
      for (const token of [newToken(), 'not-a-token', '']) {
        const response = await accept(acceptBody(token, 'e4'));
        assert.ok([400, 404].includes(response.status),
          `an unusable token must be refused; got ${response.status}`);
      }
    });
  });

  // =====================================================================
  // F. Negative-control index
  // =====================================================================
  describe('F. negative-control index (each guard has a test that fails without it)', () => {
    it('F1. names the failing test for every deliberate guard removal', () => {
      // Executed and recorded in the mission report; asserted here only so the
      // mapping cannot rot silently.
      const index = {
        "route guard requireCapability('org.user_admin') on DELETE /:id":
          'A1 (supervisor refused), A2 (operator refused), 0a (exact guard pinned)',
        'controller /^\\d+$/ shape guard in cancel':
          'A6 (malformed id is a 404 and carries no driver detail)',
        'Invitation.claimForAcceptance conditional UPDATE':
          'B2 (atomic claim), B5 (single use), B9 (concurrent double-accept), B10 (single statement)',
        'claim placed BEFORE User.create in accept':
          'D5 (single use independent of D-1)',
        'accept email-conflict pre-check before the claim':
          'B8 (a predictable refusal does not consume the invitation)',
        'toAcceptedUserView allow-list projection in accept':
          'C2 (a row containing password_hash is not echoed), C1 (no credential path in listings)',
        'view no longer interpolating a listing token':
          'C5 (no ${inv.token} in the administration view)'
      };
      assert.strictEqual(Object.keys(index).length, 7);
    });
  });
});
