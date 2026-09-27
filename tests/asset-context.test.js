/**
 * ATM-002-I2C — trustworthy asset context and QR tenant-scoping repair.
 *
 * Proves the single authoritative resolver is tenant-safe and fail-closed, that
 * only a RESOLVED outcome carries any asset field, that the Atiman projection
 * discloses nothing outside its approved field set, and that all three proven
 * legacy cross-tenant lookup defects are closed at the reachable boundary.
 *
 * Evidence policy: the HTTP layer is exercised against the real Express app with
 * real JWTs, so authentication, routing, guards and the rendered payload are all
 * production-shaped rather than simulated. Resolver claims that the HTTP layer
 * cannot express (ambiguity, the exact outcome vocabulary, malformed input) are
 * asserted by invoking the resolver directly. Where a claim is about what is
 * ABSENT, the assertion is made against the serialised response body, not against
 * a hand-picked field list.
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * src/config/database.js uses to select test-database credentials, so it can never
 * run against runtime credentials.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { getConnection, isIntegrationTest } = require('../src/config/database');
const {
  resolveAsset,
  IDENTIFIER_TYPES,
  RESOLUTION_OUTCOMES,
  ASSET_CONTEXT_FIELDS,
  MAX_IDENTIFIER_LENGTH
} = require('../src/services/asset-context.service');
const { readIdentifier } = require('../src/controllers/asset-context.controller');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating asset-context suite requires the sanctioned database-test '
    + 'gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that test-database '
    + 'credentials are used instead of runtime credentials; run it via '
    + '`npm run test:integration`';

const JWT_SECRET = 'test-only-jwt-secret-not-for-production-000000';
const REPO_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
// Identity is captured from the database and every code is unique per run, so this
// suite is safe on a long-lived shared test database and cannot collide with any
// other suite's fixtures.

let ORG_A = null;
let ORG_B = null;
let FAC_A = null;
let FAC_B = null;
let ASSET_A1 = null;      // ORG_A / FAC_A — the primary resolvable asset
let ASSET_A2 = null;      // ORG_A / FAC_A — a second asset, for ambiguity checks
let ASSET_B1 = null;      // ORG_B / FAC_B — another tenant's asset
let ASSET_UNOWNED = null; // organization_id NULL
let ASSET_CROSS_FACILITY = null; // ORG_A, but facility_id points at ORG_B's facility
let USER_A = null;
let USER_B = null;
let USER_NO_ORG = null;
let USER_INACTIVE = null;

let ID_A1 = {};           // the three identifiers of ASSET_A1
let ID_B1 = {};           // the three identifiers of ASSET_B1
let ID_UNOWNED = {};
let ID_CROSS_FACILITY = {};

let seq = 0;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`;
const tag = () => `${RUN}${(++seq).toString(36)}`;

/** A 32-character opaque token, matching `equipment.qr_token VARCHAR(32)`. */
const token = (seed) => `t${seed}`.padEnd(32, '0').slice(0, 32);

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
  return rows.length ? Number(Object.values(rows[0])[0]) : null;
};

/** The raw first column of a single row, with no numeric coercion. */
const scalarValue = async (sql, params = []) => {
  const rows = await withConn((conn) => conn.query(sql, params));
  return rows.length ? Object.values(rows[0])[0] : null;
};

