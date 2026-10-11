/**
 * ATM-001-SEC-00C — DELETE /api/organizations/:id deletion containment
 *
 * Reported defect (VERIFIED by execution; see
 * review-evidence/atiman-sec-00/probes/PROBE-orgdelete-cross-tenant.log):
 * an authenticated supervisor of tenant X could delete tenant Y through
 *   DELETE /api/organizations/:id
 * because the route was guarded by `requireAdmin` — which admits a SUPERVISOR
 * (src/middleware/auth.js:62-70) — and the controller applied no tenant
 * predicate. `users.organization_id REFERENCES organizations(id) ON DELETE
 * CASCADE` (database/postgresql/001_core.sql) then removed every user in the
 * deleted tenant.
 *
 * Containment under test (ATM-001-SEC-00C): the route now denies every caller
 * with a stable 403 before any controller or model call, until the OWNER
 * approves a permanent organization-deletion policy.
 *
 * Evidence policy: the HTTP layer is exercised against the real Express app,
 * with real JWTs and a real disposable PostgreSQL database, so authentication,
 * route matching, middleware order and the serialised payload are
 * production-shaped rather than simulated. Claims about what is ABSENT are
 * asserted against the serialised response body and against the database
 * itself, not against a hand-picked field list.
 *
 * Negative-control properties (mission §5): these assertions are exactly the
 * behaviours the pre-fix code violated — a supervisor and a tenant
 * administrator reaching the destructive handler, a cross-tenant deletion
 * succeeding, and users being cascade-deleted. Run against the unfixed
 * baseline they fail; that is the suite's own proof that it detects the
 * reported behaviour. The executed baseline run is filed with the mission
 * report. A separate, clearly labelled mechanism control below demonstrates
 * that the retained model operation is genuinely destructive, i.e. that the
 * route denial is the only thing standing between a request and the cascade.
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * src/config/database.js uses to select test-database credentials, so it can
 * never run against runtime credentials.
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const { pool, getConnection, isIntegrationTest } = require('../src/config/database');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating organization-delete containment suite requires the '
    + 'sanctioned database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, '
    + 'TEST_DB_*) so that test-database credentials are used instead of runtime '
    + 'credentials; run it via `npm run test:integration`';

const JWT_SECRET = 'test-only-jwt-secret-not-for-production-000000';

// Disposable fixture id block. It MUST stay disjoint from every other suite's:
// the sanctioned runner executes suites in PARALLEL PROCESSES against ONE
// shared database and every fixture uses `ON CONFLICT (id) DO NOTHING`, so a
// colliding id is not an error — it is a silent substitution of another
// suite's principal, with another suite's role and organization. `9997xx` is
// unused corpus-wide.
const ORG_A = 999701;        // tenant under test, subscription_status = active
const ORG_B = 999702;        // foreign tenant, subscription_status = active
const ORG_C = 999703;        // throwaway tenant for the mechanism control only
const ADMIN_A = 999711;      // ORG_A tenant administrator (highest role that exists)
const SUPERVISOR_A = 999712; // ORG_A supervisor (the reported actor)
const OPERATOR_A = 999713;   // ORG_A operator
const ADMIN_B = 999714;      // ORG_B tenant administrator (cross-tenant actor)
const OPERATOR_B = 999715;   // ORG_B user that a cascade would destroy
const OPERATOR_B2 = 999716;  // second ORG_B user, so a cascade cannot be missed
const VICTIM_C = 999717;     // ORG_C user for the mechanism control only
const ABSENT_ORG = 999799;   // id that exists in no tenant

const ORG_A_NAME = `SEC-00C Org A ${ORG_A}`;
const ORG_B_NAME = `SEC-00C Org B ${ORG_B}`;
const ORG_C_NAME = `SEC-00C Org C ${ORG_C}`;

// ---------------------------------------------------------------- DB helpers

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

const query = (conn, sql, params) => conn.query(sql, params);

async function ensureFixture() {
  await withConn(async (conn) => {
    for (const [id, name] of [
      [ORG_A, ORG_A_NAME],
      [ORG_B, ORG_B_NAME],
      [ORG_C, ORG_C_NAME]
    ]) {
      await query(conn,
        `INSERT INTO organizations (id, organization_name, subscription_status, max_users)
         VALUES (?, ?, 'active', 100) ON CONFLICT (id) DO NOTHING`,
        [id, name]);
    }

    for (const [id, username, role, orgId, isOrgAdmin] of [
      [ADMIN_A, 'sec00c-admin-a', 'admin', ORG_A, true],
      [SUPERVISOR_A, 'sec00c-supervisor-a', 'supervisor', ORG_A, false],
      [OPERATOR_A, 'sec00c-operator-a', 'operator', ORG_A, false],
      [ADMIN_B, 'sec00c-admin-b', 'admin', ORG_B, true],
      [OPERATOR_B, 'sec00c-operator-b', 'operator', ORG_B, false],
      [OPERATOR_B2, 'sec00c-operator-b2', 'operator', ORG_B, false],
      [VICTIM_C, 'sec00c-operator-c', 'operator', ORG_C, false]
    ]) {
      await query(conn,
        `INSERT INTO users (id, username, email, password_hash, full_name, role,
                            organization_id, is_organization_admin, is_active, status)
         VALUES (?, ?, ?, 'x', 'SEC-00C Fixture User', ?, ?, ?, true, 'active')
         ON CONFLICT (id) DO NOTHING`,
        [id, username, `${username}@sec00c.test.local`, role, orgId, isOrgAdmin]);
    }
  });
}

/** Full row image, so "unchanged" means every column, not a chosen few. */
const orgRow = (id) => withConn((c) =>
  c.query('SELECT * FROM organizations WHERE id = ?', [id]).then((rows) => rows[0] || null));

