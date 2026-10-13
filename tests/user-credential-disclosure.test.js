/**
 * ATM-001-SEC-B3B — user-credential disclosure, adversarial.
 *
 * The reported defect: `GET /api/users/:id` answered HTTP 200 with the target's
 * bcrypt `password_hash`, because the handler returned the raw `SELECT *` row
 * (`User.findById`). The same shape was returned by the user list
 * (`GET /api/users`), the facility/operator listing
 * (`GET /api/users/facility/operators`) and the create/update responses.
 *
 * This suite is adversarial about the DISCLOSURE, not about the authorization:
 * every assertion below is "no credential reached the client". The status code is
 * recorded and, where it is stable across the remediation lanes, asserted - but
 * the tenant/role authorization of these routes is owned by the
 * ATM-001-SEC-LEGACY-01 single-user lane (#85 `fc9eb298` / #102 `749043b`) and is
 * deliberately not asserted here, so that this suite is a detector of the
 * credential leak rather than a second, competing authorization contract.
 *
 * Two "detector" properties are asserted first, so a green run cannot be
 * vacuous:
 *   - the fixture row genuinely carries a bcrypt hash in the database, and
 *   - the raw model read genuinely returns it - so the redaction is proved to be
 *     removing something that is really there.
 *
 * Evidence policy: the HTTP layer is exercised against the real Express app with
 * real JWTs signed with the secret read from `src/config/auth.js`, so routing,
 * authentication and serialisation are production-shaped. Where the mutation
 * cannot be reached over HTTP (see the PUT finding below) the database effect is
 * still asserted, because "no credential in the response" is only meaningful
 * alongside "and the response did not come from a durable change".
 *
 * No credential value is ever printed by this suite: every assertion message
 * passes anything body-derived through `redacted()` first, which masks a bcrypt
 * hash, a JWT and any long opaque secret.
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * src/config/database.js uses to select test-database credentials, so it can
 * never run against runtime credentials.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const { getConnection, isIntegrationTest } = require('../src/config/database');
const authConfig = require('../src/config/auth');
const { User } = require('../src/models');

/**
 * The credential predicate is restated here rather than imported from
 * `src/utils/helpers`, so this suite is a detector that runs against the
 * pre-fix baseline and fails on the real disclosure, instead of failing on a
 * missing export. It stays deliberately narrow: the names the reported defect
 * can carry, plus the delimited-segment rule the production predicate uses.
 */
const SENSITIVE_KEY_NAMES = new Set([
  'password', 'passwd', 'pwd', 'password_hash', 'passwd_hash', 'passwordhash',
  'reset_token', 'password_reset_token', 'token', 'tokens', 'api_key', 'apikey',
  'api_key_hash', 'secret', 'secrets', 'client_secret', 'private_key',
  'session_token', 'refresh_token', 'access_token'
]);
const SENSITIVE_KEY_PATTERN = /(?:^|_)(?:password|passwd|secret|token|credential|api_key|private_key)(?:$|_)/;
const isSensitiveKey = (name) => {
  const key = String(name).toLowerCase();
  return SENSITIVE_KEY_NAMES.has(key) || SENSITIVE_KEY_PATTERN.test(key);
};

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating credential-disclosure suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'test-database credentials are used instead of runtime credentials; run it '
    + 'via `npm run test:integration`';

// The secret the RUNNING APPLICATION will use, read from the application's own
// configuration module rather than re-stated here.
const JWT_SECRET = authConfig.jwt.secret;

const BCRYPT_HASH_PATTERN = /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/;
const SENSITIVE_FIELD_IN_BODY_PATTERN = /"(password_hash|password|passwd|reset_token|token|secret|client_secret|api_key_hash)"\s*:/i;

/** Never let a credential-shaped value reach a test report. */
const redacted = (value) => String(value)
  .replace(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g, '[REDACTED-HASH]')
  .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}[A-Za-z0-9_.-]*/g, '[REDACTED-TOKEN]')
  .replace(/[A-Za-z0-9_-]{40,}/g, '[REDACTED-OPAQUE]');

