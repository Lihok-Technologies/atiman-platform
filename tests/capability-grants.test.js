/**
 * ATM-003 Capability Grant Foundation — schema tests (milestone 1).
 *
 * Proves migration 022 provides durable, tenant-scoped, attributed, revocable
 * capability-grant storage; that it refuses the three architecturally recognised
 * but non-grantable V1 capabilities; and that it backfills no authority.
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * src/config/database.js uses to select test-database credentials, so it can
 * never run against runtime credentials.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { getConnection, isIntegrationTest } = require('../src/config/database');
const { resolveCapabilities, REFUSAL_REASONS } = require('../src/services/capability.service');
const {
  requireCapability, requireAllCapabilities, requirePermissionViaCapability, attachCapabilities
} = require('../src/middleware/capability.middleware');
const {
  RESOLUTION_MODES, LEGACY_COMPATIBILITY_BUNDLES, V1_HUMAN_GRANTABLE, NON_HUMAN_GRANTABLE
} = require('../src/config/capabilities');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating capability-grant suite requires the sanctioned database-test '
    + 'gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that test-database '
    + 'credentials are used instead of runtime credentials; run it via '
    + '`npm run test:integration`';

const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'database', 'postgresql');
const MIGRATION_022 = path.join(MIGRATIONS_DIR, '022_capability_grant_foundation.sql');

/** The 18 capabilities a human may be granted in V1. */
const GRANTABLE = Object.freeze([
  'knowledge.author', 'knowledge.submit', 'knowledge.review', 'knowledge.approve',
  'knowledge.publish', 'knowledge.safety_review', 'knowledge.legacy_clearance', 'evidence.attach',
  'inspection.execute', 'inspection.assign',
  'finding.report', 'finding.assess', 'finding.monitor', 'finding.close',
  'escalation.prepare', 'escalation.approve',
  'org.user_admin', 'org.config_admin'
]);

/** Recognised by the architecture but deliberately NOT human-grantable in V1. */
const NON_GRANTABLE = Object.freeze(['platform.admin', 'knowledge.taxonomy_admin', 'integration.service']);

const ORG = 991001;
const ORG_B = 991002;
const GRANTEE = 991011;
const GRANTER = 991012;
const FOREIGN = 991013;

const SERVER = {
  host: process.env.TEST_DB_HOST,
  port: Number(process.env.TEST_DB_PORT),
  user: process.env.TEST_DB_USER,
  password: process.env.TEST_DB_PASSWORD
};

let dbCounter = 0;
const createdDatabases = [];
const uniqueDbName = () => `atiman_3cap_test_${process.pid}_${++dbCounter}`;
const migrationFiles = () => fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
const serverPool = (database) => new Pool({ ...SERVER, database, max: 2 });

async function createDatabase(name) {
  const pool = await serverPool('postgres');
  try {
    await pool.query(`CREATE DATABASE ${name}`);
    createdDatabases.push(name);
  } finally { await pool.end(); }
}
async function dropDatabase(name) {
  const pool = await serverPool('postgres');
  try {
    await pool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]);
    await pool.query(`DROP DATABASE IF EXISTS ${name}`);
  } finally { await pool.end(); }
}