const orgUsers = (orgId) => withConn((c) =>
  c.query(`SELECT id, username, email, full_name, role, organization_id, is_organization_admin,
                  is_active, status
             FROM users WHERE organization_id = ? ORDER BY id`, [orgId]));

const countOrg = (id) => withConn((c) =>
  c.query('SELECT COUNT(*)::int AS n FROM organizations WHERE id = ?', [id]).then((r) => r[0].n));

/**
 * Record every statement issued through the shared pool while `fn` runs.
 *
 * `src/models/base.model.js` reaches the database through `pool.execute`
 * (`BaseModel.query`), and `pool.query` covers the direct-call paths. Both are
 * wrapped because "no deletion executes" must be a statement-level claim, not
 * an inference from unchanged rows. The wrappers are process-local, so the
 * parallel-process runner cannot see this suite's recorder.
 */
async function recordSql(fn) {
  const originalExecute = pool.execute;
  const originalQuery = pool.query;
  const seen = [];
  const capture = (original) => function recorder(sql, ...rest) {
    seen.push(String(sql));
    return original.call(this, sql, ...rest);
  };
  pool.execute = capture(originalExecute);
  pool.query = capture(originalQuery);
  try {
    return { result: await fn(), seen };
  } finally {
    pool.execute = originalExecute;
    pool.query = originalQuery;
  }
}

// ---------------------------------------------------------------- HTTP helpers

let server;
let port;