const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`;
const tag = (name) => `b3b-${name}-${RUN}`;

// Synthetic passphrases. They are hashed for the fixtures and are never printed.
const FIXTURE_PASSPHRASE = `b3b-fixture-${RUN}-never-printed`;
const ROTATED_PASSPHRASE = `b3b-rotated-${RUN}-never-printed`;
const CREATED_PASSPHRASE = `b3b-created-${RUN}-never-printed`;

let ORG_A = null;
let ORG_B = null;
let FAC_A = null;
let ADMIN_A = null;
let OP_A = null;
let SUP_A = null;
let OP_FAC_A = null;
let ADMIN_B = null;
let TARGET_B = null;
let FIXTURE_HASH = null;

let server = null;
let port = null;

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

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

const scalar = async (sql, params = []) => {
  const rows = await withConn((conn) => conn.query(sql, params));
  return rows.length ? Object.values(rows[0])[0] : null;
};

async function ensureFixture() {
  FIXTURE_HASH = bcrypt.hashSync(FIXTURE_PASSPHRASE, 10);

  await withConn(async (conn) => {
    const orgs = await conn.query(
      `INSERT INTO organizations (organization_name) VALUES ($1), ($2) RETURNING id`,
      [`B3B Org A ${RUN}`, `B3B Org B ${RUN}`]);
    [ORG_A, ORG_B] = orgs.map((row) => Number(row.id));

    const facs = await conn.query(
      `INSERT INTO facilities (organization_id, name, code) VALUES ($1, $2, $3) RETURNING id`,
      [ORG_A, `B3B Facility A ${RUN}`, `B3BFA-${RUN}`]);
    FAC_A = Number(facs[0].id);

    const users = await conn.query(
      `INSERT INTO users (organization_id, username, email, password_hash, full_name, role,
                          facility_id, is_organization_admin, is_active)
       VALUES ($1, $3, $3, $9, 'B3B Admin A', 'admin',      NULL,  true,  true),
              ($1, $4, $4, $9, 'B3B Operator A', 'operator', NULL,  false, true),
              ($1, $5, $5, $9, 'B3B Supervisor A', 'supervisor', $10, false, true),
              ($1, $6, $6, $9, 'B3B Facility Op A', 'operator', $10, false, true),
              ($2, $7, $7, $9, 'B3B Admin B', 'admin',      NULL,  true,  true),
              ($2, $8, $8, $9, 'B3B Target B', 'operator',  NULL,  false, true)
       RETURNING id`,
      [ORG_A, ORG_B,
        `${tag('admin-a')}@b3b.invalid`, `${tag('op-a')}@b3b.invalid`,
        `${tag('sup-a')}@b3b.invalid`, `${tag('op-fac-a')}@b3b.invalid`,
        `${tag('admin-b')}@b3b.invalid`, `${tag('target-b')}@b3b.invalid`,
        FIXTURE_HASH, FAC_A]);
    [ADMIN_A, OP_A, SUP_A, OP_FAC_A, ADMIN_B, TARGET_B] = users.map((row) => Number(row.id));
  });
}

async function removeFixture() {
  await withConn(async (conn) => {
    await conn.query('DELETE FROM users WHERE organization_id = ANY($1::int[])', [[ORG_A, ORG_B]]);
    await conn.query('DELETE FROM facilities WHERE organization_id = ANY($1::int[])', [[ORG_A, ORG_B]]);
    await conn.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [[ORG_A, ORG_B]]);
  });
}

// ---------------------------------------------------------------------------
// Adversarial assertions
// ---------------------------------------------------------------------------

/**
 * Assert that no credential material survives anywhere in a serialised response.
 *
 * This runs BOTH a textual scan (a credential could be embedded in a string that
 * is not itself a JSON field, or re-encoded) and a structural scan of the parsed
 * body (a credential could hide under any depth of envelope or array, which a
 * top-level field filter would miss).
 */
function assertNoCredential(bodyText, context, knownHashes = []) {
  const excerpt = redacted(bodyText).slice(0, 400);

  assert.ok(!BCRYPT_HASH_PATTERN.test(bodyText),
    `${context}: response body must carry no bcrypt hash. Body: ${excerpt}`);
  assert.ok(!SENSITIVE_FIELD_IN_BODY_PATTERN.test(bodyText),
    `${context}: response body must carry no credential field. Body: ${excerpt}`);

  for (const hash of knownHashes) {
    if (!hash) continue;
    assert.ok(!bodyText.includes(hash),
      `${context}: response body must not echo the stored hash. Body: ${excerpt}`);
  }

  let parsed = null;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    // An HTML or empty body: the textual scans above are the whole contract.
    return;
  }
  assertNoSensitiveKey(parsed, context, '$');
}

function assertNoSensitiveKey(value, context, at) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSensitiveKey(entry, context, `${at}[${index}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    assert.strictEqual(isSensitiveKey(key), false,
      `${context}: sensitive field "${key}" present at ${at} - a nested envelope was not redacted`);
    assertNoSensitiveKey(entry, context, `${at}.${key}`);
  }
}

