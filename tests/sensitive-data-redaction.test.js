/**
 * ATM-001-SEC-B3B — sensitive-data redaction primitives.
 *
 * Two coupled guarantees, both proved without a database:
 *
 *   1. RESPONSE redaction: `sanitizeUser` / `redactSensitiveFields` remove
 *      credential material from an arbitrary response envelope, at any depth,
 *      without mutating the caller's object and without over-redacting a
 *      permission resource key that merely resembles a credential name.
 *      The pre-fix `sanitizeUser` was a single-field destructure
 *      (`const { password_hash, ...rest } = user`) that left a credential inside
 *      a nested envelope untouched and threw a TypeError on a null input.
 *
 *   2. LOG redaction: `BaseModel.query` no longer prints bind parameters
 *      verbatim. `redactSensitiveParams` / `boundParamNames` withhold a value
 *      whose bound column name is credential-adjacent, or whose value has the
 *      shape of a credential, while preserving the evidence an operator needs:
 *      the operation and table, the parameter count, the null-coercion outcome
 *      and every non-credential value.
 *
 * These are NON-database tests: `BaseModel.query` is driven through a stubbed
 * pool and stdout is captured, so they run in the default `npm test` suite and
 * need no integration gate.
 *
 * Credential-looking values below are synthetic and are never printed by this
 * suite: every assertion message that could quote one passes it through
 * `redacted()` first.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const BaseModel = require('../src/models/base.model');
const {
  sanitizeUser,
  redactSensitiveFields,
  isSensitiveField,
  looksLikeCredentialValue,
  boundParamNames,
  redactSensitiveParams,
  describeStatement,
  redactCredentialText,
  REDACTED
} = require('../src/utils/helpers');
const { errorHandler } = require('../src/middleware/error-handler');

// A structurally valid bcrypt hash for a passphrase that exists nowhere. It is
// synthetic test data, not a credential for any account.
const SYNTHETIC_BCRYPT = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
const SYNTHETIC_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJl';
const SYNTHETIC_OPAQUE = 'Zx7Kq2Lm9Pq4Rt6Vw8Yz1Ab3Cd5Ef7Gh9Ij2Kl4Mn6P';

/** Never let a credential-shaped value reach a test report. */
const redacted = (value) => String(value)
  .replace(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g, '[REDACTED-HASH]')
  .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}[A-Za-z0-9_.-]*/g, '[REDACTED-TOKEN]')
  .replace(/[A-Za-z0-9_-]{40,}/g, '[REDACTED-OPAQUE]');

/**
 * Capture the application's own log stream for the duration of `fn`, so describe
 * E can assert what `BaseModel.query` really emits.
 *
 * ATM-001-SEC-107-TA05 — why this patches `console.log` and no longer touches
 * `process.stdout.write`:
 *
 * The two previous revisions of this helper replaced `process.stdout.write` and
 * tried to separate protocol traffic from application traffic by chunk type:
 * forward a `Buffer`, withhold a `String`. That discriminator is not a contract.
 * Under `node --test` this file runs in a CHILD process and node:test delivers its
 * results to the parent on that same stream — as V8-serialized protocol frames
 * (`test:enqueue` / `test:dequeue` / `test:pass` / `test:fail` / `test:complete`)
 * on `NODE_TEST_CONTEXT='child-v8'`, but as TAP **text** frames on Node 20.0.0,
 * while `package.json` declares `engines.node >=18.0.0`. A withheld frame is a
 * lost result: the leaf still executes, the run still reports green, and the
 * assertion is never witnessed — a false PASS, which is strictly worse than the
 * loud failure the frame-swallowing originally caused.
 *
 * The capture therefore never touches the runner's channel. Every call site this
 * suite asserts on logs through the console interface — `BaseModel.query` via
 * `console.log` (src/models/base.model.js:78) — so patching `console.log` captures
 * exactly the intended messages and leaves `process.stdout.write` free for the
 * runner in whatever encoding it uses. `captureStderr` below (unchanged) does the
 * same for `console.error`, which is what `errorHandler` uses
 * (src/middleware/error-handler.js:19).
 *
 * Captured text is withheld from the harness output for the duration of the
 * capture, exactly as before, and the original is restored in `finally`, so a
 * throwing capture cannot leak the patch and `fn`'s error still propagates.
 * Non-vacuity is carried by cases 13-17 themselves: each requires the captured
 * text to contain the operation, the table, the parameter count and the withheld
 * marker, so an empty capture fails loudly instead of passing silently.
 */
