/**
 * BaseModel.create() insert-result regression test (ATM-001-SEC-107 D-1).
 *
 * The reported defect: `create()` ran `INSERT ... VALUES (...)` with no
 * `RETURNING` clause, read the generated key from `result.insertId`, and with
 * the PostgreSQL driver no row is returned for such a statement, so `insertId`
 * was null, `findById(null)` matched nothing and `create()` returned null AFTER
 * the row had committed. `InvitationModel.createInvitation` then threw
 * `Cannot read properties of null (reading 'id')`.
 *
 * These cases are NON-DESTRUCTIVE: no PostgreSQL connection is opened. The
 * instance's `pool` is replaced with a fake whose results are produced by the
 * REAL `normalizeResult()` from src/config/database.js, so the assertions run
 * against the same result-shape translation the runtime uses, without a
 * database. Database-backed proof of the fix is a separate, gated run.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const BaseModel = require('../src/models/base.model');
const Invitation = require('../src/models/invitation.model');
const { _translate } = require('../src/config/database');

const { normalizeResult } = _translate;

/**
 * Point a model at a fake pool that answers through the production normalizer.
 *
 * `pgResultFor(sql, params)` returns the raw `pg` Result shape
 * (`{ rows, rowCount }`) that the statement would produce.
 */
const modelWithFakePg = (model, pgResultFor, calls = []) => {
  model.pool = {
    execute: async (sql, params) => {
      calls.push({ sql, params });
      const pgResult = await pgResultFor(sql, params);
      return normalizeResult(pgResult, sql);
    }
  };
  return model;
};

const insertResult = (id) => ({ rows: [{ id }], rowCount: 1 });
const selectResult = (rows) => ({ rows, rowCount: rows.length });

/**
 * The raw `pg` Result an INSERT actually produces: PostgreSQL only returns a row
 * when the statement has a RETURNING clause, so this is what makes the case
 * collapse on the pre-fix code if the clause is absent.
 */
const pgInsert = (sql, id) => (
  /RETURNING\s+id/i.test(sql) ? insertResult(id) : { rows: [], rowCount: 1 }
);

describe('BaseModel.create() reports and returns the committed row', () => {
  it('issues RETURNING id and returns the row read back by that id', async () => {
    const calls = [];
    // Deliberately different from the input: proves the result is the persisted
    // row (including database-applied defaults), not an echo of the argument.
    const persisted = {
      id: 42,
      organization_id: 8,
      email: 'invitee@b3b.invalid',
      role: 'operator',
      token: 'token-value',
      status: 'pending',
      created_at: '2026-10-17T04:01:18.845Z'
    };

    const model = modelWithFakePg(new BaseModel('invitations'), async (sql) => (
      /^\s*INSERT/i.test(sql) ? pgInsert(sql, 42) : selectResult([persisted])
    ), calls);

    const created = await model.create({ email: 'invitee@b3b.invalid' });

    assert.match(calls[0].sql, /^\s*INSERT INTO invitations\b/i);
    assert.match(calls[0].sql, /RETURNING\s+id\s*$/i,
      'the INSERT must ask PostgreSQL for the generated key');
    assert.strictEqual(calls.length, 2, 'exactly one INSERT and one read-back');
    assert.strictEqual(calls[1].sql, 'SELECT * FROM invitations WHERE id = ?');
    assert.deepStrictEqual(calls[1].params, [42],
      'the read-back must use the id the INSERT reported, never null');
    assert.deepStrictEqual(created, persisted);
  });

  it('is non-vacuous: without RETURNING the adapter reports no id at all', async () => {
    // This is the pre-fix root cause, reproduced through the production
    // normalizer: a `pg` INSERT without RETURNING yields rows: [], so the
    // mysql2-style result carries insertId: null.
    const [rows] = normalizeResult({ rows: [], rowCount: 1 }, 'INSERT INTO users (username) VALUES (?)');
    assert.strictEqual(rows.insertId, null,
      'an INSERT without RETURNING cannot report an insertId');

    const [withReturning] = normalizeResult(insertResult(42), 'INSERT INTO users (username) VALUES (?) RETURNING id');
    assert.strictEqual(withReturning.insertId, 42,
      'RETURNING id is what makes the generated key observable');
  });

  it('throws instead of returning null when no generated id is reported', async () => {
    const calls = [];
    // Simulates the adapter shape if RETURNING stopped returning a row: the row
    // committed, but nothing reports its id.
    const model = modelWithFakePg(new BaseModel('invitations'), async () => ({ rows: [], rowCount: 1 }), calls);

    await assert.rejects(
      () => model.create({ email: 'x@y.invalid' }),
      /INSERT INTO invitations completed without reporting a generated id/
    );
    assert.strictEqual(calls.length, 1,
      'a create with no observable id must not read back with a null id');
  });

  it('propagates an INSERT failure without attempting a read-back', async () => {
    const calls = [];
    const boom = new Error('duplicate key value violates unique constraint "users_username_key"');
    const model = new BaseModel('users');
    model.pool = {
      execute: async (sql) => { calls.push(sql); throw boom; }
    };

    await assert.rejects(() => model.create({ username: 'taken' }), (error) => error === boom);
    assert.strictEqual(calls.length, 1, 'a failed INSERT must not be followed by a read');
  });
});

describe('BaseModel.create() result and credential boundaries', () => {
  const userRow = {
    id: 7,
    organization_id: 8,
    username: 'created-by-admin',
    email: 'created@b3b.invalid',
    password_hash: '$2b$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    role: 'operator'
  };

  it('withholds password_hash from the created row but not from read accessors', async () => {
    const model = modelWithFakePg(new BaseModel('users'), async (sql) => (
      /^\s*INSERT/i.test(sql) ? pgInsert(sql, 7) : selectResult([userRow])
    ));

    const created = await model.create({ username: 'created-by-admin', password_hash: 'hash' });

    assert.strictEqual(created.id, 7);
    assert.strictEqual(created.username, 'created-by-admin');
    assert.ok(!Object.prototype.hasOwnProperty.call(created, 'password_hash'),
      'create() must not return the bcrypt credential to an HTTP boundary');
    assert.notStrictEqual(created, userRow, 'the persisted row must not be mutated in place');

    // login and changePassword read the credential through the read accessors.
    const found = await model.findById(7);
    assert.strictEqual(found.password_hash, userRow.password_hash,
      'findById must still expose password_hash for credential verification');
  });

  it('makes InvitationModel.createInvitation return the persisted id', async () => {
    const invitation = modelWithFakePg(Invitation, async (sql, params) => {
      if (/^\s*INSERT/i.test(sql)) return pgInsert(sql, 101);
      // A read only matches the row when it is given the row's real id. This is
      // what makes the case fail on the pre-fix code, where the read receives null.
      return params[0] === 101
        ? selectResult([{
          id: 101,
          organization_id: 8,
          email: 'invitee@b3b.invalid',
          role: 'operator',
          token: 'persisted-token',
          status: 'pending'
        }])
        : selectResult([]);
    });

    const created = await invitation.createInvitation({
      organization_id: 8,
      email: 'Invitee@B3B.invalid',
      role: 'operator',
      invited_by: 78
    });

    assert.strictEqual(created.id, 101,
      'the reported D-1 failure was result.id on null in createInvitation');
    assert.strictEqual(created.token.length, 64,
      'the token the administrator delivers is still returned');
    assert.strictEqual(created.email, 'invitee@b3b.invalid',
      'the existing createInvitation contract (normalised email) is preserved');
  });
});
