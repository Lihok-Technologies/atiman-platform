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
    it('3. an operator of org A reading an org B user', async () => {
      const res = await get(`/api/users/${TARGET_B}`, OP_A);
      assert.notStrictEqual(res.status, 500, `threw a server error: ${redacted(res.text)}`);
      assertNoCredential(res.text, 'operator A -> org B user', [await storedHash(TARGET_B)]);

      if (res.status === 200) {
        const body = JSON.parse(res.text);
        assert.strictEqual(Number(body.data.user.id), TARGET_B,
          'the assertion must be exercised against the real foreign row');
        assert.ok(String(body.data.user.username).startsWith(tag('target-b')),
          'the assertion must be exercised against the real foreign row');
      }
    });

    it('4. an administrator of org A reading an org B operator', async () => {
      const res = await get(`/api/users/${TARGET_B}`, ADMIN_A);
      assert.notStrictEqual(res.status, 500, `threw a server error: ${redacted(res.text)}`);
      assertNoCredential(res.text, 'admin A -> org B operator', [await storedHash(TARGET_B)]);
    });

    it('5. an administrator of org A reading the org B administrator', async () => {
      const res = await get(`/api/users/${ADMIN_B}`, ADMIN_A);
      assert.notStrictEqual(res.status, 500, `threw a server error: ${redacted(res.text)}`);
      assertNoCredential(res.text, 'admin A -> org B admin', [await storedHash(ADMIN_B)]);
    });

    it('6. the reverse direction: an org B administrator reading an org A user', async () => {
      const res = await get(`/api/users/${OP_A}`, ADMIN_B);
      assert.notStrictEqual(res.status, 500, `threw a server error: ${redacted(res.text)}`);
      assertNoCredential(res.text, 'admin B -> org A user', [await storedHash(OP_A)]);
    });
  });

  // ------------------------------------------------- C. own tenant

  describe('C. own-tenant reads disclose no credential and lose no legitimate field', () => {
    it('7. an operator reading its own record', async () => {
      const res = await get(`/api/users/${OP_A}`, OP_A);
      assert.strictEqual(res.status, 200, `own record must be readable: ${redacted(res.text)}`);
      assertNoCredential(res.text, 'operator A -> self', [await storedHash(OP_A)]);

      const user = JSON.parse(res.text).data.user;
      assert.strictEqual(Number(user.id), OP_A);
      assert.ok(String(user.username).startsWith(tag('op-a')));
      assert.strictEqual(Number(user.organization_id), ORG_A);
      assert.strictEqual(user.role, 'operator');
      assert.ok(!('password_hash' in user));
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
    for (const raw of ['99999999', '0', '-1', 'abc', '1e5', '%20']) {
      it(`12. identifier "${raw}"`, async () => {
        const res = await get(`/api/users/${encodeURIComponent(raw)}`, OP_A);
        assert.notStrictEqual(res.status, 500,
          `a malformed identifier must not raise a server error: ${redacted(res.text)}`);
        assertNoCredential(res.text, `malformed identifier "${raw}"`, [FIXTURE_HASH]);
      });
    }

    it('12b. an out-of-integer-range identifier discloses no credential and no internals', async () => {
      // Pre-existing and NOT remediated here: parseInt("99999999999999999999")
      // yields a value outside the PostgreSQL INTEGER range, so the lookup raises
      // a database error and the route answers 500 with the driver's message.
      // That is the identifier-normalisation concern owned by the
      // ATM-001-SEC-LEGACY-01 lane (#85 `canViewUser` rejects an out-of-range
      // identifier before the lookup). What this mission owns - and asserts - is
      // that the response carries no credential, no stack and no SQL text.
      const res = await get('/api/users/99999999999999999999', OP_A);
      assertNoCredential(res.text, 'out-of-range identifier', [FIXTURE_HASH]);
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
