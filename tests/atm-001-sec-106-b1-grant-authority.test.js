/**
 * ATM-001-SEC-106 — blocker B-1: capability-grant authority (DRAFT, non-main).
 *
 * MISSION #106. The OWNER policy recorded for this mission is, verbatim:
 *
 *   "`is_organization_admin` + an unrelated explicit grant must NOT by itself
 *    confer `org.user_admin`. Do not infer user-admin from arbitrary grants.
 *    Specific approved ATM-003-R1 compatibility exceptions must be proven,
 *    narrowly described, and reconciled rather than silently discarded."
 *
 * WHAT WAS WRONG (the reconciled conflict). The integrated candidate carried
 * `withTenantAdministratorProfile` in `src/services/capability.service.js`: for a
 * principal with `users.role = 'admin'` AND `users.is_organization_admin = true`
 * it ADDED the ATM-003-R1 §4 Tenant Administrator profile (`org.user_admin` +
 * `org.config_admin`) in BOTH resolution modes, so ANY unrelated explicit grant
 * conferred user-administration. That made five independently PASSed assertions
 * fail (they expect 403) while six other independently PASSed assertions passed
 * (they pinned 200). The correction is in the resolver: in EXPLICIT_GRANTS mode
 * the resolved set is EXACTLY the active explicit grants, and the flag is not
 * read. No capability, role, permission or vocabulary is added or removed.
 *
 * WHAT THIS SUITE PROVES. Positive AND negative, with real database effects:
 *   A. the anti-re-widening structural pins (code-only assertions);
 *   B. the full resolver matrix: is_organization_admin true/false x explicit
 *      grants present/absent x role admin/other, plus the sibling-non-inference
 *      case (an explicit `org.config_admin` grants nothing else);
 *   C. the TRANSITION between resolutions: legacy -> explicit -> revoked -> legacy;
 *   D. the real `org.user_admin`-gated routes END TO END (GET / POST resend /
 *      DELETE on invitations), each refusal paired with a read-back of the
 *      persisted state, plus the `org.config_admin` organisation routes;
 *   E. adversarial reproducers that FAIL if anyone re-widens the inference.
 *
 * Every authorization claim is paired with a DATABASE-EFFECT claim read back
 * after the request, because a status code alone is not evidence of a write or
 * of its absence (defect D-1 made a create persist and answer HTTP 500).
 * Refusal responses are asserted against the WHOLE serialised body, so a
 * leaked invitation token cannot hide behind a field the suite forgot to check.
 *
 * FIXTURE RESIDUE (disposable database only). Migration 022 makes a capability
 * grant a permanent, attributed record (DELETE raises by trigger), so a granted
 * user cannot be deleted either. This suite therefore builds ONE stable fixture
 * set ONCE, idempotently, and reuses it: `sec106-b1-*` users in the
 * 'ATM-001-SEC-106-B1 Tenant' organization, plus one stable plan and
 * subscription. Residue is bounded to those rows, and the transition case adds
 * one REVOKED grant row per run by design (revocation is the only permitted
 * mutation). No production/shared database is ever touched: the suite is gated on
 * isIntegrationTest() and refuses to execute without the sanctioned gate.
 *
 * No credential is printed. The suite never asserts on a token VALUE; it asserts
 * that token-bearing routes are refused and that refusals disclose no token.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { getConnection, isIntegrationTest } = require('../src/config/database');
const {
  CAPABILITIES, V1_HUMAN_GRANTABLE, NON_HUMAN_GRANTABLE, RESOLUTION_MODES
} = require('../src/config/capabilities');
const { resolveCapabilities } = require('../src/services/capability.service');
const emailService = require('../src/services/email.service');
const subscriptionService = require('../src/services/subscription.service');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating ATM-001-SEC-106 B-1 suite requires the sanctioned database-test '
    + 'gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that test-database '
    + 'credentials are used instead of runtime credentials; run it via '
    + '`npm run test:integration`';

process.env.JWT_SECRET = 'test-only-jwt-secret-not-for-production-000000';
const JWT_SECRET = 'test-only-jwt-secret-not-for-production-000000';
const REPO_ROOT = path.resolve(__dirname, '..');
const SERVICE_FILE = path.join(REPO_ROOT, 'src', 'services', 'capability.service.js');

const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`;
const seq = { n: 0 };
const tag = () => `${RUN}${(++seq.n).toString(36)}`;

const ORG_NAME = 'ATM-001-SEC-106-B1 Tenant';
const PLAN_CODE = 'atm106-b1-stable';
const UNRELATED = 'knowledge.author';
const ORG_USER_ADMIN = 'org.user_admin';
const ORG_CONFIG_ADMIN = 'org.config_admin';

/** Stable fixture users. `flag` is users.is_organization_admin. */
const SHAPES = {
  ADMIN_UNRELATED: { role: 'admin', flag: true, grants: [UNRELATED] },
  ADMIN_NOFLAG_UNRELATED: { role: 'admin', flag: false, grants: [UNRELATED] },
  OPERATOR_FLAG_UNRELATED: { role: 'operator', flag: true, grants: [UNRELATED] },
  ADMIN_USER_ADMIN: { role: 'admin', flag: true, grants: [ORG_USER_ADMIN] },
  OPERATOR_USER_ADMIN: { role: 'operator', flag: false, grants: [ORG_USER_ADMIN] },
  ADMIN_CONFIG_ONLY: { role: 'admin', flag: true, grants: [ORG_CONFIG_ADMIN] },
  ADMIN_LEGACY: { role: 'admin', flag: true, grants: [] },
  OPERATOR_LEGACY: { role: 'operator', flag: false, grants: [] },
  TRANSITION: { role: 'admin', flag: true, grants: [] }
};

