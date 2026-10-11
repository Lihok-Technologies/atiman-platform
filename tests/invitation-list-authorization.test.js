/**
 * ATM-001-SEC-00G — GET /api/invitations authorization and token protection.
 *
 * Reported defect: the route required only `authenticate`, so ANY authenticated
 * principal - including an operator - received every invitation record for the
 * tenant, raw `token` field included. An invitation token is a usable enrollment
 * credential: `POST /api/invitations/accept` is public and creates the account
 * with the invitation's role. The seat defect (D-2) masked only the final
 * acceptance step, and is not an authorization control.
 *
 * Fix, in two parts:
 *   1. the route adopts `requireCapability('org.user_admin')`, the canonical
 *      ATM-003 primitive, which is the approved invitation-management authority
 *      (ATM-003-R1 section 3.3: "Manage users, invitations, roles", Tenant scope,
 *      Tenant Administrator profile); and
 *   2. the listing projects invitation rows through a view that drops `token`.
 *
 * THE RESOLVER CONSEQUENCE, ASSERTED EXPLICITLY (OWNER-accepted for this
 * mission): `resolveCapabilities` resolves a principal in exactly ONE mode, and
 * an explicit grant DISCARDS the legacy compatibility bundle
 * (src/services/capability.service.js). An administrator who holds any explicit
 * capability grant therefore does NOT hold `org.user_admin` implicitly. Tests 8
 * and 9 assert both directions of that behaviour so it can never regress
 * silently.
 *
 * NEGATIVE CONTROL: section A and section C assert what the pre-fix code
 * violates. Run unchanged against the unfixed baseline f156aa4, an operator and
 * a supervisor list successfully and the response carries raw tokens - those
 * tests FAIL there, which is this suite's proof that it detects the defect.
 *
 * The seat defect D-2 is deliberately NOT neutralized anywhere in this suite:
 * the listing route never consults the seat gate, so it masks nothing here.
 * This suite therefore asserts production-shaped behaviour throughout.
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
  : 'database-mutating invitation-list-authorization suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'test-database credentials are used instead of runtime credentials; run it '
    + 'via `npm run test:integration`';

const JWT_SECRET = 'test-only-jwt-secret-not-for-production-000000';
const REPO_ROOT = path.resolve(__dirname, '..');
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * INTEGRATION SCOPE DETECTION (ATM-001-SEC-INTEGRATION-03).
 *
 * SEC-00E (PR #90) and SEC-00H/R1 (PR #92) are SEPARATE, independently verified
 * corrections that this suite does not implement. The scope assertions below
 * must hold in every tree this suite is run against:
 *
 *   standalone (SEC-00G's own branch) — the sibling guard is genuinely absent,
 *     so the original baseline assertion is kept VERBATIM; and
 *   consolidated (SEC-00E and SEC-00H/R1 integrated) — the sibling guard IS
 *     present, so the EXACT approved guard is asserted instead of merely
 *     "unchanged".
 *
 * The integrated branch is STRICTLY STRONGER than the "unchanged" assertion it
 * replaces: it pins the precise approved guard and, for resend, additionally
 * asserts that the legacy `requireAdmin`-only guard is gone. Nothing is skipped,
 * relaxed or made vacuous in either direction.
 *
 * These predicates match the EXACT route wiring, never a bare substring, so a
 * run against the SEC-00G-standalone branch (where `requireCapability` exists
 * for the LISTING route) cannot mistake itself for the integrated tree.
 */
const SEC00E_PRESENT = (routes) =>
  /router\.post\('\/', requireAdmin, canCreateUser, invitationController\.create\)/.test(routes);
const SEC00H_PRESENT = (routes) =>
  /router\.post\('\/:id\/resend', requireCapability\('org\.user_admin'\), invitationController\.resend\)/.test(routes);