const captureStdout = async (fn) => {
  const chunks = [];
  const original = console.log;
  console.log = (...args) => {
    chunks.push(args.map(String).join(' '));
  };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return chunks.join('\n');
};

// ===========================================================================

describe('ATM-001-SEC-B3B sensitive-data redaction', () => {
  describe('A. the credential field predicate', () => {
    it('1. matches a credential word that is a delimited segment of the name', () => {
      for (const name of ['password_hash', 'password', 'reset_token', 'client_secret',
        'api_key_hash', 'refresh_token', 'password_expires_at']) {
        assert.strictEqual(isSensitiveField(name), true, `${name} must be withheld`);
      }
    });

    it('2. does not mistake a permission resource key for a credential', () => {
      // `API_KEYS` is a real RBAC resource in this codebase. A blanket substring
      // match on "api_key" would delete it from every capability response.
      for (const name of ['API_KEYS', 'api_keys', 'apikeys', 'id', 'username', 'email',
        'organization_id', 'facility_id', 'role', 'capabilities', 'permissions']) {
        assert.strictEqual(isSensitiveField(name), false, `${name} must survive redaction`);
      }
    });
  });

  describe('B. deep response redaction', () => {
    it('3. removes the credential from a flat row without mutating the input', () => {
      const row = { id: 7, username: 'u', password_hash: SYNTHETIC_BCRYPT };
      const out = sanitizeUser(row);

      assert.ok(!('password_hash' in out), 'password_hash must be gone');
      assert.strictEqual(out.id, 7);
      assert.strictEqual(out.username, 'u');
      assert.strictEqual(row.password_hash, SYNTHETIC_BCRYPT,
        'the caller-owned row must not be mutated');
    });

    it('4. reaches a credential nested inside an envelope and inside an array', () => {
      const envelope = {
        success: true,
        data: {
          user: { id: 1, password_hash: SYNTHETIC_BCRYPT },
          users: [
            { id: 2, password_hash: SYNTHETIC_BCRYPT, nested: { reset_token: SYNTHETIC_TOKEN } }
          ]
        }
      };
      const out = redactSensitiveFields(envelope);

      assert.deepStrictEqual(out.data.user, { id: 1 });
      assert.strictEqual(out.data.users[0].id, 2);
      assert.deepStrictEqual(out.data.users[0].nested, {},
        'the nested container survives, emptied of the withheld token');
      assert.ok(!JSON.stringify(out).includes('eyJ'),
        'no token material may remain anywhere in the redacted envelope');
      assert.strictEqual(envelope.data.users[0].password_hash, SYNTHETIC_BCRYPT,
        'the input envelope must not be mutated');
    });

    it('5. tolerates null and undefined instead of throwing', () => {
      // The pre-fix implementation destructured its argument and threw a
      // TypeError on null, which turned a 404 path into a 500.
      assert.strictEqual(sanitizeUser(null), null);
      assert.strictEqual(sanitizeUser(undefined), undefined);
      assert.deepStrictEqual(redactSensitiveFields([]), []);
    });

    it('6. passes a Date and a Buffer through unchanged', () => {
      const when = new Date('2026-01-01T00:00:00.000Z');
      const buf = Buffer.from('x');
      const out = sanitizeUser({ id: 3, created_at: when, blob: buf });
      assert.strictEqual(out.created_at, when);
      assert.strictEqual(out.blob, buf);
    });
  });

  describe('C. credential value shapes', () => {
    it('7. recognises a bcrypt hash, a JWT and a long opaque secret', () => {
      assert.strictEqual(looksLikeCredentialValue(SYNTHETIC_BCRYPT), true);
      assert.strictEqual(looksLikeCredentialValue(SYNTHETIC_TOKEN), true);
      assert.strictEqual(looksLikeCredentialValue(SYNTHETIC_OPAQUE), true);
    });

    it('8. does not treat ordinary values as credentials', () => {
      for (const value of [3608, null, true, 'admin', 'operator', 'a short note', '']) {
        assert.strictEqual(looksLikeCredentialValue(value), false,
          `ordinary value must stay loggable: ${redacted(value)}`);
      }
    });
  });

  describe('D. bind-parameter naming', () => {
    it('9. maps an INSERT column list onto its placeholders', () => {
      const sql = 'INSERT INTO users (username, email, password_hash, full_name, role) '
        + 'VALUES (?, ?, ?, ?, ?)';
      assert.deepStrictEqual(boundParamNames(sql, 5),
        ['username', 'email', 'password_hash', 'full_name', 'role']);
    });

    it('10. maps UPDATE SET and WHERE without confusing the two', () => {
      // The regression this guards: a WHERE scan that restarts its own counter
      // attributes `id` to the position the SET clause already consumed, and
      // redacts the identifier instead of the credential.
      const sql = 'UPDATE users SET password_hash = ?, full_name = ? WHERE id = ?';
      assert.deepStrictEqual(boundParamNames(sql, 3), ['password_hash', 'full_name', 'id']);
      assert.deepStrictEqual(redactSensitiveParams(sql, [SYNTHETIC_BCRYPT, 'Full Name', 42]),
        [REDACTED, 'Full Name', 42]);
    });

    it('11. covers an IN list and leaves an unnamed LIMIT placeholder null', () => {
      const sql = 'SELECT * FROM users WHERE id IN (?, ?) AND organization_id = ? LIMIT ?';
      assert.deepStrictEqual(boundParamNames(sql, 4), ['id', 'id', 'organization_id', null]);
      assert.deepStrictEqual(redactSensitiveParams(sql, [1, 2, 986, 3]), [1, 2, 986, 3]);
    });

    it('12. describes the statement without any parameter value', () => {
      assert.strictEqual(describeStatement('SELECT * FROM users WHERE id = ?'), 'SELECT users');
      assert.strictEqual(describeStatement('INSERT INTO users (a) VALUES (?)'), 'INSERT users');
      assert.strictEqual(describeStatement('UPDATE users SET a = ? WHERE id = ?'), 'UPDATE users');
      assert.strictEqual(describeStatement('DELETE FROM users WHERE id = ?'), 'DELETE users');
    });
  });

  describe('E. what BaseModel.query actually emits to stdout', () => {
    const runQuery = async (sql, params) => {
      const model = new BaseModel('probe_table');
      const originalExecute = model.pool.execute;
      model.pool.execute = async () => [[], {}];
      try {
        return await captureStdout(() => model.query(sql, params));
      } finally {
        model.pool.execute = originalExecute;
      }
    };

    it('13. a credential-bearing INSERT prints no hash, and keeps the operator evidence', async () => {
      const sql = 'INSERT INTO users (username, email, password_hash, full_name, role, '
        + 'organization_id, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)';
      const params = ['b3b-unit-user', 'b3b-unit@invalid', SYNTHETIC_BCRYPT, 'Unit User',
        'operator', 986, true];

      const output = await runQuery(sql, params);

      assert.ok(!output.includes(SYNTHETIC_BCRYPT), 'no bcrypt hash may reach stdout');
      assert.ok(!output.includes('password_hash":'), 'no credential VALUE may be printed');

      // Preserved evidence: the operation and table, the parameter count, and
      // every non-credential value.
      assert.ok(output.includes('INSERT users'), 'the operation and table must be logged');
      assert.ok(output.includes('7 param(s)'), 'the parameter count must be logged');
      assert.ok(output.includes('b3b-unit-user'), 'a non-credential value must still be logged');
      assert.ok(output.includes('operator'), 'a non-credential value must still be logged');
      assert.ok(output.includes('986'), 'a non-credential value must still be logged');
      assert.ok(output.includes(REDACTED), 'the withheld position must be visible as withheld');
    });

    it('14. a credential-bearing UPDATE prints no hash, and keeps the identifier', async () => {
      const sql = 'UPDATE users SET password_hash = ?, full_name = ? WHERE id = ?';
      const output = await runQuery(sql, [SYNTHETIC_BCRYPT, 'Unit User', 4242]);

      assert.ok(!output.includes(SYNTHETIC_BCRYPT), 'no bcrypt hash may reach stdout');
      assert.ok(output.includes('UPDATE users'), 'the operation and table must be logged');
      assert.ok(output.includes('4242'), 'the non-credential identifier must still be logged');
      assert.ok(output.includes('"Unit User"'), 'the non-credential value must still be logged');
    });

    it('15. a credential in an unrecognised column is caught by its value shape', async () => {
      // A raw query whose SQL never names the column: only shape detection can
      // save this, which is why it is present.
      const output = await runQuery('SELECT * FROM users WHERE some_col = ?', [SYNTHETIC_BCRYPT]);

      assert.ok(!output.includes(SYNTHETIC_BCRYPT),
        'a credential-shaped value must be withheld even when its column is unnamed');
      assert.ok(output.includes('SELECT users'));
    });

    it('16. a token bound to a token column never reaches stdout', async () => {
      const output = await runQuery(
        'SELECT * FROM invitations WHERE token = ? AND status = ?',
        [SYNTHETIC_OPAQUE + 'TOKENVALUE', 'pending']);

      assert.ok(!output.includes(SYNTHETIC_OPAQUE), 'no token may reach stdout');
      assert.ok(output.includes('"pending"'), 'the non-credential filter must still be logged');
    });

    it('17. a statement that carries no credential is logged in full', async () => {
      const output = await runQuery('SELECT * FROM users WHERE id = ?', [7]);
      assert.ok(output.includes('SELECT users'));
      assert.ok(output.includes('1 param(s)'));
      assert.ok(output.includes('7'), 'an ordinary read keeps its diagnostic value');
      assert.ok(!output.includes(REDACTED), 'nothing is withheld when nothing is sensitive');
    });
  });

  describe('F. what the error handler emits to stdout', () => {
    const captureStderr = async (fn) => {
      const chunks = [];
      const original = console.error;
      console.error = (...args) => { chunks.push(args.map(String).join(' ')); };
      try {
        await fn();
      } finally {
        console.error = original;
      }
      return chunks.join('\n');
    };

    const drive = (err) => captureStderr(() => new Promise((resolve) => {
      errorHandler(err, { path: '/api/probe', headers: {} }, { status: () => ({ json: () => resolve() }) }, () => resolve());
    }));

    it('18. a driver error that echoes a credential does not print it', async () => {
      // Reproduces the real `pg` behaviour: a failed cast reports the offending
      // value inside the message.
      const err = new Error(`invalid input syntax for type integer: "${SYNTHETIC_BCRYPT}"`);
      err.code = '22P02';
      err.statusCode = 500;

      const output = await drive(err);

      assert.ok(!output.includes(SYNTHETIC_BCRYPT),
        'a credential echoed by the driver must not reach stdout');
      // Preserved evidence: the error's identity and code are what an operator
      // actually diagnoses from.
      assert.ok(output.includes('22P02'), 'the driver code must still be logged');
      assert.ok(output.includes('invalid input syntax'), 'the error text must still be logged');
      assert.ok(output.includes(REDACTED), 'the withheld position must be visible as withheld');
    });

    it('19. a token in an error field does not reach stdout', async () => {
      const err = new Error('request failed');
      err.detail = `token=${SYNTHETIC_TOKEN}`;
      const output = await drive(err);
      assert.ok(!output.includes(SYNTHETIC_TOKEN), 'no token may reach stdout');
      assert.ok(output.includes('request failed'), 'the error text must still be logged');
    });

    it('20. redactCredentialText leaves ordinary diagnostic text intact', () => {
      const text = 'Error: column "password_reset_token" of relation "users" does not exist';
      assert.strictEqual(redactCredentialText(text), text,
        'a column NAME is not a credential and must not be masked');
    });

    it('21. a credential echoed in an error message does not leave in the response body', async () => {
      const err = new Error(`invalid input syntax for type integer: "${SYNTHETIC_BCRYPT}"`);
      err.code = '22P02';
      err.statusCode = 500;

      let body = null;
      await new Promise((resolve) => {
        errorHandler(err, { path: '/api/probe', headers: {} }, {
          status: () => ({ json: (payload) => { body = payload; resolve(); } })
        }, () => resolve());
      });

      assert.ok(body, 'the API error response must have been produced');
      assert.ok(!body.message.includes(SYNTHETIC_BCRYPT),
        'a credential echoed by the driver must not reach the response body');
      assert.ok(body.message.includes(REDACTED),
        'the withheld position must be visible as withheld in the response');
      assert.strictEqual(body.success, false, 'the error envelope must be preserved');
    });
  });
});
