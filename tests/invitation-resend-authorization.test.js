/**
 * ATM-001-SEC-00H — POST /api/invitations/:id/resend authorization and lifecycle.
 *
 * Reported defects (ATM-001-SEC-00F):
 *   SEC-00F-1  the route was guarded by `requireAdmin` alone, so a supervisor -
 *              or an administrator without organization-administration authority -
 *              could reissue an ADMINISTRATOR invitation;
 *   SEC-00F-3  the handler performed no status or expiry check, so a cancelled,
 *              expired or already-accepted invitation could be revived into a
 *              fresh, usable token;
 *   SEC-00F-9  the response returns the replacement invitation object, so a
 *              future BaseModel.create repair would surface a raw token there.
 *
 * Fix, in two bounded parts:
 *   1. the route adopts `requireCapability('org.user_admin')` - the approved
 *      invitation-management authority (ATM-003-R1 section 3.3), which
 *      ATM-003-R3 section 4 deliberately excludes from the supervisor bundle; and
 *   2. the handler enforces eligibility (pending AND unexpired) BEFORE any
 *      mutation, and derives the replacement role exclusively from the persisted
 *      invitation.
 *
 * RESIDUALS ASSERTED, NOT FIXED (reported, out of this bounded correction):
 *   - D-1 `BaseModel.create` returns null, so an authorized resend commits the
 *     replacement row and THEN throws. The suite therefore asserts the DATABASE
 *     EFFECT and never a success status, and the original invitation is expected
 *     to remain pending after an authorized resend.
 *   - Concurrency: the lookup / insert / cancel sequence is not serialized, so two
 *     concurrent resends of the same invitation can each issue a replacement.
 *     No transaction or locking architecture is introduced here (mission section 10).
 *   - The response still returns the replacement invitation object. That is left
 *     unchanged deliberately: it mirrors `POST /api/invitations`, the intended
 *     delivery point, and no unauthorized caller reaches it. ATM-001-SEC-93-D
 *     (c2): under the UNREPAIRED D-1 the response is HTTP 500 and carries NO
 *     token, and resend calls no delivery service, so this response delivers
 *     nothing today. The credential-delivery question for the post-D-1 state is
 *     ESCALATED, not decided; this correction does not claim resend can deliver
 *     a link for an existing pending invitation.
 *
 * NEGATIVE CONTROL: sections A and B assert what the pre-fix code violates. Run
 * unchanged against the unfixed baseline f156aa4, a supervisor and a plain
 * administrator reissue administrator invitations and dead invitations revive -
 * those tests FAIL there.
 *
 * No seat mask is neutralized anywhere: the resend route has no seat gate, so D-2
 * masks nothing here. This suite asserts production-shaped behaviour throughout.
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * `src/config/database.js` uses to select test-database credentials.
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
  : 'database-mutating resend-authorization suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'test-database credentials are used instead of runtime credentials; run it '
    + 'via `npm run test:integration`';

const JWT_SECRET = 'test-only-jwt-secret-not-for-production-000000';
const REPO_ROOT = path.resolve(__dirname, '..');
const HEX64 = /\b[0-9a-f]{64}\b/;

/**
 * INTEGRATION SCOPE DETECTION (ATM-001-SEC-INTEGRATION-03).
 *
 * SEC-00E (PR #90) and SEC-00G (PR #91) are SEPARATE, independently verified
 * corrections that this suite does not implement. The scope assertions below
 * must hold in every tree this suite is run against:
 *
 *   standalone (SEC-00H/R1's own branch) — the sibling guard is genuinely
 *     absent, so the original baseline assertion is kept VERBATIM; and
 *   consolidated (SEC-00E and SEC-00G integrated) — the sibling guard IS
 *     present, so the EXACT approved guard is asserted instead of merely
 *     "unchanged".
 *
 * The integrated branch is STRICTLY STRONGER: it pins the precise approved
 * guard rather than asserting a route was left alone. Nothing is skipped,
 * relaxed or made vacuous.
 *
 * Each predicate matches the EXACT route wiring, never a bare substring.
 */
const SEC00E_PRESENT = (routes) =>
  /router\.post\('\/', requireAdmin, canCreateUser, invitationController\.create\)/.test(routes);
const SEC00G_PRESENT = (routes) =>
  /router\.get\('\/', requireCapability\('org\.user_admin'\), invitationController\.getAll\)/.test(routes);