/**
 * MISSION #107 / R-1 - a refusal is NOT sanitizer evidence.
 *
 * This suite previously asserted only `status !== 500` plus "no credential" on
 * the foreign-tenant and malformed-identifier cases. Under the approved R-1
 * policy those calls are refused by the authorization layer BEFORE the handler's
 * projection runs, so a green assertion there proved nothing about the
 * sanitizer: a route that returned a raw `SELECT *` row behind a refusal would
 * have passed identically.
 *
 * Cases that stay deny-only are asserted with this helper instead. It pins the
 * exact refusal status and requires that no `data.user` projection was produced
 * at all, so "blocked before projection" can never be counted as "the sanitizing
 * branch ran". Sanitizer evidence is carried ONLY by the cases that reach a real
 * HTTP 200 (7, 7b, 7c, 8, 9, 10).
 *
 * @param {{status: number, text: string}} res
 * @param {number} expectedStatus the refusal the policy requires
 * @param {string} context
 */
function assertDeniedBeforeProjection(res, expectedStatus, context) {
  assert.strictEqual(res.status, expectedStatus,
    `${context}: expected the refused status, not a served projection. Body: ${redacted(res.text)}`);
  assertNoCredential(res.text, context, []);

  let parsed = null;
  try {
    parsed = JSON.parse(res.text);
  } catch {
    // A non-JSON refusal body: the status assertion above is the whole contract.
    return;
  }
  assert.ok(!(parsed && parsed.data && parsed.data.user),
    `${context}: a denied read must produce no user projection - it may not be credited to the sanitizer`);
}

// ---------------------------------------------------------------------------
// HTTP harness - the real application, real JWTs
// ---------------------------------------------------------------------------

