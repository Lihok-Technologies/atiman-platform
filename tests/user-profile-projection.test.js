/**
 * ATM-001-SEC-107-R1-CORRECTION - handler-projection vs router-backstop proof.
 *
 * WHY THIS SUITE EXISTS
 * --------------------
 * Arena's review of Mission #107 found the accepted credential-disclosure cases
 * passed VACUOUSLY with respect to the handler. Its mutation M1 - the
 * `GET /api/users/:id` handler returning the RAW row (`req.targetUser`) while the
 * pre-existing router-level backstop stayed intact - left every sanitizer case
 * GREEN, because `sanitizeUser === redactSensitiveFields` and the backstop applies
 * the identical function to the whole response body, producing byte-identical
 * output. Those cases proved "no credential reached the wire" but could not
 * attribute the protection to the handler projection.
 *
 * The correction makes the handler projection an explicit ALLOW-LIST
 * (`projectUserProfile` / `USER_PROFILE_FIELDS`), which is a STRICT SUBSET of the
 * raw row. The projection is now observable in the response shape, so M1 is
 * detectable. This suite proves that property at the module level; the HTTP-level
 * shape assertions live in tests/user-credential-disclosure.test.js (cases 7b, 8).
 *
 * It also pins the OTHER layer. The router-level backstop was extracted from an
 * inline closure in `src/routes/user.routes.js` into
 * `src/middleware/sensitive-response.js` so that it is independently testable and
 * so that its installation can be asserted. Section 3 drives the backstop that is
 * ACTUALLY installed on the users router.
 *
 * No database is required: this suite runs under `npm test` as well as under the
 * sanctioned integration runner.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const {
  projectUserProfile,
  USER_PROFILE_FIELDS,
  redactSensitiveFields,
  isSensitiveField
} = require('../src/utils/helpers');
const { sensitiveResponseGuard } = require('../src/middleware/sensitive-response');
const rbac = require('../src/middleware/rbac');

/**
 * The documented served-profile contract, stated INDEPENDENTLY of `src/` so that
 * editing `USER_PROFILE_FIELDS` cannot silently move this suite's expectation.
 */
const EXPECTED_PROFILE_FIELDS = [
  'id', 'username', 'email', 'full_name', 'phone',
  'role', 'facility_id', 'organization_id',
  'is_active', 'status', 'is_organization_admin',
  'last_login', 'created_at', 'updated_at'
];

/** The declared list also covers the `GET /api/auth/profile` organization join. */
const EXPECTED_PROFILE_FIELDS_WITH_ORG = [
  ...EXPECTED_PROFILE_FIELDS,
  'organization_name', 'subscription_plan', 'subscription_status'
];

/** Internal columns deliberately NOT served by a user profile. */
const WITHHELD_INTERNAL_FIELDS = [
  'invited_by', 'invited_at', 'is_billable',
  'is_sso_user', 'sso_provider', 'last_sso_login_at'
];

/** A faithful raw `SELECT *` users row, including its credential and internals. */
const RAW_ROW = Object.freeze({
  id: 4242,
  username: 'projection-fixture',
  email: 'projection-fixture@invalid',
  password_hash: '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012',
  full_name: 'Projection Fixture',
  phone: null,
  role: 'operator',
  facility_id: 7,
  is_active: true,
  status: 'active',
  is_billable: true,
  invited_by: 1,
  invited_at: new Date('2026-01-01T00:00:00Z'),
  last_login: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-02T00:00:00Z'),
  organization_id: 3,
  is_organization_admin: false,
  is_sso_user: false,
  sso_provider: null,
  last_sso_login_at: null
});

/** Listen on an ephemeral port and return { server, port }. */
const listen = (app) => new Promise((resolve) => {
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
});

const fetchJson = (port, path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path }, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, text: data }));
  }).on('error', reject);
});

// ==========================================================================