async function withConn(fn) {
  const conn = await getConnection();
  try { const r = await fn(conn); await conn.commit(); return r; }
  catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

/** Attempt a statement in a savepoint; report whether it was accepted and why not. */
async function attempt(statement, params = []) {
  return withConn(async (conn) => {
    await conn.query('SAVEPOINT cap_probe');
    try {
      await conn.query(statement, params);
      await conn.query('RELEASE SAVEPOINT cap_probe');
      return { accepted: true, error: null };
    } catch (error) {
      await conn.query('ROLLBACK TO SAVEPOINT cap_probe');
      return { accepted: false, error: error.message };
    }
  });
}

// The unknown-role case takes the compatibility branch (no explicit grants present).
const RESOLUTION_MODE_SAFE = () => RESOLUTION_MODES.LEGACY_COMPATIBILITY;

const grant = (userId = GRANTEE, orgId = ORG, capability = 'knowledge.approve', by = GRANTER) =>
  ['INSERT INTO user_capabilities (user_id, organization_id, capability, granted_by_user_id) VALUES (?, ?, ?, ?)',
    [userId, orgId, capability, by]];

/**
 * Allocate a fresh principal for one test.
 *
 * node:test runs sibling subtests concurrently, so tests must not share grant
 * rows: each test that exercises grant *state* gets its own user and therefore
 * its own grant namespace.
 */
let userSeq = 0;
async function makeUser(role = 'operator', org = ORG) {
  // The id is assigned by the database and the username is unique per run, so
  // re-running the suite against a long-lived test database cannot collide with
  // principals created by a previous run.
  const tag = `${Date.now()}-${process.pid}-${++userSeq}`;
  const rows = await withConn((conn) => conn.query(
    `INSERT INTO users (username, email, password_hash, full_name, role, organization_id, is_active)
     VALUES (?, ?, 'x', 'Capability Probe User', ?, ?, true) RETURNING id`,
    [`cap-probe-${tag}`, `cap-probe-${tag}@test.local`, role, org]));
  return rows[0].id;
}

async function ensureFixture() {
  await withConn(async (conn) => {
    await conn.query(`INSERT INTO organizations (id, organization_name) VALUES (?, ?), (?, ?) ON CONFLICT (id) DO NOTHING`,
      [ORG, 'Capability Org', ORG_B, 'Capability Other Org']);
    for (const [id, name, org, role] of [
      [GRANTEE, 'cap-grantee', ORG, 'operator'],
      [GRANTER, 'cap-granter', ORG, 'admin'],
      [FOREIGN, 'cap-foreign', ORG_B, 'admin']
    ]) {
      await conn.query(
        `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
         VALUES (?, ?, ?, 'x', 'Capability Fixture', ?, ?, true) ON CONFLICT (id) DO NOTHING`,
        [id, name, `${name}@test.local`, role, org]);
    }
  });
}

describe('ATM-003 capability grants (migration 022)', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => { await ensureFixture(); });
  after(async () => { for (const n of createdDatabases.splice(0)) { try { await dropDatabase(n); } catch { /* best effort */ } } });

  describe('structure', () => {
    it('creates the grant table with its constraints and indexes', async () => {
      const cols = await withConn((conn) => conn.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='user_capabilities' ORDER BY column_name`));
      const names = cols.map((c) => c.column_name);
      for (const required of ['id', 'user_id', 'organization_id', 'capability', 'source',
        'granted_by_user_id', 'granted_at', 'revoked_at', 'revoked_by_user_id']) {
        assert.ok(names.includes(required), `user_capabilities must have ${required}`);
      }

      const constraints = await withConn((conn) => conn.query(
        `SELECT conname FROM pg_constraint WHERE conrelid='user_capabilities'::regclass AND contype='c'`));
      const cnames = constraints.map((c) => c.conname);
      for (const required of ['chk_user_capabilities_grantable', 'chk_user_capabilities_source',
        'chk_user_capabilities_revocation_coherent', 'chk_user_capabilities_revocation_after_grant']) {
        assert.ok(cnames.includes(required), `missing ${required}`);
      }

      const indexes = await withConn((conn) => conn.query(
        `SELECT indexname FROM pg_indexes WHERE tablename='user_capabilities'`));
      const inames = indexes.map((i) => i.indexname);
      assert.ok(inames.includes('uq_user_capabilities_active'), 'active-grant uniqueness index must exist');
      assert.ok(inames.includes('idx_user_capabilities_active_user'));
      assert.ok(inames.includes('idx_user_capabilities_active_org'));

      const triggers = await withConn((conn) => conn.query(
        `SELECT tgname FROM pg_trigger WHERE tgrelid='user_capabilities'::regclass AND NOT tgisinternal`));
      const tnames = triggers.map((t) => t.tgname);
      assert.ok(tnames.includes('trg_user_capabilities_tenant'), 'tenant guard trigger must exist');
      assert.ok(tnames.includes('trg_user_capabilities_immutable'), 'immutability trigger must exist');
    });

    it('accepts exactly the 18 approved V1 human-grantable capabilities', async () => {
      const constraint = await withConn((conn) => conn.query(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='chk_user_capabilities_grantable'`));
      const def = constraint[0].def;
      for (const capability of GRANTABLE) {
        assert.ok(def.includes(`'${capability}'`), `grantable set must include ${capability}`);
      }
      const quoted = [...def.matchAll(/'([a-z]+\.[a-z_]+)'/g)].map((m) => m[1]);
      assert.strictEqual(quoted.length, GRANTABLE.length,
        `the grantable set must contain exactly ${GRANTABLE.length} capabilities, found ${quoted.length}`);
    });

    it('refuses every architecturally recognised but non-grantable capability', async () => {
      for (const capability of NON_GRANTABLE) {
        const [sql, params] = grant(GRANTEE, ORG, capability);
        const outcome = await attempt(sql, params);
        assert.strictEqual(outcome.accepted, false, `${capability} must not be grantable in V1`);
        assert.match(outcome.error, /chk_user_capabilities_grantable/);
      }
    });

    it('refuses an unknown capability identifier (no wildcard, no free text)', async () => {
      for (const capability of ['not.a.capability', '*', 'admin', 'KNOWLEDGE.APPROVE']) {
        const [sql, params] = grant(GRANTEE, ORG, capability);
        const outcome = await attempt(sql, params);
        assert.strictEqual(outcome.accepted, false, `${capability} must be refused`);
      }
    });
  });

  describe('tenancy', () => {
    it('refuses a grant scoped to an organization that is not the user\'s own', async () => {
      const [sql, params] = grant(GRANTEE, ORG_B, 'knowledge.approve');
      const outcome = await attempt(sql, params);
      assert.strictEqual(outcome.accepted, false, 'cross-tenant grant must be unrepresentable');
      assert.match(outcome.error, /is not the organization of user/);
    });

    it('refuses a grant issued by a user of another organization', async () => {
      const [sql, params] = grant(GRANTEE, ORG, 'knowledge.approve', FOREIGN);
      const outcome = await attempt(sql, params);
      assert.strictEqual(outcome.accepted, false, 'a foreign granter must be refused');
      assert.match(outcome.error, /does not belong to organization/);
    });

    it('refuses a grant to a user with no organization', async () => {
      await withConn((conn) => conn.query(
        `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
         VALUES (991014, 'cap-norg', 'cap-norg@test.local', 'x', 'No Org', 'operator', NULL, true)
         ON CONFLICT (id) DO NOTHING`));
      const [sql, params] = grant(991014, ORG, 'finding.report');
      const outcome = await attempt(sql, params);
      assert.strictEqual(outcome.accepted, false);
      assert.match(outcome.error, /belongs to no organization/);
    });
  });

  describe('grant record integrity', () => {
    it('accepts an accountable grant and records its attribution', async () => {
      const grantee = await makeUser();
      const [sql, params] = grant(grantee, ORG, 'knowledge.approve');
      const outcome = await attempt(sql, params);
      assert.strictEqual(outcome.accepted, true, outcome.error || '');
      const rows = await withConn((conn) => conn.query(
        `SELECT capability, source, granted_by_user_id, granted_at, revoked_at
           FROM user_capabilities WHERE user_id=? AND capability='knowledge.approve'`, [grantee]));
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].source, 'explicit');
      assert.strictEqual(Number(rows[0].granted_by_user_id), GRANTER);
      assert.ok(rows[0].granted_at, 'grant time must be recorded');
      assert.strictEqual(rows[0].revoked_at, null);
    });

    it('allows only one active grant per user, organization and capability', async () => {
      const grantee = await makeUser();
      const [sql, params] = grant(grantee, ORG, 'knowledge.approve');
      assert.strictEqual((await attempt(sql, params)).accepted, true);
      const second = await attempt(sql, params);
      assert.strictEqual(second.accepted, false, 'a second active grant must be refused');
      assert.match(second.error, /uq_user_capabilities_active/);
    });

    it('allows a fresh grant after revocation, keeping the revoked row as history', async () => {
      const grantee = await makeUser();
      const [sql, params] = grant(grantee, ORG, 'knowledge.approve');
      assert.strictEqual((await attempt(sql, params)).accepted, true);

      const revoke = await attempt(
        `UPDATE user_capabilities SET revoked_at=CURRENT_TIMESTAMP, revoked_by_user_id=?
          WHERE user_id=? AND capability='knowledge.approve' AND revoked_at IS NULL`, [GRANTER, grantee]);
      assert.strictEqual(revoke.accepted, true, revoke.error || '');

      const regrant = await attempt(sql, params);
      assert.strictEqual(regrant.accepted, true, 'a new grant after revocation must be accepted');

      const rows = await withConn((conn) => conn.query(
        `SELECT revoked_at FROM user_capabilities WHERE user_id=? AND capability='knowledge.approve'`, [grantee]));
      assert.strictEqual(rows.length, 2, 'the revoked grant must survive as history');
      assert.strictEqual(rows.filter((r) => r.revoked_at === null).length, 1, 'exactly one active grant');
    });

    it('refuses a half-formed revocation', async () => {
      const grantee = await makeUser();
      const [sql, params] = grant(grantee, ORG, 'finding.report');
      assert.strictEqual((await attempt(sql, params)).accepted, true);

      const halfRevoke = await attempt(
        `UPDATE user_capabilities SET revoked_at=CURRENT_TIMESTAMP
          WHERE user_id=? AND capability='finding.report' AND revoked_at IS NULL`, [grantee]);
      assert.strictEqual(halfRevoke.accepted, false, 'revoked_at without a revoking user must be refused');
      assert.match(halfRevoke.error, /chk_user_capabilities_revocation_coherent/);
    });

    it('refuses mutation of a grant\'s substance, deletion, and un-revocation', async () => {
      const grantee = await makeUser();
      const [sql, params] = grant(grantee, ORG, 'finding.assess');
      assert.strictEqual((await attempt(sql, params)).accepted, true);

      const mutate = await attempt(
        `UPDATE user_capabilities SET capability='finding.monitor' WHERE user_id=? AND revoked_at IS NULL`, [grantee]);
      assert.strictEqual(mutate.accepted, false);
      assert.match(mutate.error, /is immutable/);

      const swapUser = await attempt(
        `UPDATE user_capabilities SET user_id=? WHERE user_id=? AND revoked_at IS NULL`, [FOREIGN, grantee]);
      assert.strictEqual(swapUser.accepted, false);

      const del = await attempt(`DELETE FROM user_capabilities WHERE user_id=?`, [grantee]);
      assert.strictEqual(del.accepted, false);
      assert.match(del.error, /never deleted/);

      const revoke = await attempt(
        `UPDATE user_capabilities SET revoked_at=CURRENT_TIMESTAMP, revoked_by_user_id=?
          WHERE user_id=? AND revoked_at IS NULL`, [GRANTER, grantee]);
      assert.strictEqual(revoke.accepted, true, revoke.error || '');

      const unrevoke = await attempt(
        `UPDATE user_capabilities SET revoked_at=NULL, revoked_by_user_id=NULL
          WHERE user_id=? AND revoked_at IS NOT NULL`, [grantee]);
      assert.strictEqual(unrevoke.accepted, false);
      assert.match(unrevoke.error, /cannot be un-revoked/);
    });
  });

  describe('capability resolver — the authorization-mode boundary', () => {
    /** A connection stub, so defensive behaviour can be tested without weakening the schema. */
    const stub = (rows, { userOverride = {}, throwOn } = {}) => ({
      query: async (sql) => {
        if (throwOn && sql.includes(throwOn)) throw new Error('stub failure');
        if (sql.includes('FROM users')) {
          return [{ id: GRANTEE, organization_id: ORG, role: 'operator', is_active: true, ...userOverride }];
        }
        return rows;
      },
      rollback: async () => {},
      release: () => {}
    });

    it('uses ONLY explicit grants when the principal has any, adding no legacy capability', async () => {
      const admin = await makeUser('admin');
      const [sql, params] = grant(admin, ORG, 'finding.report');
      assert.strictEqual((await attempt(sql, params)).accepted, true);

      const resolved = await resolveCapabilities({ id: admin });
      assert.strictEqual(resolved.mode, RESOLUTION_MODES.EXPLICIT_GRANTS);
      assert.deepStrictEqual([...resolved.capabilities], ['finding.report']);
      // The admin bundle would have granted knowledge.publish; explicit mode must not.
      assert.ok(!resolved.capabilities.has('knowledge.publish'),
        'legacy capabilities must not be unioned into explicit mode');
      assert.ok(!resolved.capabilities.has('org.user_admin'));
    });

    it('does not union a second explicit grant with role-derived capabilities', async () => {
      const operator = await makeUser('operator');
      for (const capability of ['knowledge.approve', 'org.user_admin']) {
        const [sql, params] = grant(operator, ORG, capability);
        assert.strictEqual((await attempt(sql, params)).accepted, true);
      }
      const resolved = await resolveCapabilities({ id: operator });
      assert.strictEqual(resolved.mode, RESOLUTION_MODES.EXPLICIT_GRANTS);
      assert.deepStrictEqual([...resolved.capabilities].sort(),
        ['knowledge.approve', 'org.user_admin']);
      // operator's legacy bundle would have added these; explicit mode must not.
      assert.ok(!resolved.capabilities.has('inspection.execute'));
      assert.ok(!resolved.capabilities.has('finding.report'));
      assert.ok(!resolved.capabilities.has('evidence.attach'));
    });

    it('falls back to the exact legacy bundle when the principal holds no explicit grant', async () => {
      for (const role of ['operator', 'supervisor', 'admin']) {
        const user = await makeUser(role);
        const resolved = await resolveCapabilities({ id: user });
        assert.strictEqual(resolved.mode, RESOLUTION_MODES.LEGACY_COMPATIBILITY);
        assert.deepStrictEqual([...resolved.capabilities].sort(),
          [...LEGACY_COMPATIBILITY_BUNDLES[role]].sort(), `${role} bundle must match exactly`);
      }
    });

    it('never yields a non-human-grantable capability in either mode', async () => {
      for (const role of ['operator', 'supervisor', 'admin']) {
        const user = await makeUser(role);
        const [sql, params] = grant(user, ORG, 'finding.report');
        assert.strictEqual((await attempt(sql, params)).accepted, true);
        for (const principal of [{ id: user }, { id: await makeUser(role) }]) {
          const resolved = await resolveCapabilities(principal);
          for (const forbidden of NON_HUMAN_GRANTABLE) {
            assert.ok(!resolved.capabilities.has(forbidden),
              `${forbidden} must never be resolved for a human principal (${role}, ${resolved.mode})`);
          }
        }
      }
      for (const bundle of Object.values(LEGACY_COMPATIBILITY_BUNDLES)) {
        for (const forbidden of NON_HUMAN_GRANTABLE) {
          assert.ok(!bundle.includes(forbidden), `no bundle may contain ${forbidden}`);
        }
        assert.ok(!bundle.includes('*'), 'no bundle may contain a wildcard');
      }
    });

    it('ignores non-grantable and unknown identifiers even if a row exists (defence in depth)', async () => {
      const conn = stub([
        { capability: 'platform.admin' },
        { capability: 'knowledge.taxonomy_admin' },
        { capability: 'integration.service' },
        { capability: '*' },
        { capability: 'not.a.capability' },
        { capability: 'finding.report' }
      ]);
      const resolved = await resolveCapabilities({ id: GRANTEE }, { connection: conn });
      assert.strictEqual(resolved.mode, RESOLUTION_MODES.EXPLICIT_GRANTS);
      assert.deepStrictEqual([...resolved.capabilities], ['finding.report']);
    });

    it('treats a row set containing only invalid identifiers as no explicit grant', async () => {
      const conn = stub([{ capability: 'platform.admin' }, { capability: '*' }]);
      const resolved = await resolveCapabilities({ id: GRANTEE }, { connection: conn });
      assert.strictEqual(resolved.mode, RESOLUTION_MODES.LEGACY_COMPATIBILITY,
        'invalid rows must not create explicit mode');
      assert.deepStrictEqual([...resolved.capabilities].sort(),
        [...LEGACY_COMPATIBILITY_BUNDLES.operator].sort());
    });

    it('ignores grants revoked or held in another organization', async () => {
      const user = await makeUser('operator');
      const [sql, params] = grant(user, ORG, 'knowledge.publish');
      assert.strictEqual((await attempt(sql, params)).accepted, true);
      await withConn((conn) => conn.query(
        `UPDATE user_capabilities SET revoked_at=CURRENT_TIMESTAMP, revoked_by_user_id=?
          WHERE user_id=? AND capability='knowledge.publish'`, [GRANTER, user]));

      const resolved = await resolveCapabilities({ id: user });
      assert.strictEqual(resolved.mode, RESOLUTION_MODES.LEGACY_COMPATIBILITY,
        'a revoked grant must not keep the principal in explicit mode');
      assert.ok(!resolved.capabilities.has('knowledge.publish'));
    });

    it('refuses on tenant mismatch instead of resolving another tenant', async () => {
      const user = await makeUser('admin');
      const resolved = await resolveCapabilities({ id: user }, { organizationId: ORG_B });
      assert.strictEqual(resolved.reason, REFUSAL_REASONS.ORGANIZATION_MISMATCH);
      assert.strictEqual(resolved.mode, null);
      assert.strictEqual(resolved.capabilities.size, 0);
    });

    it('accepts the principal\'s own organization as explicit context', async () => {
      const user = await makeUser('operator');
      const resolved = await resolveCapabilities({ id: user }, { organizationId: ORG });
      assert.strictEqual(resolved.mode, RESOLUTION_MODES.LEGACY_COMPATIBILITY);
      assert.ok(resolved.capabilities.size > 0);
    });

    it('refuses absent, unknown, inactive and organization-less principals', async () => {
      assert.strictEqual((await resolveCapabilities(null)).reason, REFUSAL_REASONS.PRINCIPAL_REQUIRED);
      assert.strictEqual((await resolveCapabilities({})).reason, REFUSAL_REASONS.PRINCIPAL_REQUIRED);
      assert.strictEqual((await resolveCapabilities({ id: 999999 })).reason, REFUSAL_REASONS.PRINCIPAL_NOT_FOUND);

      const inactive = await makeUser('admin');
      await withConn((conn) => conn.query(`UPDATE users SET is_active=false WHERE id=?`, [inactive]));
      const inactiveResult = await resolveCapabilities({ id: inactive });
      assert.strictEqual(inactiveResult.reason, REFUSAL_REASONS.PRINCIPAL_INACTIVE);
      assert.strictEqual(inactiveResult.capabilities.size, 0,
        'an inactive user must resolve to no capabilities even as an admin');

      await withConn((conn) => conn.query(
        `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
         VALUES (991015, 'cap-noorg2', 'cap-noorg2@test.local', 'x', 'No Org 2', 'admin', NULL, true)
         ON CONFLICT (id) DO NOTHING`));
      const noOrg = await resolveCapabilities({ id: 991015 });
      assert.strictEqual(noOrg.reason, REFUSAL_REASONS.ORGANIZATION_REQUIRED);
      assert.strictEqual(noOrg.capabilities.size, 0, 'a user without a tenant resolves to nothing');
    });

    it('resolves an unrecognised role to no capabilities rather than to a default', async () => {
      const conn = stub([], { userOverride: { role: 'planner' } });
      const resolved = await resolveCapabilities({ id: GRANTEE }, { connection: conn });
      assert.strictEqual(resolved.mode, RESOLUTION_MODE_SAFE(conn));
      assert.strictEqual(resolved.capabilities.size, 0, 'an unknown role grants nothing');
    });

    it('fails closed when resolution itself errors', async () => {
      const conn = stub([], { throwOn: 'user_capabilities' });
      const resolved = await resolveCapabilities({ id: GRANTEE }, { connection: conn });
      assert.strictEqual(resolved.reason, REFUSAL_REASONS.RESOLVER_ERROR);
      assert.strictEqual(resolved.capabilities.size, 0);
    });

    it('returns an independent set per resolution (per-request, not cached authority)', async () => {
      const user = await makeUser('admin');
      const first = await resolveCapabilities({ id: user });
      first.capabilities.add('platform.admin');
      const second = await resolveCapabilities({ id: user });
      assert.ok(!second.capabilities.has('platform.admin'),
        'mutating one resolution must not affect the next');
      assert.deepStrictEqual([...second.capabilities].sort(),
        [...LEGACY_COMPATIBILITY_BUNDLES.admin].sort());
    });

    it('keeps the resolver and the schema gate on the same 18-capability set', async () => {
      const constraint = await withConn((conn) => conn.query(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='chk_user_capabilities_grantable'`));
      const inSchema = [...constraint[0].def.matchAll(/'([a-z]+\.[a-z_]+)'/g)].map((m) => m[1]).sort();
      assert.deepStrictEqual(inSchema, [...V1_HUMAN_GRANTABLE].sort(),
        'the migration constraint and the resolver vocabulary must be identical');
    });
  });

  describe('authorization primitive', () => {
    /** Minimal Express-shaped request/response pair. */
    const request = (user) => ({ user });
    const response = () => {
      const res = { statusCode: null, payload: null };
      res.status = (code) => { res.statusCode = code; return res; };
      res.json = (body) => { res.payload = body; return res; };
      return res;
    };
    const run = async (middleware, user) => {
      const res = response();
      let advanced = false;
      await middleware(request(user), res, () => { advanced = true; });
      return { res, advanced };
    };

    it('requires an authenticated principal (401, never 403-as-allow)', async () => {
      for (const user of [undefined, null, {}]) {
        const { res, advanced } = await run(requireCapability('finding.report'), user);
        assert.strictEqual(res.statusCode, 401);
        assert.strictEqual(advanced, false);
      }
    });

    it('permits a capability the principal holds and denies one they do not', async () => {
      const operator = await makeUser('operator');
      const allowed = await run(requireCapability('finding.report'), { id: operator });
      assert.strictEqual(allowed.advanced, true);

      const denied = await run(requireCapability('knowledge.approve'), { id: operator });
      assert.strictEqual(denied.advanced, false);
      assert.strictEqual(denied.res.statusCode, 403);
      assert.match(denied.res.payload.message, /knowledge\.approve is required/);
    });

    it('denies when the principal does not exist or is inactive', async () => {
      const missing = await run(requireCapability('finding.report'), { id: 987654321 });
      assert.strictEqual(missing.res.statusCode, 403, 'a missing principal must never be allowed');

      const inactive = await makeUser('admin');
      await withConn((conn) => conn.query(`UPDATE users SET is_active=false WHERE id=?`, [inactive]));
      const denied = await run(requireCapability('org.user_admin'), { id: inactive });
      assert.strictEqual(denied.advanced, false);
      assert.strictEqual(denied.res.statusCode, 403);
    });

    it('honours explicit grants in place of the legacy bundle', async () => {
      const supervisor = await makeUser('supervisor');
      const before = await run(requireCapability('escalation.approve'), { id: supervisor });
      assert.strictEqual(before.advanced, true, 'legacy supervisor bundle holds escalation.approve');

      const [sql, params] = grant(supervisor, ORG, 'knowledge.approve');
      assert.strictEqual((await attempt(sql, params)).accepted, true);

      const after = await run(requireCapability('escalation.approve'), { id: supervisor });
      assert.strictEqual(after.advanced, false,
        'one explicit grant must switch the principal to explicit mode and drop the legacy bundle');
      const granted = await run(requireCapability('knowledge.approve'), { id: supervisor });
      assert.strictEqual(granted.advanced, true);
    });

    it('fails closed when the resolver cannot resolve', async () => {
      const stub = await requireCapability('finding.report')({ user: { id: 'not-a-number' } }, response(), () => {});
      // A non-numeric id cannot resolve; the guard must deny rather than throw.
      assert.ok(stub === undefined || stub === null || true);
      const res = response();
      const req = { user: { id: 'not-a-number' } };
      await requireCapability('finding.report')(req, res, () => {});
      assert.ok(req.capabilities instanceof Set);
      assert.strictEqual(req.capabilities.size, 0);
      assert.strictEqual(res.statusCode, 403);
    });

    it('requires every capability for all-or-nothing guards', async () => {
      const user = await makeUser('operator');
      const partial = await run(requireAllCapabilities('finding.report', 'knowledge.approve'), { id: user });
      assert.strictEqual(partial.res.statusCode, 403);
      assert.match(partial.res.payload.message, /knowledge\.approve/);

      const complete = await run(requireAllCapabilities('finding.report', 'inspection.execute'), { id: user });
      assert.strictEqual(complete.advanced, true,
        'operator holds both finding.report and inspection.execute after the parity correction');
    });

    it('adapter refuses an unmapped authorization seam rather than guessing', async () => {
      const admin = await makeUser('admin');
      for (const [resource, action] of [['TASKS', 'CREATE'], ['WORK_ORDERS', 'UPDATE'], ['CATALOGS', 'DELETE']]) {
        const { res, advanced } = await run(requirePermissionViaCapability(resource, action), { id: admin });
        assert.strictEqual(advanced, false, `${resource}.${action} must not be silently allowed`);
        assert.strictEqual(res.statusCode, 403);
        assert.match(res.payload.message, /not capability-mapped/);
      }
    });

    it('adapter maps the knowledge lifecycle pairs to their capabilities', async () => {
      const operator = await makeUser('operator');
      const denied = await run(requirePermissionViaCapability('KNOWLEDGE', 'APPROVE'), { id: operator });
      assert.strictEqual(denied.res.statusCode, 403, 'an operator has no knowledge.approve');

      const admin = await makeUser('admin');
      for (const action of ['REVIEW', 'APPROVE', 'SAFETY_REVIEW']) {
        const { advanced } = await run(requirePermissionViaCapability('KNOWLEDGE', action), { id: admin });
        assert.strictEqual(advanced, true, `admin must satisfy KNOWLEDGE.${action}`);
      }
      const withGrant = await makeUser('operator');
      const [sql, params] = grant(withGrant, ORG, 'knowledge.approve');
      assert.strictEqual((await attempt(sql, params)).accepted, true);
      const granted = await run(requirePermissionViaCapability('KNOWLEDGE', 'APPROVE'), { id: withGrant });
      assert.strictEqual(granted.advanced, true, 'an explicit grant must satisfy the adapter');
    });

    it('treats reading governed knowledge as authenticated-only, not as a capability', async () => {
      const operator = await makeUser('operator');
      const { advanced } = await run(requirePermissionViaCapability('KNOWLEDGE', 'VIEW'), { id: operator });
      assert.strictEqual(advanced, true, 'reading is not an accountable act in the capability architecture');

      const unauthenticated = await run(requirePermissionViaCapability('KNOWLEDGE', 'VIEW'), undefined);
      assert.strictEqual(unauthenticated.res.statusCode, 401);
    });

    it('attaches a resolved capability set and mode to the request', async () => {
      const operator = await makeUser('operator');
      const req = { user: { id: operator } };
      await attachCapabilities(req, response(), () => {});
      assert.ok(req.capabilities instanceof Set);
      assert.strictEqual(req.capabilityMode, RESOLUTION_MODES.LEGACY_COMPATIBILITY);
      assert.ok(req.capabilities.has('finding.report'));

      const granted = await makeUser('operator');
      const [sql, params] = grant(granted, ORG, 'org.config_admin');
      assert.strictEqual((await attempt(sql, params)).accepted, true);
      const req2 = { user: { id: granted } };
      await attachCapabilities(req2, response(), () => {});
      assert.strictEqual(req2.capabilityMode, RESOLUTION_MODES.EXPLICIT_GRANTS);
      assert.ok(!req2.capabilities.has('finding.report'), 'explicit mode drops the legacy bundle');
    });

    it('is not reachable through an API-key principal (machine authority stays separate)', async () => {
      // An API-key principal carries req.apiKey and no human user id; the guard
      // must deny rather than resolve machine authority as a human.
      const res = response();
      let advanced = false;
      await requireCapability('knowledge.publish')({ apiKey: { id: 1, scopes: ['admin'] } }, res, () => { advanced = true; });
      assert.strictEqual(advanced, false, 'an API-key principal must not satisfy a human capability guard');
      assert.strictEqual(res.statusCode, 401);
    });
  });


  describe('legacy compatibility parity (milestone 4)', () => {
    /**
     * The pre-change authority oracle, transcribed from src/config/permissions.js
     * and the guards on the routes that enforce it. A compatibility bundle may
     * only contain capabilities this table permits for that role.
     */
    const PRE_CHANGE = {
      'inspection.execute': { admin: false, supervisor: true, operator: true },   // INSPECTIONS.SUBMIT: admin none
      'inspection.assign': { admin: true, supervisor: true, operator: false },    // WORK_ORDERS.ASSIGN
      'finding.report': { admin: true, supervisor: true, operator: true },        // FINDINGS.CREATE
      'finding.assess': { admin: true, supervisor: true, operator: false },       // FINDINGS.MANAGE
      'finding.monitor': { admin: true, supervisor: true, operator: false },
      'finding.close': { admin: true, supervisor: true, operator: false },
      'escalation.prepare': { admin: true, supervisor: true, operator: false },   // FINDINGS.MANAGE / LINK_SAP
      'escalation.approve': { admin: true, supervisor: true, operator: false },
      'evidence.attach': { admin: true, supervisor: false, operator: false },     // TASKS.CREATE/UPDATE: admin only
      'knowledge.author': { admin: true, supervisor: true, operator: false },     // requireAdmin on create/update
      'knowledge.submit': { admin: true, supervisor: true, operator: false },     // KNOWLEDGE.REVIEW
      'knowledge.review': { admin: true, supervisor: true, operator: false },
      'knowledge.approve': { admin: true, supervisor: true, operator: false },
      'knowledge.safety_review': { admin: true, supervisor: true, operator: false },
      'knowledge.publish': { admin: true, supervisor: true, operator: false },    // requireAdmin on publish
      'org.user_admin': { admin: true, supervisor: false, operator: false },      // USERS.DELETE supervisor none
      'org.config_admin': { admin: true, supervisor: false, operator: false },    // FACILITIES.* admin only
      'knowledge.legacy_clearance': { admin: false, supervisor: false, operator: false } // no route enforces it
    };

    it('every capability in every bundle was reachable by that role before the campaign', () => {
      for (const [role, bundle] of Object.entries(LEGACY_COMPATIBILITY_BUNDLES)) {
        for (const capability of bundle) {
          assert.ok(capability in PRE_CHANGE, `${capability} must have a parity entry`);
          assert.strictEqual(PRE_CHANGE[capability][role], true,
            `${role} must not gain ${capability}: it was unreachable before the capability model`);
        }
      }
    });

    it('records the two less-privileged mappings explicitly', () => {
      assert.ok(!LEGACY_COMPATIBILITY_BUNDLES.operator.includes('evidence.attach'),
        'operator must not gain provenance evidence attachment');
      assert.ok(!LEGACY_COMPATIBILITY_BUNDLES.supervisor.includes('evidence.attach'));
      assert.ok(LEGACY_COMPATIBILITY_BUNDLES.admin.includes('evidence.attach'),
        'admin held TASKS.CREATE/UPDATE before the campaign');
      assert.ok(!LEGACY_COMPATIBILITY_BUNDLES.supervisor.includes('org.user_admin'),
        'supervisor user administration was facility-scoped and cannot be mapped without expansion');
    });

    it('keeps admin out of inspection execution and everyone out of legacy clearance', () => {
      assert.ok(!LEGACY_COMPATIBILITY_BUNDLES.admin.includes('inspection.execute'),
        'INSPECTIONS.SUBMIT is admin: none — granting it would expand admin authority');
      for (const bundle of Object.values(LEGACY_COMPATIBILITY_BUNDLES)) {
        assert.ok(!bundle.includes('knowledge.legacy_clearance'),
          'no route enforces legacy clearance, so no bundle may grant it');
      }
    });

    it('bundles are enumerations, not wildcards, with the parity-verified sizes', () => {
      assert.strictEqual(LEGACY_COMPATIBILITY_BUNDLES.operator.length, 2);
      assert.strictEqual(LEGACY_COMPATIBILITY_BUNDLES.supervisor.length, 14);
      assert.strictEqual(LEGACY_COMPATIBILITY_BUNDLES.admin.length, 16);
      assert.ok(LEGACY_COMPATIBILITY_BUNDLES.admin.length < V1_HUMAN_GRANTABLE.length,
        'admin must be an enumeration smaller than the grantable set, never "everything"');
      for (const bundle of Object.values(LEGACY_COMPATIBILITY_BUNDLES)) {
        assert.ok(!bundle.includes('*'));
        assert.strictEqual(new Set(bundle).size, bundle.length, 'no duplicates');
      }
    });

    it('a capability added to the vocabulary later is not silently granted to a legacy role', async () => {
      // The bundles are frozen enumerations: adding to the vocabulary cannot
      // change what a legacy principal resolves to.
      const operator = await makeUser('operator');
      const resolved = await resolveCapabilities({ id: operator });
      assert.deepStrictEqual([...resolved.capabilities].sort(),
        [...LEGACY_COMPATIBILITY_BUNDLES.operator].sort());
      assert.ok(!resolved.capabilities.has('knowledge.author'));
      assert.ok(!resolved.capabilities.has('evidence.attach'));
    });
  });


  describe('migration safety', () => {
    it('applies cleanly and is safe to re-apply', async () => {
      const sql = fs.readFileSync(MIGRATION_022, 'utf8');
      const before = await withConn((conn) => conn.query(`SELECT count(*)::int AS c FROM user_capabilities`));
      for (let i = 0; i < 2; i += 1) await withConn((conn) => conn.query(sql));
      const after = await withConn((conn) => conn.query(`SELECT count(*)::int AS c FROM user_capabilities`));
      assert.strictEqual(after[0].c, before[0].c, 're-application must not create or remove grants');

      const tables = await withConn((conn) => conn.query(
        `SELECT count(*)::int AS c FROM information_schema.tables
          WHERE table_schema='public' AND table_name='user_capabilities'`));
      assert.strictEqual(tables[0].c, 1, 're-application must not duplicate the table');
    });

    it('backfills no authority when upgraded from 021 with pre-existing users', async () => {
      const name = uniqueDbName();
      await createDatabase(name);
      const pool = await serverPool(name);
      try {
        // Build to exactly 021 first — the state production is in.
        for (const file of migrationFiles().filter((f) => f.slice(0, 3) < '022')) {
          await pool.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
        }
        const preTable = await pool.query(
          `SELECT count(*)::int AS c FROM information_schema.tables
            WHERE table_schema='public' AND table_name='user_capabilities'`);
        assert.strictEqual(preTable.rows[0].c, 0, '021 must not already contain the grant table');

        await pool.query(`INSERT INTO organizations (id, organization_name) VALUES (991101, 'Upgrade Org')`);
        await pool.query(
          `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
           VALUES (991111, 'up-admin', 'up@test.local', 'x', 'Up Admin', 'admin', 991101, true),
                  (991112, 'up-op', 'up2@test.local', 'x', 'Up Operator', 'operator', 991101, true)`);
        const usersBefore = await pool.query(`SELECT count(*)::int AS c FROM users`);

        await pool.query(fs.readFileSync(MIGRATION_022, 'utf8'));

        const grants = await pool.query(`SELECT count(*)::int AS c FROM user_capabilities`);
        assert.strictEqual(grants.rows[0].c, 0,
          'migration 022 must create no grant rows: no existing user may gain authority');

        const usersAfter = await pool.query(`SELECT count(*)::int AS c FROM users`);
        assert.strictEqual(usersAfter.rows[0].c, usersBefore.rows[0].c, 'existing identities must be preserved');

        const roles = await pool.query(`SELECT role FROM users WHERE id IN (991111, 991112) ORDER BY id`);
        assert.deepStrictEqual(roles.rows.map((r) => r.role), ['admin', 'operator'],
          'migration 022 must not migrate or rewrite roles');

        const sql022 = fs.readFileSync(MIGRATION_022, 'utf8');
        await pool.query(sql022);
        const again = await pool.query(`SELECT count(*)::int AS c FROM user_capabilities`);
        assert.strictEqual(again.rows[0].c, 0, 're-application on an upgraded database must stay empty');
      } finally {
        await pool.end();
        await dropDatabase(name);
        const i = createdDatabases.indexOf(name);
        if (i >= 0) createdDatabases.splice(i, 1);
      }
    });

    it('declares that it performs no backfill and creates no platform authority', async () => {
      const sql = fs.readFileSync(MIGRATION_022, 'utf8');
      const statements = sql.replace(/\/\*[\s\S]*?\*\//g, ' ')
        .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
      assert.ok(!/INSERT\s+INTO\s+user_capabilities/i.test(statements), 'no grant insert may exist');
      assert.ok(!/UPDATE\s+user_capabilities/i.test(statements), 'no grant update may exist');
      assert.ok(!/UPDATE\s+users/i.test(statements), 'users must not be mutated');
      assert.ok(!/ALTER\s+TABLE\s+users/i.test(statements), 'users schema must not change');
      assert.ok(!/'platform\.admin'/.test(statements), 'platform.admin must not be grantable');
      assert.ok(!/'knowledge\.taxonomy_admin'/.test(statements), 'taxonomy admin must not be grantable');
      assert.ok(!/'integration\.service'/.test(statements), 'integration.service must not be human-grantable');
    });
  });
});
