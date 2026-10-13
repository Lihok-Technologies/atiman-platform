/**
 * ATM-001-SEC-104-R3 — live integration evidence for the approved self-service
 * onboarding endpoint POST /api/auth/organization-signup.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Before this file, the only coverage of organization signup anywhere in the
 * repository was STATIC FILE-CONTENT assertion: tests/organization-security-
 * policies.test.js matched a regex against the route header and the route
 * registration. No test ever issued a request, so the corrected header claim —
 * "creates an organization, its first administrator (`role = 'admin'`,
 * `is_organization_admin = true`) and a default Free subscription" — was never
 * checked against the running system, and it was FALSE.
 *
 * This suite issues the real anonymous HTTP request against the real Express app
 * on disposable PostgreSQL and reads the persisted rows back. It asserts actual
 * ROW COUNTS, never a status code alone, because defect D-1 (BaseModel.create
 * never populates `insertId`) lets a write commit behind an HTTP 500.
 *
 * OBSERVED CONTRACT AT THIS HEAD (defect D-1 — PINNED, NOT REPAIRED)
 * ------------------------------------------------------------------
 *   * HTTP 500, body `Cannot read properties of null (reading 'id')`.
 *   * ONE organization row is COMMITTED (the INSERT is never rolled back).
 *   * ZERO administrators: the first-administrator INSERT never runs.
 *   * ZERO subscriptions: the handler throws before the Free-plan lookup.
 *   * The partial state is permanent and name-squatting: a retry of the same
 *     organization name answers 409 "Organization name already exists" and the
 *     orphan cannot be removed through any V1 route (direct organization
 *     deletion is fail-closed, ATM-001-SEC-104 policy 5).
 *
 * The INTENDED contract (201 + exactly one organization + one administrator with
 * role='admin' and is_organization_admin=true + one subscription, atomically) is
 * encoded as a `todo` test, so it is machine-checked, reported as unmet, and does
 * NOT fail the suite while D-1 is open. Repairing D-1 changes the shared
 * `BaseModel.create` write path for every caller and is therefore PROPOSED and
 * ESCALATED to the OWNER, not applied here — see the header of
 * src/routes/organization.routes.js.
 *
 * SECURITY BOUNDARY (asserted, not assumed)
 * -----------------------------------------
 * The endpoint is anonymous by design and must stay mounted: disabling approved
 * self-service onboarding is not a policy-1 outcome. This suite proves it creates
 * NO principal of any kind (so nothing to escalate), discloses no credential
 * material, cannot join or mutate an existing tenant, and gives an authenticated
 * caller no additional reach.
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * src/config/database.js uses to select test-database credentials, so it can
 * never run against runtime credentials. Residue: none. Every organization this
 * suite creates is an orphan with no dependants and is deleted in `after()` by
 * the per-run prefix; the `free` plan fixture is created only when absent and
 * removed again only when this run created it and nothing references it.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { getConnection, isIntegrationTest } = require('../src/config/database');
const authConfig = require('../src/config/auth');

// The JWT secret is taken from the application configuration, never from a
// quoted literal in this file (the secret is whatever auth.js resolves).
const JWT_SECRET = authConfig.jwt.secret;

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating organization-signup suite requires the sanctioned database-test gate '
    + '(NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that test-database credentials are used '
    + 'instead of runtime credentials; run it via `npm run test:integration`';

const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`;
const TAG = `SEC104SIGNUP-${RUN}`;
const FREE_PLAN_CODE = 'free';

// An organization is named `${TAG} ${suffix}`; its first administrator is named
// `${TAG}-${suffix}` lowercased. Keep both patterns in one place.
const orgPattern = (suffix) => `${TAG} ${suffix}%`;
const userPattern = (suffix) => `${TAG}-${suffix}%`.toLowerCase();

let server = null;
let port = null;
let freePlanId = null;
let freePlanExistedBefore = false;

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

const rows = (sql, params = []) => withConn((conn) => conn.query(sql, params));

/** Actual persisted row counts for one signup attempt prefix. */
async function counts(suffix) {
  const orgs = await rows(
    'SELECT count(*)::int AS c FROM organizations WHERE organization_name LIKE $1', [orgPattern(suffix)]);
  const users = await rows(
    'SELECT count(*)::int AS c FROM users WHERE username LIKE $1', [userPattern(suffix)]);
  const subs = await rows(
    `SELECT count(*)::int AS c FROM organization_subscriptions
      WHERE organization_id IN (SELECT id FROM organizations WHERE organization_name LIKE $1)`,
    [orgPattern(suffix)]);
  return { organizations: orgs[0].c, users: users[0].c, subscriptions: subs[0].c };
}

