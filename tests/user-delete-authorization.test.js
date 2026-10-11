/**
 * ATM-001-SEC-00B — DELETE /api/users/:id authorization and tenant isolation.
 *
 * Reported defect: the route was guarded only by `requireAdmin`, which admits a
 * supervisor as well as an administrator (`src/middleware/auth.js`), and neither
 * the handler nor `User.delete` applied any organization or facility predicate.
 * A supervisor of one tenant could delete another tenant's user, and the
 * approved `USERS.DELETE` contract (`admin: 'all'`, `supervisor: 'none'`,
 * `operator: 'none'`) was never consulted.
 *
 * Required properties asserted here: operators and supervisors cannot delete;
 * an administrator is confined to their own organization; a cross-tenant
 * deletion is refused and leaves the target byte-identical; an unauthorized
 * response is indistinguishable from a missing record; malformed and
 * out-of-range identifiers fail safely; and the legitimate same-tenant
 * administrator workflow still works.
 *
 * Evidence policy: the HTTP layer is exercised against the real Express app
 * with real JWTs and a real disposable PostgreSQL database, so authentication,
 * routing, permission resolution and middleware order are production-shaped.
 * Where a claim is about what did NOT happen, it is asserted against the
 * database row itself, not against the response.
 *
 * Negative controls: section A asserts the behaviours the pre-fix code
 * violated. Run against the unfixed baseline, an operator and a supervisor
 * receive 200 and the cross-tenant administrator deletes the foreign record -
 * those tests FAIL, which is this suite's own proof that it detects the
 * reported vulnerability.
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * `src/config/database.js` uses to select test-database credentials.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const { getConnection, isIntegrationTest } = require('../src/config/database');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating user-delete suite requires the sanctioned database-test '
    + 'gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that test-database '
    + 'credentials are used instead of runtime credentials; run it via '
    + '`npm run test:integration`';

const JWT_SECRET = 'test-only-jwt-secret-not-for-production-000000';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`;
const seq = { n: 0 };
const tag = () => `${RUN}${(++seq.n).toString(36)}`;

/** Byte-unique bcrypt-shaped hash per fixture user, so "unchanged" is literal. */
const hashFor = (key) => `$2a$04$${`${RUN}${key}`.padEnd(53, 'y').slice(0, 53)}`;

const USERS = {};
const HASHES = {};
let ORG_A = null;
let ORG_B = null;

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
  const { organizationId, role, isOrganizationAdmin = false } = options;
  const marker = hashFor(key);
  const handle = `sec00b-${key.toLowerCase()}-${tag()}`;
  const rows = await conn.query(
    `INSERT INTO users (organization_id, username, email, password_hash, full_name,
                        role, is_active, status, is_organization_admin, is_billable)
     VALUES ($1, $2, $3, $4, $5, $6, true, 'active', $7, true)
     RETURNING id`,
    [organizationId, handle, `${handle}@test.local`, marker, `SEC00B ${key}`,
      role, isOrganizationAdmin]);
  USERS[key] = Number(rows[0].id);
  HASHES[key] = marker;
  return USERS[key];
}

async function ensureFixture() {
  await withConn(async (conn) => {
    const orgs = await conn.query(
      `INSERT INTO organizations (organization_name, subscription_status)
       VALUES ($1, 'active'), ($2, 'active') RETURNING id`,
      [`SEC00B Org A ${RUN}`, `SEC00B Org B ${RUN}`]);
    [ORG_A, ORG_B] = orgs.map((row) => Number(row.id));

    await insertUser(conn, 'ADMIN_A', { organizationId: ORG_A, role: 'admin', isOrganizationAdmin: true });
    await insertUser(conn, 'ADMIN_B', { organizationId: ORG_B, role: 'admin', isOrganizationAdmin: true });
    await insertUser(conn, 'SUP_A', { organizationId: ORG_A, role: 'supervisor' });
    await insertUser(conn, 'OPER_A', { organizationId: ORG_A, role: 'operator' });
    await insertUser(conn, 'VICTIM_A', { organizationId: ORG_A, role: 'operator' });
    await insertUser(conn, 'VICTIM_A2', { organizationId: ORG_A, role: 'operator' });
    await insertUser(conn, 'VICTIM_B', { organizationId: ORG_B, role: 'operator' });
  });
}

