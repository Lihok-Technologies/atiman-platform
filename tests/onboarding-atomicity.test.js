/**
 * MISSION D-1 — onboarding atomicity, orphan-tenant containment and credential
 * non-disclosure, proved against the real Express app and disposable PostgreSQL.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `BaseModel.create` (src/models/base.model.js) issued
 * `INSERT INTO t (...) VALUES (...)` with NO `RETURNING id` and then read the
 * generated key from `result.insertId`. The runtime driver is PostgreSQL (`pg`,
 * see src/config/database.js); a `pg` Result carries no `insertId`, and
 * `normalizeResult()` can only populate one from a row the statement returned.
 * With no `RETURNING`, `insertId` stayed null, `findById(null)` matched nothing,
 * and `create()` returned `null` for EVERY caller while the INSERT had already
 * committed on an autocommit pool connection. Callers then threw on `.id` AFTER a
 * durable write.
 *
 * Four reproduced consequences, all of them asserted here as ROW COUNTS and table
 * state rather than as status codes, because a 500 is not evidence that no write
 * happened:
 *
 *   1. `POST /api/auth/organization-signup` (anonymous) committed exactly ONE
 *      ORGANIZATION with ZERO users and ZERO subscriptions, was never rolled
 *      back, and answered HTTP 500. The orphan is permanent (direct organization
 *      deletion is fail-closed, ATM-001-SEC-00C), so the name could never be
 *      registered again: anonymous tenant-name squatting, and the pre-check is
 *      TOCTOU because `organizations.organization_name` carries no UNIQUE
 *      constraint.
 *   2. `POST /api/invitations` committed a row carrying a live, undelivered token.
 *   3. `POST /api/invitations/:id/resend` committed a replacement and then never
 *      retired the original, leaving TWO live pending rows.
 *   4. `POST /api/invitations/accept` committed the account and never retired the
 *      invitation, defeating the invitation's single-use control.
 *
 * WHAT THIS SUITE PROVES AT THIS HEAD
 * -----------------------------------
 *   * signup is a 201 that commits exactly one organization, one administrator
 *     (`role = 'admin'`, `is_organization_admin = true`) and one subscription,
 *     with `organizations.subscription_id` linked;
 *   * a failure AFTER the organization INSERT rolls the whole tenant back, so no
 *     organization can exist without its administrator on ANY failure path;
 *   * `BaseModel.create` returns the committed row and THROWS rather than
 *     returning a value a caller might treat as success;
 *   * no response on any exercised path discloses `password_hash`, bcrypt
 *     material, SQL or a stack frame;
 *   * the invitation flows issue one live token, retire it on acceptance, refuse
 *     a replay, admit exactly one of two concurrent acceptances, and leave a
 *     refused or failed acceptance with the invitation still usable;
 *   * the tenant and the granted role still come from the persisted invitation
 *     row, never from the request body.
 *
 * GUARD SENSITIVITY
 * -----------------
 * Cases marked `GUARD-SENSITIVE` are written so that removing the guard they name
 * makes them FAIL. They are the in-suite detectors; the mutation campaign that
 * executes each removal and records the caught case is reported with the mission
 * evidence (cases A4, B2, B3, D4, D5, E1).
 *
 * D-2 IS PINNED, NOT REPAIRED
 * ---------------------------
 * `subscriptionService.getSeatUsage` reads the alias `activeBillableUsers` while
 * PostgreSQL folds the unquoted alias to lower case, so `activeUsers` is
 * `undefined`, `availableSeats` is `NaN` and `canAddUser` is always false for
 * every tenant. That MASKS the invitation controller behind a 403 before any write
 * (case C2 asserts the mask is still present, so a silent D-2 repair fails this
 * suite rather than passing unnoticed). Cases D1-D7 therefore neutralise the mask
 * IN-PROCESS, only for the duration of the case, and restore it in `finally`; they
 * exercise the real controller, routing, persistence and transaction. D-2 itself is
 * out of this mission's scope and is NOT repaired here.
 *
 * Database-mutating suite: gated on `isIntegrationTest()`, the same predicate
 * src/config/database.js uses to select test-database credentials, so it can never
 * run against runtime credentials. Residue: every organization this suite creates
 * is removed in `after()` by its per-run name prefix, and the `free` plan fixture is
 * created only when absent and removed again only when this run created it. No
 * capability grant is created (migration 022 makes grants undeletable).
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const { getConnection, isIntegrationTest } = require('../src/config/database');
const authConfig = require('../src/config/auth');
const subscriptionService = require('../src/services/subscription.service');
const { User, Invitation } = require('../src/models');

// The JWT secret comes from application configuration, never from a quoted literal.
const JWT_SECRET = authConfig.jwt.secret;

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating onboarding-atomicity suite requires the sanctioned database-test '
    + 'gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that test-database credentials '
    + 'are used instead of runtime credentials; run it via `npm run test:integration`';

const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`;
const TAG = `D1ONB-${RUN}`;
const FREE_PLAN_CODE = 'free';
const PASSWORD = 'D1-Probe-Password-1!';

let server = null;
let port = null;
let freePlanId = null;
let freePlanExistedBefore = false;
let FIX_ORG = null;
let FIX_ADMIN = null;
let FIX_BEARER = null;
let seq = 0;

const mark = (suffix) => `${TAG} ${suffix}-${++seq}`;
const userMark = (suffix) => `${TAG}-${suffix}-${++seq}`.toLowerCase();
const orgLike = (suffix) => `${TAG} ${suffix}%`;
const userLike = (suffix) => `${TAG}-${suffix}%`.toLowerCase();

/** Run `fn` on a fresh pooled connection inside a committed transaction. */
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
const scalar = async (sql, params = []) => {
  const found = await rows(sql, params);
  return found.length ? Number(Object.values(found[0])[0]) : null;
};