const freePlanIdOf = async () => {
  const found = await rows('SELECT id FROM subscription_plans WHERE plan_code = $1', [FREE_PLAN_CODE]);
  return found.length ? Number(found[0].id) : null;
};

/**
 * A real `free` plan must exist, or "0 subscriptions" could be explained by a
 * missing plan instead of by the throw. Created idempotently and removed again in
 * `after()` only when this run created it.
 */
async function ensureFreePlan() {
  freePlanExistedBefore = (await freePlanIdOf()) !== null;
  if (!freePlanExistedBefore) {
    await rows(
      `INSERT INTO subscription_plans (plan_code, plan_name, description, base_price, is_active, is_public)
       VALUES ($1, 'Free', 'SEC104-R3 signup fixture', 0.00, TRUE, TRUE)
       ON CONFLICT (plan_code) DO NOTHING`, [FREE_PLAN_CODE]);
  }
  freePlanId = await freePlanIdOf();
}

async function cleanup() {
  await withConn(async (conn) => {
    await conn.query(
      `DELETE FROM organization_subscriptions
        WHERE organization_id IN (SELECT id FROM organizations WHERE organization_name LIKE $1)`,
      [orgPattern('')]);
    await conn.query('DELETE FROM users WHERE username LIKE $1', [userPattern('')]);
    await conn.query('DELETE FROM organizations WHERE organization_name LIKE $1', [orgPattern('')]);
    if (!freePlanExistedBefore) {
      await conn.query(
        `DELETE FROM subscription_plans
          WHERE plan_code = $1
            AND NOT EXISTS (SELECT 1 FROM organization_subscriptions WHERE plan_id = subscription_plans.id)`,
        [FREE_PLAN_CODE]);
    }
  });
}