function call(method, requestPath, { userId, body, token, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const bearer = token || (userId ? jwt.sign({ userId }, JWT_SECRET) : null);
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: requestPath,
      headers: {
        ...(payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {}),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { parsed = String(data).slice(0, 400); }
        resolve({ status: res.statusCode, body: parsed, raw: data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const del = (orgId, options) => call('DELETE', `/api/organizations/${orgId}`, options);

// =========================================================================
// Containment behaviour — real HTTP, real JWTs, disposable PostgreSQL.
// =========================================================================

describe('ATM-001-SEC-00C — organization-deletion containment', { skip: DB_TEST_SKIP_REASON }, () => {
  let orgABefore;
  let orgBBefore;
  let usersABefore;
  let usersBBefore;

  before(async () => {
    await ensureFixture();
    orgABefore = await orgRow(ORG_A);
    orgBBefore = await orgRow(ORG_B);
    usersABefore = await orgUsers(ORG_A);
    usersBBefore = await orgUsers(ORG_B);

    assert.ok(orgABefore && orgBBefore, 'fixture organizations must exist');
    assert.ok(usersBBefore.length >= 2, 'ORG_B must hold users a cascade could destroy');

    process.env.JWT_SECRET = JWT_SECRET;
    const app = require('../src/app');
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    port = server.address().port;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  // ---- 1. unauthenticated -------------------------------------------------

  it('1. denies an unauthenticated deletion request (401) and touches nothing', async () => {
    const res = await del(ORG_B);
    assert.strictEqual(res.status, 401, `expected 401, got ${res.status}: ${res.raw}`);
    assert.strictEqual(res.body.success, false);
    assert.ok(!/SEC-00C/.test(res.raw), 'the response must not name a tenant');
    assert.strictEqual(await countOrg(ORG_B), 1);
  });

  it('1b. denies an expired/invalid-identity token and a forged-signature token', async () => {
    const absentUser = await del(ORG_B, { userId: 999798 });
    assert.strictEqual(absentUser.status, 401, `unknown identity: ${absentUser.raw}`);

    const expired = jwt.sign({ userId: ADMIN_A }, JWT_SECRET, { expiresIn: -60 });
    const expiredRes = await del(ORG_B, { token: expired });
    assert.strictEqual(expiredRes.status, 401, `expired token: ${expiredRes.raw}`);

    const forged = jwt.sign({ userId: ADMIN_A }, 'not-the-server-secret-0000000000000000');
    const forgedRes = await del(ORG_B, { token: forged });
    assert.strictEqual(forgedRes.status, 401, `forged signature: ${forgedRes.raw}`);

    assert.strictEqual(await countOrg(ORG_B), 1);
  });

  // ---- 2-6. every authenticated role is denied ----------------------------

  it('2. denies an operator deleting its own organization and a foreign one (403)', async () => {
    const own = await del(ORG_A, { userId: OPERATOR_A });
    assert.strictEqual(own.status, 403, `operator/own: ${own.raw}`);
    assert.strictEqual(own.body.code, 'ORGANIZATION_DELETION_DISABLED');

    const foreign = await del(ORG_B, { userId: OPERATOR_A });
    assert.strictEqual(foreign.status, 403, `operator/foreign: ${foreign.raw}`);
    assert.strictEqual(foreign.body.code, 'ORGANIZATION_DELETION_DISABLED');
  });

  it('3. denies a supervisor deleting its own organization and a foreign one (403)', async () => {
    const own = await del(ORG_A, { userId: SUPERVISOR_A });
    assert.strictEqual(own.status, 403, `supervisor/own: ${own.raw}`);

    const foreign = await del(ORG_B, { userId: SUPERVISOR_A });
    assert.strictEqual(foreign.status, 403, `supervisor/foreign: ${foreign.raw}`);
  });

  it('4. denies a tenant administrator deleting its own organization (403)', async () => {
    const res = await del(ORG_A, { userId: ADMIN_A });
    assert.strictEqual(res.status, 403, `admin/own: ${res.raw}`);
    assert.strictEqual(res.body.code, 'ORGANIZATION_DELETION_DISABLED');
  });

  it('5. denies a cross-tenant administrator deleting another organization (403)', async () => {
    const res = await del(ORG_B, { userId: ADMIN_B });
    assert.strictEqual(res.status, 403, `admin-b/foreign: ${res.raw}`);
    assert.strictEqual(res.body.code, 'ORGANIZATION_DELETION_DISABLED');
  });

  it('6. admits no platform-administrator exemption, and none can exist', async () => {
    // No platform role exists in the schema, so "platform administrator" cannot
    // be a database identity. Assert the allowed role set, then assert that the
    // most privileged identity that DOES exist (a tenant administrator with
    // is_organization_admin) is still denied, including when the token carries
    // forged elevated claims.
    const roles = await withConn((c) => c.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'chk_users_role'`));
    assert.match(roles[0].def, /'admin'/);
    assert.match(roles[0].def, /'supervisor'/);
    assert.match(roles[0].def, /'operator'/);
    assert.ok(!/platform/i.test(roles[0].def), 'no platform role may be checkable');

    const forgedClaims = jwt.sign({
      userId: ADMIN_A,
      role: 'platform_admin',
      is_organization_admin: true,
      organization_id: ORG_B
    }, JWT_SECRET);
    const res = await del(ORG_B, { token: forgedClaims });
    assert.strictEqual(res.status, 403, `forged platform claims: ${res.raw}`);
    assert.strictEqual(res.body.code, 'ORGANIZATION_DELETION_DISABLED');
  });

  // ---- 7-9. nothing was modified, deleted or cascaded ---------------------

  it('7. leaves every organization record byte-identical', async () => {
    assert.deepStrictEqual(await orgRow(ORG_A), orgABefore, 'ORG_A was modified');
    assert.deepStrictEqual(await orgRow(ORG_B), orgBBefore, 'ORG_B was modified');
    assert.strictEqual(await countOrg(ORG_A), 1);
    assert.strictEqual(await countOrg(ORG_B), 1);
  });

  it('8. leaves every associated user record byte-identical (no cascade)', async () => {
    assert.deepStrictEqual(await orgUsers(ORG_A), usersABefore, 'ORG_A users changed');
    assert.deepStrictEqual(await orgUsers(ORG_B), usersBBefore, 'ORG_B users changed');
  });

  it('9. executes no database deletion statement at all', async () => {
    const { result, seen } = await recordSql(() => del(ORG_B, { userId: SUPERVISOR_A }));
    assert.strictEqual(result.status, 403, `expected denial, got ${result.status}: ${result.raw}`);

    // The contained route may read (authentication loads the acting user), but
    // it must issue no data-modifying statement whatsoever.
    const mutating = seen.filter((sql) => /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|MERGE)\b/i.test(sql));
    assert.deepStrictEqual(
      mutating, [],
      `the contained route must issue no mutating statement; saw: ${JSON.stringify(mutating)}`);

    const deletions = seen.filter((sql) => /\bDELETE\b/i.test(sql));
    assert.deepStrictEqual(deletions, [], 'no DELETE statement may be issued');
  });

  // ---- 10. malformed and out-of-range identifiers -------------------------

  it('10. fails safely on malformed, out-of-range and absent identifiers', async () => {
    // Only characters that are legal in a request path, so a failure here is the
    // application's containment and never the HTTP parser's.
    const hostile = [
      'abc', '0', '-1', '1.5', '1e3', '+1', 'NaN', 'Infinity',
      '2147483648', '99999999999999999999999', '000000000000000000000001',
      'null', 'undefined', '%20', '%2e%2e'
    ];
    for (const id of hostile) {
      const res = await del(id, { userId: SUPERVISOR_A });
      assert.strictEqual(
        res.status, 403,
        `identifier ${JSON.stringify(id)} must fail closed with the uniform denial, `
        + `got ${res.status}: ${res.raw}`);
      assert.strictEqual(res.body.code, 'ORGANIZATION_DELETION_DISABLED');
    }

    // The absent and malformed shapes must be indistinguishable from the above.
    const absent = await del(ABSENT_ORG, { userId: ADMIN_A });
    assert.strictEqual(absent.status, 403, `absent id: ${absent.raw}`);

    assert.strictEqual(await countOrg(ORG_A), 1);
    assert.strictEqual(await countOrg(ORG_B), 1);
  });

  // ---- 12. no information disclosure --------------------------------------

  it('12. discloses nothing, and is identical for existing, foreign, absent and malformed ids', async () => {
    const own = await del(ORG_A, { userId: ADMIN_A });
    const foreign = await del(ORG_B, { userId: ADMIN_B });
    const absent = await del(ABSENT_ORG, { userId: ADMIN_A });
    const malformed = await del('abc', { userId: ADMIN_A });

    for (const res of [own, foreign, absent, malformed]) {
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.raw, own.raw, 'every denial must be byte-identical');
    }

    assert.ok(!/SEC-00C/.test(own.raw), 'must not name any organization');
    assert.ok(!new RegExp(String(ORG_A)).test(own.raw), 'must not echo the requested id');
    assert.ok(!new RegExp(String(ORG_B)).test(own.raw), 'must not echo the requested id');
    assert.ok(!/password|user_count|facility_count|equipment_count/i.test(own.raw),
      'must not carry organization statistics or credential material');
    assert.deepStrictEqual(Object.keys(own.body).sort(), ['code', 'message', 'success']);
  });

  // ---- 11. unrelated organization workflows are untouched -----------------

  it('11. leaves organization read and update operations working', async () => {
    const read = await call('GET', `/api/organizations/${ORG_A}`, { userId: ADMIN_A });
    assert.strictEqual(read.status, 200, `GET /:id: ${read.raw}`);
    assert.strictEqual(read.body.data.organization.id, ORG_A);

    const mine = await call('GET', '/api/organizations/my', { userId: ADMIN_A });
    assert.strictEqual(mine.status, 200, `GET /my: ${mine.raw}`);
    assert.strictEqual(mine.body.data.organization.id, ORG_A);

    const stats = await call('GET', `/api/organizations/${ORG_A}/stats`, { userId: ADMIN_A });
    assert.strictEqual(stats.status, 200, `GET /:id/stats: ${stats.raw}`);

    const list = await call('GET', '/api/organizations', { userId: ADMIN_A });
    assert.strictEqual(list.status, 200, `GET /: ${list.raw}`);

    const updatedEmail = `sec00c-updated-${ORG_A}@sec00c.test.local`;
    const update = await call('PUT', `/api/organizations/${ORG_A}`, {
      userId: ADMIN_A,
      body: { billing_email: updatedEmail }
    });
    assert.strictEqual(update.status, 200, `PUT /:id: ${update.raw}`);
    const after = await orgRow(ORG_A);
    assert.strictEqual(after.billing_email, updatedEmail, 'the update must persist');

    // Cross-tenant read denial for a non-administrator is unchanged behaviour.
    const crossTenantRead = await call('GET', `/api/organizations/${ORG_B}`, { userId: SUPERVISOR_A });
    assert.strictEqual(crossTenantRead.status, 403, `supervisor cross-tenant read: ${crossTenantRead.raw}`);

    // The unrelated update must not have resurrected the deletion capability.
    const stillDenied = await del(ORG_A, { userId: ADMIN_A });
    assert.strictEqual(stillDenied.status, 403, `post-update delete: ${stillDenied.raw}`);
  });

  // ---- alternate method / path handling -----------------------------------

  it('13. denies alternate encodings of the deletion request and never treats it as a read', async () => {
    const variants = [
      `/api/organizations/${ORG_B}/`,
      `/api/organizations/${ORG_B}?force=true`,
      `/api/organizations/${ORG_B}?confirm=yes`
    ];
    for (const requestPath of variants) {
      const res = await call('DELETE', requestPath, { userId: ADMIN_A });
      assert.ok(
        res.status === 403 || res.status === 404,
        `${requestPath} must be denied, got ${res.status}: ${res.raw}`);
      assert.ok(!/deleted successfully/i.test(res.raw));
    }

    // A body cannot re-enable deletion.
    const withBody = await call('DELETE', `/api/organizations/${ORG_B}`, {
      userId: ADMIN_A,
      body: { confirm: true, force: true, cascade: true }
    });
    assert.strictEqual(withBody.status, 403, `body cannot authorise: ${withBody.raw}`);

    assert.strictEqual(await countOrg(ORG_A), 1);
    assert.strictEqual(await countOrg(ORG_B), 1);
  });

  // ---- mechanism negative control (disposable fixtures only) --------------

  it('NEGATIVE CONTROL: the retained model operation really does destroy a tenant and cascade', async () => {
    // Safe by construction: it runs only under the sanctioned test gate, only
    // against a disposable database, and only on fixtures created by this suite
    // (ORG_C / VICTIM_C), which exist for no other purpose. It proves the
    // cascade the containment prevents is real — i.e. that the 403 is load
    // bearing rather than cosmetic.
    const { Organization } = require('../src/models');

    assert.strictEqual(await countOrg(ORG_C), 1, 'ORG_C fixture must exist before the control');
    assert.strictEqual((await orgUsers(ORG_C)).length, 1, 'ORG_C must hold exactly one user');

    await Organization.delete(ORG_C);

    assert.strictEqual(await countOrg(ORG_C), 0, 'the model operation deletes the organization');
    assert.strictEqual((await orgUsers(ORG_C)).length, 0,
      'ON DELETE CASCADE removed the organization\'s users — the blast radius the route denial prevents');

    // Restore the ORG_C fixture so the control is repeatable and idempotent.
    await ensureFixture();
    assert.strictEqual(await countOrg(ORG_C), 1, 'ORG_C fixture restored');
  });
});
