/**
 * ATM-001-SEC-107-D2 — seat-count alias and integer type on PostgreSQL.
 *
 * THE DEFECT
 *
 * getSeatUsage() counted billable seats with
 *
 *     SELECT COUNT(*) as activeBillableUsers ...
 *
 * and read the result as `result[0].activeBillableUsers`. On PostgreSQL that
 * fails twice: an unquoted identifier is folded to lower case, so the key is
 * `activebillableusers`, and COUNT(*) is bigint, which pg-types returns as a
 * STRING. The reader therefore saw `undefined`, and the derived
 * `Math.max(0, totalAllowed - undefined)` became NaN.
 *
 * WHY THIS SUITE EXISTS AS A DATABASE TEST
 *
 * A mocked pool can return any key it likes, so a mock passes against the
 * buggy SQL. The alias and type behaviour is a property of the PostgreSQL
 * wire result and pg-types, so this suite executes the real service against a
 * real PostgreSQL server through the real runtime adapter
 * (src/config/database.js -> pg). Nothing about the seat count is faked.
 *
 * EVIDENCE POLICY
 *
 *  - The query the service ACTUALLY executes is captured from the live
 *    `pool.execute` call and re-executed on a fresh client, so the asserted
 *    field name and JavaScript type belong to the production SQL, not to a
 *    copy of it in this file.
 *  - The legacy expression is executed too (non-vacuity control), proving the
 *    assertion discriminates: the pre-fix form yields a folded alias and a
 *    string, and the reader yields undefined / NaN.
 *  - Zero and non-zero counts are both checked against real rows, and the
 *    existing seat-limit enforcement (canAddUser / getAvailableSeats) is
 *    checked at, below and above the limit.
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * src/config/database.js uses to select TEST_DB_* credentials, so it can never
 * run against runtime DB_ / PG_ configuration. Fixtures are deleted afterwards.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { Client } = require('pg');
const { pool, isIntegrationTest } = require('../src/config/database');
const { prepareQuery } = require('../src/utils/sql-translator');
const subscriptionService = require('../src/services/subscription.service');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating seat-count suite requires the sanctioned database-test '
    + 'gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that test-database '
    + 'credentials are used instead of runtime credentials; run it via '
    + '`npm run test:integration`';

/** The disposable server this suite drives. Comes from TEST_DB_* only. */
const SERVER = {
  host: process.env.TEST_DB_HOST,
  port: Number(process.env.TEST_DB_PORT),
  database: process.env.TEST_DB_NAME,
  user: process.env.TEST_DB_USER,
  password: process.env.TEST_DB_PASSWORD
};

const client = () => new Client({ ...SERVER, connectionTimeoutMillis: 5000 });

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// Fixture identities are generated per run so a long-lived disposable database
// is safe to reuse and a previous run's rows can never be mistaken for these.
const fixtures = {
  zero: { org: null, plan: null, sub: null, expected: 0, allowed: 5 },
  mixed: { org: null, plan: null, sub: null, expected: 3, allowed: 5 },
  atLimit: { org: null, plan: null, sub: null, expected: 2, allowed: 2 },
  overLimit: { org: null, plan: null, sub: null, expected: 3, allowed: 2 }
};

const created = [];

async function insertOrganization(db, label) {
  const result = await db.query(
    'INSERT INTO organizations (organization_name) VALUES ($1) RETURNING id',
    [`SEC-107-D2 ${label} ${RUN}`]
  );
  const id = Number(result.rows[0].id);
  created.push(['organizations', id]);
  return id;
}

async function insertPlan(db, label, allowed) {
  const result = await db.query(
    `INSERT INTO subscription_plans
       (plan_code, plan_name, included_users, max_users, base_price,
        price_per_additional_user, is_active)
     VALUES ($1, $2, $3, $4, 0, 0, TRUE)
     RETURNING id`,
    [`sec107_d2_${label}_${RUN}`, `SEC-107-D2 ${label} ${RUN}`, allowed, allowed]
  );
  const id = Number(result.rows[0].id);
  created.push(['subscription_plans', id]);
  return id;
}

async function insertSubscription(db, organizationId, planId, allowed) {
  const result = await db.query(
    `INSERT INTO organization_subscriptions
       (organization_id, plan_id, included_users, extra_users, max_users,
        base_price, price_per_additional_user, status, billing_cycle)
     VALUES ($1, $2, $3, 0, $4, 0, 0, 'active', 'monthly')
     RETURNING id`,
    [organizationId, planId, allowed, allowed]
  );
  const id = Number(result.rows[0].id);
  created.push(['organization_subscriptions', id]);
  return id;
}