async function ensureFixture() {
  await withConn(async (conn) => {
    const orgs = await conn.query(
      `INSERT INTO organizations (organization_name) VALUES ($1), ($2) RETURNING id`,
      [`I2C Org A ${RUN}`, `I2C Org B ${RUN}`]);
    [ORG_A, ORG_B] = orgs.map((row) => Number(row.id));

    const facilities = await conn.query(
      `INSERT INTO facilities (organization_id, name, code, facility_type, sap_reference_code)
       VALUES ($1, 'I2C Facility A', $3, 'WTP', 'SAP-FAC-A'),
              ($2, 'I2C Facility B', $4, 'WTP', 'SAP-FAC-B')
       RETURNING id`,
      [ORG_A, ORG_B, `FA-${RUN}`, `FB-${RUN}`]);
    [FAC_A, FAC_B] = facilities.map((row) => Number(row.id));

    const category = await conn.query(
      `INSERT INTO equipment_categories (category_code, category_name)
       VALUES ($1, 'I2C Category') RETURNING id`, [`CAT-${RUN}`]);
    const klass = await conn.query(
      `INSERT INTO equipment_classes (category_id, class_code, class_name)
       VALUES ($1, $2, 'I2C Class') RETURNING id`, [category[0].id, `CLS-${RUN}`]);
    const etype = await conn.query(
      `INSERT INTO equipment_types (class_id, type_code, type_name)
       VALUES ($1, $2, 'I2C Equipment Type') RETURNING id`, [klass[0].id, `TYP-${RUN}`]);
    const ETYPE = Number(etype[0].id);

    const assets = await conn.query(
      `INSERT INTO equipment (organization_id, facility_id, name, code, qr_token, qr_code,
                              equipment_type_id, status, criticality, sap_equipment_reference, sap_floc_hint)
       VALUES ($1, $2, 'I2C Pump Alpha',   $5,  $9,  $13, $17, 'operational', 'high',   'SAP-EQ-A1', 'SAP-FLOC-A1'),
              ($1, $2, 'I2C Pump Beta',    $6,  $10, $14, $17, 'maintenance', 'medium', 'SAP-EQ-A2', 'SAP-FLOC-A2'),
              ($3, $4, 'I2C Pump Gamma',   $7,  $11, $15, $17, 'operational', 'low',    'SAP-EQ-B1', 'SAP-FLOC-B1'),
              (NULL, $2, 'I2C Unowned Pump', $8, $12, $16, $17, 'operational', 'low',    'SAP-EQ-U1', 'SAP-FLOC-U1')
       RETURNING id`,
      [ORG_A, FAC_A, ORG_B, FAC_B,
        `A1-${RUN}`, `A2-${RUN}`, `B1-${RUN}`, `U1-${RUN}`,
        token(`a1${RUN}`), token(`a2${RUN}`), token(`b1${RUN}`), token(`u1${RUN}`),
        `QA1-${RUN}`, `QA2-${RUN}`, `QB1-${RUN}`, `QU1-${RUN}`,
        ETYPE]);
    [ASSET_A1, ASSET_A2, ASSET_B1, ASSET_UNOWNED] = assets.map((row) => Number(row.id));

    // An asset in ORG_A whose facility column points at ORG_B's facility. The
    // legacy foreign key carries no tenant constraint, so this state is
    // representable and the projection must never leak that facility.
    const cross = await conn.query(
      `INSERT INTO equipment (organization_id, facility_id, name, code, qr_token, qr_code)
       VALUES ($1, $2, 'I2C Cross-Facility Pump', $3, $4, $5) RETURNING id`,
      [ORG_A, FAC_B, `XF-${RUN}`, token(`xf${RUN}`), `QXF-${RUN}`]);
    ASSET_CROSS_FACILITY = Number(cross[0].id);

    ID_A1 = { token: token(`a1${RUN}`), qrCode: `QA1-${RUN}`, code: `A1-${RUN}` };
    ID_B1 = { token: token(`b1${RUN}`), qrCode: `QB1-${RUN}`, code: `B1-${RUN}` };
    ID_UNOWNED = { token: token(`u1${RUN}`), qrCode: `QU1-${RUN}`, code: `U1-${RUN}` };
    ID_CROSS_FACILITY = { token: token(`xf${RUN}`), qrCode: `QXF-${RUN}`, code: `XF-${RUN}` };

    const users = await conn.query(
      `INSERT INTO users (organization_id, username, email, password_hash, full_name, role, is_active)
       VALUES ($1, $3, $3, 'x', 'I2C Operator A', 'operator', true),
              ($2, $4, $4, 'x', 'I2C Operator B', 'operator', true),
              (NULL, $5, $5, 'x', 'I2C No Org', 'operator', true),
              ($1, $6, $6, 'x', 'I2C Inactive', 'operator', false)
       RETURNING id`,
      [ORG_A, ORG_B,
        `i2c-a-${RUN}@test.local`, `i2c-b-${RUN}@test.local`,
        `i2c-none-${RUN}@test.local`, `i2c-off-${RUN}@test.local`]);
    [USER_A, USER_B, USER_NO_ORG, USER_INACTIVE] = users.map((row) => Number(row.id));
  });
}

// ---------------------------------------------------------------------------
// HTTP harness — the real application, real JWTs
// ---------------------------------------------------------------------------

let server = null;
let port = null;