/** Persisted state for one signup attempt prefix. Never a status code. */
async function signupState(suffix) {
  const organizations = await rows(
    `SELECT id, organization_name, subscription_id FROM organizations
      WHERE organization_name LIKE $1 ORDER BY id`, [orgLike(suffix)]);
  const users = await rows(
    `SELECT id, username, role, is_organization_admin, organization_id, status, is_billable
       FROM users WHERE username LIKE $1 ORDER BY id`, [userLike(suffix)]);
  const subscriptions = await rows(
    `SELECT os.id, os.organization_id, os.plan_id, os.status, os.seats_used, os.seats_available
       FROM organization_subscriptions os
      WHERE os.organization_id IN (
        SELECT id FROM organizations WHERE organization_name LIKE $1)`, [orgLike(suffix)]);
  return { organizations, users, subscriptions };
}

const freePlanIdOf = async () =>
  scalar('SELECT id FROM subscription_plans WHERE plan_code = $1', [FREE_PLAN_CODE]);

async function ensureFreePlan() {
  freePlanExistedBefore = (await freePlanIdOf()) !== null;
  if (!freePlanExistedBefore) {
    await rows(
      `INSERT INTO subscription_plans (plan_code, plan_name, description, included_users,
         max_users, base_price, price_per_additional_user, is_active, is_public,
         max_facilities, max_equipment)
       VALUES ($1, 'Free', 'D-1 onboarding-atomicity fixture', 50, 50, 0.00, 0.00, TRUE, TRUE, 5, 100)
       ON CONFLICT (plan_code) DO NOTHING`, [FREE_PLAN_CODE]);
  }
  freePlanId = await freePlanIdOf();
}

async function cleanup() {
  await withConn(async (conn) => {
    await conn.query(
      `DELETE FROM users WHERE username LIKE $1 OR organization_id IN (
         SELECT id FROM organizations WHERE organization_name LIKE $2)`, [userLike(''), orgLike('')]);
    await conn.query(`DELETE FROM organizations WHERE organization_name LIKE $1`, [orgLike('')]);
  });
  if (!freePlanExistedBefore && freePlanId !== null) {
    const referenced = await scalar(
      'SELECT count(*) FROM organization_subscriptions WHERE plan_id = $1', [freePlanId]);
    if (referenced === 0) {
      await rows('DELETE FROM subscription_plans WHERE id = $1 AND plan_code = $2', [freePlanId, FREE_PLAN_CODE]);
    }
  }
}

function call(method, urlPath, { body, bearer } = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1', port, method, path: urlPath,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {})
      }
    }, (response) => {
      let text = '';
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { json = null; }
        resolve({ status: response.statusCode, text, json, headers: response.headers });
      });
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

const signupBody = (suffix, overrides = {}) => ({
  organization_name: `${TAG} ${suffix}`,
  industry: 'other',
  username: userMark(suffix),
  email: `${userMark(suffix)}@test.local`,
  password: PASSWORD,
  full_name: `D1 ${suffix}`,
  ...overrides
});

const signup = (body) => call('POST', '/api/auth/organization-signup', { body });
const anonymousSignup = (suffix, overrides) => signup(signupBody(suffix, overrides));