const usernameFor = (key) => `sec106-b1-${key.toLowerCase().replace(/_/g, '-')}`;

const U = {};
let ORG = null;
let PLAN_ID = null;
const INV = {};

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

const rows = (sql, params) => withConn((conn) => conn.query(sql, params));

const grantRows = (userId) => rows(
  `SELECT id, capability, revoked_at FROM user_capabilities
    WHERE user_id = $1 AND organization_id = $2 ORDER BY id`, [userId, ORG]);

const activeGrantCount = async (userId) => Number((await rows(
  `SELECT count(*)::int AS c FROM user_capabilities
    WHERE user_id = $1 AND revoked_at IS NULL`, [userId]))[0].c);

/**
 * Revoke every active grant of a principal. Migration 022 requires the revocation
 * to be coherent (revoked_by_user_id present) and forbids deleting the row.
 */
const revokeActiveGrants = (userId) => rows(
  `UPDATE user_capabilities SET revoked_at = NOW(), revoked_by_user_id = $2
    WHERE user_id = $1 AND revoked_at IS NULL`, [userId, U.ADMIN_LEGACY]);

/**
 * Idempotent stable fixture. A grant cannot be deleted, so every row here is
 * find-or-create and a re-run adds nothing (except the transition case's revoked
 * row, documented above).
 */
async function ensureFixture() {
  await withConn(async (conn) => {
    const existing = await conn.query('SELECT id FROM organizations WHERE organization_name = $1', [ORG_NAME]);
    ORG = existing.length
      ? Number(existing[0].id)
      : Number((await conn.query(
        `INSERT INTO organizations (organization_name, industry, subscription_plan, subscription_status)
         VALUES ($1, 'water', 'pro', 'active') RETURNING id`, [ORG_NAME]))[0].id);

    const plan = await conn.query('SELECT id FROM subscription_plans WHERE plan_code = $1', [PLAN_CODE]);
    PLAN_ID = plan.length
      ? Number(plan[0].id)
      : Number((await conn.query(
        `INSERT INTO subscription_plans (plan_code, plan_name, base_price, max_facilities, max_equipment)
         VALUES ($1, 'ATM-001-SEC-106 B1 Plan', 10.00, 20, 200) RETURNING id`, [PLAN_CODE]))[0].id);

    const subscription = await conn.query(
      'SELECT id FROM organization_subscriptions WHERE organization_id = $1', [ORG]);
    if (subscription.length) {
      await conn.query(
        `UPDATE organization_subscriptions SET plan_id = $2, status = 'active' WHERE organization_id = $1`,
        [ORG, PLAN_ID]);
    } else {
      await conn.query(
        `INSERT INTO organization_subscriptions (organization_id, plan_id, status, base_price)
         VALUES ($1, $2, 'active', 10.00)`, [ORG, PLAN_ID]);
    }

    for (const [key, shape] of Object.entries(SHAPES)) {
      const username = usernameFor(key);
      const found = await conn.query('SELECT id FROM users WHERE username = $1', [username]);
      if (found.length) {
        // Re-establish the exact shape a previous (possibly mutated) run may have
        // changed, so a re-run is deterministic.
        await conn.query(
          `UPDATE users SET is_active = true, role = $2, is_organization_admin = $3, organization_id = $4
            WHERE id = $1`, [Number(found[0].id), shape.role, shape.flag, ORG]);
        U[key] = Number(found[0].id);
      } else {
        const inserted = await conn.query(
          `INSERT INTO users (organization_id, username, email, password_hash, full_name, role, is_active, is_organization_admin)
           VALUES ($1, $2, $3, 'x', $4, $5, true, $6) RETURNING id`,
          [ORG, username, `${username}@test.local`, `SEC106 B1 ${key}`, shape.role, shape.flag]);
        U[key] = Number(inserted[0].id);
      }
    }

    // Active grants: exactly one per (user, capability), idempotent by NOT EXISTS.
    for (const [key, shape] of Object.entries(SHAPES)) {
      for (const capability of shape.grants) {
        await conn.query(
          `INSERT INTO user_capabilities (user_id, organization_id, capability, source, granted_by_user_id)
           SELECT $1::integer, $2::integer, $3::varchar(64), 'explicit', $4::integer
            WHERE NOT EXISTS (
              SELECT 1 FROM user_capabilities
               WHERE user_id = $1::integer AND organization_id = $2::integer
                 AND capability = $3::varchar(64) AND revoked_at IS NULL)`,
          [U[key], ORG, capability, U.ADMIN_LEGACY]);
      }
    }

    // Any active grant left on the transition principal by an interrupted run
    // would destroy the "legacy" precondition; revoke it (the only permitted
    // mutation of a grant).
    await conn.query(
      `UPDATE user_capabilities SET revoked_at = NOW(), revoked_by_user_id = $2
        WHERE user_id = $1 AND revoked_at IS NULL`, [U.TRANSITION, U.ADMIN_LEGACY]);
  });
}