async function cleanupFixture() {
  try {
    await withConn(async (conn) => {
      const orgIds = [ORG_A, ORG_B].filter((id) => id !== null);
      if (orgIds.length) {
        await conn.query(`DELETE FROM users WHERE organization_id = ANY($1::int[])`, [orgIds]);
        await conn.query(`DELETE FROM organization_subscriptions WHERE organization_id = ANY($1::int[])`, [orgIds]);
        await conn.query(`UPDATE organizations SET subscription_id = NULL WHERE id = ANY($1::int[])`, [orgIds]);
        await conn.query(`DELETE FROM organizations WHERE id = ANY($1::int[])`, [orgIds]);
      }
    });
  } catch {
    // Disposable-database hygiene only.
  }
}

/** The complete stored state of a user, used to prove non-mutation. */
async function rowOf(userId) {
  return withConn(async (conn) => {
    const rows = await conn.query(
      `SELECT id, organization_id, username, email, password_hash, full_name, role,
              is_active, status, is_organization_admin, is_billable
       FROM users WHERE id = $1`, [userId]);
    return rows[0] || null;
  });
}

// ---------------------------------------------------------------------------
// HTTP harness
// ---------------------------------------------------------------------------

let server = null;
let port = null;

function call(method, requestPath, { userId } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (userId) headers.Authorization = `Bearer ${jwt.sign({ userId }, JWT_SECRET)}`;
    const req = http.request({ host: '127.0.0.1', port, method, path: requestPath, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

const deleteAs = (key, targetId) => call('DELETE', `/api/users/${targetId}`, { userId: USERS[key] });

/** Assert an attempted deletion was refused and left the target untouched. */
async function assertRefusedAndUnchanged(response, actorKey, targetKey, expectedStatus) {
  const label = `${actorKey} -> ${targetKey}`;
  assert.strictEqual(response.status, expectedStatus,
    `${label}: expected ${expectedStatus}, got ${response.status} (${response.text})`);
  const stored = await rowOf(USERS[targetKey]);
  assert.ok(stored, `${label}: the target must not have been deleted`);
  assert.strictEqual(stored.password_hash, HASHES[targetKey],
    `${label}: the target's stored row must be byte-identical`);
}

// ==========================================================================

describe('ATM-001-SEC-00B DELETE /api/users/:id authorization and tenant isolation', { skip: DB_TEST_SKIP_REASON }, () => {
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

  // ------------------------------------------------------ A: the reported defect
  describe('A. unauthorized deletion is refused (negative controls)', () => {
    it('1. an operator cannot delete another user', async () => {
      const response = await deleteAs('OPER_A', USERS.VICTIM_A);
      await assertRefusedAndUnchanged(response, 'OPER_A', 'VICTIM_A', 403);
      assert.ok(/DELETE permission required/.test(response.text),
        'the refusal must come from the approved permission contract');
    });

    it('2. a supervisor cannot delete another user', async () => {
      const response = await deleteAs('SUP_A', USERS.VICTIM_A);
      await assertRefusedAndUnchanged(response, 'SUP_A', 'VICTIM_A', 403);
    });

    it('3. a supervisor cannot delete a user in another tenant', async () => {
      const response = await deleteAs('SUP_A', USERS.VICTIM_B);
      await assertRefusedAndUnchanged(response, 'SUP_A', 'VICTIM_B', 403);
    });

    it('4. an administrator cannot delete a user of another tenant', async () => {
      const response = await deleteAs('ADMIN_A', USERS.VICTIM_B);
      await assertRefusedAndUnchanged(response, 'ADMIN_A', 'VICTIM_B', 404);
    });

    it('5. a foreign-tenant administrator cannot delete one of ours', async () => {
      const response = await deleteAs('ADMIN_B', USERS.VICTIM_A);
      await assertRefusedAndUnchanged(response, 'ADMIN_B', 'VICTIM_A', 404);
    });
  });

  // ------------------------------------------------- B: non-disclosure and safety
  describe('B. refusals do not disclose existence and fail safely', () => {
    it('6. an operator or supervisor gets one identical 403 for an existing and an absent identifier', async () => {
      const absentId = 2147483600;
      for (const actor of ['OPER_A', 'SUP_A']) {
        const existing = await deleteAs(actor, USERS.VICTIM_A);
        const absent = await deleteAs(actor, absentId);
        assert.strictEqual(existing.status, 403);
        assert.strictEqual(absent.status, 403);
        assert.strictEqual(absent.text, existing.text,
          `${actor}: the response must not depend on whether the target exists`);
      }
    });

    it('7. a cross-tenant target and an absent target are byte-identical for an administrator', async () => {
      const crossTenant = await deleteAs('ADMIN_A', USERS.VICTIM_B);
      const absent = await deleteAs('ADMIN_A', 2147483601);
      assert.strictEqual(crossTenant.status, 404);
      assert.strictEqual(absent.status, 404);
      assert.strictEqual(crossTenant.text, absent.text,
        'a cross-tenant record must be indistinguishable from an absent one');
      assert.ok(!/SEC00B Org B/.test(crossTenant.text), 'no tenant identity may be disclosed');
      assert.ok(!/password_hash/i.test(crossTenant.text), 'no credential field may be disclosed');
    });

    it('8. malformed and out-of-range identifiers fail safely with the same 404', async () => {
      const malformed = ['abc', '0', '-1', '1.5', '99999999999999999999', '2147483648', '1e3'];
      const baseline = await deleteAs('ADMIN_A', 2147483602);
      for (const raw of malformed) {
        const response = await call('DELETE', `/api/users/${raw}`, { userId: USERS.ADMIN_A });
        assert.strictEqual(response.status, 404, `id "${raw}" must fail safely`);
        assert.strictEqual(response.text, baseline.text,
          `id "${raw}" must be indistinguishable from an absent record`);
      }
    });

    it('9. an unauthenticated deletion is 401 and changes nothing', async () => {
      const response = await call('DELETE', `/api/users/${USERS.VICTIM_A}`);
      assert.strictEqual(response.status, 401);
      await assertRefusedAndUnchanged(response, 'anonymous', 'VICTIM_A', 401);
    });

    it('10. every refused attempt left both tenants exactly as they were', async () => {
      for (const key of ['ADMIN_A', 'ADMIN_B', 'SUP_A', 'OPER_A', 'VICTIM_A', 'VICTIM_A2', 'VICTIM_B']) {
        const stored = await rowOf(USERS[key]);
        assert.ok(stored, `${key} must still exist`);
        assert.strictEqual(stored.password_hash, HASHES[key], `${key} must be unmodified`);
      }
    });
  });

  // ------------------------------------------------- C: legitimate workflows
  describe('C. the legitimate administrator workflow is preserved', () => {
    it('11. a same-tenant administrator can still delete a user', async () => {
      const response = await deleteAs('ADMIN_A', USERS.VICTIM_A);
      assert.strictEqual(response.status, 200, `authorized deletion must still work: ${response.text}`);
      assert.strictEqual(await rowOf(USERS.VICTIM_A), null, 'the record must be gone');
    });

    it('12. the same-tenant workflow works in the other tenant too', async () => {
      const response = await deleteAs('ADMIN_B', USERS.VICTIM_B);
      assert.strictEqual(response.status, 200, `authorized deletion must still work: ${response.text}`);
      assert.strictEqual(await rowOf(USERS.VICTIM_B), null, 'the record must be gone');
    });

    it('13. deleting a non-existent user reports 404, never a false success', async () => {
      const response = await deleteAs('ADMIN_A', 2147483603);
      assert.strictEqual(response.status, 404);
    });

    it('14. an administrator still cannot delete their own account', async () => {
      const response = await deleteAs('ADMIN_A', USERS.ADMIN_A);
      assert.strictEqual(response.status, 400, `self-deletion must stay refused: ${response.text}`);
      assert.ok(/Cannot delete your own account/.test(response.text));
      assert.ok(await rowOf(USERS.ADMIN_A), 'the administrator must still exist');
    });
  });

  // ------------------------------------------------- D: scoped destructive statement
  describe('D. the deletion is scoped in the data layer as well as the guard', () => {
    it('15. deleteForOrganization refuses a foreign-tenant id and removes a same-tenant one', async () => {
      const { User } = require('../src/models');

      const foreign = await User.deleteForOrganization(USERS.SUP_A, ORG_B);
      assert.strictEqual(foreign, false, 'a tenant-mismatched delete must remove nothing');
      assert.ok(await rowOf(USERS.SUP_A), 'the record must survive a mismatched delete');

      const own = await User.deleteForOrganization(USERS.VICTIM_A2, ORG_A);
      assert.strictEqual(own, true, 'a tenant-matched delete must report removal');
      assert.strictEqual(await rowOf(USERS.VICTIM_A2), null, 'the record must be gone');
    });
  });
});