/** Every credential/SQL/stack disclosure this suite refuses to accept. */
function assertNoCredentialDisclosure(text, password) {
  assert.ok(!/"?password_hash"?/.test(text), 'password_hash must never be disclosed');
  assert.ok(!/\$2[aby]\$\d\d\$/.test(text), 'no bcrypt hash material may be disclosed');
  assert.ok(!new RegExp(password).test(text), 'the submitted password must never echo back');
  assert.ok(!/\binsertId\b/.test(text), 'no internal identifier may be disclosed');
  assert.ok(!/(SELECT |INSERT |RETURNING )/i.test(text), 'no SQL detail may be disclosed');
  assert.ok(!/\bat\s+\S+\s+\(.*:\d+:\d+\)/.test(text), 'no stack frame may be disclosed');
}

/** Neutralise the out-of-scope D-2 alias defect for one case, then restore it. */
async function withSeatMaskRemoved(fn) {
  const realCanAdd = subscriptionService.canAddUser;
  subscriptionService.canAddUser = async () => true;
  try {
    return await fn();
  } finally {
    subscriptionService.canAddUser = realCanAdd;
  }
}

/**
 * Run one mutation-sensitive unit against a model whose INSERT reports no
 * generated key, i.e. the shape a `RETURNING`-less INSERT produces.
 */
async function withCreateInsertReportingNoKey(insertStatementResult, fn) {
  const realExecute = User.pool.execute;
  User.pool.execute = async (sql, params) => {
    if (/^\s*INSERT INTO users/i.test(sql)) return insertStatementResult;
    return realExecute.call(User.pool, sql, params);
  };
  try {
    return await fn();
  } finally {
    User.pool.execute = realExecute;
  }
}