async function insertInvitation(key, { role = 'operator' } = {}) {
  const email = `sec106-b1-${key.toLowerCase()}-${tag()}@test.local`;
  const result = await rows(
    `INSERT INTO invitations (organization_id, email, role, invited_by, token, status, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', NOW() + INTERVAL '7 days', NOW())
     RETURNING id, token`, [ORG, email, role, U.ADMIN_LEGACY, crypto.randomBytes(32).toString('hex')]);
  INV[key] = { id: Number(result[0].id), email, role };
  return INV[key];
}

const invitationRow = async (id) => (await rows(
  `SELECT id, email, role, status, organization_id FROM invitations WHERE id = $1`, [id]))[0];

const invitationsForOrg = () => rows(
  `SELECT id, email, role, status FROM invitations WHERE organization_id = $1 ORDER BY id`, [ORG]);

async function cleanupFixture() {
  try {
    await rows(`DELETE FROM invitations WHERE email LIKE $1`, ['sec106-b1-%']);
    // The stable users and their grants are undeletable residue by design of
    // migration 022; only the revocable state is normalised here.
    await revokeActiveGrants(U.TRANSITION);
  } catch {
    // Disposable-database hygiene only; never mask an authorization assertion.
  }
}

// ---------------------------------------------------------------------------
// HTTP harness — the real application, real JWTs
// ---------------------------------------------------------------------------

let server = null;
let port = null;

const REAL_SEND_INVITATION = emailService.sendInvitation;
let delivered = [];

const tokenFor = (key) => jwt.sign({ userId: U[key] }, JWT_SECRET, { expiresIn: '1h' });

function call(method, requestPath, { as = null, body = null } = {}) {
  const headers = {};
  if (as) headers.Authorization = `Bearer ${tokenFor(as)}`;
  let payload = null;
  if (body !== null) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: requestPath, headers }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* non-JSON body */ }
        resolve({ status: res.statusCode, text, json });
      });
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

const get = (p, opts) => call('GET', p, opts);
const post = (p, body, opts = {}) => call('POST', p, { ...opts, body });
const del = (p, opts) => call('DELETE', p, opts);

const REAL_CAN_ADD_USER = subscriptionService.canAddUser;
const withSeatMaskNeutralized = async (fn) => {
  subscriptionService.canAddUser = async () => true;
  try { return await fn(); } finally { subscriptionService.canAddUser = REAL_CAN_ADD_USER; }
};

/** Read a source file with comment lines removed, so only code is asserted. */
const codeOnly = (file) => fs.readFileSync(file, 'utf8')
  .split('\n')
  .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
  .join('\n');

const flatCode = (file) => codeOnly(file).replace(/\s+/g, ' ');

/** Every value that looks like an invitation credential anywhere in a body. */
const HEX64_GLOBAL = /[0-9a-f]{64}/g;
const disclosedTokens = (text) => (text.match(HEX64_GLOBAL) || []).length;