function call(method, requestPath, { userId, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: requestPath,
      headers: {
        Accept: 'application/json',
        ...(userId
          ? { Authorization: `Bearer ${require('jsonwebtoken').sign({ userId }, JWT_SECRET)}` }
          : {}),
        ...(payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text: data }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const get = (p, userId) => call('GET', p, { userId });
const put = (p, userId, body) => call('PUT', p, { userId, body });
const post = (p, userId, body) => call('POST', p, { userId, body });

const storedHash = (userId) => scalar('SELECT password_hash FROM users WHERE id = $1', [userId]);

const captureStdout = async (fn) => {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk, ...rest) => {
    chunks.push(typeof chunk === 'string' ? chunk : String(chunk));
    if (typeof rest[rest.length - 1] === 'function') rest[rest.length - 1]();
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = original;
  }
  return chunks.join('');
};

// ==========================================================================

describe('ATM-001-SEC-B3B user credential disclosure', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => {
    await ensureFixture();
    const app = require('../src/app');
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await removeFixture();
  });

  // ------------------------------------------------- A. the detector property

  describe('A. the fixture genuinely carries a credential', () => {
    it('1. the stored row holds a bcrypt hash, and the raw model read returns it', async () => {
      const hash = await storedHash(TARGET_B);
      assert.ok(BCRYPT_HASH_PATTERN.test(String(hash)),
        'the fixture must hold a real bcrypt hash, or a green run would be vacuous');

      const raw = await User.findById(TARGET_B);
      assert.ok(raw && BCRYPT_HASH_PATTERN.test(String(raw.password_hash)),
        'the raw SELECT * row must carry the hash - this is what the redaction removes');
    });

    it('2. hashing the fixture passphrase reproduces the stored hash', () => {
      assert.strictEqual(bcrypt.compareSync(FIXTURE_PASSPHRASE, FIXTURE_HASH), true,
        'the fixture hash must be a real bcrypt hash of the fixture passphrase');
    });
  });

  // ------------------------------------------------- B. cross-tenant attempts

  describe('B. foreign-tenant attempts disclose no credential', () => {
    // DENY-ONLY under the approved R-1 policy: "Other users and foreign-tenant
    // records remain governed by existing #102 authorization and tenant
    // non-disclosure rules." These cases therefore CANNOT reach the projection,
    // and they are asserted as refusals rather than as sanitizer evidence. Each
    // target is first proven to exist, so the refusal is a real denial and not a
    // disguised "the row was absent".
    it('3. an operator of org A reading an org B user', async () => {
      assert.ok(await User.findById(TARGET_B), 'the foreign target must exist for the denial to be meaningful');
      // An operator holds no USERS.VIEW, so the capability gate refuses before
      // the identifier is even looked up - identically for every target.
      const res = await get(`/api/users/${TARGET_B}`, OP_A);
      assertDeniedBeforeProjection(res, 403, 'operator A -> org B user');
    });

    it('4. an administrator of org A reading an org B operator', async () => {
      assert.ok(await User.findById(TARGET_B), 'the foreign target must exist for the denial to be meaningful');
      // An administrator holds USERS.VIEW but not across tenants: the shared
      // `authorizeUserScope` core answers the same 404 an absent record produces.
      const res = await get(`/api/users/${TARGET_B}`, ADMIN_A);
      assertDeniedBeforeProjection(res, 404, 'admin A -> org B operator');
    });

    it('5. an administrator of org A reading the org B administrator', async () => {
      assert.ok(await User.findById(ADMIN_B), 'the foreign target must exist for the denial to be meaningful');
      const res = await get(`/api/users/${ADMIN_B}`, ADMIN_A);
      assertDeniedBeforeProjection(res, 404, 'admin A -> org B admin');
    });

    it('6. the reverse direction: an org B administrator reading an org A user', async () => {
      assert.ok(await User.findById(OP_A), 'the foreign target must exist for the denial to be meaningful');
      const res = await get(`/api/users/${OP_A}`, ADMIN_B);
      assertDeniedBeforeProjection(res, 404, 'admin B -> org A user');
    });
  });

  // ------------------------------------------------- C. own tenant

  describe('C. own-tenant reads disclose no credential and lose no legitimate field', () => {
    it('7. an operator reading its own record (R-1: the sanitizing branch must actually run)', async () => {
      // MISSION #107 / R-1 - the positive, NON-VACUOUS sanitizer witness.
      //
      // HISTORICAL CONTRADICTION, PRESERVED: as accepted, B3-B asserted 200 for
      // this call while #102/R3 test 7 asserted 403 for the SAME call and named a
      // different reason. The OWNER-approved R-1 policy adopts THIS assertion -
      // an authenticated operator may read its own sanitized record - and #102's
      // superseded 403 is recorded verbatim in its own case rather than deleted.
      //
      // A refusal is explicitly NOT accepted here: the call must reach the
      // handler's projection and come back 200 with the positive field set
      // intact, which "blocked before projection" can never produce.
      const rowBefore = await User.findById(OP_A);

      const res = await get(`/api/users/${OP_A}`, OP_A);
      assert.strictEqual(res.status, 200,
        `R-1: the operator's own record must reach the projection: ${redacted(res.text)}`);
      assertNoCredential(res.text, 'operator A -> self', [await storedHash(OP_A)]);

      const user = JSON.parse(res.text).data.user;
      assert.strictEqual(Number(user.id), OP_A);
      assert.ok(String(user.username).startsWith(tag('op-a')));
      assert.strictEqual(Number(user.organization_id), ORG_A);
      assert.strictEqual(user.role, 'operator');
      assert.ok(!('password_hash' in user));

      // The projection RAN and removed exactly the credential fields: every
      // other persisted column survives. A blanket drop, an empty envelope, or a
      // refusal all fail here.
      const expectedKeys = Object.keys(rowBefore).filter((key) => !isSensitiveKey(key));
      assert.ok(expectedKeys.length >= 5,
        'the positive field set must be non-trivial for this to be real sanitizer evidence');
      assert.deepStrictEqual(Object.keys(user).sort(), expectedKeys.sort(),
        'every non-sensitive column must survive; only credential fields may be removed');

      // Non-effect: a read must not alter the row it read.
      const rowAfter = await User.findById(OP_A);
      assert.strictEqual(rowAfter.password_hash, rowBefore.password_hash,
        'an own-record GET must not rotate or clear the stored credential');
    });

    it('7b. the already-approved self-profile path also serves an operator (task-1 survey evidence)', async () => {
      // The task-1 survey found an EXISTING, authenticate-only, self-scoped
      // profile route - `GET /api/auth/profile` (src/routes/auth.routes.js:18 ->
      // `authController.getProfile`), which resolves identity from `req.user.id`
      // and applies `sanitizeUser`. It is exercised here so the survey claim is
      // demonstrated rather than merely asserted in prose. It is NOT the route
      // this mission changed; it is reported as the pre-existing own-profile
      // path and it keeps working unchanged.
      const res = await get('/api/auth/profile', OP_A);
      assert.strictEqual(res.status, 200,
        `the pre-existing self-profile path must serve an operator: ${redacted(res.text)}`);
      assertNoCredential(res.text, 'operator A -> /api/auth/profile', [await storedHash(OP_A)]);

      const user = JSON.parse(res.text).data.user;
      assert.strictEqual(Number(user.id), OP_A, 'the self-profile path must return the principal itself');
      assert.strictEqual(user.role, 'operator');
      assert.ok(!('password_hash' in user), 'the self-profile path must be sanitized');
    });

    it('7c. a spoofed identity cannot retarget the own-record read', async () => {
      // R-1 negatives: a client-supplied user id or organization - in the query
      // string or in the request body - must never address another user. Identity
      // is taken from the AUTHENTICATED PRINCIPAL only.
      const rowBefore = await User.findById(OP_A);

      const viaQuery = await call('GET',
        `/api/users/${OP_A}?id=${TARGET_B}&userId=${TARGET_B}&organization_id=${ORG_B}`,
        { userId: OP_A });
      assert.strictEqual(viaQuery.status, 200,
        `a query-spoofed own-record read must still be the own record: ${redacted(viaQuery.text)}`);
      assert.strictEqual(Number(JSON.parse(viaQuery.text).data.user.id), OP_A,
        'a query-supplied id must not retarget the read');

      const viaBody = await call('GET', `/api/users/${OP_A}`, {
        userId: OP_A,
        body: { id: TARGET_B, userId: TARGET_B, organization_id: ORG_B, role: 'admin' }
      });
      assert.strictEqual(viaBody.status, 200,
        `a body-spoofed own-record read must still be the own record: ${redacted(viaBody.text)}`);
      assert.strictEqual(Number(JSON.parse(viaBody.text).data.user.id), OP_A,
        'a body-supplied id/org must not retarget the read');

      // Naming somebody else in the PATH is not an own-record read, and the
      // unchanged capability gate still refuses it however the query is dressed.
      const foreignTarget = await call('GET',
        `/api/users/${TARGET_B}?id=${OP_A}&organization_id=${ORG_A}`, { userId: OP_A });
      assert.strictEqual(foreignTarget.status, 403,
        'a foreign path target must still be refused regardless of query claims');

      assertNoCredential(viaQuery.text, 'query spoof', [await storedHash(TARGET_B)]);
      assertNoCredential(viaBody.text, 'body spoof', [await storedHash(TARGET_B)]);

      // Non-effect on the caller's own row.
      const rowAfter = await User.findById(OP_A);
      assert.strictEqual(rowAfter.password_hash, rowBefore.password_hash,
        'a spoofed read must not alter the caller row');
    });

    it('8. an administrator reading an own-tenant operator (exact redaction, not a blanket drop)', async () => {
      const res = await get(`/api/users/${OP_FAC_A}`, ADMIN_A);
      assert.strictEqual(res.status, 200, `own-tenant read must succeed: ${redacted(res.text)}`);
      assertNoCredential(res.text, 'admin A -> own-tenant operator', [await storedHash(OP_FAC_A)]);

      const user = JSON.parse(res.text).data.user;
      const before = await User.findById(OP_FAC_A);
      const expectedKeys = Object.keys(before).filter((key) => key !== 'password_hash');
      assert.deepStrictEqual(Object.keys(user).sort(), expectedKeys.sort(),
        'every non-credential column must survive; only password_hash may be removed');
    });

    it('9. the user list carries no credential in any element', async () => {
      const res = await get('/api/users', ADMIN_A);
      assert.strictEqual(res.status, 200, `the list must succeed: ${redacted(res.text)}`);

      const known = [await storedHash(ADMIN_A), await storedHash(OP_A),
        await storedHash(SUP_A), await storedHash(OP_FAC_A)];
      assertNoCredential(res.text, 'admin A -> user list', known);

      const users = JSON.parse(res.text).data.users;
      assert.ok(users.length >= 4, 'the list must contain the org A fixtures');
      for (const user of users) {
        assert.ok(!('password_hash' in user), 'no element may carry password_hash');
        assert.ok(user.username, 'a legitimate identifier must survive');
      }
    });

    it('10. the facility/operator listing carries no credential', async () => {
      const res = await get('/api/users/facility/operators', SUP_A);
      assert.strictEqual(res.status, 200, `the operator listing must succeed: ${redacted(res.text)}`);
      assertNoCredential(res.text, 'supervisor A -> facility operators', [await storedHash(OP_FAC_A)]);

      const users = JSON.parse(res.text).data.users;
      assert.ok(users.length >= 1, 'the facility listing must contain the facility operator');
      assert.ok(!users.some((user) => 'password_hash' in user));
    });

    it('11. the legacy role-shaped permissions view loses no resource key', async () => {
      const res = await get('/api/users/me/permissions', ADMIN_A);
      assert.strictEqual(res.status, 200, `permissions must succeed: ${redacted(res.text)}`);

      const permissions = JSON.parse(res.text).data.permissions;
      assert.ok(Object.keys(permissions).length > 0, 'the permission map must not be emptied');
      // API_KEYS is a real RBAC resource whose NAME resembles a credential. A
      // blanket substring redaction would delete it; this asserts it cannot.
      assert.strictEqual(isSensitiveKey('API_KEYS'), false);
      assertNoCredential(res.text, 'me/permissions', []);
    });
  });

  // ------------------------------------------------- D. absent and malformed

  describe('D. absent and malformed identifiers disclose no credential', () => {
    // DENY-ONLY. An operator holds no USERS.VIEW, so every malformed identifier
    // is refused by the capability gate before the identifier is parsed; the
    // projection is unreachable and these cases therefore carry no sanitizer
    // evidence. They are asserted as refusals with an explicit status.
    for (const raw of ['99999999', '0', '-1', 'abc', '1e5', '%20']) {
      it(`12. identifier "${raw}"`, async () => {
        const res = await get(`/api/users/${encodeURIComponent(raw)}`, OP_A);
        assertDeniedBeforeProjection(res, 403, `malformed identifier "${raw}"`);
      });
    }

    it('12b. an out-of-integer-range identifier discloses no credential and no internals', async () => {
      // CORRECTED COMMENT (the pre-mission text described a 500 with the driver's
      // message). For the operator caller used here the USERS.VIEW gate refuses
      // BEFORE any lookup, so the out-of-range value never reaches the database
      // and the observed status is 403, not 500. What this case owns is that no
      // credential, stack or SQL text is disclosed on the refusal, and that the
      // refusal is not a served projection.
      const res = await get('/api/users/99999999999999999999', OP_A);
      assertDeniedBeforeProjection(res, 403, 'out-of-range identifier');
      assert.ok(!/\bat\s+\/|node_modules|SELECT\s|INSERT\s|password_hash/i.test(res.text),
        `no stack or SQL may be disclosed: ${redacted(res.text)}`);
    });

    it('13. an absent identifier answers 404 and creates no row', async () => {
      const before = Number(await scalar('SELECT count(*)::int FROM users'));
      const res = await get('/api/users/99999999', ADMIN_A);
      assert.strictEqual(res.status, 404, `absent target must be 404: ${redacted(res.text)}`);
      assertNoCredential(res.text, 'absent identifier', [FIXTURE_HASH]);
      const after = Number(await scalar('SELECT count(*)::int FROM users'));
      assert.strictEqual(after, before, 'a read must not create a user row');
    });
  });

  // ------------------------------------------------- E. database effect

  describe('E. the mutating paths assert database effect, and echo no credential', () => {
    it('14. PUT with a new password: no credential in the body, and the stored hash is coherent', async () => {
      const before = await storedHash(OP_FAC_A);
      const res = await put(`/api/users/${OP_FAC_A}`, ADMIN_A, {
        full_name: 'B3B Rotated Name',
        password: ROTATED_PASSPHRASE
      });

      assertNoCredential(res.text, 'PUT /api/users/:id response', [before]);

      // The response must never echo the submitted plaintext either.
      assert.ok(!res.text.includes(ROTATED_PASSPHRASE),
        `the submitted passphrase must never be echoed: ${redacted(res.text)}`);

      const after = await storedHash(OP_FAC_A);
      if (res.status >= 200 && res.status < 300) {
        assert.notStrictEqual(after, before, 'a successful update must change the stored hash');
        assert.ok(BCRYPT_HASH_PATTERN.test(String(after)),
          'the stored value must be a fresh bcrypt hash, never the plaintext');
        assert.strictEqual(bcrypt.compareSync(ROTATED_PASSPHRASE, String(after)), true,
          'the stored hash must correspond to the submitted passphrase');
      } else {
        // The reference implementation of this route raises a ReferenceError
        // before any write (an open finding of the #85/#102 lane, not of this
        // one). Either way the response must disclose nothing and must not have
        // partially applied the change.
        assert.strictEqual(after, before,
          'a failed update must leave the stored credential byte-identical');
      }
    });

    it('15. POST create: no credential in the body, and the row is created with a hash, not plaintext', async () => {
      const before = Number(await scalar('SELECT count(*)::int FROM users WHERE organization_id = $1',
        [ORG_A]));
      const res = await post('/api/users', ADMIN_A, {
        username: tag('created'),
        email: `${tag('created')}@b3b.invalid`,
        password: CREATED_PASSPHRASE,
        full_name: 'B3B Created',
        role: 'operator'
      });

      assertNoCredential(res.text, 'POST /api/users response', [FIXTURE_HASH]);
      assert.ok(!res.text.includes(CREATED_PASSPHRASE),
        `the submitted passphrase must never be echoed: ${redacted(res.text)}`);

      const after = Number(await scalar('SELECT count(*)::int FROM users WHERE organization_id = $1',
        [ORG_A]));
      const created = await scalar('SELECT password_hash FROM users WHERE username = $1', [tag('created')]);

      if (res.status >= 200 && res.status < 300) {
        assert.strictEqual(after, before + 1, 'a successful create must persist exactly one row');
        assert.ok(BCRYPT_HASH_PATTERN.test(String(created)),
          'the persisted credential must be a bcrypt hash, never the plaintext');
        assert.ok(!String(created).includes(CREATED_PASSPHRASE), 'the plaintext must not be stored');
      } else {
        // Seat validation rejects the request in a fixture organization with no
        // active subscription. That is the pre-existing gate, not a disclosure:
        // the assertion that matters is that nothing was written.
        assert.strictEqual(after, before, 'a rejected create must persist no row');
        assert.strictEqual(created, null, 'a rejected create must persist no row');
      }
    });
  });

  // ------------------------------------------------- F. the logging source

  describe('F. a credential-bearing INSERT emits no hash to stdout', () => {
    it('16. the real BaseModel INSERT log carries the operation, not the credential', async () => {
      const username = tag('stdout-probe');
      let createdId = null;

      const output = await captureStdout(async () => {
        await User.create({
          username,
          email: `${username}@b3b.invalid`,
          password_hash: FIXTURE_HASH,
          full_name: 'B3B Stdout Probe',
          role: 'operator',
          organization_id: ORG_A,
          is_active: true
        });
        createdId = await scalar('SELECT id FROM users WHERE username = $1', [username]);
      });

      assert.ok(!output.includes(FIXTURE_HASH), 'no bcrypt hash may reach stdout');
      assert.ok(!BCRYPT_HASH_PATTERN.test(output), 'no bcrypt-shaped value may reach stdout');

      // Preserved, non-sensitive evidence that operators rely on.
      assert.ok(output.includes('INSERT users'), 'the operation and table must still be logged');
      assert.ok(/param\(s\)/.test(output), 'the parameter count must still be logged');
      assert.ok(output.includes(username), 'a non-credential identifier must still be logged');
      assert.ok(output.includes('operator'), 'a non-credential value must still be logged');
      assert.ok(output.includes('[REDACTED]'), 'the withheld position must be visible as withheld');

      // Database effect: the credential really was written - so the absence of a
      // hash in the log is a redaction, not an aborted statement.
      assert.ok(createdId, 'the credential-bearing INSERT must have persisted a row');
      const stored = await storedHash(createdId);
      assert.ok(BCRYPT_HASH_PATTERN.test(String(stored)),
        'the persisted row must hold the bcrypt hash that the log withheld');
    });
  });
});