const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`;
const seq = { n: 0 };
const tag = () => `${RUN}${(++seq.n).toString(36)}`;

const U = {};
let ORG_A = null;
let ORG_B = null;
let FAC_A = null;
const INV = {};

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
  const handle = `sec00h-${key.toLowerCase()}-${tag()}`;
  const rows = await conn.query(
    `INSERT INTO users (organization_id, username, email, password_hash, full_name,
                        role, facility_id, is_active, status, is_organization_admin, is_billable)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true,'active',$8,true) RETURNING id`,
    [organizationId, handle, `${handle}@test.local`,
      `$2a$04$${`${RUN}${key}`.padEnd(53, 'y').slice(0, 53)}`,
      `SEC00H ${key}`, role, facilityId, isOrganizationAdmin]);
  U[key] = Number(rows[0].id);
  return U[key];
}

/** Insert an invitation row directly, exactly as production stores it. */
async function insertInvitation(conn, key, options) {
  const {
    organizationId, role, invitedBy, status = 'pending',
    expiresSql = `NOW() + INTERVAL '7 days'`, acceptedBy = null
  } = options;
  const email = `sec00h-${key.toLowerCase()}-${tag()}@test.local`;
  const token = crypto.randomBytes(32).toString('hex');
  const rows = await conn.query(
    `INSERT INTO invitations (organization_id, email, role, invited_by, token, status,
                              expires_at, created_at, accepted_at, accepted_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,${expiresSql},NOW(),${acceptedBy ? 'NOW()' : 'NULL'},$7) RETURNING id`,
    [organizationId, email, role, invitedBy, token, status, acceptedBy]);
  INV[key] = { id: Number(rows[0].id), email, role, status, token, organizationId };
  return INV[key];
}

/** Create a fresh invitation mid-test, so mutating cases cannot collide. */
async function makeInvitation(key, options) {
  return withConn((conn) => insertInvitation(conn, key, options));
}

async function ensureFixture() {
  await withConn(async (conn) => {
    const orgs = await conn.query(
      `INSERT INTO organizations (organization_name, subscription_status)
       VALUES ($1,'active'),($2,'active') RETURNING id`,
      [`SEC00H Org A ${RUN}`, `SEC00H Org B ${RUN}`]);
    [ORG_A, ORG_B] = orgs.map((r) => Number(r.id));

    const fac = await conn.query(
      `INSERT INTO facilities (organization_id,name,code,facility_type)
       VALUES ($1,'SEC00H Fac A',$2,'WTP') RETURNING id`, [ORG_A, `SH-${tag()}`]);
    FAC_A = Number(fac[0].id);

    const plan = await conn.query(
      `INSERT INTO subscription_plans (plan_code,plan_name,included_users,max_users)
       VALUES ($1,'SEC00H Plan',50,NULL) RETURNING id`, [`SEC00H-${tag()}`]);
    await conn.query(
      `INSERT INTO organization_subscriptions (organization_id,plan_id,included_users,status)
       VALUES ($1,$2,50,'active'),($3,$2,50,'active')`, [ORG_A, Number(plan[0].id), ORG_B]);

    await insertUser(conn, 'ADMIN_A', { organizationId: ORG_A, role: 'admin', isOrganizationAdmin: true });
    await insertUser(conn, 'PLAIN_ADMIN_A', { organizationId: ORG_A, role: 'admin', isOrganizationAdmin: false });
    await insertUser(conn, 'ADMIN_A_OTHER_GRANT', { organizationId: ORG_A, role: 'admin', isOrganizationAdmin: true });
    await insertUser(conn, 'ADMIN_A_GRANTED', { organizationId: ORG_A, role: 'admin', isOrganizationAdmin: true });
    await insertUser(conn, 'SUP_A', { organizationId: ORG_A, role: 'supervisor', facilityId: FAC_A });
    await insertUser(conn, 'OPER_A', { organizationId: ORG_A, role: 'operator', facilityId: FAC_A });
    await insertUser(conn, 'OPER_A_GRANTED', { organizationId: ORG_A, role: 'operator', facilityId: FAC_A });
    await insertUser(conn, 'ADMIN_B', { organizationId: ORG_B, role: 'admin', isOrganizationAdmin: true });

    // Explicit grants: one UNRELATED capability discards the legacy bundle;
    // an explicit org.user_admin is the documented recovery path.
    // ATM-001-SEC-00H-R1 adds an OPERATOR holding org.user_admin EXPLICITLY: the
    // capability gate admits it, but it holds no role-issuance authority at all.
    await conn.query(
      `INSERT INTO user_capabilities (user_id, organization_id, capability, granted_by_user_id)
       VALUES ($1,$2,'knowledge.author',$1), ($3,$2,'org.user_admin',$3), ($4,$2,'org.user_admin',$4)`,
      [U.ADMIN_A_OTHER_GRANT, ORG_A, U.ADMIN_A_GRANTED, U.OPER_A_GRANTED]);

    // Terminal / ineligible invitations and one non-pending-supervisor row.
    await insertInvitation(conn, 'A_CANCELLED', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A, status: 'cancelled' });
    await insertInvitation(conn, 'A_ACCEPTED', { organizationId: ORG_A, role: 'admin', invitedBy: U.ADMIN_A, status: 'accepted', acceptedBy: U.OPER_A });
    await insertInvitation(conn, 'A_EXPIRED', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A, expiresSql: `NOW() - INTERVAL '1 day'` });
    await insertInvitation(conn, 'B_PENDING', { organizationId: ORG_B, role: 'operator', invitedBy: U.ADMIN_B });
  });
}

async function cleanupFixture() {
  try {
    await withConn(async (conn) => {
      await conn.query(`DELETE FROM invitations WHERE email LIKE $1`, [`sec00h-%`]);
      await conn.query(`DELETE FROM users WHERE username LIKE $1`, [`sec00h-%`]);
      const orgIds = [ORG_A, ORG_B].filter((id) => id !== null);
      if (orgIds.length) {
        await conn.query(`DELETE FROM user_capabilities WHERE organization_id = ANY($1::int[])`, [orgIds]);
        await conn.query(`DELETE FROM organization_subscriptions WHERE organization_id = ANY($1::int[])`, [orgIds]);
        await conn.query(`DELETE FROM facilities WHERE organization_id = ANY($1::int[])`, [orgIds]);
        await conn.query(`DELETE FROM users WHERE organization_id = ANY($1::int[])`, [orgIds]);
        await conn.query(`DELETE FROM organizations WHERE id = ANY($1::int[])`, [orgIds]);
      }
      await conn.query(`DELETE FROM subscription_plans WHERE plan_code LIKE $1`, [`SEC00H-${RUN}%`]);
    });
  } catch {
    // Disposable-database hygiene only; never mask the security assertions.
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

const resend = (as, id, body = null) =>
  call('POST', `/api/invitations/${id}/resend`, { as, body });

const emailService = require('../src/services/email.service');
const REAL_SEND_INVITATION = emailService.sendInvitation;
let delivered = [];
function installDeliveryRecorder() {
  delivered = [];
  emailService.sendInvitation = async (options) => { delivered.push(options); };
}

const invitationRows = () => withConn((conn) => conn.query(
  `SELECT id, email, role, status, expires_at, organization_id, token FROM invitations
    WHERE organization_id = ANY($1::int[]) ORDER BY id`, [[ORG_A, ORG_B]]));

const rowById = (id) => withConn((conn) => conn.query(
  `SELECT id, email, role, status, organization_id, token FROM invitations WHERE id = $1`, [id]));

const PENDING_LIKE = ['pending', 'accepted', 'cancelled'];

/** Assert a refusal mutated nothing: no replacement, no token, no cancel, no delivery. */
async function assertRefusedCleanly(response, invitation, expectedStatus, label) {
  assert.strictEqual(response.status, expectedStatus,
    `${label}: expected ${expectedStatus}, got ${response.status} ${response.text}`);
  const rows = await invitationRows();
  assert.strictEqual(rows.filter((r) => r.email === invitation.email).length, 1,
    `${label}: no replacement invitation row may be created`);
  const original = await rowById(invitation.id);
  assert.strictEqual(original[0].status, invitation.status,
    `${label}: the original invitation must not be cancelled or altered`);
  assert.strictEqual(original[0].token, invitation.token,
    `${label}: the original token must be untouched`);
  assert.ok(!HEX64.test(response.text),
    `${label}: a refusal must not carry a usable token`);
  assert.strictEqual(delivered.length, 0,
    `${label}: a refusal must trigger no delivery`);
}

// ===========================================================================

describe('ATM-001-SEC-00H POST /api/invitations/:id/resend authorization and lifecycle', { skip: DB_TEST_SKIP_REASON }, () => {
  // ----------------------------------------------------------- structural
  describe('0. route wiring and scope containment (source assertions)', () => {
    it('1. the resend route enforces the approved invitation-management capability', () => {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'src', 'routes', 'invitation.routes.js'), 'utf8');
      assert.match(source,
        /router\.post\('\/:id\/resend', requireCapability\('org\.user_admin'\), invitationController\.resend\)/,
        'resend must be authorized by org.user_admin, not by the legacy admin role');
      assert.match(source,
        /const \{ requireCapability \} = require\('\.\.\/middleware\/capability\.middleware'\)/,
        'the canonical ATM-003 primitive must be used');
      assert.doesNotMatch(source, /router\.post\('\/:id\/resend', requireAdmin/,
        'requireAdmin must not be retained: it is neither necessary nor sufficient for this action');
    });

    it('2. the handler derives no role, tenant or admin flag from client input', () => {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'src', 'controllers', 'invitation.controller.js'), 'utf8');
      const handler = source.slice(source.indexOf('async resend(req, res, next)'));
      const body = handler.slice(0, handler.indexOf('\n  }\n}'));
      assert.doesNotMatch(body, /req\.(body|query)\.role/,
        'a client-supplied role must never influence the replacement');
      assert.doesNotMatch(body, /req\.(body|query)\.organization_id/,
        'a client-supplied tenant must never influence the lookup or the write');
      assert.doesNotMatch(body, /req\.(body|query)\.is_organization_admin/,
        'a client-supplied administrator flag must never influence authorization');
      assert.match(body, /role: invitation\.role/,
        'the replacement role must come from the persisted invitation');
      assert.match(body, /status !== 'pending'/,
        'eligibility must be enforced against the persisted status');
    });

    it('3. no schema, migration or capability vocabulary change', () => {
      const schema = fs.readFileSync(path.join(REPO_ROOT, 'database', 'postgresql', '001_core.sql'), 'utf8');
      assert.match(schema, /chk_invitations_role CHECK \(role IN \('operator','supervisor','admin'\)\)/,
        'the role vocabulary and statuses are unchanged');
      const cap = fs.readFileSync(path.join(REPO_ROOT, 'src', 'config', 'capabilities.js'), 'utf8');
      assert.match(cap, /ORG_USER_ADMIN: 'org\.user_admin'/, 'the capability vocabulary is unchanged');
      const migrations = fs.readdirSync(path.join(REPO_ROOT, 'database', 'migrations'));
      assert.ok(!migrations.some((f) => /02[4-9]|0[3-9]\d/.test(f)),
        'SEC-00H adds no migration');
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
    await cleanupFixture();
  });

  // ===================================================== A. authorization
  describe('A. authorization (negative controls)', () => {
    it('01. an unauthenticated caller cannot resend', async () => {
      const inv = await makeInvitation('A_01', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      delivered = [];
      const response = await call('POST', `/api/invitations/${inv.id}/resend`);
      await assertRefusedCleanly(response, inv, 401, 'unauthenticated');
    });

    it('02. an OPERATOR cannot resend', async () => {
      const inv = await makeInvitation('A_02', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      delivered = [];
      const response = await resend('OPER_A', inv.id);
      await assertRefusedCleanly(response, inv, 403, 'operator');
      assert.match(response.text, /org\.user_admin is required/,
        'the refusal must come from the capability guard');
    });

    it('03. a SUPERVISOR cannot resend an administrator invitation', async () => {
      const inv = await makeInvitation('A_03', { organizationId: ORG_A, role: 'admin', invitedBy: U.SUP_A });
      delivered = [];
      const response = await resend('SUP_A', inv.id);
      await assertRefusedCleanly(response, inv, 403, 'supervisor');
    });

    it('04. an administrator without org.user_admin cannot resend', async () => {
      const inv = await makeInvitation('A_04', { organizationId: ORG_A, role: 'admin', invitedBy: U.ADMIN_A });
      delivered = [];
      const response = await resend('ADMIN_A_OTHER_GRANT', inv.id);
      await assertRefusedCleanly(response, inv, 403, 'admin without org.user_admin');
    });

    it('04b. a PLAIN administrator holds org.user_admin but may NOT reissue an ADMINISTRATOR invitation', async () => {
      // ATM-001-SEC-00H-R1. The approved `admin` compatibility bundle does carry
      // org.user_admin, and `is_organization_admin` is not part of the capability
      // vocabulary, so the CAPABILITY gate admits a plain administrator
      // (LEGACY_COMPATIBILITY mode). But resend re-issues the STORED role, and the
      // approved creation-time authority (ATM-001-SEC-00E) permits only an
      // organization administrator to issue the administrator role. Requiring
      // org.user_admin alone was finding F-2 of ATM-001-SEC-00H-VUDA-01.
      const inv = await makeInvitation('A_04B', { organizationId: ORG_A, role: 'admin', invitedBy: U.ADMIN_A });
      delivered = [];
      const response = await resend('PLAIN_ADMIN_A', inv.id);
      await assertRefusedCleanly(response, inv, 403, 'plain administrator on an admin invitation');
      assert.match(response.text, /Only organization administrators can create admin accounts/,
        'the refusal must come from the approved role-issuance authority');
    });

    it('04c. that same plain administrator may still reissue a role they ARE authorized to issue', async () => {
      // The remediation narrows who may reissue the ADMINISTRATOR role; it does
      // not revoke the plain administrator's org.user_admin for other roles.
      const inv = await makeInvitation('A_04C', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      const response = await resend('PLAIN_ADMIN_A', inv.id);
      assert.notStrictEqual(response.status, 403, 'an administrator may issue the operator role');
      const replacement = (await invitationRows()).find((r) => r.email === inv.email && r.id !== inv.id);
      assert.ok(replacement, 'the replacement must be created');
      assert.strictEqual(replacement.role, 'operator', 'the stored role is preserved');
    });

    it('05. an authorized tenant administrator may resend a pending invitation', async () => {
      const inv = await makeInvitation('A_05', { organizationId: ORG_A, role: 'admin', invitedBy: U.ADMIN_A });
      const before = (await invitationRows()).length;
      const response = await resend('ADMIN_A', inv.id);
      assert.notStrictEqual(response.status, 403, 'an authorized principal must not be refused');
      const rows = await invitationRows();
      assert.strictEqual(rows.length, before + 1, 'exactly one replacement row must be created');
      const replacement = rows.find((r) => r.email === inv.email && r.id !== inv.id);
      assert.ok(replacement, 'the replacement must exist');
      assert.strictEqual(replacement.status, 'pending');
      assert.strictEqual(replacement.role, 'admin', 'the authorized role must be preserved');
      assert.strictEqual(Number(replacement.organization_id), ORG_A);
      // D-1 means the handler throws after the INSERT commits, so a success
      // status is not asserted anywhere in this suite.
      assert.notStrictEqual(response.status, 200, 'D-1 prevents a serialized success response');
    });

    it('06. a cross-tenant administrator cannot resend a foreign invitation', async () => {
      const inv = await makeInvitation('A_06', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      delivered = [];
      const response = await resend('ADMIN_B', inv.id);
      await assertRefusedCleanly(response, inv, 404, 'cross-tenant');
      assert.ok(!response.text.includes(inv.email),
        'a refusal must not disclose a foreign invitation detail');
    });

    it('07. a forged organization identifier cannot redirect the tenant', async () => {
      const inv = await makeInvitation('A_07', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      await resend('ADMIN_A', inv.id, { organization_id: ORG_B });
      const replacement = (await invitationRows())
        .find((r) => r.email === inv.email && r.id !== inv.id);
      assert.ok(replacement, 'the resend must still act on the caller tenant');
      assert.strictEqual(Number(replacement.organization_id), ORG_A,
        'the tenant is the authenticated session, never the body');
    });
  });

  // ======================================= B. lifecycle (negative controls)
  describe('B. invitation lifecycle', () => {
    it('11. a CANCELLED invitation cannot be revived', async () => {
      delivered = [];
      const response = await resend('ADMIN_A', INV.A_CANCELLED.id);
      await assertRefusedCleanly(response, INV.A_CANCELLED, 400, 'cancelled');
      assert.match(response.text, /Only pending invitations can be resent/);
    });

    it('12. an ACCEPTED invitation cannot be reissued', async () => {
      delivered = [];
      const response = await resend('ADMIN_A', INV.A_ACCEPTED.id);
      await assertRefusedCleanly(response, INV.A_ACCEPTED, 400, 'accepted');
    });

    it('13. an EXPIRED invitation cannot be revived', async () => {
      delivered = [];
      const response = await resend('ADMIN_A', INV.A_EXPIRED.id);
      await assertRefusedCleanly(response, INV.A_EXPIRED, 400, 'expired');
      assert.match(response.text, /expired invitation cannot be resent/);
    });

    it('14. a pending, unexpired invitation remains resendable', async () => {
      const inv = await makeInvitation('A_14', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      const response = await resend('ADMIN_A', inv.id);
      assert.notStrictEqual(response.status, 400, 'an eligible invitation must not be refused');
      assert.strictEqual((await invitationRows()).filter((r) => r.email === inv.email).length, 2,
        'a replacement must exist alongside the original');
    });

    it('15. a malformed invitation identifier is refused without leaking internals', async () => {
      delivered = [];
      const before = (await invitationRows()).length;
      const response = await resend('ADMIN_A', 'not-a-number');
      assert.strictEqual(response.status, 404, 'an unusable identifier must not reach the database');
      assert.strictEqual((await invitationRows()).length, before, 'nothing may be created');
      assert.ok(!/invalid input syntax|type integer|pgerror|severity/i.test(response.text),
        'NEGATIVE CONTROL: the pre-fix code returned the raw driver error here');
      assert.ok(!HEX64.test(response.text));
    });

    it('16. a nonexistent invitation identifier is refused', async () => {
      delivered = [];
      const before = (await invitationRows()).length;
      const response = await resend('ADMIN_A', 987654321);
      assert.strictEqual(response.status, 404);
      assert.strictEqual((await invitationRows()).length, before);
      assert.ok(!HEX64.test(response.text));
    });
  });

  // ================================================= C. stored-role integrity
  describe('C. stored-role integrity', () => {
    it('08. a forged body.role cannot change the granted role', async () => {
      const inv = await makeInvitation('A_08', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      await resend('ADMIN_A', inv.id, { role: 'admin' });
      const replacement = (await invitationRows()).find((r) => r.email === inv.email && r.id !== inv.id);
      assert.ok(replacement, 'the resend must act');
      assert.strictEqual(replacement.role, 'operator',
        'the stored role governs; a body role is inert');
    });

    it('09. a forged query.role cannot change the granted role', async () => {
      const inv = await makeInvitation('A_09', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      await call('POST', `/api/invitations/${inv.id}/resend?role=admin`, { as: 'ADMIN_A' });
      const replacement = (await invitationRows()).find((r) => r.email === inv.email && r.id !== inv.id);
      assert.ok(replacement, 'the resend must act');
      assert.strictEqual(replacement.role, 'operator', 'a query role must be inert');
    });

    it('09b. a stored ADMINISTRATOR role is preserved, not silently downgraded', async () => {
      const inv = await makeInvitation('A_09B', { organizationId: ORG_A, role: 'admin', invitedBy: U.ADMIN_A });
      await resend('ADMIN_A', inv.id, { role: 'operator' });
      const replacement = (await invitationRows()).find((r) => r.email === inv.email && r.id !== inv.id);
      assert.ok(replacement);
      assert.strictEqual(replacement.role, 'admin', 'the persisted role is authoritative in both directions');
    });

    it('10. a forged is_organization_admin cannot widen authorization', async () => {
      const inv = await makeInvitation('A_10', { organizationId: ORG_A, role: 'admin', invitedBy: U.SUP_A });
      delivered = [];
      const response = await resend('SUP_A', inv.id, { is_organization_admin: true, role: 'admin' });
      await assertRefusedCleanly(response, inv, 403, 'forged admin flag');
    });
  });

  // ================================================= D. historical invitations
  describe('D. historical administrator invitations', () => {
    it('17. a previously UNAUTHORIZED administrator invitation may be reissued only by an authorized principal', async () => {
      const inv = await makeInvitation('A_17', { organizationId: ORG_A, role: 'admin', invitedBy: U.SUP_A });
      await resend('ADMIN_A', inv.id);
      const replacement = (await invitationRows()).find((r) => r.email === inv.email && r.id !== inv.id);
      assert.ok(replacement, 'an authorized tenant administrator may replace it');
      assert.strictEqual(replacement.role, 'admin', 'its stored role is preserved');
      // A supervisor still may not: the authorization is the caller's, and the
      // historical provenance of the row does not create authority.
      const inv2 = await makeInvitation('A_17B', { organizationId: ORG_A, role: 'admin', invitedBy: U.SUP_A });
      delivered = [];
      const refused = await resend('SUP_A', inv2.id);
      await assertRefusedCleanly(refused, inv2, 403, 'supervisor on a historical admin invitation');
    });

    it('18. a previously AUTHORIZED administrator invitation is still resendable', async () => {
      const inv = await makeInvitation('A_18', { organizationId: ORG_A, role: 'admin', invitedBy: U.ADMIN_A });
      await resend('ADMIN_A', inv.id);
      const replacement = (await invitationRows()).find((r) => r.email === inv.email && r.id !== inv.id);
      assert.ok(replacement, 'the legitimate case must keep working');
      assert.strictEqual(replacement.role, 'admin');
    });

    it('19. a caller whose administrator-role issuance authority has been revoked is refused', async () => {
      // ATM-001-SEC-00H-R1 required test 9. Authority is read NOW, from the
      // principal, not from the invitation's provenance: revoking the caller's
      // is_organization_admin revokes the ability to reissue an admin invitation,
      // even though the caller still holds org.user_admin.
      const inv = await makeInvitation('A_19', { organizationId: ORG_A, role: 'admin', invitedBy: U.ADMIN_A });
      await withConn((c) => c.query(`UPDATE users SET is_organization_admin = false WHERE id = $1`, [U.ADMIN_A]));
      try {
        delivered = [];
        const response = await resend('ADMIN_A', inv.id);
        await assertRefusedCleanly(response, inv, 403, 'revoked administrator-role authority');
      } finally {
        await withConn((c) => c.query(`UPDATE users SET is_organization_admin = true WHERE id = $1`, [U.ADMIN_A]));
      }
    });
  });

  // ================================================= E. explicit grants
  describe('E. explicit capability grants (resolver rule preserved)', () => {
    it('20. an explicit grant WITHOUT org.user_admin does not authorize resend', async () => {
      const inv = await makeInvitation('A_20', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      delivered = [];
      const response = await resend('ADMIN_A_OTHER_GRANT', inv.id);
      await assertRefusedCleanly(response, inv, 403, 'explicit grant without org.user_admin');
    });

    it('21. an explicit org.user_admin grant authorizes resend', async () => {
      const inv = await makeInvitation('A_21', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      const response = await resend('ADMIN_A_GRANTED', inv.id);
      assert.notStrictEqual(response.status, 403, 'the explicit grant is the authority');
      const replacement = (await invitationRows()).find((r) => r.email === inv.email && r.id !== inv.id);
      assert.ok(replacement, 'the replacement must be created');
    });
  });

  // ================================================= F. refusal invariants
  describe('F. a rejected request mutates nothing', () => {
    it('22-25. refusals create no row, issue no token, cancel nothing and deliver nothing', async () => {
      const cases = [
        ['OPER_A', 'rejected: operator', 403],
        ['SUP_A', 'rejected: supervisor', 403],
        ['ADMIN_A_OTHER_GRANT', 'rejected: no org.user_admin', 403],
        ['ADMIN_B', 'rejected: cross-tenant', 404]
      ];
      for (const [as, label, expected] of cases) {
        const inv = await makeInvitation(`R_${tag()}`, { organizationId: ORG_A, role: 'admin', invitedBy: U.ADMIN_A });
        delivered = [];
        const response = await resend(as, inv.id);
        await assertRefusedCleanly(response, inv, expected, label);
      }
      // Lifecycle refusals too.
      for (const [key, expected] of [['A_CANCELLED', 400], ['A_ACCEPTED', 400], ['A_EXPIRED', 400]]) {
        delivered = [];
        const response = await resend('ADMIN_A', INV[key].id);
        await assertRefusedCleanly(response, INV[key], expected, `rejected: ${key}`);
      }
    });
  });

  // ================================================= G. tenant isolation
  describe('G. tenant isolation', () => {
    it('26. a cross-tenant resend is refused and leaks nothing', async () => {
      const inv = await makeInvitation('B_26', { organizationId: ORG_B, role: 'operator', invitedBy: U.ADMIN_B });
      delivered = [];
      const response = await resend('ADMIN_A', inv.id);
      await assertRefusedCleanly(response, inv, 404, 'org A admin on an org B invitation');
      assert.ok(!response.text.includes(inv.email),
        'foreign invitation details must not be disclosed');
    });
  });

  // ================================================= H. concurrency residual
  describe('H. concurrency (residual, reported not fixed)', () => {
    it('30. concurrent resends are not serialized — residual asserted, not claimed safe', async () => {
      const inv = await makeInvitation('A_30', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      const results = await Promise.all([
        resend('ADMIN_A', inv.id),
        resend('ADMIN_A', inv.id),
        resend('ADMIN_A', inv.id)
      ]);
      const replacements = (await invitationRows()).filter((r) => r.email === inv.email && r.id !== inv.id);

      assert.ok(replacements.length >= 1, 'the operation must still issue a replacement');
      // RESIDUAL: the lookup / insert / cancel sequence is not serialized and no
      // transaction or locking architecture is introduced by this bounded
      // correction. More than one replacement proves the window is open. The
      // assertion is deliberately one-sided so the test records the behaviour
      // rather than pretending the race is closed.
      assert.ok(results.every((r) => r.status !== undefined), 'every concurrent request must complete');
      if (replacements.length > 1) {
        assert.ok(true, `RESIDUAL CONFIRMED: ${replacements.length} replacements issued from one original`);
      }
      assert.strictEqual(replacements.filter((r) => r.status === 'pending').length, replacements.length,
        'each replacement is a pending invitation with its own usable token');
    });
  });

  // ================================================= I. scope containment
  describe('I. adjacent routes are unchanged', () => {
    it('27. the creation route carries the baseline guard, or SEC-00E\'s approved chain when present', () => {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'src', 'routes', 'invitation.routes.js'), 'utf8');
      if (SEC00E_PRESENT(source)) {
        // INTEGRATED. SEC-00E (PR #90) is a separate, independently verified
        // correction; when it is present the EXACT approved chain is pinned, which
        // is strictly stronger than asserting the route was left alone.
        assert.match(source, /router\.post\('\/', requireAdmin, canCreateUser, invitationController\.create\)/,
          'with SEC-00E present, creation must carry the approved role-assignment authority');
        assert.ok(!/router\.post\('\/', requireAdmin, invitationController\.create\)/.test(source),
          'with SEC-00E present, the bare requireAdmin-only creation guard must be gone');
      } else {
        assert.match(source, /router\.post\('\/', requireAdmin, invitationController\.create\)/,
          'creation is out of scope and unchanged (SEC-00E is a separate PR)');
      }
    });

    it('28. the listing route carries the baseline form, or SEC-00G\'s approved guard when present', () => {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'src', 'routes', 'invitation.routes.js'), 'utf8');
      if (SEC00G_PRESENT(source)) {
        // INTEGRATED. SEC-00G (PR #91) is a separate, independently verified
        // correction; when it is present the approved capability guard is pinned
        // exactly, and the retired unprotected listing route is asserted gone.
        assert.match(source, /router\.get\('\/', requireCapability\('org\.user_admin'\), invitationController\.getAll\)/,
          'with SEC-00G present, listing must carry the approved org.user_admin capability');
        assert.ok(!/router\.get\('\/', invitationController\.getAll\)/.test(source),
          'with SEC-00G present, the unprotected listing route must be gone');
      } else {
        assert.match(source, /router\.get\('\/', invitationController\.getAll\)/,
          'listing is out of scope; SEC-00G is a separate PR and is not carried here');
      }
    });

    it('29. acceptance is unchanged and cancellation carries the approved guard when SEC-93-A is present', () => {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'src', 'routes', 'invitation.routes.js'), 'utf8');
      assert.match(source, /router\.post\('\/accept', invitationController\.accept\)/);

      // ATM-001-SEC-93-A (MISSION 3 residual A). The standalone tree this suite
      // was written against left cancellation on `requireAdmin` alone, which
      // admits a supervisor; that is recorded here VERBATIM so the suite still
      // describes that tree. Integrated, cancellation carries the approved
      // ATM-003-R1 invitation-management capability, and the legacy
      // requireAdmin-only guard is asserted GONE — the same inversion this suite
      // already applies to the listing route above.
      if (/router\.delete\('\/:id', requireCapability\('org\.user_admin'\), invitationController\.cancel\)/.test(source)) {
        assert.ok(!/router\.delete\('\/:id', requireAdmin, invitationController\.cancel\)/.test(source),
          'with SEC-93-A present, the legacy requireAdmin-only cancellation guard must be gone');
      } else {
        assert.match(source, /router\.delete\('\/:id', requireAdmin, invitationController\.cancel\)/,
          'cancellation is out of this suite\u2019s scope and unchanged on the standalone tree');
      }
    });

    it('29b. resend still delivers no email (pre-existing gap, reported not claimed)', async () => {
      const inv = await makeInvitation('A_29B', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      delivered = [];
      await resend('ADMIN_A', inv.id);
      // SEC-00F reported that resend never delivers. Asserting it keeps the
      // suite honest: a refusal delivering nothing is therefore over-determined.
      assert.strictEqual(delivered.length, 0,
        'the pre-existing gap is asserted; it is not treated as a control');
    });
  });

  // ============================ J. role-issuance authority (ATM-001-SEC-00H-R1)
  //
  // Remediation of independent finding F-2 (ATM-001-SEC-00H-VUDA-01): requiring
  // `org.user_admin` alone let a principal re-issue a role it may not issue.
  // Resend now also applies the approved creation-time role-assignment authority
  // (ATM-001-SEC-00E) to the STORED role.
  describe('J. role-issuance authority (ATM-001-SEC-00H-R1 remediation of F-2)', () => {
    it('R1-01. a tenant administrator with administrator-role authority reissues an administrator invitation', async () => {
      const inv = await makeInvitation('R1_01', { organizationId: ORG_A, role: 'admin', invitedBy: U.ADMIN_A });
      const response = await resend('ADMIN_A', inv.id);
      assert.notStrictEqual(response.status, 403,
        'an organization administrator may issue the administrator role');
      const replacement = (await invitationRows()).find((r) => r.email === inv.email && r.id !== inv.id);
      assert.ok(replacement, 'the replacement must be created');
      assert.strictEqual(replacement.role, 'admin');
      assert.strictEqual(Number(replacement.organization_id), ORG_A);
    });

    it('R1-02. an authorized principal reissues an eligible non-administrator invitation', async () => {
      for (const role of ['operator', 'supervisor']) {
        const inv = await makeInvitation(`R1_02_${role}`, { organizationId: ORG_A, role, invitedBy: U.ADMIN_A });
        const response = await resend('ADMIN_A', inv.id);
        assert.notStrictEqual(response.status, 403, `an administrator may issue the ${role} role`);
        const replacement = (await invitationRows()).find((r) => r.email === inv.email && r.id !== inv.id);
        assert.ok(replacement, `the ${role} replacement must be created`);
        assert.strictEqual(replacement.role, role, 'the stored role is preserved');
      }
    });

    it('R1-03. an explicit-grant principal with org.user_admin reissues a role they may issue', async () => {
      for (const role of ['admin', 'operator']) {
        const inv = await makeInvitation(`R1_03_${role}`, { organizationId: ORG_A, role, invitedBy: U.ADMIN_A });
        const response = await resend('ADMIN_A_GRANTED', inv.id);
        assert.notStrictEqual(response.status, 403,
          `an explicit org.user_admin plus administrator-role authority may issue ${role}`);
        const replacement = (await invitationRows()).find((r) => r.email === inv.email && r.id !== inv.id);
        assert.ok(replacement, 'the replacement must be created');
        assert.strictEqual(replacement.role, role);
      }
    });

    it('R1-04. an OPERATOR holding only an explicit org.user_admin cannot reissue an ADMINISTRATOR invitation', async () => {
      const inv = await makeInvitation('R1_04', { organizationId: ORG_A, role: 'admin', invitedBy: U.ADMIN_A });
      delivered = [];
      const response = await resend('OPER_A_GRANTED', inv.id);
      await assertRefusedCleanly(response, inv, 403, 'explicit-grant operator on an admin invitation');
      assert.match(response.text, /Access denied/,
        'the operator holds no role-issuance authority at all');
    });

    it('R1-04b. that operator cannot reissue an OPERATOR invitation either', async () => {
      const inv = await makeInvitation('R1_04B', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      delivered = [];
      const response = await resend('OPER_A_GRANTED', inv.id);
      await assertRefusedCleanly(response, inv, 403, 'explicit-grant operator on an operator invitation');
    });

    it('R1-05. a plain administrator lacking administrator-role authority cannot reissue an ADMINISTRATOR invitation', async () => {
      const inv = await makeInvitation('R1_05', { organizationId: ORG_A, role: 'admin', invitedBy: U.ADMIN_A });
      delivered = [];
      const response = await resend('PLAIN_ADMIN_A', inv.id);
      await assertRefusedCleanly(response, inv, 403, 'plain administrator on an admin invitation');
    });

    it('R1-06. a supervisor cannot reissue an ADMINISTRATOR invitation', async () => {
      const inv = await makeInvitation('R1_06', { organizationId: ORG_A, role: 'admin', invitedBy: U.SUP_A });
      delivered = [];
      const response = await resend('SUP_A', inv.id);
      await assertRefusedCleanly(response, inv, 403, 'supervisor on an admin invitation');
    });

    it('R1-07. a principal without org.user_admin cannot resend any role', async () => {
      for (const [as, role] of [['OPER_A', 'operator'], ['ADMIN_A_OTHER_GRANT', 'admin']]) {
        const inv = await makeInvitation(`R1_07_${as}`, { organizationId: ORG_A, role, invitedBy: U.ADMIN_A });
        delivered = [];
        const response = await resend(as, inv.id);
        await assertRefusedCleanly(response, inv, 403, `${as} without org.user_admin`);
      }
    });

    it('R1-08. a cross-tenant principal cannot resend, whatever its role authority', async () => {
      const inv = await makeInvitation('R1_08', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
      delivered = [];
      const response = await resend('ADMIN_B', inv.id);
      await assertRefusedCleanly(response, inv, 404, 'cross-tenant');
    });

    it('R1-09. revoking administrator-role authority refuses the previously-authorized explicit-grant principal', async () => {
      const inv = await makeInvitation('R1_09', { organizationId: ORG_A, role: 'admin', invitedBy: U.ADMIN_A });
      await withConn((c) => c.query(`UPDATE users SET is_organization_admin = false WHERE id = $1`, [U.ADMIN_A_GRANTED]));
      try {
        delivered = [];
        const response = await resend('ADMIN_A_GRANTED', inv.id);
        assert.strictEqual(response.status, 403,
          'the explicit grant is necessary but not sufficient for the administrator role');
        assert.match(response.text, /Only organization administrators can create admin accounts/);
        await assertRefusedCleanly(response, inv, 403, 'explicit grant with revoked administrator-role authority');
      } finally {
        await withConn((c) => c.query(`UPDATE users SET is_organization_admin = true WHERE id = $1`, [U.ADMIN_A_GRANTED]));
      }
    });

    it('R1-10. a forged body.role cannot downgrade the stored role out of the authority check', async () => {
      const inv = await makeInvitation('R1_10', { organizationId: ORG_A, role: 'admin', invitedBy: U.ADMIN_A });
      delivered = [];
      const response = await resend('PLAIN_ADMIN_A', inv.id, { role: 'operator', is_organization_admin: true });
      await assertRefusedCleanly(response, inv, 403, 'forged body.role on a stored admin invitation');
    });

    it('R1-11. a forged query.role cannot downgrade the stored role out of the authority check', async () => {
      const inv = await makeInvitation('R1_11', { organizationId: ORG_A, role: 'admin', invitedBy: U.ADMIN_A });
      delivered = [];
      const response = await call('POST', `/api/invitations/${inv.id}/resend?role=operator`, { as: 'PLAIN_ADMIN_A' });
      await assertRefusedCleanly(response, inv, 403, 'forged query.role on a stored admin invitation');
    });

    it('R1-12. forged administrator flags cannot manufacture role-issuance authority', async () => {
      const inv = await makeInvitation('R1_12', { organizationId: ORG_A, role: 'admin', invitedBy: U.SUP_A });
      delivered = [];
      const response = await resend('SUP_A', inv.id, { is_organization_admin: true, role: 'admin' });
      await assertRefusedCleanly(response, inv, 403, 'forged is_organization_admin');
    });

    it('R1-13. neither an authorized nor a refused resend alters a stored invitation role', async () => {
      const authorized = await makeInvitation('R1_13A', { organizationId: ORG_A, role: 'admin', invitedBy: U.ADMIN_A });
      await resend('ADMIN_A', authorized.id);
      const original = (await rowById(authorized.id))[0];
      assert.strictEqual(original.role, 'admin', 'the original stored role is untouched');
      // D-1 throws after the replacement commits, before Invitation.cancel runs.
      assert.strictEqual(original.status, 'pending',
        'the original is retired only after its replacement exists (D-1 residual)');

      const refused = await makeInvitation('R1_13B', { organizationId: ORG_A, role: 'admin', invitedBy: U.ADMIN_A });
      delivered = [];
      await resend('PLAIN_ADMIN_A', refused.id);
      const refusedRow = (await rowById(refused.id))[0];
      assert.strictEqual(refusedRow.role, 'admin');
      assert.strictEqual(refusedRow.token, refused.token);
      assert.strictEqual(refusedRow.status, 'pending');
    });

    it('R1-14. the role authority is evaluated against the persisted row, never the caller', () => {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'src', 'controllers', 'invitation.controller.js'), 'utf8');
      const handler = source.slice(source.indexOf('async resend(req, res, next)'));
      assert.match(handler, /roleIssuanceAuthority\(req\.user, invitation\.role\)/,
        'the authority decision must take the stored role');
      assert.doesNotMatch(handler, /roleIssuanceAuthority\(req\.user, (req|request)\./,
        'the authority decision must never take a client-supplied role');
      const rbac = fs.readFileSync(path.join(REPO_ROOT, 'src', 'middleware', 'rbac.js'), 'utf8');
      assert.match(rbac, /const roleIssuanceAuthority = \(user, role\) =>/,
        'the approved creation policy must be the single source of the decision');
      assert.match(rbac, /const refusal = roleIssuanceAuthority\(req\.user, newUserRole\)/,
        'creation must use the same decision, so the two can never drift');
    });
  });
});