async function insertUser(db, organizationId, label, status, isBillable) {
  const result = await db.query(
    `INSERT INTO users
       (username, email, password_hash, full_name, status, is_billable,
        is_active, organization_id)
     VALUES ($1, $2, 'not-a-credential', $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      `sec107d2_${label}_${RUN}`,
      `sec107d2_${label}_${RUN}@example.invalid`,
      `SEC-107-D2 ${label}`,
      status,
      isBillable,
      status !== 'archived',
      organizationId
    ]
  );
  const id = Number(result.rows[0].id);
  created.push(['users', id]);
  return id;
}

async function seed(fixture, label, users) {
  const db = client();
  await db.connect();
  try {
    await db.query('BEGIN');
    fixture.org = await insertOrganization(db, label);
    fixture.plan = await insertPlan(db, label, fixture.allowed);
    fixture.sub = await insertSubscription(db, fixture.org, fixture.plan, fixture.allowed);
    for (const [userLabel, status, billable] of users) {
      await insertUser(db, fixture.org, `${label}_${userLabel}`, status, billable);
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
}

/**
 * Capture the exact SQL text and parameters the live service hands to
 * `pool.execute`, then let the real call proceed unchanged.
 */
async function captureSeatCountQuery(organizationId) {
  const originalExecute = pool.execute;
  let captured = null;
  pool.execute = async function (sql, params = []) {
    if (typeof sql === 'string'
      && /COUNT\(\*\)/.test(sql)
      && /activeBillableUsers/.test(sql)) {
      captured = { sql, params };
    }
    return originalExecute.call(this, sql, params);
  };
  try {
    const usage = await subscriptionService.getSeatUsage(organizationId);
    return { usage, captured };
  } finally {
    pool.execute = originalExecute;
  }
}

/**
 * Execute a captured (MySQL-placeholder) query on a fresh PostgreSQL client and
 * return the raw pg result, including the field metadata.
 */
async function executeCaptured(captured) {
  const { sql, params } = prepareQuery(captured.sql, captured.params);
  const db = client();
  await db.connect();
  try {
    return await db.query(sql, params);
  } finally {
    await db.end();
  }
}

/** The pre-fix expression, verbatim apart from the placeholder form. */
const LEGACY_SQL = `
  SELECT COUNT(*) as activeBillableUsers
  FROM users
  WHERE organization_id = $1
  AND is_billable = TRUE
  AND status IN ('active', 'invited')`;

describe('ATM-001-SEC-107-D2 seat count (PostgreSQL)', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => {
    await seed(fixtures.zero, 'zero', []);
    await seed(fixtures.mixed, 'mixed', [
      ['active_a', 'active', true],
      ['active_b', 'active', true],
      ['invited_c', 'invited', true],
      ['nonbillable', 'active', false],
      ['suspended_e', 'suspended', true],
      ['archived_f', 'archived', true]
    ]);
    await seed(fixtures.atLimit, 'atlimit', [
      ['seat_1', 'active', true],
      ['seat_2', 'active', true]
    ]);
    await seed(fixtures.overLimit, 'overlimit', [
      ['over_1', 'active', true],
      ['over_2', 'active', true],
      ['over_3', 'active', true]
    ]);
  });

  after(async () => {
    const db = client();
    await db.connect();
    try {
      for (const [table, id] of created.reverse()) {
        await db.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
      }
    } finally {
      await db.end();
    }
    // The service pool belongs to this process only; close it so the run does
    // not wait for the pool's idle timeout.
    await pool.end();
  });

  it('zero billable users: alias key is present, value is the integer 0', async () => {
    const usage = await subscriptionService.getSeatUsage(fixtures.zero.org);

    assert.strictEqual(typeof usage.activeUsers, 'number',
      'activeUsers must be a JavaScript number, not a bigint string');
    assert.ok(Number.isInteger(usage.activeUsers));
    assert.strictEqual(usage.activeUsers, 0, 'COUNT(*) always returns a row, so zero is a real 0');
    assert.strictEqual(usage.availableSeats, 5);
    assert.strictEqual(usage.used, 0);
    assert.strictEqual(usage.isFull, false);
    assert.strictEqual(await subscriptionService.canAddUser(fixtures.zero.org), true);
  });

  it('mixed rows: filter preserved, count is the integer 3 across active and invited', async () => {
    const usage = await subscriptionService.getSeatUsage(fixtures.mixed.org);

    assert.strictEqual(typeof usage.activeUsers, 'number');
    assert.ok(Number.isInteger(usage.activeUsers));
    assert.strictEqual(usage.activeUsers, fixtures.mixed.expected,
      'only billable rows with status active/invited may count');
    assert.strictEqual(usage.totalAllowedUsers, 5);
    assert.strictEqual(usage.availableSeats, 2);
    assert.strictEqual(usage.isFull, false);
    assert.strictEqual(usage.overHardLimit, false);
    assert.strictEqual(await subscriptionService.canAddUser(fixtures.mixed.org), true);
  });

  it('the SQL the service executes returns exactly activeBillableUsers as an integer', async () => {
    const { usage, captured } = await captureSeatCountQuery(fixtures.mixed.org);

    assert.ok(captured, 'the seat-count query must have been executed by getSeatUsage');
    const result = await executeCaptured(captured);

    assert.strictEqual(result.fields.length, 1);
    assert.strictEqual(result.fields[0].name, 'activeBillableUsers',
      'the alias must survive PostgreSQL identifier folding exactly as quoted');
    assert.strictEqual(result.rows[0].activebillableusers, undefined,
      'an unquoted alias would appear under the folded name');
    assert.strictEqual(typeof result.rows[0].activeBillableUsers, 'number',
      'COUNT(*) is bigint and pg-types returns int8 as a string without ::int');
    assert.ok(Number.isInteger(result.rows[0].activeBillableUsers));
    assert.strictEqual(result.rows[0].activeBillableUsers, fixtures.mixed.expected);

    // The service's own reader observed the same value.
    assert.strictEqual(usage.activeUsers, fixtures.mixed.expected);
  });

  it('existing seat-limit enforcement is intact at and above the limit', async () => {
    const atLimit = await subscriptionService.getSeatUsage(fixtures.atLimit.org);
    assert.strictEqual(atLimit.activeUsers, 2);
    assert.strictEqual(atLimit.totalAllowedUsers, 2);
    assert.strictEqual(atLimit.availableSeats, 0);
    assert.strictEqual(atLimit.overHardLimit, false);
    assert.strictEqual(atLimit.isFull, true);
    assert.strictEqual(await subscriptionService.canAddUser(fixtures.atLimit.org), false,
      'a reached seat limit must still refuse additions');
    assert.strictEqual(await subscriptionService.getAvailableSeats(fixtures.atLimit.org), 0);

    const overLimit = await subscriptionService.getSeatUsage(fixtures.overLimit.org);
    assert.strictEqual(overLimit.activeUsers, 3);
    assert.strictEqual(overLimit.totalAllowedUsers, 2);
    assert.strictEqual(overLimit.availableSeats, 0);
    assert.strictEqual(overLimit.overHardLimit, true);
    assert.strictEqual(await subscriptionService.canAddUser(fixtures.overLimit.org), false,
      'an organization over the hard limit must refuse additions');
  });

  it('NON-VACUITY CONTROL: the pre-fix expression yields a folded alias and a string', async () => {
    const db = client();
    await db.connect();
    let result;
    try {
      result = await db.query(LEGACY_SQL, [fixtures.mixed.org]);
    } finally {
      await db.end();
    }

    assert.strictEqual(result.fields[0].name, 'activebillableusers',
      'without quoting PostgreSQL folds the camelCase alias');
    const row = result.rows[0];
    assert.strictEqual(row.activeBillableUsers, undefined,
      'the reader at subscription.service.js:106 would see undefined');
    assert.strictEqual(typeof row.activebillableusers, 'string',
      'COUNT(*) is int8, which pg-types returns as a string');
    assert.ok(/^[0-9]+$/.test(row.activebillableusers));

    // Reconstruct the derived values the pre-fix reader produced.
    const activeUsers = row.activeBillableUsers;
    const availableSeats = Math.max(0, 5 - activeUsers);
    assert.strictEqual(activeUsers, undefined);
    assert.ok(Number.isNaN(availableSeats), 'the pre-fix reader produced NaN, not a number');
  });
});
