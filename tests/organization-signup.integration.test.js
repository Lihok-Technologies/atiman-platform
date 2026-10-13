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
 * CONTRACT AT THIS HEAD (defect D-1 REPAIRED — pins INVERTED by ATM-001-SEC-B3D)
 * -----------------------------------------------------------------------------
 * This suite was authored against the pinned D-1 defect and asserted the DEFECT:
 * HTTP 500 with ONE ORPHAN organization COMMITTED and ZERO administrators. The
 * integrated candidate carries the ATM-001-SEC-D1 repair (`BaseModel.create`
 * RETURNs the inserted id, and the handler runs every write on ONE transaction),
 * so those assertions are now FALSE and have been INVERTED — never deleted and
 * never weakened. S2/S3/S4/S5/S7/S8 now assert the repaired behaviour, and S9's
 * `todo` marker is removed so the intended contract is a strict assertion.
 *
 * REPAIRED CONTRACT (asserted here, on row counts read back from the database):
 *   * HTTP 201, with exactly ONE organization, ONE administrator
 *     (role='admin', is_organization_admin=true) and ONE default Free
 *     subscription.
 *   * The onboarding is ATOMIC: no organization is ever left without its
 *     administrator, and no partial state is visible from independent
 *     connections.
 *   * A retry of an already-onboarded name is refused 409 because the tenant
 *     genuinely EXISTS (not because an orphan squats the name).
 *
 * NOTE (ATM-001-SEC-B3D condition 2): the brief enumerated S2-S4 as the failing
 * pins. In fact S5, S7 and S8 also asserted the defect and would also have
 * failed; all six are inverted here, and that under-enumeration is recorded as a
 * finding rather than silently absorbed.
 *
 * STILL CARRIED AS A RELEASE BLOCKER: this suite has no failure-injection case
 * proving that a mid-onboarding failure rolls back. That is the same missing
 * detector class as condition 4 (resend mutation M8). It is NOT authored here.
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

    it('S2. anonymous signup answers HTTP 201 and persists exactly ONE organization, ONE administrator and ONE subscription (D-1 repaired; pin inverted)', async (t) => {
      const before = await counts('S2');
      assert.deepStrictEqual(before, { organizations: 0, users: 0, subscriptions: 0 },
        'no fixture may exist before the attempt');

      const res = await anonymousSignup(signupBody('S2'));

      // --- the HTTP result ------------------------------------------------
      assert.strictEqual(res.status, 201,
        'the ATM-001-SEC-D1 repair makes the approved self-service onboarding succeed');
      assert.strictEqual(res.json.success, true);
      assert.doesNotMatch(res.text, /Cannot read properties of null/,
        'the D-1 null-id failure must no longer surface at organization.id');

      // --- the DATABASE EFFECT, not the status code ------------------------
      const after = await counts('S2');
      assert.strictEqual(after.organizations, 1, 'database effect: exactly ONE organization row');
      assert.strictEqual(after.users, 1,
        'database effect: exactly ONE administrator — the first-user INSERT now runs');
      assert.strictEqual(after.subscriptions, 1,
        'database effect: exactly ONE subscription from the real free plan');

      const created = await rows(
        'SELECT id FROM organizations WHERE organization_name = $1', [`${TAG} S2`]);
      assert.strictEqual(created.length, 1, 'the organization row is findable by its name');
      const orgId = Number(created[0].id);

      const dependants = await rows(
        `SELECT
           (SELECT count(*)::int FROM users WHERE organization_id = $1) AS users,
           (SELECT count(*)::int FROM organization_subscriptions WHERE organization_id = $1) AS subscriptions`,
        [orgId]);
      assert.deepStrictEqual(
        { users: dependants[0].users, subscriptions: dependants[0].subscriptions },
        { users: 1, subscriptions: 1 },
        'ATOMICITY: the organization has exactly one owner and one subscription — no orphan record');

      const admin = await rows(
        'SELECT role, is_organization_admin FROM users WHERE organization_id = $1', [orgId]);
      assert.deepStrictEqual(
        { role: admin[0].role, is_organization_admin: admin[0].is_organization_admin },
        { role: 'admin', is_organization_admin: true },
        'the first user is the tenant administrator');

      t.diagnostic(`D-1 repaired: HTTP ${res.status}; organizations=${after.organizations}, `
        + `administrators=${after.users}, subscriptions=${after.subscriptions}`);
    });

    it('S3. the write IS transactional: a completed onboarding is complete and stable from independent connections', async () => {
      const res = await anonymousSignup(signupBody('S3'));
      assert.strictEqual(res.status, 201);

      // Two reads on two freshly acquired pooled connections. The retired D-1 pin
      // asserted that a partial write survived the handler; the repaired contract
      // asserts the inverse: only the COMPLETE onboarding is observable.
      const first = await counts('S3');
      const second = await counts('S3');
      assert.deepStrictEqual(first, { organizations: 1, users: 1, subscriptions: 1 },
        'the complete onboarding is visible from an independent connection');
      assert.deepStrictEqual(second, first,
        'the committed state is stable, not an in-flight write');

      assert.notStrictEqual(first.organizations, 0,
        'transaction behaviour: the organization is committed together with its administrator');

      const orphans = await rows(
        `SELECT count(*)::int AS c FROM organizations o
          WHERE o.organization_name LIKE $1
            AND NOT EXISTS (SELECT 1 FROM users u WHERE u.organization_id = o.id)`,
        [orgPattern('S3')]);
      assert.strictEqual(orphans[0].c, 0,
        'no organization may be left without its administrator (the D-1 orphan is gone)');
    });

    it('S4. a retry of an onboarded name is refused 409 because the tenant genuinely EXISTS, and nothing is duplicated', async () => {
      const body = signupBody('S4');

      const first = await anonymousSignup(body);
      assert.strictEqual(first.status, 201,
        'the first attempt onboards the tenant completely (the D-1 orphan pin is inverted)');
      assert.deepStrictEqual(await counts('S4'),
        { organizations: 1, users: 1, subscriptions: 1 });

      // (a) The IDENTICAL body is refused by the pre-write uniqueness checks that
      // run BEFORE the organization-name check: the username now exists. Any of
      // those refusals is correct, so this asserts the refusal and the absence of
      // duplication, not one specific message.
      const retry = await anonymousSignup(body);
      assert.strictEqual(retry.status, 409,
        'the name is now taken by a REAL, fully onboarded tenant');
      assert.match(retry.json.message, /already exists/);
      assert.deepStrictEqual(await counts('S4'),
        { organizations: 1, users: 1, subscriptions: 1 },
        'database effect: the refused retry persisted nothing and duplicated nothing');

      // (b) A retry with a NEW username but the SAME organization name reaches the
      // organization-name check and is refused there — the tenant genuinely
      // EXISTS now, rather than an orphan squatting the name.
      const reorg = await anonymousSignup(signupBody('S4', {
        username: `${TAG}-s4-second`.toLowerCase(),
        email: `${TAG}-s4-second@test.local`.toLowerCase()
      }));
      assert.strictEqual(reorg.status, 409,
        'an existing, fully onboarded organization name cannot be reused');
      assert.strictEqual(reorg.json.message, 'Organization name already exists');
      assert.deepStrictEqual(await counts('S4'),
        { organizations: 1, users: 1, subscriptions: 1 },
        'database effect: the second refusal persisted nothing either');
    });

    it('S5. two distinct names both onboard completely: the complete state is systematic', async () => {
      const first = await anonymousSignup(signupBody('S5a'));
      const second = await anonymousSignup(signupBody('S5b'));

      assert.strictEqual(first.status, 201);
      assert.strictEqual(second.status, 201);
      assert.deepStrictEqual(await counts('S5a'),
        { organizations: 1, users: 1, subscriptions: 1 });
      assert.deepStrictEqual(await counts('S5b'),
        { organizations: 1, users: 1, subscriptions: 1 });
      assert.strictEqual((await counts('S5')).users, 2,
        'each attempt created its own administrator');
      assert.strictEqual((await counts('S5')).subscriptions, 2,
        'each attempt created its own subscription');
    });

    it('S6. the endpoint cannot join or mutate an existing tenant', async () => {
      await anonymousSignup(signupBody('S6'));
      const orgId = Number((await rows(
        'SELECT id FROM organizations WHERE organization_name = $1', [`${TAG} S6`]))[0].id);
      assert.deepStrictEqual(await counts('S6'),
        { organizations: 1, users: 1, subscriptions: 1 });

      // Re-using the EXISTING organization name with a NEW username must not
      // attach a user to that tenant (the pre-write uniqueness check refuses it).
      const joinAttempt = await anonymousSignup(signupBody('S6', {
        username: `${TAG}-s6-second`.toLowerCase(),
        email: `${TAG}-s6-second@test.local`.toLowerCase()
      }));
      assert.strictEqual(joinAttempt.status, 409,
        'an existing organization name cannot be joined through signup');
      assert.deepStrictEqual(await counts('S6'),
        { organizations: 1, users: 1, subscriptions: 1 },
        'database effect: no second user was attached to the existing organization');

      const subs = await rows(
        'SELECT count(*)::int AS c FROM organization_subscriptions WHERE organization_id = $1', [orgId]);
      assert.strictEqual(subs[0].c, 1, 'database effect: no additional subscription was attached');
    });

    it('S7. security boundary: the anonymous endpoint creates EXACTLY the designed first administrator and discloses no credential material', async () => {
      const password = 'NotARealPassword-104!';
      const res = await anonymousSignup(signupBody('S7', { password }));

      assert.strictEqual(res.status, 201,
        'the approved self-service onboarding succeeds after the D-1 repair');

      // EXACTLY the designed principal: one administrator, and only for the NEW
      // tenant. The retired D-1 pin asserted "no principal at all", which was an
      // artefact of the defect rather than a security property of the endpoint.
      const principals = await rows(
        'SELECT count(*)::int AS c FROM users WHERE username LIKE $1', [userPattern('S7')]);
      assert.strictEqual(principals[0].c, 1, 'exactly one principal is created');
      const admins = await rows(
        `SELECT count(*)::int AS c FROM users
          WHERE username LIKE $1 AND role = 'admin' AND is_organization_admin = true`, [userPattern('S7')]);
      assert.strictEqual(admins[0].c, 1, 'that principal is the tenant administrator of the NEW tenant');

      const owner = await rows(
        'SELECT organization_id FROM users WHERE username LIKE $1', [userPattern('S7')]);
      const ownerOrg = await rows(
        'SELECT organization_name FROM organizations WHERE id = $1', [Number(owner[0].organization_id)]);
      assert.strictEqual(ownerOrg[0].organization_name, `${TAG} S7`,
        'the principal belongs to the newly created tenant and confers nothing in any other');

      // The designed auto-login token and its cookie ARE approved product
      // behaviour and are therefore NOT asserted absent. Everything that would
      // leak a SECRET still is.
      assert.ok(!/\$2[aby]\$\d\d\$/.test(res.text), 'no bcrypt hash material may be disclosed');
      assert.ok(!new RegExp(password).test(res.text), 'the submitted password must never echo back');
      assert.ok(!/password_hash|insertId|BaseModel|SELECT |INSERT /i.test(res.text),
        'no internal identifier, SQL or schema detail may be disclosed');
      assert.ok(!/\bat\s+\S+\s+\(.*:\d+:\d+\)/.test(res.text), 'no stack frame may be disclosed');

      // The JWT payload is a hand-picked allow-list; pin its exact shape so a
      // future change cannot stuff the row (and therefore password_hash) into it.
      const token = res.json && res.json.data && res.json.data.token;
      assert.strictEqual(typeof token, 'string', 'the designed auto-login token is present');
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      assert.deepStrictEqual(Object.keys(payload).sort(),
        ['exp', 'iat', 'isOrgAdmin', 'organizationId', 'role', 'userId'],
        'the JWT payload is the hand-picked allow-list, never a full user row');
      assert.ok(!('password_hash' in payload), 'the JWT payload must not carry password_hash');
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

      // The endpoint ignores the ambient identity: it creates a NEW tenant rather
      // than minting the caller's. The retired D-1 pin asserted a 500; the
      // repaired contract asserts the same PERMISSION outcome with a real write.
      assert.strictEqual(res.status, 201,
        'an authenticated caller gets the same NEW-tenant result');
      assert.deepStrictEqual(await counts('S8'),
        { organizations: 1, users: 1, subscriptions: 1 });
      assert.deepStrictEqual(await shape(), before,
        'database effect: the authenticated caller\u2019s own tenant is unchanged in shape');

      const created = await rows(
        'SELECT organization_id FROM users WHERE username LIKE $1', [userPattern('S8')]);
      assert.notStrictEqual(Number(created[0].organization_id), callerOrg,
        'the created administrator belongs to the NEW tenant, never to the caller\u2019s');
    });

    // The D-1 `todo` marker is REMOVED (ATM-001-SEC-B3D condition 2): the repair
    // is present in this tree, so the intended contract is now a strict assertion.
    it('S9. INTENDED contract: 201 with exactly one organization, one administrator and one subscription, atomically',
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