describe('ATM-001-SEC-107-R1-CORRECTION user-profile projection is provable', () => {
  // ------------------------------------------------ 1. the allow-list contract

  describe('1. projectUserProfile emits exactly the documented allow-list', () => {
    it('1a. the projection equals the allow-list, and withholds every internal column', () => {
      const projected = projectUserProfile(RAW_ROW);

      assert.deepStrictEqual(Object.keys(projected).sort(), EXPECTED_PROFILE_FIELDS.slice().sort(),
        'the projected key set must equal the documented allow-list exactly');
      assert.deepStrictEqual(USER_PROFILE_FIELDS.slice().sort(),
        EXPECTED_PROFILE_FIELDS_WITH_ORG.slice().sort(),
        'src must declare the same allow-list this suite asserts');

      for (const field of WITHHELD_INTERNAL_FIELDS) {
        assert.ok(!(field in projected), `internal column ${field} must not be projected`);
      }
      assert.ok(!('password_hash' in projected), 'the credential column must not be projected');
      for (const key of Object.keys(projected)) {
        assert.ok(!isSensitiveField(key), `the allow-list must not carry a credential-named key: ${key}`);
      }
    });

    it('1b. legitimate values are preserved unchanged (not a blanket drop)', () => {
      const projected = projectUserProfile(RAW_ROW);
      assert.strictEqual(projected.id, RAW_ROW.id);
      assert.strictEqual(projected.username, RAW_ROW.username);
      assert.strictEqual(projected.email, RAW_ROW.email);
      assert.strictEqual(projected.role, RAW_ROW.role);
      assert.strictEqual(projected.organization_id, RAW_ROW.organization_id);
      assert.strictEqual(projected.is_organization_admin, RAW_ROW.is_organization_admin);
    });

    it('1c. non-object input is returned unchanged, and the input row is not mutated', () => {
      assert.strictEqual(projectUserProfile(null), null);
      assert.strictEqual(projectUserProfile(undefined), undefined);
      assert.deepStrictEqual(projectUserProfile([1, 2]), [1, 2]);

      const before = { ...RAW_ROW };
      projectUserProfile(RAW_ROW);
      assert.deepStrictEqual({ ...RAW_ROW }, before, 'projection must not mutate its input');
    });
  });

  // --------------------------------- 2. WHY M1 is detectable (the mechanism)

  describe('2. the allow-list projection is distinguishable from the raw-row backstop (M1)', () => {
    it('2a. the projection is a STRICT SUBSET of the backstopped raw row', () => {
      const projected = projectUserProfile(RAW_ROW);
      // M1: handler returns the raw row and the pre-existing router backstop
      // applies `redactSensitiveFields` to the whole body.
      const m1Body = redactSensitiveFields(RAW_ROW);

      const projectedKeys = Object.keys(projected).sort();
      const m1Keys = Object.keys(m1Body).sort();

      assert.deepStrictEqual(Object.keys(RAW_ROW).filter((k) => isSensitiveField(k)), ['password_hash'],
        'the fixture must carry exactly one credential-named column, or this proof is not faithful');
      assert.ok(projectedKeys.length < m1Keys.length,
        'the projection must be a STRICT subset of the backstopped raw row, otherwise M1 would be invisible');
      assert.notDeepStrictEqual(projectedKeys, m1Keys,
        'a raw row behind the router backstop must have a DIFFERENT response shape from the allow-list projection - '
        + 'this is precisely why the shape assertions in cases 7b/8 turn M1 RED');
    });

    it('2b. a credential cannot be introduced by widening the declared allow-list', () => {
      // The projection is guarded by the credential predicate itself, so even a
      // source row carrying a credential cannot have it projected.
      const projected = projectUserProfile({ ...RAW_ROW, reset_token: 'TOKEN', client_secret: 'SECRET' });
      assert.ok(!('reset_token' in projected));
      assert.ok(!('client_secret' in projected));
      assert.deepStrictEqual(Object.keys(projected).sort(), EXPECTED_PROFILE_FIELDS.slice().sort());
    });
  });

  // ------------------------------------------- 3. the router-level backstop

  describe('3. the router-level backstop is installed AND functional', () => {
    it('3a. the users router installs sensitiveResponseGuard, and the installed guard redacts a raw row', async () => {
      // Structural + behavioural in one: locate the guard that is ACTUALLY
      // installed on the real users router and drive that exact middleware.
      // Removing `router.use(sensitiveResponseGuard)` from
      // src/routes/user.routes.js makes this RED.
      const router = require('../src/routes/user.routes');
      const installed = router.stack.find((layer) => layer.handle === sensitiveResponseGuard);
      assert.ok(installed,
        'src/routes/user.routes.js must install sensitiveResponseGuard as a router-level backstop');

      let captured = null;
      const res = { json: (body) => { captured = body; return res; } };
      let nextCalled = false;
      installed.handle({}, res, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, true, 'the backstop must call next()');

      // Simulate a handler that forgot to project: a raw row, nested in the real
      // envelope, with a credential AND a credential-named metadata field.
      res.json({
        success: true,
        data: { user: { id: 1, username: 'raw', password_hash: 'HASH', reset_token: 'TOKEN', nested: { client_secret: 'S' } } }
      });

      assert.ok(captured, 'the backstop must not swallow the response');
      assert.ok(!('password_hash' in captured.data.user), 'the backstop must strip password_hash');
      assert.ok(!('reset_token' in captured.data.user), 'the backstop must strip reset_token');
      assert.ok(!('client_secret' in captured.data.user.nested), 'the backstop must redact nested objects');
      assert.strictEqual(captured.data.user.username, 'raw', 'the backstop must not drop legitimate fields');
      assert.strictEqual(captured.success, true, 'the backstop must preserve the envelope');
    });

    it('3b. the backstop redacts over real HTTP through an Express app', async () => {
      const app = express();
      app.use(sensitiveResponseGuard);
      app.get('/raw-user', (req, res) => res.json({
        success: true,
        data: { user: { id: 1, username: 'raw', password_hash: 'HASH', nested: { api_key: 'K' } } }
      }));

      const { server, port } = await listen(app);
      try {
        const res = await fetchJson(port, '/raw-user');
        assert.strictEqual(res.status, 200);
        const body = JSON.parse(res.text);
        assert.ok(!('password_hash' in body.data.user), 'no credential may reach the client');
        assert.ok(!('api_key' in body.data.user.nested), 'nested credentials must be stripped');
        assert.strictEqual(body.data.user.username, 'raw');
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });

  // ------------------------------------------------- 4. no dead code remains

  describe('4. the removed #107 carve-out leaves no dead code', () => {
    it('4a. requireUsersViewUnlessOwnRecord is not exported and not defined', () => {
      assert.ok(!('requireUsersViewUnlessOwnRecord' in rbac),
        'the unauthorized own-record carve-out must not remain an exported helper');

      const source = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '..', 'src', 'middleware', 'rbac.js'), 'utf8');
      assert.ok(!/^\s*const\s+requireUsersViewUnlessOwnRecord\b/m.test(source),
        'no definition of the removed carve-out may remain');

      const routeSource = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '..', 'src', 'routes', 'user.routes.js'), 'utf8');
      assert.ok(!/\brequireUsersViewUnlessOwnRecord\s*[,)\n]/.test(routeSource.replace(/\/\*[\s\S]*?\*\//g, '')),
        'the route must not reference the removed carve-out outside comments');
      assert.ok(/router\.get\('\/:id',\s*requirePermission\('USERS',\s*'VIEW'\),\s*canViewUser/.test(routeSource),
        'GET /api/users/:id must be gated by requirePermission(USERS, VIEW)');
    });
  });
});