function call(method, requestPath, { userId, followRedirect } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: requestPath,
      headers: userId ? { Authorization: `Bearer ${jwt.sign({ userId }, JWT_SECRET)}` } : {}
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const result = {
          status: res.statusCode,
          location: res.headers.location || null,
          text: data
        };
        if (followRedirect && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(call('GET', res.headers.location, { userId }).then((next) => ({ ...next, from: result })));
          return;
        }
        resolve(result);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const get = (p, opts) => call('GET', p, opts);

const asTenantA = (p, opts = {}) => get(p, { userId: USER_A, ...opts });
const asTenantB = (p, opts = {}) => get(p, { userId: USER_B, ...opts });

// ==========================================================================

describe('ATM-002-I2C trustworthy asset context', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => {
    await ensureFixture();
    process.env.JWT_SECRET = JWT_SECRET;
    const app = require('../src/app');
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  // ------------------------------------------------------------------ A. auth

  describe('A. authentication', () => {
    it('1. anonymous access to every asset-context path fails closed', async () => {
      const tokenLookup = await get(`/api/equipment/qr/lookup/${ID_A1.token}`);
      assert.strictEqual(tokenLookup.status, 401, 'the equipment token lookup must require authentication');
      assert.ok(!tokenLookup.text.includes('I2C Pump Alpha'),
        'an unauthenticated response must not contain asset data');

      const mobileAsset = await get(`/api/m/asset/${ID_A1.token}`);
      assert.strictEqual(mobileAsset.status, 401,
        'DEFECT B: the QR asset page must no longer answer an anonymous caller');
      assert.ok(!mobileAsset.text.includes('I2C Pump Alpha'));
      assert.ok(!/sap_equipment_reference|sap_floc_hint|facility_sap_ref/i.test(mobileAsset.text),
        'no SAP reference may appear in an anonymous response');
      assert.ok(!/recent_findings|recent_inspections/.test(mobileAsset.text),
        'no finding or inspection payload may appear in an anonymous response');

      const page = await get(`/atiman/asset?code=${encodeURIComponent(ID_A1.code)}`);
      assert.strictEqual(page.status, 302, 'the Atiman asset page must redirect an anonymous caller');
      assert.match(page.location, /^\/mobile\/login/);
      assert.ok(!page.text.includes('I2C Pump Alpha'));

      const legacy = await get(`/mobile/asset?code=${encodeURIComponent(ID_A1.code)}`);
      assert.ok(legacy.status >= 300 && legacy.status < 400,
        'the legacy entry must not render asset data itself');
    });

    it('2. an authenticated tenant principal resolves its own asset on every path', async () => {
      const viaToken = await asTenantA(`/api/equipment/qr/lookup/${ID_A1.token}`);
      assert.strictEqual(viaToken.status, 200);
      assert.strictEqual(JSON.parse(viaToken.text).data.equipment.id, ASSET_A1);

      const viaMobile = await asTenantA(`/api/m/asset/${ID_A1.token}`);
      assert.strictEqual(viaMobile.status, 200);
      assert.strictEqual(JSON.parse(viaMobile.text).data.asset.id, ASSET_A1);

      const viaPage = await asTenantA(`/atiman/asset?code=${encodeURIComponent(ID_A1.code)}`);
      assert.strictEqual(viaPage.status, 200);
      assert.ok(viaPage.text.includes('I2C Pump Alpha'), 'the page renders the resolved asset');

      const viaTokenPage = await asTenantA(`/atiman/asset?token=${encodeURIComponent(ID_A1.token)}`);
      assert.strictEqual(viaTokenPage.status, 200);
      assert.ok(viaTokenPage.text.includes('I2C Pump Alpha'));
    });

    it('3. a principal with no organization fails closed', async () => {
      const direct = await resolveAsset({ organizationId: null }, { type: IDENTIFIER_TYPES.CODE, value: ID_A1.code });
      assert.strictEqual(direct.outcome, RESOLUTION_OUTCOMES.ORGANIZATION_REQUIRED);
      assert.strictEqual(direct.asset, null);

      const viaApi = await get(`/api/equipment/qr/lookup/${ID_A1.token}`, { userId: USER_NO_ORG });
      assert.strictEqual(viaApi.status, 404, 'no tenant means no resolution');
      assert.ok(!viaApi.text.includes('I2C Pump Alpha'));

      const viaPage = await get(`/atiman/asset?code=${encodeURIComponent(ID_A1.code)}`, { userId: USER_NO_ORG });
      assert.strictEqual(viaPage.status, 200);
      assert.ok(!viaPage.text.includes('I2C Pump Alpha'));
      assert.match(viaPage.text, /not associated with an organization/i,
        'the experience must state why nothing could be resolved');
    });

    it('4. an inactive principal fails closed through the existing authentication architecture', async () => {
      const viaApi = await get(`/api/equipment/qr/lookup/${ID_A1.token}`, { userId: USER_INACTIVE });
      assert.strictEqual(viaApi.status, 401, 'an inactive principal is not authenticated');

      const viaPage = await get(`/atiman/asset?code=${encodeURIComponent(ID_A1.code)}`, { userId: USER_INACTIVE });
      assert.strictEqual(viaPage.status, 302);
      assert.match(viaPage.location, /^\/mobile\/login/);

      const invalid = await get(`/api/equipment/qr/lookup/${ID_A1.token}`, { userId: 987654321 });
      assert.strictEqual(invalid.status, 401, 'an unknown principal is not authenticated');
    });
  });

  // --------------------------------------------------------------- B. tenancy

  describe('B. tenant isolation', () => {
    it('5. tenant A cannot receive tenant B asset by opaque token', async () => {
      const resolution = await resolveAsset({ organizationId: ORG_A },
        { type: IDENTIFIER_TYPES.QR_TOKEN, value: ID_B1.token });
      assert.strictEqual(resolution.outcome, RESOLUTION_OUTCOMES.FOREIGN_TENANT);
      assert.strictEqual(resolution.asset, null, 'a foreign outcome carries no asset');

      const viaApi = await asTenantA(`/api/equipment/qr/lookup/${ID_B1.token}`);
      assert.strictEqual(viaApi.status, 404, 'the API collapses foreign and absent');
      assert.ok(!viaApi.text.includes('I2C Pump Gamma'));

      const viaMobile = await asTenantA(`/api/m/asset/${ID_B1.token}`);
      assert.strictEqual(viaMobile.status, 404);
      assert.ok(!viaMobile.text.includes('I2C Pump Gamma'));
    });

    it('6. tenant A cannot receive tenant B asset by qr_code', async () => {
      const resolution = await resolveAsset({ organizationId: ORG_A },
        { type: IDENTIFIER_TYPES.CODE, value: ID_B1.qrCode });
      assert.strictEqual(resolution.outcome, RESOLUTION_OUTCOMES.FOREIGN_TENANT);
      assert.strictEqual(resolution.asset, null);

      const viaPage = await asTenantA(`/atiman/asset?code=${encodeURIComponent(ID_B1.qrCode)}`);
      assert.strictEqual(viaPage.status, 200);
      assert.ok(!/I2C Pump Gamma|QB1-|I2C Facility B|SAP-EQ-B1|SAP-FLOC-B1|I2C Equipment Type/.test(viaPage.text),
        'no foreign asset detail may appear anywhere in the rendered page');
      assert.match(viaPage.text, /belongs to another organization/i,
        'ATM-002-R7 §10.2 requires the different-tenant outcome to be stated');
    });

    it('7. tenant A cannot receive tenant B asset by asset code', async () => {
      const resolution = await resolveAsset({ organizationId: ORG_A },
        { type: IDENTIFIER_TYPES.CODE, value: ID_B1.code });
      assert.strictEqual(resolution.outcome, RESOLUTION_OUTCOMES.FOREIGN_TENANT);
      assert.strictEqual(resolution.asset, null);

      const viaPage = await asTenantA(`/atiman/asset?code=${encodeURIComponent(ID_B1.code)}`);
      assert.ok(!viaPage.text.includes('I2C Pump Gamma'));

      // And symmetrically: tenant B cannot see tenant A's asset.
      const mirrored = await asTenantB(`/atiman/asset?code=${encodeURIComponent(ID_A1.code)}`);
      assert.ok(!/I2C Pump Alpha|I2C Facility A|SAP-EQ-A1/.test(mirrored.text));
      assert.match(mirrored.text, /belongs to another organization/i);
    });

    it('8. no response carries a single foreign asset field', async () => {
      // Every string the foreign asset legitimately owns, including its EAM
      // references, must be absent from every response shape.
      const foreignDetail = [
        'I2C Pump Gamma', ID_B1.code, ID_B1.qrCode, ID_B1.token,
        'I2C Facility B', `FB-${RUN}`, 'SAP-EQ-B1', 'SAP-FLOC-B1', 'SAP-FAC-B'
      ];

      const responses = await Promise.all([
        asTenantA(`/atiman/asset?code=${encodeURIComponent(ID_B1.code)}`),
        asTenantA(`/atiman/asset?token=${encodeURIComponent(ID_B1.token)}`),
        asTenantA(`/api/equipment/qr/lookup/${ID_B1.token}`),
        asTenantA(`/api/m/asset/${ID_B1.token}`),
        asTenantA(`/mobile/asset?code=${encodeURIComponent(ID_B1.code)}`, { followRedirect: true })
      ]);

      for (const response of responses) {
        for (const detail of foreignDetail) {
          assert.ok(!response.text.includes(detail),
            `response leaked foreign detail ${JSON.stringify(detail)}`);
        }
      }

      // And the resolver's own contract: only RESOLVED may carry a payload.
      for (const identifier of [
        { type: IDENTIFIER_TYPES.QR_TOKEN, value: ID_B1.token },
        { type: IDENTIFIER_TYPES.CODE, value: ID_B1.code },
        { type: IDENTIFIER_TYPES.CODE, value: ID_B1.qrCode }
      ]) {
        const resolution = await resolveAsset({ organizationId: ORG_A }, identifier);
        assert.notStrictEqual(resolution.outcome, RESOLUTION_OUTCOMES.RESOLVED);
        assert.strictEqual(resolution.asset, null);
      }
    });

    it('9. an asset belonging to no organization can never be resolved operationally', async () => {
      assert.strictEqual(
        await scalar('SELECT organization_id IS NULL FROM equipment WHERE id = $1', [ASSET_UNOWNED]), 1,
        'the fixture must genuinely have no organization');

      for (const identifier of [
        { type: IDENTIFIER_TYPES.QR_TOKEN, value: ID_UNOWNED.token },
        { type: IDENTIFIER_TYPES.CODE, value: ID_UNOWNED.code }
      ]) {
        const resolution = await resolveAsset({ organizationId: ORG_A }, identifier);
        assert.strictEqual(resolution.outcome, RESOLUTION_OUTCOMES.UNOWNED_ASSET);
        assert.strictEqual(resolution.asset, null);
      }

      const viaApi = await asTenantA(`/api/equipment/qr/lookup/${ID_UNOWNED.token}`);
      assert.strictEqual(viaApi.status, 404);

      const viaPage = await asTenantA(`/atiman/asset?code=${encodeURIComponent(ID_UNOWNED.code)}`);
      assert.ok(!viaPage.text.includes('I2C Unowned Pump'));
      assert.match(viaPage.text, /not registered to an organization/i);
    });

    it('never projects a facility that belongs to another tenant', async () => {
      const resolution = await resolveAsset({ organizationId: ORG_A },
        { type: IDENTIFIER_TYPES.CODE, value: ID_CROSS_FACILITY.code });
      assert.strictEqual(resolution.outcome, RESOLUTION_OUTCOMES.RESOLVED);
      assert.strictEqual(resolution.asset.id, ASSET_CROSS_FACILITY);
      assert.strictEqual(resolution.asset.facility, null,
        'an asset pointing at another tenant\'s facility must not disclose that facility');

      const viaPage = await asTenantA(`/atiman/asset?code=${encodeURIComponent(ID_CROSS_FACILITY.code)}`);
      assert.ok(!/I2C Facility B|FB-|SAP-FAC-B/.test(viaPage.text));
      assert.match(viaPage.text, /Not recorded for this asset/);
    });
  });

  // ----------------------------------------------------- C. identifier rules

  describe('C. identifier behaviour', () => {
    it('10. a valid opaque token resolves the correct same-tenant asset', async () => {
      const resolution = await resolveAsset({ organizationId: ORG_A },
        { type: IDENTIFIER_TYPES.QR_TOKEN, value: ID_A1.token });
      assert.strictEqual(resolution.outcome, RESOLUTION_OUTCOMES.RESOLVED);
      assert.strictEqual(resolution.asset.id, ASSET_A1);

      // An opaque token must not be usable as a code, and vice versa.
      const tokenAsCode = await resolveAsset({ organizationId: ORG_A },
        { type: IDENTIFIER_TYPES.CODE, value: ID_A1.token });
      assert.strictEqual(tokenAsCode.outcome, RESOLUTION_OUTCOMES.NOT_FOUND,
        'identifier kinds are not interchangeable');
    });

    it('11. a valid manual code resolves the correct same-tenant asset', async () => {
      for (const value of [ID_A1.code, ID_A1.qrCode]) {
        const resolution = await resolveAsset({ organizationId: ORG_A },
          { type: IDENTIFIER_TYPES.CODE, value });
        assert.strictEqual(resolution.outcome, RESOLUTION_OUTCOMES.RESOLVED);
        assert.strictEqual(resolution.asset.id, ASSET_A1);
      }
    });

    it('12/13. an unknown token and an unknown code both have a defined recovery', async () => {
      const unknownToken = await asTenantA('/api/equipment/qr/lookup/0000000000000000000000000000ffff');
      assert.strictEqual(unknownToken.status, 404);

      const unknownCode = await asTenantA('/atiman/asset?code=NOT-A-REAL-CODE-1234');
      assert.strictEqual(unknownCode.status, 200);
      assert.match(unknownCode.text, /No asset is registered under that code/,
        'the recovery must tell the operator what to do next');
      assert.match(unknownCode.text, /name="code"/, 'manual entry must remain available');
    });

    it('14. malformed input fails safely without reaching the database', async () => {
      const cases = [
        { type: IDENTIFIER_TYPES.CODE, value: '' },
        { type: IDENTIFIER_TYPES.CODE, value: '   ' },
        { type: IDENTIFIER_TYPES.CODE, value: 'x'.repeat(MAX_IDENTIFIER_LENGTH + 1) },
        { type: IDENTIFIER_TYPES.CODE, value: 'bad\u0000code' },
        { type: IDENTIFIER_TYPES.CODE, value: 'bad\u001fcode' },
        { type: 'asset_id', value: '1' },
        { type: IDENTIFIER_TYPES.CODE },
        { type: IDENTIFIER_TYPES.CODE, value: { nested: true } }
      ];
      for (const identifier of cases) {
        const resolution = await resolveAsset({ organizationId: ORG_A }, identifier);
        assert.notStrictEqual(resolution.outcome, RESOLUTION_OUTCOMES.RESOLVED,
          `${JSON.stringify(identifier)} must not resolve`);
        assert.strictEqual(resolution.asset, null);
        assert.ok(
          resolution.outcome === RESOLUTION_OUTCOMES.INVALID_IDENTIFIER
          || resolution.outcome === RESOLUTION_OUTCOMES.AMBIGUOUS_IDENTIFIER,
          `unexpected outcome ${resolution.outcome}`);
      }

      // A malformed identifier is refused, never partially matched.
      const partial = await resolveAsset({ organizationId: ORG_A },
        { type: IDENTIFIER_TYPES.CODE, value: ID_A1.code.slice(0, -1) });
      assert.strictEqual(partial.outcome, RESOLUTION_OUTCOMES.NOT_FOUND);

      // Supplying both identifier kinds is refused rather than guessed at.
      assert.deepStrictEqual(readIdentifier({ token: 'a', code: 'b' }), { supplied: false, bothSupplied: true });
      assert.deepStrictEqual(readIdentifier({}), { supplied: false, bothSupplied: false });
      assert.strictEqual(readIdentifier({ code: 'only' }).identifier.type, IDENTIFIER_TYPES.CODE);
      assert.strictEqual(readIdentifier({ token: 'only' }).identifier.type, IDENTIFIER_TYPES.QR_TOKEN);

      const both = await asTenantA(`/atiman/asset?token=${ID_A1.token}&code=${ID_A1.code}`);
      assert.strictEqual(both.status, 200);
      assert.ok(!both.text.includes('I2C Pump Alpha'));
      assert.match(both.text, /not both/i);
    });

    it('15. no identifier permits broad tenant enumeration', async () => {
      // There is no listing, no search and no wildcard: the resolver exposes
      // exactly one operation.
      const service = require('../src/services/asset-context.service');
      const exported = Object.keys(service).sort();
      for (const forbidden of ['listAssets', 'searchAssets', 'getAssets', 'browseAssets', 'findAssets']) {
        assert.ok(!exported.includes(forbidden), `${forbidden} must not exist`);
      }

      for (const wildcard of ['%', '_', '*', '%A1-', `${RUN}%`]) {
        const resolution = await resolveAsset({ organizationId: ORG_A },
          { type: IDENTIFIER_TYPES.CODE, value: wildcard });
        assert.notStrictEqual(resolution.outcome, RESOLUTION_OUTCOMES.RESOLVED,
          `${wildcard} must not act as a wildcard`);
        assert.strictEqual(resolution.asset, null);
      }

      // The other tenant's assets stay invisible even when every identifier shape
      // that could plausibly match them is tried.
      for (const candidate of [ID_B1.code, ID_B1.qrCode, ID_B1.token, `B1-${RUN}`, `QB1-${RUN}`]) {
        const resolution = await resolveAsset({ organizationId: ORG_A },
          { type: IDENTIFIER_TYPES.CODE, value: candidate });
        assert.strictEqual(resolution.asset, null);
      }
    });

    it('refuses an ambiguous identifier instead of choosing one', async () => {
      // Give one asset a code that equals another asset's qr_code: the CODE
      // identifier kind then matches two rows and must refuse.
      const collision = `X-${RUN}`;
      await withConn((conn) => conn.query(
        'UPDATE equipment SET qr_code = $2 WHERE id = $1', [ASSET_A2, collision]));
      await withConn((conn) => conn.query(
        'UPDATE equipment SET code = $2 WHERE id = $1', [ASSET_A1, collision]));

      const resolution = await resolveAsset({ organizationId: ORG_A },
        { type: IDENTIFIER_TYPES.CODE, value: collision });
      assert.strictEqual(resolution.outcome, RESOLUTION_OUTCOMES.AMBIGUOUS_IDENTIFIER);
      assert.strictEqual(resolution.asset, null);

      const viaPage = await asTenantA(`/atiman/asset?code=${encodeURIComponent(collision)}`);
      assert.match(viaPage.text, /matches more than one asset record/i);
      assert.ok(!/I2C Pump Alpha|I2C Pump Beta/.test(viaPage.text));

      // Restore, so no other assertion depends on the collision.
      await withConn((conn) => conn.query('UPDATE equipment SET qr_code = $2 WHERE id = $1',
        [ASSET_A2, ID_A1.qrCode.replace('QA1', 'QA2')]));
      await withConn((conn) => conn.query('UPDATE equipment SET code = $2 WHERE id = $1',
        [ASSET_A1, ID_A1.code]));
    });
  });

  // ------------------------------------------------------------ D. projection

  describe('D. asset-context projection', () => {
    it('16. the projection contains exactly the approved Atiman fields', async () => {
      const resolution = await resolveAsset({ organizationId: ORG_A },
        { type: IDENTIFIER_TYPES.CODE, value: ID_A1.code });
      const asset = resolution.asset;

      assert.deepStrictEqual(Object.keys(asset).sort(), [...ASSET_CONTEXT_FIELDS].sort());
      assert.deepStrictEqual(Object.keys(asset.facility).sort(), ['code', 'id', 'name']);
      assert.deepStrictEqual(Object.keys(asset.taxonomy).sort(), ['category', 'class', 'label', 'type']);
      assert.strictEqual(asset.taxonomy.label, 'I2C Category > I2C Class > I2C Equipment Type');
      assert.strictEqual(asset.name, 'I2C Pump Alpha');
      assert.strictEqual(asset.code, ID_A1.code);
      assert.strictEqual(asset.status, 'operational');
      assert.strictEqual(asset.criticality, 'high');
      assert.strictEqual(asset.facility.name, 'I2C Facility A');
    });

    it('17/18/19/20. no EAM, work-order, scheduling, assignment, finding or inspection field is present', async () => {
      const responses = await Promise.all([
        asTenantA(`/atiman/asset?code=${encodeURIComponent(ID_A1.code)}`),
        asTenantA(`/api/equipment/qr/lookup/${ID_A1.token}`),
        asTenantA(`/api/m/asset/${ID_A1.token}`)
      ]);

      const forbidden = [
        /sap_equipment_reference/i, /sap_floc_hint/i, /facility_sap_ref/i, /sap_reference_code/i,
        /sapNotification/i, /work_order/i, /workOrder/i, /maintenance_plan/i, /maintenancePlan/i,
        /schedule/i, /assigned_to/i, /assignedTo/i, /technician/i, /due_date/i, /dueDate/i,
        /recent_findings/i, /recent_inspections/i, /applicable_templates/i, /quick_actions/i,
        /iso_classification/i, /lastInspection/i, /findingsCount/i, /organization_id/i, /qr_token/i
      ];

      for (const response of responses) {
        for (const pattern of forbidden) {
          assert.ok(!pattern.test(response.text),
            `${pattern} must not appear in an asset-context response`);
        }
        assert.ok(!/\bPASS\b|\bFAIL\b/.test(response.text),
          'no pass/fail verdict may be presented: Atiman records no inspection result');
      }

      // The SAP values exist in the database, so their absence is a real property
      // of the projection rather than of the fixture.
      assert.strictEqual(
        await scalarValue('SELECT sap_equipment_reference FROM equipment WHERE id = $1', [ASSET_A1]),
        'SAP-EQ-A1');
    });

    it('reports an unrecorded value as unrecorded, never as an invented default', async () => {
      await withConn((conn) => conn.query(
        'UPDATE equipment SET status = NULL, criticality = NULL WHERE id = $1', [ASSET_A2]));
      const resolution = await resolveAsset({ organizationId: ORG_A },
        { type: IDENTIFIER_TYPES.CODE, value: `A2-${RUN}` });
      assert.strictEqual(resolution.outcome, RESOLUTION_OUTCOMES.RESOLVED);
      assert.strictEqual(resolution.asset.status, null);
      assert.strictEqual(resolution.asset.criticality, null);
    });
  });

  // -------------------------------------------------- E. legacy defect closure

  describe('E. legacy defect regression', () => {
    it('21. /api/equipment/qr/lookup/:token cannot cross tenant', async () => {
      const own = await asTenantA(`/api/equipment/qr/lookup/${ID_A1.token}`);
      assert.strictEqual(own.status, 200);

      const foreign = await asTenantA(`/api/equipment/qr/lookup/${ID_B1.token}`);
      assert.strictEqual(foreign.status, 404);
      assert.ok(!foreign.text.includes('I2C Pump Gamma'));

      // The mirror direction too: tenant B cannot reach tenant A's asset.
      const mirror = await asTenantB(`/api/equipment/qr/lookup/${ID_A1.token}`);
      assert.strictEqual(mirror.status, 404);
      assert.ok(!mirror.text.includes('I2C Pump Alpha'));
    });

    it('22. /api/m/asset/:token cannot disclose anonymously', async () => {
      const anonymous = await get(`/api/m/asset/${ID_A1.token}`);
      assert.strictEqual(anonymous.status, 401,
        'DEFECT B: this endpoint used optionalAuth and skipped its tenant check when unauthenticated');

      // The router-level guard is what refuses, not a route that happens to be
      // missing, so an unrelated path under the same mount behaves identically.
      const control = await get('/api/m/i2c-control-path');
      assert.strictEqual(control.status, anonymous.status);
    });

    it('23. /api/m/asset/:token cannot cross tenant', async () => {
      const own = await asTenantA(`/api/m/asset/${ID_A1.token}`);
      assert.strictEqual(own.status, 200);
      assert.strictEqual(JSON.parse(own.text).data.asset.id, ASSET_A1);

      const foreign = await asTenantA(`/api/m/asset/${ID_B1.token}`);
      assert.strictEqual(foreign.status, 404);
      assert.ok(!/I2C Pump Gamma|SAP-EQ-B1|recent_findings/.test(foreign.text));
    });

    it('24. /mobile/asset?code= cannot cross tenant', async () => {
      // The legacy entry performs no lookup at all: it hands off to the single
      // resolver, so it has nothing to leak.
      const own = await asTenantA(`/mobile/asset?code=${encodeURIComponent(ID_A1.code)}`, { followRedirect: true });
      assert.ok(own.from && own.from.location.startsWith('/atiman/asset'),
        'the legacy entry must hand off to the Atiman asset page');
      assert.ok(own.text.includes('I2C Pump Alpha'));

      const foreign = await asTenantA(`/mobile/asset?code=${encodeURIComponent(ID_B1.code)}`, { followRedirect: true });
      assert.ok(!/I2C Pump Gamma|I2C Facility B|SAP-EQ-B1/.test(foreign.text));
      assert.match(foreign.text, /belongs to another organization/i);

      const noCode = await asTenantA('/mobile/asset');
      assert.strictEqual(noCode.status, 302);
      assert.strictEqual(noCode.location, '/atiman/asset');
    });

    it('the reachable legacy model lookups are no longer reachable from any route', async () => {
      // The routes that used to read assets unscoped are gone from the code path.
      const routes = require('../src/routes/mobile.routes');
      const inspectionRoutes = require('../src/routes/mobile-inspection.routes');
      const equipmentRoutes = require('../src/routes/equipment.routes');

      const collect = (router) => router.stack
        .filter((layer) => layer.route)
        .map((layer) => `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`);

      assert.ok(collect(equipmentRoutes).includes('GET /qr/lookup/:token'),
        'the equipment token lookup still exists, but now resolves tenant-safely');
      assert.ok(collect(routes).includes('GET /asset'));
      assert.ok(collect(inspectionRoutes).includes('GET /asset/:token'));

      // The QR asset page is no longer the first thing the router mounts, so it
      // can no longer sit outside the router's authentication guard.
      const firstNonRoute = inspectionRoutes.stack.find((layer) => !layer.route);
      assert.strictEqual(firstNonRoute.name, 'authenticate',
        'authentication must be mounted before every route in the inspection router');
    });
  });

  // ------------------------------------------------------------ F. boundaries

  describe('F. boundaries', () => {
    it('25/26/27/28. resolving asset context creates no Observation, Finding, work order or grant', async () => {
      const counts = async () => ({
        observations: await scalar('SELECT count(*)::int FROM asset_observations WHERE organization_id = ANY($1::int[])',
          [[ORG_A, ORG_B]]),
        findings: await scalar('SELECT count(*)::int FROM findings WHERE organization_id = ANY($1::int[])',
          [[ORG_A, ORG_B]]),
        workOrders: await scalar('SELECT count(*)::int FROM work_orders WHERE organization_id = ANY($1::int[])',
          [[ORG_A, ORG_B]]),
        plans: await scalar('SELECT count(*)::int FROM maintenance_plans WHERE organization_id = ANY($1::int[])',
          [[ORG_A, ORG_B]]),
        schedules: await scalar('SELECT count(*)::int FROM schedules WHERE organization_id = ANY($1::int[])',
          [[ORG_A, ORG_B]]),
        grants: await scalar('SELECT count(*)::int FROM user_capabilities WHERE organization_id = ANY($1::int[])',
          [[ORG_A, ORG_B]])
      });

      const before = await counts();
      await asTenantA(`/atiman/asset?code=${encodeURIComponent(ID_A1.code)}`);
      await asTenantA(`/atiman/asset?token=${encodeURIComponent(ID_A1.token)}`);
      await asTenantA(`/api/equipment/qr/lookup/${ID_A1.token}`);
      await asTenantA(`/api/m/asset/${ID_A1.token}`);
      await asTenantA(`/mobile/asset?code=${encodeURIComponent(ID_A1.code)}`, { followRedirect: true });
      const after = await counts();

      assert.deepStrictEqual(after, before, 'resolving asset context must have no side effect');
    });

    it('29. no migration 024 exists and the endpoint is still 023', async () => {
      const dir = path.join(REPO_ROOT, 'database', 'postgresql');
      const files = fs.readdirSync(dir).filter((name) => /^\d{3}_.*\.sql$/.test(name)).sort();
      assert.strictEqual(files.length, 23, 'I2C must add no migration');
      assert.strictEqual(files[files.length - 1], '023_asset_observations.sql');
      assert.ok(!files.some((name) => name.startsWith('024')),
        'no migration 024 may exist');
    });

    it('changes no capability vocabulary, bundle or permission matrix', async () => {
      const capabilities = require('../src/config/capabilities');
      assert.strictEqual(capabilities.V1_HUMAN_GRANTABLE.length, 18);
      assert.strictEqual(capabilities.NON_HUMAN_GRANTABLE.length, 3);
      assert.ok(!Object.values(capabilities.CAPABILITIES).some((id) => /asset/i.test(id)),
        'reading asset context is not an accountable capability act');

      const middleware = require('../src/middleware/capability.middleware');
      assert.ok(!Object.values(middleware.CAPABILITY_FOR_PERMISSION)
        .some((value) => typeof value === 'string' && /asset/i.test(value)),
      'the permission adapter must not gain an asset capability');
    });

    it('does not gate asset context on a role', async () => {
      // The Atiman asset page must render for an operator: reading asset context
      // is authorized by authentication and tenant ownership, not by role.
      const asOperator = await asTenantA(`/atiman/asset?code=${encodeURIComponent(ID_A1.code)}`);
      assert.strictEqual(asOperator.status, 200);
      assert.ok(asOperator.text.includes('I2C Pump Alpha'));

      for (const file of ['asset-context.controller.js', 'atiman.controller.js']) {
        const source = fs.readFileSync(path.join(REPO_ROOT, 'src', 'controllers', file), 'utf8');
        assert.ok(!/userRole|\.role\b/.test(source),
          `${file} must not consult a role`);
      }

      // The I1 shell invariant survives I2C: the shell composition controller still
      // takes nothing from the request, because identifier handling lives in its own
      // controller rather than diluting that property.
      const shellSource = fs.readFileSync(
        path.join(REPO_ROOT, 'src', 'controllers', 'atiman.controller.js'), 'utf8');
      assert.ok(!/req\.body|req\.query|req\.headers/.test(shellSource),
        'the accepted I1 shell controller must still take no authority from the request');
    });

    it('introduces no route that could capture an Observation', async () => {
      const app = require('../src/app');
      const routePaths = [];
      const walk = (stack) => {
        for (const layer of stack || []) {
          if (layer.route) {
            routePaths.push(Object.keys(layer.route.methods).join(',').toUpperCase() + ' ' + layer.route.path);
          } else if (layer.handle && layer.handle.stack) {
            walk(layer.handle.stack);
          }
        }
      };
      const root = (app.router && app.router.stack) ? app.router : app._router;
      walk(root.stack);
      assert.ok(routePaths.length > 100, `the route walk must traverse the app (found ${routePaths.length})`);
      assert.deepStrictEqual(routePaths.filter((route) => /observation/i.test(route)), []);
    });
  });
});