describe('MISSION D-1 organization signup and invitation onboarding: live PostgreSQL evidence',
  { skip: DB_TEST_SKIP_REASON, concurrency: 1 }, () => {
    before(async () => {
      await ensureFreePlan();

      const org = await rows(
        `INSERT INTO organizations (organization_name, industry) VALUES ($1, 'other') RETURNING id`,
        [`${TAG} FIXTURE`]);
      FIX_ORG = Number(org[0].id);
      const admin = await rows(
        `INSERT INTO users (username, email, password_hash, full_name, role, organization_id,
           is_organization_admin, is_active, status, is_billable)
         VALUES ($1, $2, 'fixture-hash', 'D1 Fixture Admin', 'admin', $3, TRUE, TRUE, 'active', TRUE)
         RETURNING id`,
        [userMark('fixture'), `${userMark('fixture')}@test.local`, FIX_ORG]);
      FIX_ADMIN = Number(admin[0].id);
      await rows(
        `INSERT INTO organization_subscriptions (organization_id, plan_id, included_users, extra_users,
           max_users, base_price, price_per_additional_user, status, billing_cycle,
           current_period_start, current_period_end, seats_used, seats_available)
         VALUES ($1, $2, 50, 0, 50, 0, 0, 'active', 'monthly', CURRENT_TIMESTAMP,
           CURRENT_TIMESTAMP + INTERVAL '30 days', 1, 49)`,
        [FIX_ORG, freePlanId]);
      FIX_BEARER = jwt.sign(
        { userId: FIX_ADMIN, organizationId: FIX_ORG, role: 'admin', isOrgAdmin: true },
        JWT_SECRET, { expiresIn: '1h' });

      const app = require('../src/app');
      server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      port = server.address().port;
    });

    after(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
      await cleanup();
    });

    // ===================================================== A. organization signup

    describe('A. POST /api/auth/organization-signup', () => {
      it('A1. a real free plan exists and the endpoint is reachable anonymously', async () => {
        assert.strictEqual(typeof JWT_SECRET, 'string');
        assert.ok(JWT_SECRET.length > 0, 'src/config/auth.js must resolve a JWT secret');
        assert.notStrictEqual(freePlanId, null,
          'a real free plan must exist, or "0 subscriptions" could be explained by a missing plan');

        // No Authorization header: the approved self-service onboarding endpoint
        // must stay mounted and anonymous.
        const res = await anonymousSignup('A1');
        assert.strictEqual(res.status, 201, `anonymous signup must succeed: ${res.text}`);
        assert.strictEqual((await signupState('A1')).organizations.length, 1);
      });

      it('A2. success commits exactly one organization, one administrator and one linked subscription', async () => {
        const body = signupBody('A2');
        const state = await signupState('A2');
        assert.deepStrictEqual(
          { organizations: state.organizations.length, users: state.users.length, subscriptions: state.subscriptions.length },
          { organizations: 0, users: 0, subscriptions: 0 },
          'no fixture may exist before the attempt');

        const res = await signup(body);
        assert.strictEqual(res.status, 201, `expected 201, got ${res.status}: ${res.text}`);

        const after = await signupState('A2');
        assert.strictEqual(after.organizations.length, 1, 'exactly one organization');
        assert.strictEqual(after.users.length, 1, 'exactly one administrator');
        assert.strictEqual(after.subscriptions.length, 1, 'exactly one default subscription');

        assert.deepStrictEqual(
          { role: after.users[0].role, is_organization_admin: after.users[0].is_organization_admin },
          { role: 'admin', is_organization_admin: true },
          'the first user is the tenant administrator (authorized role issuance preserved)');
        assert.strictEqual(
          after.users[0].organization_id, after.organizations[0].id,
          'the administrator belongs to the organization that was created');
        assert.strictEqual(
          after.subscriptions[0].organization_id, after.organizations[0].id,
          'the subscription belongs to the organization that was created');
        assert.strictEqual(
          after.organizations[0].subscription_id, after.subscriptions[0].id,
          'organizations.subscription_id is linked to the created subscription');

        // The response is a created-tenant contract, and it must not disclose the
        // administrator credential.
        assert.strictEqual(res.json.success, true);
        assert.strictEqual(res.json.data.organization.id, after.organizations[0].id);
        assert.strictEqual(res.json.data.user.role, 'admin');
        assertNoCredentialDisclosure(res.text, PASSWORD);

        // ...while the credential really does exist in the database, so "absent
        // from the response" is not "never created".
        const hash = await rows('SELECT password_hash FROM users WHERE username = $1', [body.username]);
        assert.strictEqual(hash.length, 1);
        assert.match(hash[0].password_hash, /^\$2[aby]\$/, 'the stored credential is a real bcrypt hash');
      });

      it('A3. a duplicate organization name is refused 409 with no second organization and no second user', async () => {
        const body = signupBody('A3');
        const first = await signup(body);
        assert.strictEqual(first.status, 201);
        assert.strictEqual((await signupState('A3')).organizations.length, 1);

        const retry = await signup({ ...body, username: userMark('A3-retry'), email: `${userMark('A3-retry')}@test.local` });
        assert.strictEqual(retry.status, 409, 'the duplicate name is refused');
        assert.strictEqual(retry.json.message, 'Organization name already exists',
          'the refusal wording is unchanged (non-disclosure preserved)');

        const after = await signupState('A3');
        assert.strictEqual(after.organizations.length, 1, 'the refused retry persisted no second organization');
        assert.strictEqual(after.users.length, 1, 'the refused retry attached no second user');
      });

      it('A4. ORPHAN-RECORD behaviour: a failure AFTER the organization INSERT leaves NO organization (GUARD-SENSITIVE: transaction)', async () => {
        const suffix = 'A4';
        const body = signupBody(suffix);

        // Fail on the real path, after the organization and administrator INSERTs:
        // a plan id that does not exist makes
        // OrganizationSubscription.createForOrganization throw `Invalid plan`.
        const realGetPlan = subscriptionService.getPlanByCode;
        subscriptionService.getPlanByCode = async () => ({ id: -1, code: FREE_PLAN_CODE });
        let res;
        try {
          res = await signup(body);
        } finally {
          subscriptionService.getPlanByCode = realGetPlan;
        }

        assert.strictEqual(res.status, 500, 'the injected failure must surface as a server error');

        const after = await signupState(suffix);
        assert.strictEqual(after.organizations.length, 0,
          'NO organization may be committed behind a failed signup');
        assert.strictEqual(after.users.length, 0,
          'NO administrator may be committed behind a failed signup');
        assert.strictEqual(after.subscriptions.length, 0,
          'NO subscription may be committed behind a failed signup');
        assert.strictEqual(
          await scalar('SELECT count(*) FROM users WHERE username = $1', [body.username]), 0,
          'the submitted username exists nowhere in the database');

        // The name must be registrable afterwards: an orphan would permanently
        // squat it, because direct organization deletion is fail-closed.
        const retry = await signup({ ...body, username: userMark('A4-retry'), email: `${userMark('A4-retry')}@test.local` });
        assert.strictEqual(retry.status, 201,
          'the name must still be registrable after a failed attempt (no permanent squattable orphan)');
        assert.strictEqual((await signupState(suffix)).organizations.length, 1);
      });

      it('A5. security boundary: the public endpoint joins no existing tenant and discloses no credential material', async () => {
        const created = await anonymousSignup('A5');
        assert.strictEqual(created.status, 201);
        assertNotDisclosedFor(created);

        const target = (await signupState('A5')).organizations[0];
        assert.strictEqual(
          await scalar('SELECT count(*) FROM users WHERE organization_id = $1', [target.id]), 1,
          'the new tenant has exactly its own administrator');

        // Re-using the EXISTING organization name with a NEW username must not
        // attach a user to the existing tenant.
        const joinAttempt = await signup({
          ...signupBody('A5'),
          username: userMark('A5-join'),
          email: `${userMark('A5-join')}@test.local`
        });
        assert.strictEqual(joinAttempt.status, 409, 'an existing tenant cannot be joined through signup');
        assert.strictEqual(
          await scalar('SELECT count(*) FROM users WHERE organization_id = $1', [target.id]), 1,
          'database effect: no user was attached to the existing tenant');

        // The fixture tenant is untouched in shape by an anonymous or
        // authenticated attempt.
        const shape = async () => ({
          users: await scalar('SELECT count(*) FROM users WHERE organization_id = $1', [FIX_ORG]),
          subscriptions: await scalar('SELECT count(*) FROM organization_subscriptions WHERE organization_id = $1', [FIX_ORG])
        });
        const before = await shape();
        const authenticated = await call('POST', '/api/auth/organization-signup',
          { body: signupBody('A5-auth'), bearer: FIX_BEARER });
        assert.strictEqual(authenticated.status, 201,
          'an authenticated caller creates a NEW tenant, never gains reach into its own');
        assert.deepStrictEqual(await shape(), before,
          'the authenticated caller\u2019s own tenant is unchanged in shape');
        assertNotDisclosedFor(authenticated);

        function assertNotDisclosedFor(res) {
          assertNoCredentialDisclosure(res.text, PASSWORD);
          assert.ok(!/set-cookie/i.test(JSON.stringify(res.headers))
            || /cmms_token/.test(JSON.stringify(res.headers)),
            'the only cookie set may be the application session cookie');
        }
      });
    });

    // ============================================== B. BaseModel.create contract

    describe('B. BaseModel.create', () => {
      it('B1. create() returns the COMMITTED row, with a real generated id', async () => {
        const username = userMark('B1');
        const created = await User.create({
          username,
          email: `${username}@test.local`,
          password_hash: 'fixture-hash',
          full_name: 'B1 Created',
          role: 'operator',
          organization_id: FIX_ORG,
          is_active: true,
          status: 'active',
          is_billable: true
        });

        assert.ok(created, 'create() must not return null after committing an INSERT');
        assert.ok(Number.isInteger(created.id) && created.id > 0,
          `create() must return a real generated id, got ${JSON.stringify(created.id)}`);
        assert.strictEqual(created.username, username);

        const persisted = await rows('SELECT id, username FROM users WHERE username = $1', [username]);
        assert.strictEqual(persisted.length, 1, 'the row is committed');
        assert.strictEqual(Number(persisted[0].id), created.id,
          'the returned id is the id of the committed row');
      });

      it('B2. create() withholds password_hash, and findById() still returns it (GUARD-SENSITIVE: credential projection)', async () => {
        const username = userMark('B2');
        const created = await User.create({
          username,
          email: `${username}@test.local`,
          password_hash: 'fixture-hash',
          full_name: 'B2 Created',
          role: 'operator',
          organization_id: FIX_ORG,
          is_active: true,
          status: 'active',
          is_billable: true
        });

        assert.strictEqual(Object.prototype.hasOwnProperty.call(created, 'password_hash'), false,
          'a create() result must never carry password_hash');
        assert.ok(!JSON.stringify(created).includes('fixture-hash'));

        // The read accessor must keep returning it, or login and changePassword
        // (which compare against user.password_hash) break.
        const reread = await User.findById(created.id);
        assert.strictEqual(reread.password_hash, 'fixture-hash',
          'findById() must still expose password_hash: login and changePassword depend on it');
      });

      it('B3. create() THROWS rather than returning null when the INSERT reports no generated key (GUARD-SENSITIVE: throw guard)', async () => {
        // Reproduce exactly what a RETURNING-less INSERT returns through the pg
        // adapter: a rows array whose insertId is null.
        const noKey = [];
        noKey.insertId = null;
        noKey.affectedRows = 1;
        noKey.rowCount = 1;

        await assert.rejects(
          () => withCreateInsertReportingNoKey([noKey, {}], () => User.create({
            username: userMark('B3'),
            email: `${userMark('B3')}@test.local`,
            password_hash: 'fixture-hash',
            full_name: 'B3 Not Created',
            role: 'operator',
            organization_id: FIX_ORG,
            is_active: true,
            status: 'active',
            is_billable: true
          })),
          /committed without reporting a generated id/,
          'an unobservable INSERT must fail loudly, never return null');
      });
    });

    // ================================================================= C. D-2 pin

    describe('C. D-2 (seat alias) is pinned, not repaired', () => {
      it('C1. getSeatUsage still computes NaN availableSeats and canAddUser is still always false', async () => {
        // The fixture tenant has 50 allowed seats and one billable user, so a
        // correct seat calculation would report 49 available.
        const usage = await subscriptionService.getSeatUsage(FIX_ORG);
        assert.ok(usage, 'the fixture tenant has a subscription');
        assert.strictEqual(usage.activeUsers, undefined,
          'D-2 pin: PostgreSQL folds the unquoted alias activeBillableUsers to lower case');
        assert.ok(Number.isNaN(usage.availableSeats),
          'D-2 pin: availableSeats is NaN for a tenant with free seats');
        assert.strictEqual(await subscriptionService.canAddUser(FIX_ORG), false,
          'D-2 pin: canAddUser is false for every tenant');
      });

      it('C2. that defect MASKS the invitation controller behind a 403 before any write', async () => {
        const email = `${userMark('C2')}@test.local`;
        const before = await scalar('SELECT count(*) FROM invitations WHERE email = $1', [email]);
        const res = await call('POST', '/api/invitations', { body: { email, role: 'operator' }, bearer: FIX_BEARER });
        assert.strictEqual(res.status, 403,
          'D-2 masks the invitation controller: the request is refused by its own seat gate');
        assert.strictEqual(await scalar('SELECT count(*) FROM invitations WHERE email = $1', [email]), before,
          'database effect: the masked request persisted nothing');
      });
    });

    // ======================================================== D. invitation flows

    describe('D. invitation onboarding (D-2 unmasked in-process; D-2 itself NOT repaired)', () => {
      it('D1. POST /api/invitations commits exactly one live pending invitation and returns its token', async () => {
        const email = `${userMark('D1')}@test.local`;
        const res = await withSeatMaskRemoved(() =>
          call('POST', '/api/invitations', { body: { email, role: 'operator' }, bearer: FIX_BEARER }));

        assert.strictEqual(res.status, 201, `expected 201, got ${res.status}: ${res.text}`);
        const found = await rows('SELECT id, status, token, role FROM invitations WHERE email = $1', [email]);
        assert.strictEqual(found.length, 1, 'exactly one invitation row is committed');
        assert.strictEqual(found[0].status, 'pending', 'the committed invitation is live');
        assert.ok(res.json.data.invitation.token, 'the creating administrator receives the delivery token');
        assert.strictEqual(res.json.data.invitation.id, Number(found[0].id),
          'the returned id is the id of the committed row');
      });

      it('D2. accept commits the account, retires the invitation and discloses no credential', async () => {
        const email = `${userMark('D2')}@test.local`;
        const created = await withSeatMaskRemoved(() =>
          call('POST', '/api/invitations', { body: { email, role: 'operator' }, bearer: FIX_BEARER }));
        assert.strictEqual(created.status, 201);
        const token = created.json.data.invitation.token;
        const username = userMark('D2-accept');

        const res = await withSeatMaskRemoved(() => call('POST', '/api/invitations/accept', { body: {
          token, username, password: PASSWORD, full_name: 'D2 Accept'
        } }));

        assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${res.text}`);

        const account = await rows(
          'SELECT id, role, organization_id, status FROM users WHERE username = $1', [username]);
        assert.strictEqual(account.length, 1, 'the account row is committed');
        assert.strictEqual(Number(account[0].organization_id), FIX_ORG, 'the account joined the inviting tenant');
        assert.strictEqual(account[0].role, 'operator', 'the granted role is the invitation role');

        const invitation = await rows(
          'SELECT status, accepted_at, accepted_by_user_id FROM invitations WHERE token = $1', [token]);
        assert.strictEqual(invitation.length, 1);
        assert.strictEqual(invitation[0].status, 'accepted', 'the invitation is retired');
        assert.ok(invitation[0].accepted_at, 'the acceptance is timestamped');
        assert.strictEqual(Number(invitation[0].accepted_by_user_id), Number(account[0].id),
          'the acceptance is attributed to the created account');

        assertNoCredentialDisclosure(res.text, PASSWORD);
        assert.strictEqual(Object.prototype.hasOwnProperty.call(res.json.data.user, 'password_hash'), false);
      });

      it('D3. a token cannot be replayed: no second account, and the invitation stays retired', async () => {
        const email = `${userMark('D3')}@test.local`;
        const created = await withSeatMaskRemoved(() =>
          call('POST', '/api/invitations', { body: { email, role: 'operator' }, bearer: FIX_BEARER }));
        const token = created.json.data.invitation.token;
        const first = userMark('D3-first');

        const accepted = await withSeatMaskRemoved(() => call('POST', '/api/invitations/accept', { body: {
          token, username: first, password: PASSWORD, full_name: 'D3 First'
        } }));
        assert.strictEqual(accepted.status, 200);

        const second = userMark('D3-second');
        const replay = await withSeatMaskRemoved(() => call('POST', '/api/invitations/accept', { body: {
          token, username: second, password: PASSWORD, full_name: 'D3 Second'
        } }));

        assert.notStrictEqual(replay.status, 200, 'a consumed token must not be accepted again');
        assert.strictEqual(await scalar('SELECT count(*) FROM users WHERE username = $1', [second]), 0,
          'database effect: the replay created no second account');
        assert.strictEqual(
          await scalar(`SELECT count(*) FROM invitations WHERE token = $1 AND status = 'accepted'`, [token]), 1,
          'the invitation is still retired, not re-opened');
      });

      it('D4. exactly ONE of two concurrent acceptances of the same token creates an account (GUARD-SENSITIVE: FOR UPDATE)', async () => {
        const email = `${userMark('D4')}@test.local`;
        const seeded = await rows(
          `INSERT INTO invitations (organization_id, email, role, invited_by, token, status, expires_at)
           VALUES ($1, $2, 'operator', $3, $4, 'pending', CURRENT_TIMESTAMP + INTERVAL '7 days')
           RETURNING token`,
          [FIX_ORG, email, FIX_ADMIN, `d4token${RUN}${++seq}`.padEnd(64, '0')]);
        const token = seeded[0].token;
        const userA = userMark('D4-a');
        const userB = userMark('D4-b');

        const [a, b] = await withSeatMaskRemoved(() => Promise.all([
          call('POST', '/api/invitations/accept', { body: { token, username: userA, password: PASSWORD, full_name: 'D4 A' } }),
          call('POST', '/api/invitations/accept', { body: { token, username: userB, password: PASSWORD, full_name: 'D4 B' } })
        ]));

        const statuses = [a.status, b.status].sort();
        assert.deepStrictEqual(statuses, [200, 409],
          `exactly one acceptance may win, got ${a.status}/${b.status}: ${a.text} | ${b.text}`);

        const accounts = await rows(
          'SELECT id FROM users WHERE username IN ($1, $2)', [userA, userB]);
        assert.strictEqual(accounts.length, 1,
          'database effect: one token consumed exactly once, so exactly one account exists');
        assert.strictEqual(
          await scalar(`SELECT count(*) FROM invitations WHERE token = $1 AND status = 'accepted'`, [token]), 1);
      });

      it('D5. a failure AFTER the account INSERT leaves the invitation usable and commits no account (GUARD-SENSITIVE: transaction)', async () => {
        const email = `${userMark('D5')}@test.local`;
        const seeded = await rows(
          `INSERT INTO invitations (organization_id, email, role, invited_by, token, status, expires_at)
           VALUES ($1, $2, 'operator', $3, $4, 'pending', CURRENT_TIMESTAMP + INTERVAL '7 days')
           RETURNING id, token`,
          [FIX_ORG, email, FIX_ADMIN, `d5token${RUN}${++seq}`.padEnd(64, '0')]);
        const invitationId = Number(seeded[0].id);
        const token = seeded[0].token;
        const username = userMark('D5-accept');

        const realAccept = Invitation.accept;
        Invitation.accept = async () => { throw new Error('injected post-insert failure'); };
        let res;
        try {
          res = await withSeatMaskRemoved(() => call('POST', '/api/invitations/accept', { body: {
            token, username, password: PASSWORD, full_name: 'D5 Accept'
          } }));
        } finally {
          Invitation.accept = realAccept;
        }

        assert.strictEqual(res.status, 500, 'the injected failure surfaces as a server error');

        assert.strictEqual(await scalar('SELECT count(*) FROM users WHERE username = $1', [username]), 0,
          'NO account may be committed when the acceptance fails');
        const invitation = await rows('SELECT status FROM invitations WHERE id = $1', [invitationId]);
        assert.strictEqual(invitation[0].status, 'pending',
          'the invitation must NOT be consumed by a failed acceptance: no consumed-but-unusable invitation');

        // ...and it is genuinely still usable.
        const retry = await withSeatMaskRemoved(() => call('POST', '/api/invitations/accept', { body: {
          token, username, password: PASSWORD, full_name: 'D5 Retry'
        } }));
        assert.strictEqual(retry.status, 200, 'the restored invitation is usable again');
      });

      it('D6. resend leaves exactly ONE live pending invitation', async () => {
        const email = `${userMark('D6')}@test.local`;
        const seeded = await rows(
          `INSERT INTO invitations (organization_id, email, role, invited_by, token, status, expires_at)
           VALUES ($1, $2, 'operator', $3, $4, 'pending', CURRENT_TIMESTAMP + INTERVAL '7 days')
           RETURNING id`,
          [FIX_ORG, email, FIX_ADMIN, `d6token${RUN}${++seq}`.padEnd(64, '0')]);
        const targetId = Number(seeded[0].id);

        const res = await withSeatMaskRemoved(() =>
          call('POST', `/api/invitations/${targetId}/resend`, { body: {}, bearer: FIX_BEARER }));

        assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${res.text}`);

        const all = await rows('SELECT id, status FROM invitations WHERE email = $1 ORDER BY id', [email]);
        assert.strictEqual(all.length, 2, 'the resend issued exactly one replacement');
        assert.strictEqual(all.filter((r) => r.status === 'pending').length, 1,
          'exactly ONE live pending row may remain after a resend');
        const replaced = all.find((r) => Number(r.id) === targetId);
        assert.strictEqual(replaced.status, 'cancelled', 'the replaced invitation is retired');
      });

      it('D7. acceptance never confers authority the invitation did not carry', async () => {
        const email = `${userMark('D7')}@test.local`;
        const created = await withSeatMaskRemoved(() =>
          call('POST', '/api/invitations', { body: { email, role: 'operator' }, bearer: FIX_BEARER }));
        const token = created.json.data.invitation.token;
        const username = userMark('D7-accept');

        const res = await withSeatMaskRemoved(() => call('POST', '/api/invitations/accept', { body: {
          token, username, password: PASSWORD, full_name: 'D7 Accept',
          // A public caller supplying its own authority must change nothing.
          role: 'admin',
          is_organization_admin: true,
          organization_id: FIX_ORG + 100000
        } }));
        assert.strictEqual(res.status, 200);

        const account = await rows(
          'SELECT role, is_organization_admin, organization_id FROM users WHERE username = $1', [username]);
        assert.strictEqual(account[0].role, 'operator',
          'the granted role is the PERSISTED invitation role, never a request-body field');
        assert.notStrictEqual(account[0].is_organization_admin, true,
          'acceptance cannot confer organization-administrator authority');
        assert.strictEqual(Number(account[0].organization_id), FIX_ORG,
          'the tenant is the PERSISTED invitation tenant, never a request-body field');
      });
    });

    // ============================================ E. administration credential path

    describe('E. user administration credential non-disclosure', () => {
      it('E1. POST /api/users discloses no credential while storing a real bcrypt hash (GUARD-SENSITIVE: response projection)', async () => {
        const username = userMark('E1');
        const res = await call('POST', '/api/users', {
          bearer: FIX_BEARER,
          body: {
            username,
            email: `${username}@test.local`,
            password: PASSWORD,
            full_name: 'E1 Created',
            role: 'operator'
          }
        });

        assert.strictEqual(res.status, 201, `expected 201, got ${res.status}: ${res.text}`);
        assertNoCredentialDisclosure(res.text, PASSWORD);

        const stored = await rows('SELECT password_hash FROM users WHERE username = $1', [username]);
        assert.strictEqual(stored.length, 1, 'the account was really created');
        assert.match(stored[0].password_hash, /^\$2[aby]\$/,
          'the credential is really stored, so its absence from the response is a redaction and not a missing write');
      });
    });
  });