// ===========================================================================

describe('ATM-001-SEC-106 B-1 capability-grant authority', { skip: DB_TEST_SKIP_REASON, concurrency: 1 }, () => {
  before(async () => {
    await ensureFixture();
    const app = require('../src/app');
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
    emailService.sendInvitation = async (options) => { delivered.push(options); };
  });

  after(async () => {
    emailService.sendInvitation = REAL_SEND_INVITATION;
    if (server) await new Promise((resolve) => server.close(resolve));
    await cleanupFixture();
  });

  // ---------------------------------------------------------------- A. structural
  describe('A. anti-re-widening pins (no database)', () => {
    it('A1. the resolver reads no is_organization_admin and adds no profile', () => {
      const code = codeOnly(SERVICE_FILE);

      assert.doesNotMatch(code, /is_organization_admin/,
        'the resolver must not read the organization-administrator flag at all (#106/B-1)');
      assert.doesNotMatch(code, /withTenantAdministratorProfile/,
        'the removed exception must not come back under its old name');
      assert.doesNotMatch(code, /TENANT_ADMINISTRATOR/,
        'no tenant-administrator profile may be applied by the resolver');
      assert.doesNotMatch(code, /capabilities\.add\(/,
        'the resolver must never ADD a capability a mode did not yield');
      assert.match(flatCode(SERVICE_FILE),
        /mode: RESOLUTION_MODES\.EXPLICIT_GRANTS, capabilities: explicit,/,
        'EXPLICIT_GRANTS must return exactly the resolved explicit grant set, unchanged');
    });

    it('A2. no capability, role, permission or vocabulary was added', () => {
      assert.strictEqual(Object.keys(CAPABILITIES).length, 21,
        'the ATM-003-R1 vocabulary is exactly the 21 recognised capabilities');
      assert.strictEqual(V1_HUMAN_GRANTABLE.length, 18,
        'the V1 human-grantable subset is unchanged');
      assert.deepStrictEqual([...NON_HUMAN_GRANTABLE].sort(),
        ['integration.service', 'knowledge.taxonomy_admin', 'platform.admin'].sort(),
        'platform.admin must stay non-human-grantable');
      assert.ok(!V1_HUMAN_GRANTABLE.includes(CAPABILITIES.PLATFORM_ADMIN),
        'platform.admin must never become grantable');
      assert.deepStrictEqual(Object.values(RESOLUTION_MODES).sort(),
        ['EXPLICIT_GRANTS', 'LEGACY_COMPATIBILITY'],
        'there are still exactly two resolution modes and no third state');
      assert.ok(V1_HUMAN_GRANTABLE.includes(CAPABILITIES.ORG_USER_ADMIN),
        'org.user_admin remains grantable, so a legitimate grant is reachable');
    });
  });

  // ---------------------------------------------------------------- B. resolver matrix
  describe('B. resolver matrix (real rows, real grants)', () => {
    const resolve = (key) => resolveCapabilities({ id: U[key] });

    it('B1. role=admin + flag=true + UNRELATED grant confers ONLY that grant', async () => {
      const shape = (await rows('SELECT role, is_organization_admin FROM users WHERE id = $1', [U.ADMIN_UNRELATED]))[0];
      assert.deepStrictEqual(
        { role: shape.role, flag: shape.is_organization_admin },
        { role: 'admin', flag: true },
        'fixture integrity: the row must really be the tenant-administrator shape');

      const resolved = await resolve('ADMIN_UNRELATED');
      assert.strictEqual(resolved.mode, RESOLUTION_MODES.EXPLICIT_GRANTS);
      assert.deepStrictEqual([...resolved.capabilities].sort(), [UNRELATED],
        'an unrelated grant must not confer user-administration');
      assert.ok(!resolved.capabilities.has(ORG_USER_ADMIN));
      assert.ok(!resolved.capabilities.has(ORG_CONFIG_ADMIN));
    });

    it('B2. role=admin + flag=FALSE + unrelated grant behaves identically (the flag is irrelevant)', async () => {
      const resolved = await resolve('ADMIN_NOFLAG_UNRELATED');
      assert.strictEqual(resolved.mode, RESOLUTION_MODES.EXPLICIT_GRANTS);
      assert.deepStrictEqual([...resolved.capabilities].sort(), [UNRELATED],
        'the flag must not change the EXPLICIT_GRANTS outcome in either direction');
    });

    it('B3. role=operator + flag=true + unrelated grant confers only that grant', async () => {
      const resolved = await resolve('OPERATOR_FLAG_UNRELATED');
      assert.strictEqual(resolved.mode, RESOLUTION_MODES.EXPLICIT_GRANTS);
      assert.deepStrictEqual([...resolved.capabilities].sort(), [UNRELATED],
        'a non-admin role must never gain org.user_admin from the flag');
      assert.ok(!resolved.capabilities.has(ORG_USER_ADMIN));
    });

    it('B4. an EXPLICIT org.user_admin grant IS preserved, and drags nothing with it', async () => {
      const resolved = await resolve('ADMIN_USER_ADMIN');
      assert.strictEqual(resolved.mode, RESOLUTION_MODES.EXPLICIT_GRANTS);
      assert.deepStrictEqual([...resolved.capabilities].sort(), [ORG_USER_ADMIN],
        'a legitimate explicit grant is preserved EXACTLY, with no sibling inference');
      assert.ok(!resolved.capabilities.has(ORG_CONFIG_ADMIN),
        'the sibling profile entry must NOT be inferred from org.user_admin');
    });

    it('B5. an explicit org.config_admin grant confers NOTHING else (sibling non-inference)', async () => {
      const resolved = await resolve('ADMIN_CONFIG_ONLY');
      assert.strictEqual(resolved.mode, RESOLUTION_MODES.EXPLICIT_GRANTS);
      assert.deepStrictEqual([...resolved.capabilities].sort(), [ORG_CONFIG_ADMIN]);
      assert.ok(!resolved.capabilities.has(ORG_USER_ADMIN),
        'the ADJACENT half of the ATM-003-R1 §4 profile must not be inferred');
    });

    it('B6. an operator holding an explicit org.user_admin keeps it (capability gate, not role issuance)', async () => {
      const resolved = await resolve('OPERATOR_USER_ADMIN');
      assert.deepStrictEqual([...resolved.capabilities].sort(), [ORG_USER_ADMIN],
        'the capability is held because it was granted, not because of any role');
    });

    it('B7. LEGACY_COMPATIBILITY parity is unchanged: the un-granted admin keeps the R1 profile', async () => {
      const resolved = await resolve('ADMIN_LEGACY');
      assert.strictEqual(resolved.mode, RESOLUTION_MODES.LEGACY_COMPATIBILITY);
      assert.ok(resolved.capabilities.has(ORG_USER_ADMIN), 'legacy admin bundle unchanged');
      assert.ok(resolved.capabilities.has(ORG_CONFIG_ADMIN), 'legacy admin bundle unchanged');
      assert.strictEqual(await activeGrantCount(U.ADMIN_LEGACY), 0,
        'fixture integrity: the legacy principal really holds no active grant');
    });

    it('B8. the un-granted operator gains nothing from legacy mode', async () => {
      const resolved = await resolve('OPERATOR_LEGACY');
      assert.strictEqual(resolved.mode, RESOLUTION_MODES.LEGACY_COMPATIBILITY);
      assert.ok(!resolved.capabilities.has(ORG_USER_ADMIN));
      assert.ok(!resolved.capabilities.has(ORG_CONFIG_ADMIN));
    });
  });

  // ---------------------------------------------------------------- C. transition
  describe('C. the TRANSITION between resolution modes', () => {
    it('C1. legacy -> explicit -> revoked -> legacy, with the authority following each time', async () => {
      // Precondition: no ACTIVE grant, so the principal resolves by legacy bundle.
      await revokeActiveGrants(U.TRANSITION);
      assert.strictEqual(await activeGrantCount(U.TRANSITION), 0, 'transition precondition');

      const legacy = await resolveCapabilities({ id: U.TRANSITION });
      assert.strictEqual(legacy.mode, RESOLUTION_MODES.LEGACY_COMPATIBILITY);
      assert.ok(legacy.capabilities.has(ORG_USER_ADMIN),
        'before the grant the tenant administrator has its legacy profile');

      // TRANSITION: issue ONE unrelated grant (a real row, attributed).
      await rows(
        `INSERT INTO user_capabilities (user_id, organization_id, capability, source, granted_by_user_id)
         VALUES ($1, $2, $3, 'explicit', $4)`, [U.TRANSITION, ORG, UNRELATED, U.ADMIN_LEGACY]);

      const explicit = await resolveCapabilities({ id: U.TRANSITION });
      assert.strictEqual(explicit.mode, RESOLUTION_MODES.EXPLICIT_GRANTS,
        'one active grant switches the mode');
      assert.deepStrictEqual([...explicit.capabilities].sort(), [UNRELATED],
        'the transition must NOT carry org.user_admin across (#106/B-1)');
      assert.ok(!explicit.capabilities.has(ORG_USER_ADMIN));

      // Revocation returns the principal to compatibility: a revoked grant is not
      // an active grant, and the mode rule is unchanged.
      await revokeActiveGrants(U.TRANSITION);
      assert.strictEqual(await activeGrantCount(U.TRANSITION), 0);
      const revoked = await resolveCapabilities({ id: U.TRANSITION });
      assert.strictEqual(revoked.mode, RESOLUTION_MODES.LEGACY_COMPATIBILITY);
      assert.ok(revoked.capabilities.has(ORG_USER_ADMIN),
        'a revoked grant must not be treated as an active grant');
      assert.ok(revoked.capabilities.has(ORG_CONFIG_ADMIN));
    });
  });

  // ---------------------------------------------------------------- D. routes, real effects
  describe('D. org.user_admin routes END TO END, with database effects', () => {
    it('D1. GET /api/invitations: the flagged granted administrator is refused and sees no row', async () => {
      await insertInvitation('LIST_REFUSED');
      const response = await get('/api/invitations', { as: 'ADMIN_UNRELATED' });

      assert.strictEqual(response.status, 403,
        `an unrelated grant must not confer org.user_admin: ${response.text}`);
      assert.match(response.text, /org\.user_admin is required/);
      assert.strictEqual(disclosedTokens(response.text), 0,
        'a refusal must not disclose any invitation credential');
      // The row the principal was refused still exists, i.e. the refusal is
      // authorization and not an empty tenant.
      assert.strictEqual((await invitationRow(INV.LIST_REFUSED.id)).status, 'pending');
    });

    it('D2. GET /api/invitations: an explicit org.user_admin holder IS admitted (positive control)', async () => {
      const response = await get('/api/invitations', { as: 'ADMIN_USER_ADMIN' });
      assert.strictEqual(response.status, 200,
        `a legitimate explicit grant must still work: ${response.text}`);
      const returned = (response.json?.data?.invitations || []).map((r) => Number(r.id)).sort();
      const expected = (await invitationsForOrg()).map((r) => Number(r.id)).sort();
      assert.deepStrictEqual(returned, expected,
        'the admitted principal sees exactly its own tenant rows');
      assert.strictEqual(disclosedTokens(response.text), 0,
        'the listing must never serialise an enrollment token');
    });

    it('D3. POST resend: the flagged granted administrator is refused and NO row is written', async () => {
      const inv = await insertInvitation('RESEND_REFUSED', { role: 'admin' });
      const before = await invitationsForOrg();
      delivered = [];

      const response = await post(`/api/invitations/${inv.id}/resend`, null, { as: 'ADMIN_UNRELATED' });

      assert.strictEqual(response.status, 403,
        `an unrelated grant must not authorize a resend, least of all an ADMIN invitation: ${response.text}`);
      assert.strictEqual(disclosedTokens(response.text), 0, 'a refusal must issue no token');
      assert.deepStrictEqual(await invitationsForOrg(), before,
        'database effect: a refusal writes NO row and retires nothing');
      assert.strictEqual((await invitationRow(inv.id)).status, 'pending', 'the original is untouched');
      assert.strictEqual(delivered.length, 0, 'a refusal delivers nothing');
    });

    it('D4. POST resend: an explicit org.user_admin holder IS admitted and the real rows change', async () => {
      const inv = await insertInvitation('RESEND_ALLOWED', { role: 'admin' });
      delivered = [];

      const response = await post(`/api/invitations/${inv.id}/resend`, null, { as: 'ADMIN_USER_ADMIN' });

      assert.strictEqual(response.status, 200,
        `an explicit org.user_admin plus administrator-role authority may re-issue: ${response.text}`);
      const after = await invitationsForOrg();
      const replacements = after.filter((r) => r.email === inv.email && Number(r.id) !== inv.id);
      assert.strictEqual(replacements.length, 1, 'exactly one replacement row is persisted');
      assert.strictEqual(replacements[0].role, 'admin', 'the stored role is preserved');
      assert.strictEqual(replacements[0].status, 'pending');
      assert.strictEqual((await invitationRow(inv.id)).status, 'cancelled',
        'the predecessor is retired in the same transaction (D-1 repair)');
    });

    it('D5. POST resend: an explicit org.config_admin holder is refused (no sibling inference)', async () => {
      const inv = await insertInvitation('RESEND_CONFIG_ONLY', { role: 'operator' });
      const before = await invitationsForOrg();

      const response = await post(`/api/invitations/${inv.id}/resend`, null, { as: 'ADMIN_CONFIG_ONLY' });

      assert.strictEqual(response.status, 403,
        `org.config_admin must not imply org.user_admin: ${response.text}`);
      assert.deepStrictEqual(await invitationsForOrg(), before, 'database effect: no row written');
      assert.strictEqual((await invitationRow(inv.id)).status, 'pending');
    });

    it('D6. DELETE /api/invitations/:id: refused for the flagged granted administrator, with no state change', async () => {
      const inv = await insertInvitation('CANCEL_REFUSED');

      const response = await del(`/api/invitations/${inv.id}`, { as: 'ADMIN_UNRELATED' });

      assert.strictEqual(response.status, 403,
        `an unrelated grant must not authorize cancellation: ${response.text}`);
      assert.strictEqual((await invitationRow(inv.id)).status, 'pending',
        'database effect: the invitation is still pending');
    });

    it('D7. DELETE /api/invitations/:id: an explicit org.user_admin holder cancels, and the row changes', async () => {
      const inv = await insertInvitation('CANCEL_ALLOWED');

      const response = await del(`/api/invitations/${inv.id}`, { as: 'ADMIN_USER_ADMIN' });

      assert.strictEqual(response.status, 200, `a legitimate grant must still work: ${response.text}`);
      assert.strictEqual((await invitationRow(inv.id)).status, 'cancelled',
        'database effect: the row really moved pending -> cancelled');
    });

    it('D8. POST /api/invitations is NOT org.user_admin-gated and is UNCHANGED (no widening, no narrowing)', async () => {
      const email = `sec106-b1-created-${tag()}@test.local`;
      delivered = [];

      const response = await withSeatMaskNeutralized(() =>
        post('/api/invitations', { email, role: 'operator' }, { as: 'ADMIN_UNRELATED' }));

      assert.strictEqual(response.status, 201,
        `the creation route carries the legacy requireAdmin + role-issuance guard, not org.user_admin: ${response.text}`);
      const persisted = (await invitationsForOrg()).filter((r) => r.email === email);
      assert.strictEqual(persisted.length, 1, 'database effect: the invitation row is persisted');
      assert.strictEqual(persisted[0].status, 'pending');
      assert.strictEqual(persisted[0].role, 'operator');
    });

    it('D9. PUT /api/organizations/:id is refused for the flagged granted administrator, with no write', async () => {
      const before = (await rows('SELECT billing_address FROM organizations WHERE id = $1', [ORG]))[0];
      const marker = `sec106-b1-refused-${tag()}`;

      const response = await call('PUT', `/api/organizations/${ORG}`, {
        as: 'ADMIN_UNRELATED', body: { billing_address: marker }
      });

      assert.strictEqual(response.status, 403,
        `an unrelated grant must not confer org.config_admin: ${response.text}`);
      const after = (await rows('SELECT billing_address FROM organizations WHERE id = $1', [ORG]))[0];
      assert.strictEqual(after.billing_address, before.billing_address,
        'database effect: the refused profile update wrote nothing');
    });

    it('D10. PUT /api/organizations/:id still works for an explicit org.config_admin holder', async () => {
      const marker = `sec106-b1-allowed-${tag()}`;

      const response = await call('PUT', `/api/organizations/${ORG}`, {
        as: 'ADMIN_CONFIG_ONLY', body: { billing_address: marker }
      });

      assert.strictEqual(response.status, 200, `a legitimate grant must still work: ${response.text}`);
      const after = (await rows('SELECT billing_address FROM organizations WHERE id = $1', [ORG]))[0];
      assert.strictEqual(after.billing_address, marker,
        'database effect: the explicitly granted profile write is persisted');
    });
  });

  // ---------------------------------------------------------------- E. adversarial
  describe('E. adversarial reproducers (these FAIL if the inference is re-widened)', () => {
    it('E1. EVERY org.user_admin-gated route refuses the exact B-1 principal and mutates nothing', async () => {
      const inv = await insertInvitation('ADVERSARIAL', { role: 'admin' });
      const before = await invitationsForOrg();
      delivered = [];

      const attempts = [
        ['GET', '/api/invitations'],
        ['DELETE', `/api/invitations/${inv.id}`],
        ['POST', `/api/invitations/${inv.id}/resend`]
      ];

      for (const [method, requestPath] of attempts) {
        const response = await call(method, requestPath, { as: 'ADMIN_UNRELATED' });
        assert.strictEqual(response.status, 403,
          `${method} ${requestPath}: role='admin' + is_organization_admin=true + one unrelated grant must not confer org.user_admin`);
        assert.strictEqual(disclosedTokens(response.text), 0,
          `${method} ${requestPath}: a refusal must disclose no credential`);
      }

      assert.deepStrictEqual(await invitationsForOrg(), before,
        'adversarial: no gated route may mutate state for the B-1 principal');
      assert.strictEqual((await invitationRow(inv.id)).status, 'pending');
      assert.strictEqual(delivered.length, 0);
    });

    it('E2. the schema is a second independent gate: an unknown or non-grantable row cannot exist', async () => {
      // The resolver filters unrecognised and non-human-grantable identifiers, and
      // migration 022's CHECK constraint refuses to store them at all. Both gates
      // must fail closed, so neither a malformed nor a platform-scoped grant can
      // ever become the "unrelated grant" that flips a principal into explicit
      // mode — nor confer anything.
      for (const capability of [`not.a.capability.${tag()}`, 'platform.admin', 'integration.service']) {
        await assert.rejects(
          () => rows(
            `INSERT INTO user_capabilities (user_id, organization_id, capability, source, granted_by_user_id)
             VALUES ($1, $2, $3, 'explicit', $4)`, [U.ADMIN_UNRELATED, ORG, capability, U.ADMIN_LEGACY]),
          /chk_user_capabilities_grantable|violates check constraint/i,
          `${capability} must be unrepresentable in the grant table`);
      }

      const resolved = await resolveCapabilities({ id: U.ADMIN_UNRELATED });
      assert.deepStrictEqual([...resolved.capabilities].sort(), [UNRELATED],
        'the principal is unchanged by the refused inserts');

      const response = await get('/api/invitations', { as: 'ADMIN_UNRELATED' });
      assert.strictEqual(response.status, 403, 'the route must still refuse the principal');
    });

    it('E3. users.role is schema-constrained, so no unrecognised role can be reached', async () => {
      // The resolver's "an unrecognised role resolves to nothing rather than to a
      // default" branch is defence in depth. It must not be reachable as a GRANT
      // path, and the schema is the reason: users.role admits only the three
      // roles the legacy bundles enumerate.
      await assert.rejects(
        () => rows(`UPDATE users SET role = 'quality_reviewer' WHERE id = $1`, [U.ADMIN_LEGACY]),
        /chk_users_role|violates check constraint/i,
        'an unrecognised role must be unrepresentable, or the legacy path is reachable with an unknown role');

      const roles = await rows(
        'SELECT DISTINCT role FROM users WHERE id = ANY($1::int[])',
        [[U.ADMIN_UNRELATED, U.ADMIN_LEGACY, U.OPERATOR_LEGACY]]);
      for (const row of roles) {
        assert.ok(['admin', 'supervisor', 'operator'].includes(row.role),
          `only the three enumerated roles may exist, saw ${row.role}`);
      }

      // Restore/verify: the legacy administrator still holds the approved R1
      // profile (nothing in this suite perturbed it) and the granted principal
      // still holds exactly its grant.
      const legacyRestored = await resolveCapabilities({ id: U.ADMIN_LEGACY });
      assert.ok(legacyRestored.capabilities.has(ORG_USER_ADMIN),
        'the legacy administrator still holds the R1 profile');
      const explicitRestored = await resolveCapabilities({ id: U.ADMIN_UNRELATED });
      assert.deepStrictEqual([...explicitRestored.capabilities].sort(), [UNRELATED]);
    });
  });

  // ---------------------------------------------------------------- F. residue
  describe('F. fixture integrity and documented residue', () => {
    it('F1. every fixture grant is a real, active, tenant-scoped, attributed row', async () => {
      for (const [key, shape] of Object.entries(SHAPES)) {
        const grants = await grantRows(U[key]);
        const active = grants.filter((g) => g.revoked_at === null).map((g) => g.capability).sort();
        // TRANSITION is normalised to zero active grants by section C.
        const expected = (key === 'TRANSITION' ? [] : [...shape.grants]).sort();
        assert.deepStrictEqual(active, expected,
          `${key}: active grants must be exactly the fixture's, and every row must carry attribution`);
      }
      const unattributed = await rows(
        `SELECT count(*)::int AS c FROM user_capabilities
          WHERE organization_id = $1 AND granted_by_user_id IS NULL`, [ORG]);
      assert.strictEqual(unattributed[0].c, 0, 'every grant must be attributed to a grantor');
    });
  });
});