const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`;
const seq = { n: 0 };
const tag = () => `${RUN}${(++seq.n).toString(36)}`;

const newToken = () => crypto.randomBytes(32).toString('hex');

const U = {};
let ORG_A = null;
let ORG_B = null;
let ORG_C = null;
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
  const handle = `sec00g-${key.toLowerCase()}-${tag()}`;
  const rows = await conn.query(
    `INSERT INTO users (organization_id, username, email, password_hash, full_name,
                        role, facility_id, is_active, status, is_organization_admin, is_billable)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true,'active',$8,true) RETURNING id`,
    [organizationId, handle, `${handle}@test.local`,
      `$2a$04$${`${RUN}${key}`.padEnd(53, 'y').slice(0, 53)}`,
      `SEC00G ${key}`, role, facilityId, isOrganizationAdmin]);
  U[key] = Number(rows[0].id);
  return U[key];
}

async function insertInvitation(conn, key, options) {
  const { organizationId, role, invitedBy, status = 'pending', expiresSql = `NOW() + INTERVAL '7 days'`,
    acceptedBy = null } = options;
  const email = `sec00g-${key.toLowerCase()}-${tag()}@test.local`;
  const token = newToken();
  const rows = await conn.query(
    `INSERT INTO invitations (organization_id, email, role, invited_by, token, status,
                              expires_at, created_at, accepted_at, accepted_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,${expiresSql},NOW(),${acceptedBy ? 'NOW()' : 'NULL'},$7) RETURNING id`,
    [organizationId, email, role, invitedBy, token, status, acceptedBy]);
  INV[key] = { id: Number(rows[0].id), email, role, status, token, organizationId };
  return INV[key];
}

async function ensureFixture() {
  await withConn(async (conn) => {
    const orgs = await conn.query(
      `INSERT INTO organizations (organization_name, subscription_status)
       VALUES ($1,'active'),($2,'active'),($3,'active') RETURNING id`,
      [`SEC00G Org A ${RUN}`, `SEC00G Org B ${RUN}`, `SEC00G Org C ${RUN}`]);
    [ORG_A, ORG_B, ORG_C] = orgs.map((r) => Number(r.id));

    const fac = await conn.query(
      `INSERT INTO facilities (organization_id,name,code,facility_type)
       VALUES ($1,'SEC00G Fac A',$2,'WTP') RETURNING id`, [ORG_A, `SG-${tag()}`]);
    FAC_A = Number(fac[0].id);

    const plan = await conn.query(
      `INSERT INTO subscription_plans (plan_code,plan_name,included_users,max_users)
       VALUES ($1,'SEC00G Plan',50,NULL) RETURNING id`, [`SEC00G-${tag()}`]);
    await conn.query(
      `INSERT INTO organization_subscriptions (organization_id,plan_id,included_users,status)
       VALUES ($1,$2,50,'active'),($3,$2,50,'active'),($4,$2,50,'active')`,
      [ORG_A, Number(plan[0].id), ORG_B, ORG_C]);

    await insertUser(conn, 'ADMIN_A', { organizationId: ORG_A, role: 'admin', isOrganizationAdmin: true });
    await insertUser(conn, 'PLAIN_ADMIN_A', { organizationId: ORG_A, role: 'admin', isOrganizationAdmin: false });
    await insertUser(conn, 'ADMIN_A_OTHER_GRANT', { organizationId: ORG_A, role: 'admin', isOrganizationAdmin: true });
    await insertUser(conn, 'ADMIN_A_GRANTED', { organizationId: ORG_A, role: 'admin', isOrganizationAdmin: true });
    await insertUser(conn, 'SUP_A', { organizationId: ORG_A, role: 'supervisor', facilityId: FAC_A });
    await insertUser(conn, 'OPER_A', { organizationId: ORG_A, role: 'operator', facilityId: FAC_A });
    await insertUser(conn, 'ADMIN_B', { organizationId: ORG_B, role: 'admin', isOrganizationAdmin: true });
    await insertUser(conn, 'ADMIN_C', { organizationId: ORG_C, role: 'admin', isOrganizationAdmin: true });

    // Explicit grants: one unrelated capability (discards the legacy bundle) and
    // one explicit org.user_admin (the documented recovery path).
    await conn.query(
      `INSERT INTO user_capabilities (user_id, organization_id, capability, granted_by_user_id)
       VALUES ($1,$2,'knowledge.author',$1), ($3,$2,'org.user_admin',$3)`,
      [U.ADMIN_A_OTHER_GRANT, ORG_A, U.ADMIN_A_GRANTED]);

    // Nine invitation rows in tenant A across every status, plus one in tenant B.
    await insertInvitation(conn, 'A_PENDING_OPERATOR', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A });
    await insertInvitation(conn, 'A_PENDING_ADMIN', { organizationId: ORG_A, role: 'admin', invitedBy: U.ADMIN_A });
    await insertInvitation(conn, 'A_ACCEPTED_ADMIN', { organizationId: ORG_A, role: 'admin', invitedBy: U.ADMIN_A, status: 'accepted', acceptedBy: U.OPER_A });
    await insertInvitation(conn, 'A_EXPIRED_OPERATOR', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A, expiresSql: `NOW() - INTERVAL '1 day'` });
    await insertInvitation(conn, 'A_CANCELLED_OPERATOR', { organizationId: ORG_A, role: 'operator', invitedBy: U.ADMIN_A, status: 'cancelled' });
    await insertInvitation(conn, 'A_SECOND_ADMIN', { organizationId: ORG_A, role: 'admin', invitedBy: U.ADMIN_A });
    await insertInvitation(conn, 'A_SUPERVISOR_ROLE', { organizationId: ORG_A, role: 'supervisor', invitedBy: U.ADMIN_A });
    await insertInvitation(conn, 'B_PENDING_ADMIN', { organizationId: ORG_B, role: 'admin', invitedBy: U.ADMIN_B });
  });
}

async function cleanupFixture() {
  try {
    await withConn(async (conn) => {
      await conn.query(`DELETE FROM invitations WHERE email LIKE $1`, [`sec00g-%`]);
      await conn.query(`DELETE FROM users WHERE username LIKE $1`, [`sec00g-%`]);
      const orgIds = [ORG_A, ORG_B, ORG_C].filter((id) => id !== null);
      if (orgIds.length) {
        await conn.query(`DELETE FROM user_capabilities WHERE organization_id = ANY($1::int[])`, [orgIds]);
        await conn.query(`DELETE FROM organization_subscriptions WHERE organization_id = ANY($1::int[])`, [orgIds]);
        await conn.query(`DELETE FROM facilities WHERE organization_id = ANY($1::int[])`, [orgIds]);
        await conn.query(`DELETE FROM users WHERE organization_id = ANY($1::int[])`, [orgIds]);
        await conn.query(`DELETE FROM organizations WHERE id = ANY($1::int[])`, [orgIds]);
      }
      await conn.query(`DELETE FROM subscription_plans WHERE plan_code LIKE $1`, [`SEC00G-${RUN}%`]);
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

const listAs = (key, query = '') => call('GET', `/api/invitations${query}`, { as: key });

/**
 * Recursively find every credential-bearing path in a response payload:
 * any key whose name mentions a token, and any 64-hex value anywhere.
 */
function credentialPaths(value, at = '$') {
  const hits = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...credentialPaths(v, `${at}[${i}]`)));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (/token/i.test(k)) hits.push(`${at}.${k}`);
      hits.push(...credentialPaths(v, `${at}.${k}`));
    }
  } else if (typeof value === 'string' && HEX64.test(value)) {
    hits.push(`${at}=<64-hex value>`);
  }
  return hits;
}

const parse = (response) => JSON.parse(response.text);

/**
 * The seat defect (D-2) masks invitation CREATION, not listing.
 *
 * `canAddUser` returns false for every organization, so an authorized creation
 * is refused 403 at the controller's seat check. Test 24 asserts the creation
 * route is UNCHANGED by SEC-00G, so it neutralizes D-2 IN THIS PROCESS ONLY to
 * reach the behaviour underneath. No source file is modified, and the listing
 * assertions never need this because the listing route has no seat gate.
 */
const subscriptionService = require('../src/services/subscription.service');
const REAL_CAN_ADD_USER = subscriptionService.canAddUser;
async function withSeatMaskNeutralized(fn) {
  subscriptionService.canAddUser = async () => true;
  try { return await fn(); } finally { subscriptionService.canAddUser = REAL_CAN_ADD_USER; }
}

/** Every token this suite created, so "absent" can be asserted literally. */
const fixtureTokens = () => Object.values(INV).map((i) => i.token);

const snapshot = () => withConn((conn) => conn.query(
  `SELECT id, email, role, status, token, organization_id FROM invitations
    WHERE organization_id = ANY($1::int[]) ORDER BY id`, [[ORG_A, ORG_B, ORG_C]]));

// ===========================================================================

describe('ATM-001-SEC-00G GET /api/invitations authorization and token protection', { skip: DB_TEST_SKIP_REASON }, () => {
  // ----------------------------------------------------------- structural
  describe('0. route wiring and scope containment (source assertions)', () => {
    it('1. the listing applies the approved invitation-management capability', () => {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'src', 'routes', 'invitation.routes.js'), 'utf8');
      assert.match(source,
        /router\.get\('\/', requireCapability\('org\.user_admin'\), invitationController\.getAll\)/,
        'the listing must be authorized by org.user_admin, the approved invitation-management authority');
      assert.match(source,
        /const \{ requireCapability \} = require\('\.\.\/middleware\/capability\.middleware'\)/,
        'the canonical ATM-003 primitive must be used, not a reimplementation');
    });

    it('2. the listing projects rows through a view that drops the token', () => {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'src', 'controllers', 'invitation.controller.js'), 'utf8');
      assert.match(source, /const toInvitationListingView = \(invitation\) => \{[\s\S]*?const \{ token, \.\.\.listing \} = invitation;/,
        'the listing view must destructure `token` out of the row');
      assert.match(source, /const invitations = invitationRows\.map\(toInvitationListingView\);/,
        'the listing must be built from the sanitized projection, never the raw rows');
    });

    it('3. no invitation lifecycle operation other than listing was changed', () => {
      const routes = fs.readFileSync(path.join(REPO_ROOT, 'src', 'routes', 'invitation.routes.js'), 'utf8');

      // Unchanged in EVERY configuration this suite may run against: acceptance
      // stays public and cancel stays on the legacy admin guard. No correction in
      // this campaign touches either route.
      assert.match(routes, /router\.post\('\/accept', invitationController\.accept\)/, 'acceptance is unchanged and still public');
      assert.match(routes, /router\.delete\('\/:id', requireAdmin, invitationController\.cancel\)/, 'cancel is unchanged');

      // RESEND. SEC-00H/R1 (PR #92) is a separate, independently verified
      // correction. Standalone (absent) the original baseline assertion is kept
      // VERBATIM; integrated (present) the approved capability guard is pinned
      // exactly AND the retired legacy guard is asserted gone. Strictly stronger.
      if (SEC00H_PRESENT(routes)) {
        assert.match(routes, /router\.post\('\/:id\/resend', requireCapability\('org\.user_admin'\), invitationController\.resend\)/,
          'with SEC-00H present, resend must carry the approved org.user_admin capability guard');
        assert.ok(!/router\.post\('\/:id\/resend', requireAdmin, invitationController\.resend\)/.test(routes),
          'with SEC-00H present, the legacy requireAdmin-only resend guard must be gone');
      } else {
        assert.match(routes, /router\.post\('\/:id\/resend', requireAdmin, invitationController\.resend\)/,
          'resend is unchanged (out of scope; reported separately)');
      }

      // CREATION. SEC-00E (PR #90) is likewise separate. SEC-00G adds and removes
      // no creation authority, and must not be read as carrying PR #90.
      if (SEC00E_PRESENT(routes)) {
        assert.match(routes, /router\.post\('\/', requireAdmin, canCreateUser, invitationController\.create\)/,
          'with SEC-00E present, creation must carry the approved role-assignment authority');
      } else {
        assert.match(routes, /router\.post\('\/', requireAdmin, invitationController\.create\)/,
          'the creation route must be exactly what this baseline carries — SEC-00E is a separate PR');
        assert.ok(!routes.includes('canCreateUser'),
          'SEC-00G introduces no creation authority and does not import SEC-00E\'s guard');
      }
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

  // ===================================================== A. authorization
  describe('A. authorization (negative controls)', () => {
    it('4. an unauthenticated caller cannot list invitations', async () => {
      const response = await call('GET', '/api/invitations');
      assert.strictEqual(response.status, 401, 'authentication is required');
      assert.strictEqual(credentialPaths(JSON.parse(response.text)).length, 0,
        'a refusal must not carry invitation credentials');
    });

    it('5. an OPERATOR cannot list invitations', async () => {
      const response = await listAs('OPER_A');
      assert.strictEqual(response.status, 403,
        'NEGATIVE CONTROL: the pre-fix code returned 200 with raw tokens here');
      assert.match(response.text, /org\.user_admin is required/,
        'the refusal must come from the capability guard');
      assert.ok(!fixtureTokens().some((t) => response.text.includes(t)),
        'a refusal must not disclose any invitation token');
    });

    it('6. a SUPERVISOR cannot list invitations', async () => {
      const response = await listAs('SUP_A');
      assert.strictEqual(response.status, 403,
        'NEGATIVE CONTROL: the pre-fix code returned 200 with raw tokens here');
      assert.ok(!fixtureTokens().some((t) => response.text.includes(t)),
        'a refusal must not disclose any invitation token');
    });

    it('7. a plain administrator holds the capability and may list (design A, asserted)', async () => {
      // OWNER ruling for SEC-00G: authority is the RESOLVED capability, not the
      // `is_organization_admin` flag. In legacy compatibility mode the `admin`
      // bundle carries org.user_admin, so a plain administrator is admitted.
      const response = await listAs('PLAIN_ADMIN_A');
      assert.strictEqual(response.status, 200,
        'the approved admin compatibility bundle carries org.user_admin');
      assert.strictEqual(parse(response).data.invitations.length, 7, 'tenant A holds seven invitations');
    });

    it('8. an administrator holding an unrelated explicit grant does NOT hold org.user_admin', async () => {
      // OWNER-accepted consequence of design A: explicit grants discard the
      // legacy bundle, so an administrator who took any unrelated grant loses
      // the implicit org.user_admin and needs it granted explicitly.
      const response = await listAs('ADMIN_A_OTHER_GRANT');
      assert.strictEqual(response.status, 403,
        'the resolver resolves in EXPLICIT_GRANTS mode and the legacy bundle is discarded');
    });

    it('9. an administrator holding an explicit org.user_admin may list (the recovery path)', async () => {
      const response = await listAs('ADMIN_A_GRANTED');
      assert.strictEqual(response.status, 200,
        'an explicit org.user_admin grant restores the authority the resolver discarded');
      assert.strictEqual(parse(response).data.invitations.length, 7);
    });

    it('10. an authorized organization administrator may list', async () => {
      const response = await listAs('ADMIN_A');
      assert.strictEqual(response.status, 200, 'legitimate Tenant Administrator access is preserved');
      const body = parse(response);
      assert.strictEqual(body.success, true);
      assert.ok(Array.isArray(body.data.invitations), 'invitations must be an array');
      assert.ok(body.data.stats && typeof body.data.stats === 'object', 'stats must be present');
    });
  });

  // ================================================== B. tenant isolation
  describe('B. tenant isolation', () => {
    it('11. a cross-tenant administrator sees only its own tenant', async () => {
      const response = await listAs('ADMIN_B');
      assert.strictEqual(response.status, 200);
      const rows = parse(response).data.invitations;
      assert.strictEqual(rows.length, 1, 'tenant B holds exactly one invitation');
      assert.strictEqual(Number(rows[0].organization_id), ORG_B);
      assert.ok(rows.every((r) => Number(r.organization_id) === ORG_B),
        'no row from another tenant may appear');
    });

    it('12. a forged organization identifier cannot change the result', async () => {
      const viaQuery = await listAs('ADMIN_A', `?organization_id=${ORG_B}`);
      assert.strictEqual(viaQuery.status, 200);
      const rows = parse(viaQuery).data.invitations;
      assert.strictEqual(rows.length, 7, 'the query string must not redirect the tenant');
      assert.ok(rows.every((r) => Number(r.organization_id) === ORG_A),
        'the tenant is always the authenticated session');

      const viaBody = await call('GET', '/api/invitations', { as: 'ADMIN_A', body: { organization_id: ORG_B } });
      const bodyRows = parse(viaBody).data.invitations;
      assert.ok(bodyRows.every((r) => Number(r.organization_id) === ORG_A),
        'a request body must not redirect the tenant either');
    });
  });

  // ============================================== C. credential protection
  describe('C. credential protection', () => {
    it('13. no invitation row exposes a top-level token field', async () => {
      const rows = parse(await listAs('ADMIN_A')).data.invitations;
      assert.ok(rows.length > 0, 'precondition: the listing returned rows');
      for (const row of rows) {
        assert.ok(!Object.prototype.hasOwnProperty.call(row, 'token'),
          `row ${row.id} must not carry a token field`);
      }
    });

    it('14. no raw invitation token appears anywhere in the response', async () => {
      const response = await listAs('ADMIN_A');
      for (const token of fixtureTokens()) {
        assert.ok(!response.text.includes(token),
          'NEGATIVE CONTROL: the pre-fix code returned every raw token here');
      }
      assert.ok(!/\b[0-9a-f]{64}\b/.test(response.text), 'no 64-hex value may appear');
    });

    it('15. no nested object or array exposes a credential', async () => {
      const body = parse(await listAs('ADMIN_A'));
      assert.deepStrictEqual(credentialPaths(body), [],
        'no key named *token* and no 64-hex value may exist at any depth');
    });

    it('16. no alternative credential field substitutes for the token', async () => {
      const body = parse(await listAs('ADMIN_A'));
      const raw = JSON.stringify(body);
      for (const field of ['invitationLink', 'invitation_link', 'link', 'url', 'signupUrl', 'code']) {
        assert.ok(!raw.includes(field), `field "${field}" must not appear in a listing`);
      }
      assert.ok(!/signup\?token=/.test(raw), 'no enrollment URL may be constructed in a listing');
    });

    it('17. refused responses disclose no credential either', async () => {
      for (const key of ['OPER_A', 'SUP_A', 'ADMIN_A_OTHER_GRANT']) {
        const response = await listAs(key);
        assert.ok(!fixtureTokens().some((t) => response.text.includes(t)),
          `${key}: a refusal must not leak a token`);
        assert.ok(!/\b[0-9a-f]{64}\b/.test(response.text), `${key}: no 64-hex value in a refusal`);
      }
    });
  });

  // ==================================================== D. behaviour preserved
  describe('D. authorized listing behaviour', () => {
    it('18. the response keeps the structure the administration view consumes', async () => {
      const body = parse(await listAs('ADMIN_A'));
      assert.strictEqual(body.success, true);
      assert.ok(Array.isArray(body.data.invitations));
      for (const field of ['total', 'pending', 'accepted', 'expired', 'availableSeats']) {
        assert.ok(field in body.data.stats, `stats.${field} must be present`);
      }
      for (const field of ['id', 'email', 'role', 'status', 'created_at', 'expires_at', 'organization_id']) {
        assert.ok(field in body.data.invitations[0], `invitation.${field} must be preserved`);
      }
    });

    it('19. every invitation status and role is still listed', async () => {
      const rows = parse(await listAs('ADMIN_A')).data.invitations;
      const ids = rows.map((r) => Number(r.id));
      for (const key of ['A_PENDING_OPERATOR', 'A_PENDING_ADMIN', 'A_ACCEPTED_ADMIN',
        'A_EXPIRED_OPERATOR', 'A_CANCELLED_OPERATOR', 'A_SECOND_ADMIN', 'A_SUPERVISOR_ROLE']) {
        assert.ok(ids.includes(INV[key].id), `${key} must be listed`);
      }
      const statuses = new Set(rows.map((r) => r.status));
      for (const s of ['pending', 'accepted', 'cancelled']) {
        assert.ok(statuses.has(s), `status ${s} must remain visible to the administrator`);
      }
      // An expired invitation is still stored as 'pending' with a past
      // expires_at; expiry is derived, and `stats.expired` is where it surfaces.
      assert.ok(ids.includes(INV.A_EXPIRED_OPERATOR.id), 'the expired invitation must still be listed');
      assert.ok(rows.some((r) => r.role === 'admin'), 'administrator invitations are listed');
      assert.strictEqual(rows.length, 7);
    });

    it('20. a tenant with no invitations receives an empty list', async () => {
      const response = await listAs('ADMIN_C');
      assert.strictEqual(response.status, 200);
      const body = parse(response);
      assert.deepStrictEqual(body.data.invitations, []);
      assert.strictEqual(body.data.stats.total, 0);
    });

    it('21. listing mutates nothing', async () => {
      const before = await snapshot();
      await listAs('ADMIN_A');
      await listAs('ADMIN_B');
      await listAs('SUP_A');
      await listAs('OPER_A');
      const after = await snapshot();
      assert.deepStrictEqual(after, before, 'a listing must not change any invitation row');
    });

    it('22. the administration view keeps its fields and loses only the token', async () => {
      const rows = parse(await listAs('ADMIN_A')).data.invitations;
      const pending = rows.find((r) => Number(r.id) === INV.A_PENDING_OPERATOR.id);
      assert.ok(pending, 'the pending invitation must be listed');
      // Fields the view renders:
      for (const field of ['id', 'email', 'role', 'status', 'created_at']) {
        assert.ok(pending[field] !== undefined && pending[field] !== null, `${field} must survive`);
      }
      // The reported consumer dependency: the "Copy Link" action needs the token.
      assert.strictEqual(pending.token, undefined,
        'REPORTED BREAKAGE: the mobile admin "Copy Link" action for an existing invitation '
        + 'reads inv.token and will no longer work; that view is out of this mission scope');
    });
  });

  // ================================================= E. scope containment
  describe('E. adjacent behaviour is unchanged', () => {
    it('23. SEC-00G changes no creation authority, and a supervisor cannot obtain an administrator invitation', async () => {
      // CREATION AUTHORITY belongs to SEC-00E (PR #90), a separate unmerged
      // correction. Standalone this asserts the baseline route verbatim;
      // integrated it pins SEC-00E's exact approved chain. Strictly stronger.
      const routes = fs.readFileSync(path.join(REPO_ROOT, 'src', 'routes', 'invitation.routes.js'), 'utf8');
      if (SEC00E_PRESENT(routes)) {
        assert.match(routes, /router\.post\('\/', requireAdmin, canCreateUser, invitationController\.create\)/,
          'with SEC-00E present, creation must carry the approved role-assignment authority');
      } else {
        assert.match(routes, /router\.post\('\/', requireAdmin, invitationController\.create\)/,
          'the creation chain must be unchanged by SEC-00G');
      }

      // BEHAVIOURAL SECURITY ASSERTION — preserved and STRENGTHENED.
      //
      // A supervisor must never be able to obtain an administrator invitation,
      // and the refused path must persist NOTHING. This is SEC-00E's core
      // invariant, asserted here live over HTTP against the database.
      //
      // The original form could only observe the BASELINE mechanism, in which the
      // refusal came from the D-2 seat defect — a capacity bug and explicitly NOT
      // an authorization control. On any combined tree its source assertion failed
      // first, so this behavioural tail was never reached (recorded as an unreached
      // limit by ATM-001-SEC-00H-R1-VUDA-02; closed by ATM-001-SEC-INTEGRATION-01).
      // It is now reached, and it asserts WHICH control refuses:
      //   standalone — the seat mask, identified as such and not mistaken for a control;
      //   integrated — role-assignment authority, and explicitly NOT the seat mask.
      const email = `sec00g-scope-${tag()}@test.local`;
      const response = await call('POST', '/api/invitations', { as: 'SUP_A', body: { email, role: 'admin' } });
      assert.strictEqual(response.status, 403,
        'a supervisor-issued administrator invitation must be refused');
      if (SEC00E_PRESENT(routes)) {
        assert.match(response.text, /Can only create operator users/,
          'with SEC-00E present the refusal must come from role-assignment authority');
        assert.ok(!/Seat limit reached/.test(response.text),
          'the refusal must NOT be the D-2 seat mask: that is a capacity defect, not an authorization control');
      } else {
        assert.match(response.text, /Seat limit reached/,
          'the refusal must be identified as the seat defect, not mistaken for a control');
      }
      const rows = await withConn((conn) => conn.query(`SELECT id, role FROM invitations WHERE email = $1`, [email]));
      assert.strictEqual(rows.length, 0,
        'the refused path persists nothing — no administrator invitation may be created');
    });

    it('24. an authorized creation still returns the new enrollment credential', async () => {
      // The delivery moment is creation, not listing. D-1 makes the response 500
      // after the INSERT commits, so the DATABASE EFFECT is asserted.
      const email = `sec00g-create-${tag()}@test.local`;
      const response = await withSeatMaskNeutralized(() =>
        call('POST', '/api/invitations', { as: 'ADMIN_A', body: { email, role: 'operator' } }));
      assert.notStrictEqual(response.status, 403, 'an authorized administrator must not be refused by authority');
      const rows = await withConn((conn) => conn.query(`SELECT token FROM invitations WHERE email = $1`, [email]));
      assert.strictEqual(rows.length, 1, 'the authorized invitation must persist');
      assert.ok(HEX64.test(String(rows[0].token)), 'creation still issues a usable token');
    });

    it('25. cancel is unchanged, and resend authority is enforced when SEC-00H is present', async () => {
      const routes = fs.readFileSync(path.join(REPO_ROOT, 'src', 'routes', 'invitation.routes.js'), 'utf8');

      // CANCEL is out of scope for every correction in this campaign and stays on
      // the legacy admin guard, so a supervisor remains admitted. Unconditional.
      const cancel = await call('DELETE', `/api/invitations/${INV.A_PENDING_OPERATOR.id}`, { as: 'SUP_A' });
      assert.notStrictEqual(cancel.status, 403, 'cancel is out of scope and unchanged (supervisor still admitted)');

      // RESEND. Capture the original invitation's database state BEFORE the
      // request, so the assertion is made on EFFECT and not merely on status.
      const email = INV.A_PENDING_ADMIN.email;
      const before = await withConn((conn) => conn.query(
        `SELECT id, status, role FROM invitations WHERE email = $1 ORDER BY id`, [email]));
      const resend = await call('POST', `/api/invitations/${INV.A_PENDING_ADMIN.id}/resend`, { as: 'SUP_A' });
      const after = await withConn((conn) => conn.query(
        `SELECT id, status, role FROM invitations WHERE email = $1 ORDER BY id`, [email]));

      if (SEC00H_PRESENT(routes)) {
        // INTEGRATED — the approved PROTECTED behaviour.
        //
        // SEC-00H/R1 is present, so a supervisor MUST be refused resend authority
        // on an administrator invitation. This assertion is the INVERSE of the
        // standalone one: the standalone form asserted that the supervisor was NOT
        // refused, i.e. it pinned the vulnerable pre-fix behaviour that the suite
        // itself reports as SEC-00F-1. Replacing it with the closure assertion
        // turns a vulnerability pin into a regression test — and it is stronger
        // than a status check because it also asserts the database effect.
        assert.strictEqual(resend.status, 403,
          'with SEC-00H present a supervisor must be refused resend authority');
        assert.strictEqual(after.length, before.length,
          'a refused resend must not create a replacement invitation row');
        assert.strictEqual(after[0].status, before[0].status,
          'a refused resend must not alter the original invitation status');
        assert.strictEqual(after[0].role, before[0].role,
          'a refused resend must not alter the stored invitation role');

        // CRITICAL SECURITY INVARIANT (SEC-00H-R1 finding F-2).
        //
        // A PLAIN administrator (role = 'admin', is_organization_admin = false)
        // holds org.user_admin through the approved admin compatibility bundle, so
        // it passes the route's capability gate — but it must NOT be able to
        // re-issue an ADMINISTRATOR invitation, because it has no authority to
        // issue the administrator role. This is the exact escalation class the
        // standalone form of this test tolerated, and the case a capability-only
        // guard does not close. Asserting it here makes this test a real detector
        // of an F-2 regression rather than a restatement of the route wiring.
        const adminEmail = INV.A_SECOND_ADMIN.email;
        const adminBefore = await withConn((conn) => conn.query(
          `SELECT id, status, role FROM invitations WHERE email = $1 ORDER BY id`, [adminEmail]));
        const plainResend = await call('POST', `/api/invitations/${INV.A_SECOND_ADMIN.id}/resend`, { as: 'PLAIN_ADMIN_A' });
        const adminAfter = await withConn((conn) => conn.query(
          `SELECT id, status, role FROM invitations WHERE email = $1 ORDER BY id`, [adminEmail]));
        assert.strictEqual(plainResend.status, 403,
          'a plain administrator must NOT be able to re-issue an administrator invitation');
        assert.strictEqual(adminAfter.length, adminBefore.length,
          'the refused administrator-role resend must not create a replacement invitation row');
        assert.strictEqual(adminAfter[0].role, adminBefore[0].role,
          'the refused administrator-role resend must not alter the stored invitation role');
      } else {
        assert.notStrictEqual(resend.status, 403,
          'resend is out of scope and unchanged; its missing authority check is reported as SEC-00F-1');
      }
    });
  });
});