function call(method, requestPath, { body, bearer } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = {};
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    if (payload !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request({ host: '127.0.0.1', port, method, path: requestPath, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        text: data,
        json: (() => { try { return JSON.parse(data); } catch { return null; } })()
      }));
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

/** A unique, well-formed signup payload. */
const signupBody = (suffix, overrides = {}) => ({
  organization_name: `${TAG} ${suffix}`,
  industry: 'water',
  username: `${TAG}-${suffix}`.toLowerCase(),
  email: `${TAG}-${suffix}@test.local`.toLowerCase(),
  password: 'NotARealPassword-104!',
  full_name: `SEC104 Signup ${suffix}`,
  ...overrides
});

const anonymousSignup = (body) => call('POST', '/api/auth/organization-signup', { body });

// ===========================================================================

describe('ATM-001-SEC-104-R3 organization signup: live disposable-PostgreSQL evidence',
  { skip: DB_TEST_SKIP_REASON, concurrency: 1 }, () => {
    before(async () => {
      const app = require('../src/app');
      server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      port = server.address().port;
      await ensureFreePlan();
    });

    after(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
      await cleanup();
    });

    it('S1. the endpoint is mounted and anonymous, and a real free plan exists', () => {
      // The JWT secret is read from the application configuration (never a quoted
      // literal), so a token assertion can never silently use a different key.
      assert.ok(typeof JWT_SECRET === 'string' && JWT_SECRET.length > 0,
        'src/config/auth.js must resolve a JWT secret');

      const authRoutes = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'routes', 'auth.routes.js'), 'utf8');
      assert.match(authRoutes, /router\.post\('\/organization-signup', authController\.organizationSignup\)/,
        'the approved self-service endpoint must stay mounted and unauthenticated');
      assert.strictEqual(freePlanId !== null, true,
        'a real free plan exists, so "0 subscriptions" cannot be explained by a missing plan');
    });

    it('S2. anonymous signup answers HTTP 500 and persists ONE ORPHAN organization with ZERO users and ZERO subscriptions (D-1 pinned)', async (t) => {
      const before = await counts('S2');
      assert.deepStrictEqual(before, { organizations: 0, users: 0, subscriptions: 0 },
        'no fixture may exist before the attempt');

      const res = await anonymousSignup(signupBody('S2'));

      // --- the HTTP result ------------------------------------------------
      assert.strictEqual(res.status, 500,
        'the observed result at this head is a server error, not a 201');
      assert.strictEqual(res.json.success, false);
      assert.match(res.json.message, /Cannot read properties of null \(reading 'id'\)/,
        'the failure is defect D-1 surfacing at organization.id');

      // --- the DATABASE EFFECT, not the status code ------------------------
      const after = await counts('S2');
      assert.strictEqual(after.organizations, 1,
        'database effect: exactly ONE organization row was committed');
      assert.strictEqual(after.users, 0,
        'database effect: ZERO administrators were created — the first-user INSERT never ran');
      assert.strictEqual(after.subscriptions, 0,
        'database effect: ZERO subscriptions were created, even though a real free plan exists');

      // The orphan is real and belongs to this attempt, and nothing references it.
      const orphan = await rows(
        'SELECT id FROM organizations WHERE organization_name = $1', [`${TAG} S2`]);
      assert.strictEqual(orphan.length, 1, 'the committed organization row is findable by its name');
      const orphanId = Number(orphan[0].id);

      const dependants = await rows(
        `SELECT
           (SELECT count(*)::int FROM users WHERE organization_id = $1) AS users,
           (SELECT count(*)::int FROM organization_subscriptions WHERE organization_id = $1) AS subscriptions`,
        [orphanId]);
      assert.deepStrictEqual(
        { users: dependants[0].users, subscriptions: dependants[0].subscriptions },
        { users: 0, subscriptions: 0 },
        'ORPHAN-RECORD behaviour: the committed organization has no owner and no subscription');

      // The submitted username was never persisted ANYWHERE, which is the
      // difference between "created then failed" and "never created".
      const named = await rows('SELECT count(*)::int AS c FROM users WHERE username = $1',
        [userPattern('S2').replace(/%$/, '')]);
      assert.strictEqual(named[0].c, 0,
        'the submitted administrator username exists nowhere in the database');

      t.diagnostic(`D-1 observed: HTTP ${res.status}; committed organizations=${after.organizations}, `
        + `administrators=${after.users}, subscriptions=${after.subscriptions}; INTENDED: 201 with `
        + 'organizations=1, administrators=1 (role=admin, is_organization_admin=true), subscriptions=1');
    });

    it('S3. the failure is NOT transactional: the partial write is committed and visible from independent connections', async () => {
      const res = await anonymousSignup(signupBody('S3'));
      assert.strictEqual(res.status, 500);

      // Two reads on two freshly acquired pooled connections. If the INSERT were
      // inside a rolled-back (or still-open) transaction, neither could see it.
      const first = await counts('S3');
      const second = await counts('S3');
      assert.strictEqual(first.organizations, 1, 'the organization INSERT committed');
      assert.strictEqual(second.organizations, 1, 'the committed row is stable, not an in-flight write');
      assert.strictEqual(first.users, 0, 'no administrator row was ever written');
      assert.strictEqual(first.subscriptions, 0, 'no subscription row was ever written');

      // A signup that throws after committing a write is non-atomic: there is no
      // wrapping transaction to roll back, so the orphan survives the 500.
      assert.notStrictEqual(first.organizations, 0,
        'transaction behaviour: the handler threw but the write was NOT rolled back');
    });

    it('S4. ORPHAN-RECORD behaviour: a retry of the same name is refused 409 and the orphan blocks it permanently', async () => {
      const body = signupBody('S4');

      const first = await anonymousSignup(body);
      assert.strictEqual(first.status, 500, 'the first attempt fails with D-1 and commits an orphan');
      assert.strictEqual((await counts('S4')).organizations, 1);

      const retry = await anonymousSignup(body);
      assert.strictEqual(retry.status, 409,
        'the orphaned name is now taken, so the legitimate retry is refused');
      assert.strictEqual(retry.json.message, 'Organization name already exists');
      assert.strictEqual((await counts('S4')).organizations, 1,
        'database effect: the refused retry persisted nothing (no second orphan)');
      assert.strictEqual((await counts('S4')).users, 0,
        'database effect: still zero administrators after the retry');
    });

    it('S5. the partial state is systematic: a second, distinct name reproduces it', async () => {
      const first = await anonymousSignup(signupBody('S5a'));
      const second = await anonymousSignup(signupBody('S5b'));

      assert.strictEqual(first.status, 500);
      assert.strictEqual(second.status, 500);
      assert.strictEqual((await counts('S5a')).organizations, 1);
      assert.strictEqual((await counts('S5b')).organizations, 1);
      assert.strictEqual((await counts('S5')).users, 0,
        'neither attempt created an administrator');
      assert.strictEqual((await counts('S5')).subscriptions, 0,
        'neither attempt created a subscription');
    });

    it('S6. the endpoint cannot join or mutate an existing tenant', async () => {
      await anonymousSignup(signupBody('S6'));
      const orphanId = Number((await rows(
        'SELECT id FROM organizations WHERE organization_name = $1', [`${TAG} S6`]))[0].id);
      assert.deepStrictEqual(await counts('S6'),
        { organizations: 1, users: 0, subscriptions: 0 });

      // Re-using the EXISTING organization name with a NEW username must not
      // attach a user to the orphan (the pre-write uniqueness check refuses it).
      const joinAttempt = await anonymousSignup(signupBody('S6', {
        username: `${TAG}-s6-second`.toLowerCase(),
        email: `${TAG}-s6-second@test.local`.toLowerCase()
      }));
      assert.strictEqual(joinAttempt.status, 409,
        'an existing organization name cannot be joined through signup');
      assert.strictEqual((await counts('S6')).users, 0,
        'database effect: no user was attached to the existing organization');

      const subs = await rows(
        'SELECT count(*)::int AS c FROM organization_subscriptions WHERE organization_id = $1', [orphanId]);
      assert.strictEqual(subs[0].c, 0, 'database effect: no subscription was attached');
    });

    it('S7. security boundary: the anonymous endpoint creates NO principal and discloses no credential material', async () => {
      const password = 'NotARealPassword-104!';
      const res = await anonymousSignup(signupBody('S7', { password }));

      assert.strictEqual(res.status, 500);

      // No principal of any kind — so there is nothing to privilege-escalate.
      const principals = await rows(
        'SELECT count(*)::int AS c FROM users WHERE username LIKE $1', [userPattern('S7')]);
      assert.strictEqual(principals[0].c, 0,
        'signup created no user, so it created no administrator and no is_organization_admin principal');
      const admins = await rows(
        `SELECT count(*)::int AS c FROM users
          WHERE username LIKE $1 AND (role = 'admin' OR is_organization_admin = true)`, [userPattern('S7')]);
      assert.strictEqual(admins[0].c, 0, 'no privileged principal was minted');

      // Non-disclosure: assert against the WHOLE response body, never a
      // hand-picked field list. No token, no cookie, no hash, no SQL, no path.
      assert.ok(!/token/i.test(res.text), 'no token may be disclosed');
      assert.ok(!/set-cookie/i.test(JSON.stringify(res.headers)), 'no session cookie may be set');
      assert.ok(!/\$2[aby]\$\d\d\$/.test(res.text), 'no bcrypt hash material may be disclosed');
      assert.ok(!new RegExp(password).test(res.text), 'the submitted password must never echo back');
      assert.ok(!/password_hash|insertId|BaseModel|SELECT |INSERT /i.test(res.text),
        'no internal identifier, SQL or schema detail may be disclosed');
      assert.ok(!/\bat\s+\S+\s+\(.*:\d+:\d+\)/.test(res.text), 'no stack frame may be disclosed');
    });

    it('S8. an AUTHENTICATED caller gains no additional reach: no confused deputy, no write into its own tenant', async () => {
      const existing = await rows(
        'SELECT id, organization_id FROM users WHERE is_active = true ORDER BY id LIMIT 1');
      if (!existing.length) {
        // No identity exists in this database, so the confusion path is not
        // reachable and there is nothing to assert about it.
        return;
      }
      const callerId = Number(existing[0].id);
      const callerOrg = Number(existing[0].organization_id);
      const bearer = jwt.sign({ userId: callerId }, JWT_SECRET);

      const shape = async () => {
        const found = await rows(
          `SELECT
             (SELECT count(*)::int FROM users WHERE organization_id = $1) AS users,
             (SELECT count(*)::int FROM organization_subscriptions WHERE organization_id = $1) AS subscriptions`,
          [callerOrg]);
        return { users: found[0].users, subscriptions: found[0].subscriptions };
      };
      const before = await shape();

      const res = await call('POST', '/api/auth/organization-signup', {
        body: signupBody('S8'), bearer
      });

      // The endpoint ignores the ambient identity: it does not mint a user into
      // the caller's tenant, and it changes nothing in it.
      assert.strictEqual(res.status, 500,
        'an authenticated caller gets the same D-1 result; the endpoint confers nothing');
      assert.strictEqual((await counts('S8')).users, 0,
        'no user was created for the authenticated attempt');
      assert.strictEqual((await counts('S8')).organizations, 1,
        'the anonymous write path is unchanged by the presence of a bearer token');
      assert.deepStrictEqual(await shape(), before,
        'database effect: the authenticated caller\u2019s own tenant is unchanged in shape');
    });

    // ------------------------------------------------------------------
    // The INTENDED contract, machine-checked and reported as unmet while D-1 is
    // open. A `todo` failure does not fail the suite (verified on this runtime);
    // it is reported in the summary so the gap cannot be forgotten. When D-1 is
    // fixed this test starts passing and the `todo` marker must be removed
    // together with the D-1 pins above.
    // ------------------------------------------------------------------
    it('S9. INTENDED contract: 201 with exactly one organization, one administrator and one subscription, atomically',
      { todo: 'D-1 open: BaseModel.create never populates insertId, so signup commits an orphan and answers HTTP 500' },
      async () => {
        const res = await anonymousSignup(signupBody('S9'));

        assert.strictEqual(res.status, 201, 'the intended result is a created tenant, not a 500');
        const after = await counts('S9');
        assert.strictEqual(after.organizations, 1, 'exactly one organization');
        assert.strictEqual(after.users, 1, 'exactly one administrator');
        assert.strictEqual(after.subscriptions, 1, 'exactly one default Free subscription');

        const admin = await rows(
          'SELECT role, is_organization_admin FROM users WHERE username = $1',
          [userPattern('S9').replace(/%$/, '')]);
        assert.deepStrictEqual(
          { role: admin[0].role, is_organization_admin: admin[0].is_organization_admin },
          { role: 'admin', is_organization_admin: true },
          'the first user is the tenant administrator');

        const orphanFree = await rows(
          `SELECT count(*)::int AS c FROM organizations o
            WHERE o.organization_name LIKE $1
              AND NOT EXISTS (SELECT 1 FROM users u WHERE u.organization_id = o.id)`,
          [orgPattern('S9')]);
        assert.strictEqual(orphanFree[0].c, 0, 'no organization may be left without an administrator');
      });
  });
