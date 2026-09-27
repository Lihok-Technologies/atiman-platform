/**
 * ATM-002-I2E — Report / observation capture.
 *
 * Proves the first real Atiman field workflow end to end: trustworthy asset
 * context, a capability-gated Report surface, capture through the accepted
 * Observation service, and a confirmation that claims only what the server did.
 *
 * Evidence policy: the HTTP layer is exercised against the real Express app with
 * real JWTs, so authentication, routing, capability enforcement, asset resolution
 * and the rendered payload are all production-shaped. What the HTTP layer cannot
 * express (a persistence-path failure that occurs after resolution succeeds) is
 * proved by driving the real controller with a stubbed writer through the module
 * cache, so the "no success without persistence" property is executed rather than
 * asserted from source text.
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
const { DESTINATIONS, composeWorkNavigation, withheldDestinations } = require('../src/config/destinations');
const { availableActions } = require('../src/services/today.service');
const { V1_HUMAN_GRANTABLE, LEGACY_COMPATIBILITY_BUNDLES } = require('../src/config/capabilities');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating report-capture suite requires the sanctioned database-test '
    + 'gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that test-database '
    + 'credentials are used instead of runtime credentials; run it via '
    + '`npm run test:integration`';

const JWT_SECRET = 'test-only-jwt-secret-not-for-production-000000';
const REPO_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let ORG_A = null;
let ORG_B = null;
let FAC_A = null;
let FAC_B = null;
let ASSET_A1 = null;
let ASSET_B1 = null;
let ASSET_UNOWNED = null;
let ASSET_NO_FACILITY = null;
let ASSET_CROSS_FACILITY = null;
let USER_A = null;          // operator of ORG_A, no explicit grants -> legacy bundle
let USER_NO_REPORT = null;  // ORG_A, one explicit grant that excludes finding.report
let USER_B = null;
let USER_INACTIVE = null;
let USER_ADMIN_REPORT = null;    // role admin, explicit grant WITH finding.report
let USER_ADMIN_NO_REPORT = null; // role admin, explicit grant WITHOUT finding.report
let ID_A1 = {};
let ID_B1 = {};
let ID_UNOWNED = {};
let ID_CROSS_FACILITY = {};
let ID_NO_FACILITY = {};

let seq = 0;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`;
const tag = () => `${RUN}${(++seq).toString(36)}`;

/**
 * A run-unique observation description. The suite may be re-run against a
 * long-lived shared test database, so any assertion that looks a row up by its
 * text must look up a text no earlier run could have written.
 */
const mark = (name) => `${name} ${RUN}-${++seq}`;
const token = (seed) => `r${seed}`.padEnd(32, '0').slice(0, 32);

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

async function ensureFixture() {
  await withConn(async (conn) => {
    const orgs = await conn.query(
      `INSERT INTO organizations (organization_name) VALUES ($1), ($2) RETURNING id`,
      [`I2E Org A ${RUN}`, `I2E Org B ${RUN}`]);
    [ORG_A, ORG_B] = orgs.map((row) => Number(row.id));

    const facilities = await conn.query(
      `INSERT INTO facilities (organization_id, name, code, facility_type)
       VALUES ($1, 'I2E Facility A', $3, 'WTP'), ($2, 'I2E Facility B', $4, 'WTP')
       RETURNING id`,
      [ORG_A, ORG_B, `RA-${RUN}`, `RB-${RUN}`]);
    [FAC_A, FAC_B] = facilities.map((row) => Number(row.id));

    ID_A1 = { token: token(`a1${RUN}`), qr: `RA1Q-${RUN}`, code: `RA1-${RUN}` };
    ID_B1 = { token: token(`b1${RUN}`), qr: `RB1Q-${RUN}`, code: `RB1-${RUN}` };
    ID_UNOWNED = { token: token(`u1${RUN}`), qr: `RU1Q-${RUN}`, code: `RU1-${RUN}` };
    ID_CROSS_FACILITY = { token: token(`xf${RUN}`), qr: `RXFQ-${RUN}`, code: `RXF-${RUN}` };

    ID_NO_FACILITY = { token: token(`nf${RUN}`), qr: `RNFQ-${RUN}`, code: `RNF-${RUN}` };

    const assets = await conn.query(
      `INSERT INTO equipment (organization_id, facility_id, name, code, qr_token, qr_code)
       VALUES ($1, $2, 'I2E Pump Alpha', $5, $9,  $13),
              ($3, $4, 'I2E Pump Bravo', $6, $10, $14),
              (NULL, $2, 'I2E Unowned Pump', $7, $11, $15),
              ($1, NULL, 'I2E Facility-less Pump', $8, $12, $16)
       RETURNING id`,
      [ORG_A, FAC_A, ORG_B, FAC_B,
        ID_A1.code, ID_B1.code, ID_UNOWNED.code, ID_NO_FACILITY.code,
        ID_A1.token, ID_B1.token, ID_UNOWNED.token, ID_NO_FACILITY.token,
        ID_A1.qr, ID_B1.qr, ID_UNOWNED.qr, ID_NO_FACILITY.qr]);
    [ASSET_A1, ASSET_B1, ASSET_UNOWNED, ASSET_NO_FACILITY] = assets.map((row) => Number(row.id));

    // ORG_A asset whose facility column points at ORG_B's facility.
    const cross = await conn.query(
      `INSERT INTO equipment (organization_id, facility_id, name, code, qr_token, qr_code)
       VALUES ($1, $2, 'I2E Cross-Facility Pump', $3, $4, $5) RETURNING id`,
      [ORG_A, FAC_B, ID_CROSS_FACILITY.code, ID_CROSS_FACILITY.token, ID_CROSS_FACILITY.qr]);
    ASSET_CROSS_FACILITY = Number(cross[0].id);

    const users = await conn.query(
      `INSERT INTO users (organization_id, username, email, password_hash, full_name, role, is_active)
       VALUES ($1, $3, $3, 'x', 'I2E Operator A', 'operator', true),
              ($2, $4, $4, 'x', 'I2E Operator B', 'operator', true),
              ($1, $5, $5, 'x', 'I2E Inactive', 'operator', false),
              ($1, $6, $6, 'x', 'I2E Narrow', 'operator', true),
              ($1, $7, $7, 'x', 'I2E Admin Reporter', 'admin', true),
              ($1, $8, $8, 'x', 'I2E Admin Non-reporter', 'admin', true)
       RETURNING id`,
      [ORG_A, ORG_B,
        `i2e-a-${RUN}@test.local`, `i2e-b-${RUN}@test.local`,
        `i2e-off-${RUN}@test.local`, `i2e-narrow-${RUN}@test.local`,
        `i2e-adminrep-${RUN}@test.local`, `i2e-adminnarrow-${RUN}@test.local`]);
    [USER_A, USER_B, USER_INACTIVE, USER_NO_REPORT, USER_ADMIN_REPORT, USER_ADMIN_NO_REPORT] =
      users.map((row) => Number(row.id));

    // An explicit grant switches this principal out of legacy-role compatibility
    // into EXPLICIT_GRANTS, so it holds exactly this one capability and therefore
    // does NOT hold finding.report. That is how a real denial is produced without
    // inventing a role.
    const granter = await conn.query(
      `INSERT INTO users (organization_id, username, email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $2, 'x', 'I2E Granter', 'admin', true) RETURNING id`,
      [ORG_A, `i2e-granter-${RUN}@test.local`]);
    await conn.query(
      `INSERT INTO user_capabilities (user_id, organization_id, capability, granted_by_user_id)
       VALUES ($1, $2, 'inspection.execute', $3),
              ($4, $2, 'finding.report',   $3),
              ($5, $2, 'inspection.execute', $3)`,
      [USER_NO_REPORT, ORG_A, Number(granter[0].id), USER_ADMIN_REPORT, USER_ADMIN_NO_REPORT]);

    AS_CODE_A1 = { kind: 'code', value: ID_A1.code };
    AS_TOKEN_A1 = { kind: 'token', value: ID_A1.token };
    AS_CODE_B1 = { kind: 'code', value: ID_B1.code };
    AS_CODE_UNOWNED = { kind: 'code', value: ID_UNOWNED.code };
    AS_CODE_CROSS = { kind: 'code', value: ID_CROSS_FACILITY.code };
    AS_CODE_NO_FACILITY = { kind: 'code', value: ID_NO_FACILITY.code };
  });
}

// ---------------------------------------------------------------------------
// HTTP harness — the real application, real JWTs
// ---------------------------------------------------------------------------

let server = null;
let port = null;

function call(method, requestPath, { userId, form } = {}) {
  return new Promise((resolve, reject) => {
    const payload = form ? new URLSearchParams(form).toString() : null;
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: requestPath,
      headers: {
        ...(userId ? { Authorization: `Bearer ${jwt.sign({ userId }, JWT_SECRET)}` } : {}),
        ...(payload
          ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload) }
          : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location || null, text: data }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const getPage = (p, userId) => call('GET', p, { userId });
const postForm = (p, userId, form) => call('POST', p, { userId, form });

const formFor = (identifier, values = {}) => ({
  identifierType: identifier.kind,
  identifierValue: identifier.value,
  observationText: values.observationText || '',
  measuredValue: values.measuredValue || '',
  unit: values.unit || '',
  ...values
});

// Assigned by ensureFixture(): these depend on identities the database issues.
let AS_CODE_A1 = null;
let AS_TOKEN_A1 = null;
let AS_CODE_B1 = null;
let AS_CODE_UNOWNED = null;
let AS_CODE_CROSS = null;
let AS_CODE_NO_FACILITY = null;

const observationsFor = (orgIds) => scalar(
  'SELECT count(*)::int FROM asset_observations WHERE organization_id = ANY($1::int[])', [orgIds]);

// ==========================================================================

describe('ATM-002-I2E report / observation capture', { skip: DB_TEST_SKIP_REASON }, () => {
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

  // ------------------------------------------------- A. entry and presentation

  describe('A. entry and presentation', () => {
    it('1. Report is an available destination with a real href, and Inspect is not', async () => {
      const report = DESTINATIONS.find((destination) => destination.id === 'report');
      assert.strictEqual(report.available, true, 'Report must be available once implemented');
      assert.strictEqual(report.href, '/atiman/report');
      assert.strictEqual(report.capability, 'finding.report');
      assert.strictEqual(report.unavailableReason, undefined);

      const inspect = DESTINATIONS.find((destination) => destination.id === 'inspect');
      assert.strictEqual(inspect.available, false, 'Inspect must remain unavailable');
      assert.strictEqual(inspect.href, null);
    });

    it('2. Report visibility follows the finding.report capability alone', async () => {
      const withCapability = composeWorkNavigation(new Set(['finding.report'])).map((d) => d.id);
      const withoutCapability = composeWorkNavigation(new Set(['inspection.execute'])).map((d) => d.id);
      assert.ok(withCapability.includes('report'));
      assert.ok(!withoutCapability.includes('report'), 'no capability, no destination');
      assert.deepStrictEqual(withoutCapability, ['today', 'knowledge']);
    });

    it('3. a principal without finding.report sees no Report control anywhere', async () => {
      const todayWith = await getPage('/today', USER_A);
      const todayWithout = await getPage('/today', USER_NO_REPORT);
      assert.ok(todayWith.text.includes('/atiman/report'), 'the authorized principal is offered Report');
      assert.ok(!todayWithout.text.includes('/atiman/report'),
        'the control is hidden without the capability');

      const assetWith = await getPage(`/atiman/asset?code=${encodeURIComponent(ID_A1.code)}`, USER_A);
      const assetWithout = await getPage(`/atiman/asset?code=${encodeURIComponent(ID_A1.code)}`, USER_NO_REPORT);
      assert.ok(assetWith.text.includes('/atiman/report?code='));
      assert.ok(!assetWithout.text.includes('/atiman/report?code='));
      assert.match(assetWithout.text, /cannot record observations yet/i,
        'the absence is stated rather than left implicit');
    });

    it('4. direct HTTP access without finding.report is denied on both routes', async () => {
      const before = await observationsFor([ORG_A, ORG_B]);

      const form = await getPage(`/atiman/report?code=${encodeURIComponent(ID_A1.code)}`, USER_NO_REPORT);
      assert.strictEqual(form.status, 403, 'the form itself is denied');
      assert.match(form.text, /Reporting is not available for your account/);

      const submit = await postForm('/atiman/report', USER_NO_REPORT, formFor(AS_CODE_A1, {
        observationText: 'attempted without authority'
      }));
      assert.strictEqual(submit.status, 403, 'submission is denied');
      assert.ok(!submit.text.includes('Observation recorded'));

      assert.strictEqual(await observationsFor([ORG_A, ORG_B]), before,
        'a denied submission writes nothing');

      // Hidden is not the enforcement: the same principal is refused even though
      // the control is absent from the page.
      const bare = await getPage('/atiman/report', USER_NO_REPORT);
      assert.strictEqual(bare.status, 403);
    });

    it('5. role is not Report authority: the capability alone decides', async () => {
      // Two principals with the SAME role but different grants, and two with
      // different roles but the same grant. If role carried authority, these pairs
      // could not disagree and agree the way they do.
      const adminWithReport = await getPage(
        `/atiman/report?code=${encodeURIComponent(ID_A1.code)}`, USER_ADMIN_REPORT);
      const operatorWithReport = await getPage(
        `/atiman/report?code=${encodeURIComponent(ID_A1.code)}`, USER_A);
      const adminWithoutReport = await getPage(
        `/atiman/report?code=${encodeURIComponent(ID_A1.code)}`, USER_ADMIN_NO_REPORT);

      assert.strictEqual(adminWithReport.status, 200,
        'an admin holding finding.report is authorized');
      assert.strictEqual(operatorWithReport.status, 200,
        'an operator holding finding.report is authorized');
      assert.strictEqual(adminWithoutReport.status, 403,
        'an admin who does NOT hold finding.report is DENIED — role is not authority');

      // Same capability, different role: the capture surface is materially the same.
      for (const marker of ['name="observationText"', 'name="measuredValue"', 'name="unit"']) {
        assert.ok(adminWithReport.text.includes(marker));
        assert.ok(operatorWithReport.text.includes(marker));
      }

      // And the legacy bundles that name roles are never consulted.
      const controller = fs.readFileSync(
        path.join(REPO_ROOT, 'src/controllers/report-capture.controller.js'), 'utf8');
      assert.match(controller, /resolveCapabilities\(req\.user\)/);
      assert.ok(!/LEGACY_COMPATIBILITY_BUNDLES/.test(controller));
      assert.ok(!/userRole/.test(controller), 'no userRole may appear in the controller');
      assert.ok(!LEGACY_COMPATIBILITY_BUNDLES.admin.includes('inspection.execute'));
    });
  });

  // ------------------------------------------------------ B. asset security

  describe('B. asset security', () => {
    it('6. an own-tenant asset enters Report', async () => {
      for (const identifier of [AS_CODE_A1, AS_TOKEN_A1]) {
        const page = await getPage(
          `/atiman/report?${identifier.kind}=${encodeURIComponent(identifier.value)}`, USER_A);
        assert.strictEqual(page.status, 200);
        assert.ok(page.text.includes('I2E Pump Alpha'), 'the resolved asset is shown');
        assert.ok(page.text.includes('name="observationText"'), 'the capture form is offered');
      }
    });

    it('7. a foreign-tenant asset cannot enter Report', async () => {
      const page = await getPage(`/atiman/report?code=${encodeURIComponent(ID_B1.code)}`, USER_A);
      assert.strictEqual(page.status, 200);
      assert.ok(!/I2E Pump Bravo|I2E Facility B|RB1-|RA1-/.test(page.text.replace(ID_A1.code, '')),
        'no foreign asset detail may appear');
      assert.match(page.text, /belongs to another organization/i);
      assert.ok(!page.text.includes('name="observationText"'), 'no capture form for a foreign asset');

      const submit = await postForm('/atiman/report', USER_A, formFor(AS_CODE_B1, {
        observationText: 'cross-tenant attempt'
      }));
      assert.ok(!submit.text.includes('Observation recorded'));
      assert.strictEqual(
        await scalar(`SELECT count(*)::int FROM asset_observations WHERE organization_id = $1`, [ORG_B]), 0,
        'nothing was written into the other tenant');
    });

    it('8. an asset belonging to no organization fails closed', async () => {
      const page = await getPage(`/atiman/report?code=${encodeURIComponent(ID_UNOWNED.code)}`, USER_A);
      assert.ok(!page.text.includes('I2E Unowned Pump'));
      assert.match(page.text, /not registered to an organization/i);

      const submit = await postForm('/atiman/report', USER_A, formFor(AS_CODE_UNOWNED, {
        observationText: 'unowned attempt'
      }));
      assert.ok(!submit.text.includes('Observation recorded'));
      assert.strictEqual(
        await scalar('SELECT count(*)::int FROM asset_observations WHERE organization_id IS NULL'), 0);
    });

    it('9. a browser-supplied organization cannot override the trusted tenant', async () => {
      const before = await observationsFor([ORG_A, ORG_B]);
      const response = await postForm('/atiman/report', USER_A, {
        ...formFor(AS_CODE_A1, { observationText: 'forged organization attempt' }),
        organizationId: String(ORG_B),
        tenant_id: String(ORG_B),
        org_id: String(ORG_B),
        recordedByUserId: String(USER_B)
      });
      assert.ok(response.text.includes('Observation recorded'), 'the legitimate capture still succeeds');

      const stored = await withConn((conn) => conn.query(
        `SELECT organization_id, recorded_by_user_id, asset_id
           FROM asset_observations WHERE organization_id = $1 ORDER BY id DESC LIMIT 1`, [ORG_A]));
      assert.strictEqual(Number(stored[0].organization_id), ORG_A, 'tenant came from the session');
      assert.strictEqual(Number(stored[0].recorded_by_user_id), USER_A, 'recorder came from the session');
      assert.strictEqual(Number(stored[0].asset_id), ASSET_A1);
      assert.strictEqual(await observationsFor([ORG_B]), 0, 'nothing landed in the other tenant');
      assert.strictEqual(await observationsFor([ORG_A, ORG_B]), before + 1);
    });

    it('10. a forged asset identifier cannot cause cross-tenant capture', async () => {
      // The identifier is the only asset context the browser supplies, and it is
      // re-resolved against the trusted tenant on submission. A raw asset id is not
      // an accepted identifier kind at all, and the other tenant's identifiers
      // resolve to nothing this tenant may use.
      for (const forged of [
        { identifierType: 'asset_id', identifierValue: String(ASSET_B1) },
        { identifierType: 'code', identifierValue: String(ASSET_B1) },
        { identifierType: 'token', identifierValue: String(ASSET_B1) },
        { identifierType: 'code', identifierValue: ID_B1.token },
        { identifierType: 'token', identifierValue: ID_B1.qr }
      ]) {
        const response = await postForm('/atiman/report', USER_A, {
          ...forged,
          observationText: `forged identifier ${forged.identifierType}`,
          measuredValue: '',
          unit: ''
        });
        assert.ok(!response.text.includes('Observation recorded'),
          `${JSON.stringify(forged)} must not record anything`);
      }

      // An asset with no facility of its own cannot be attributed, and a facility
      // belonging to another tenant is never projected, so neither can be written.
      const noFacility = await postForm('/atiman/report', USER_A, formFor(AS_CODE_NO_FACILITY, {
        observationText: 'facility-less attempt'
      }));
      assert.ok(!noFacility.text.includes('Observation recorded'));
      assert.match(noFacility.text, /has no facility recorded in your organization/i);

      const crossFacility = await postForm('/atiman/report', USER_A, formFor(AS_CODE_CROSS, {
        observationText: 'cross-facility attempt'
      }));
      assert.ok(!crossFacility.text.includes('Observation recorded'));
      assert.ok(!/I2E Facility B/.test(crossFacility.text));

      assert.strictEqual(await observationsFor([ORG_B]), 0);
    });
  });

  // ------------------------------------------------------------- C. capture

  describe('C. capture', () => {
    it('11/12/13. text-only, measurement-only and combined captures all succeed', async () => {
      const textOnly = mark('audible rumble at the drive end');
      const combined = mark('seal weeping');
      const cases = [
        { observationText: textOnly, measuredValue: '', unit: '' },
        { observationText: '', measuredValue: '72.4', unit: 'degC' },
        { observationText: combined, measuredValue: '1.25', unit: 'mm/s' }
      ];
      for (const values of cases) {
        const response = await postForm('/atiman/report', USER_A, formFor(AS_CODE_A1, values));
        assert.ok(response.text.includes('Observation recorded'),
          `${JSON.stringify(values)} must be accepted`);
      }

      const byText = async (text) => withConn((conn) => conn.query(
        `SELECT observation_text, measured_value, unit FROM asset_observations
          WHERE organization_id = $1 AND observation_text = $2`, [ORG_A, text]));

      const textRow = await byText(textOnly);
      assert.strictEqual(textRow.length, 1);
      assert.strictEqual(textRow[0].measured_value, null,
        'a text-only capture records no measurement');
      assert.strictEqual(textRow[0].unit, null);

      const measurementRow = await withConn((conn) => conn.query(
        `SELECT observation_text, measured_value, unit FROM asset_observations
          WHERE organization_id = $1 AND observation_text IS NULL AND measured_value = 72.4
            AND unit = 'degC'`, [ORG_A]));
      assert.ok(measurementRow.length >= 1, 'a measurement-only capture records no description');

      const combinedRow = await byText(combined);
      assert.strictEqual(combinedRow.length, 1);
      assert.strictEqual(String(combinedRow[0].measured_value), '1.2500');
      assert.strictEqual(combinedRow[0].unit, 'mm/s');
    });

    it('14/15. an empty capture and a unit without a value both fail', async () => {
      const before = await observationsFor([ORG_A]);

      const empty = await postForm('/atiman/report', USER_A, formFor(AS_CODE_A1, {
        observationText: '', measuredValue: '', unit: ''
      }));
      assert.ok(empty.text.includes('Nothing was recorded'));
      assert.ok(!empty.text.includes('Observation recorded'));
      assert.match(empty.text, /Record something/);

      const whitespace = await postForm('/atiman/report', USER_A, formFor(AS_CODE_A1, {
        observationText: '   ', measuredValue: '', unit: ''
      }));
      assert.ok(!whitespace.text.includes('Observation recorded'));

      const unitOnly = await postForm('/atiman/report', USER_A, formFor(AS_CODE_A1, {
        observationText: 'a note', measuredValue: '', unit: 'degC'
      }));
      assert.ok(!unitOnly.text.includes('Observation recorded'));
      assert.match(unitOnly.text, /A unit describes a measured value/);

      assert.strictEqual(await observationsFor([ORG_A]), before, 'nothing was persisted');
    });

    it('16. exact decimal semantics survive the HTTP path', async () => {
      // 72.4 must be stored and reported as 72.4000 — the database's exact decimal,
      // never a float round-trip and never reformatted by the browser layer.
      const decimalMark = mark('decimal probe');
      const response = await postForm('/atiman/report', USER_A, formFor(AS_CODE_A1, {
        observationText: decimalMark, measuredValue: '72.4', unit: 'degC'
      }));
      assert.ok(response.text.includes('Observation recorded'));
      const stored = await withConn((conn) => conn.query(
        `SELECT measured_value FROM asset_observations
          WHERE organization_id = $1 AND observation_text = $2`, [ORG_A, decimalMark]));
      assert.strictEqual(stored.length, 1);
      assert.strictEqual(String(stored[0].measured_value), '72.4000');
      assert.match(response.text, /72\.4000/, 'the confirmation reports the stored value verbatim');

      // Zero is a recorded value, not an absence.
      const zero = await postForm('/atiman/report', USER_A, formFor(AS_CODE_A1, {
        observationText: mark('zero probe'), measuredValue: '0', unit: 'bar'
      }));
      assert.ok(zero.text.includes('Observation recorded'));

      // A float artifact is refused rather than silently rounded.
      const before = await observationsFor([ORG_A]);
      const artifact = await postForm('/atiman/report', USER_A, formFor(AS_CODE_A1, {
        observationText: mark('artifact probe'), measuredValue: '0.30000000000000004', unit: 'mm'
      }));
      assert.ok(!artifact.text.includes('Observation recorded'));
      assert.match(artifact.text, /plain number with at most 4 decimal places/);
      assert.strictEqual(await observationsFor([ORG_A]), before);
    });

    it('17. Report writes a NULL procedure context', async () => {
      const procedureMark = mark('procedure context probe');
      await postForm('/atiman/report', USER_A, formFor(AS_CODE_A1, {
        observationText: procedureMark
      }));
      const stored = await withConn((conn) => conn.query(
        `SELECT task_template_id, task_template_step_id FROM asset_observations
          WHERE organization_id = $1 AND observation_text = $2`, [ORG_A, procedureMark]));
      assert.strictEqual(stored.length, 1);
      assert.strictEqual(stored[0].task_template_id, null, 'Report is procedure-less');
      assert.strictEqual(stored[0].task_template_step_id, null);
    });

    it('18/19/20. recorder, tenant and the facility/asset relationship all come from trusted context', async () => {
      const attributionMark = mark('attribution probe');
      await postForm('/atiman/report', USER_A, formFor(AS_CODE_A1, {
        observationText: attributionMark, measuredValue: '3', unit: 'bar'
      }));
      const stored = await withConn((conn) => conn.query(
        `SELECT organization_id, recorded_by_user_id, asset_id, facility_id, observed_at
           FROM asset_observations WHERE organization_id = $1 AND observation_text = $2`,
        [ORG_A, attributionMark]));
      assert.strictEqual(stored.length, 1);
      assert.strictEqual(Number(stored[0].organization_id), ORG_A);
      assert.strictEqual(Number(stored[0].recorded_by_user_id), USER_A);
      assert.strictEqual(Number(stored[0].asset_id), ASSET_A1);
      assert.strictEqual(Number(stored[0].facility_id), FAC_A,
        'the facility is the asset\'s own facility in this tenant');
      assert.ok(stored[0].observed_at, 'the observation is timestamped');

      // The tenant's facility/asset relationship is the service's rule, reached
      // through the route rather than re-implemented here.
      const wrongTenant = await postForm('/atiman/report', USER_B, formFor(AS_CODE_A1, {
        observationText: 'other tenant probe'
      }));
      assert.ok(!wrongTenant.text.includes('Observation recorded'));
    });
  });

  // ----------------------------------------------------- D. product boundary

  describe('D. product boundary', () => {
    it('21/22. one submission creates exactly one Observation and zero Findings', async () => {
      const before = {
        observations: await observationsFor([ORG_A, ORG_B]),
        findings: await scalar('SELECT count(*)::int FROM findings WHERE organization_id = ANY($1::int[])', [[ORG_A, ORG_B]])
      };

      const onceMark = mark('one and only one');
      const response = await postForm('/atiman/report', USER_A, formFor(AS_CODE_A1, {
        observationText: onceMark, measuredValue: '11.5', unit: 'bar'
      }));
      assert.ok(response.text.includes('Observation recorded'));

      const after = {
        observations: await observationsFor([ORG_A, ORG_B]),
        findings: await scalar('SELECT count(*)::int FROM findings WHERE organization_id = ANY($1::int[])', [[ORG_A, ORG_B]])
      };
      assert.strictEqual(after.observations, before.observations + 1, 'exactly one observation');
      assert.strictEqual(after.findings, before.findings, 'zero findings');

      const rows = await withConn((conn) => conn.query(
        `SELECT id FROM asset_observations WHERE observation_text = $1`, [onceMark]));
      assert.strictEqual(rows.length, 1);
      assert.ok(response.text.includes(`#${rows[0].id}`), 'the confirmation names the persisted record');
    });

    it('23/24/25/26. no work order, SAP/EAM state, capability grant or media record is created', async () => {
      const counts = async () => ({
        workOrders: await scalar('SELECT count(*)::int FROM work_orders'),
        plans: await scalar('SELECT count(*)::int FROM maintenance_plans'),
        schedules: await scalar('SELECT count(*)::int FROM schedules'),
        sapFindings: await scalar(
          `SELECT count(*)::int FROM findings WHERE requires_sap_notification IS TRUE OR sap_notification_no IS NOT NULL`),
        readings: await scalar('SELECT count(*)::int FROM inspection_readings'),
        grants: await scalar('SELECT count(*)::int FROM user_capabilities WHERE organization_id = ANY($1::int[])', [[ORG_A, ORG_B]]),
        attachments: await scalar('SELECT count(*)::int FROM attachments'),
        files: await scalar('SELECT count(*)::int FROM uploaded_files')
      });
      const before = await counts();
      await postForm('/atiman/report', USER_A, formFor(AS_CODE_A1, {
        observationText: mark('side effect probe'), measuredValue: '2', unit: 'bar'
      }));
      assert.deepStrictEqual(await counts(), before, 'a capture has no side effect outside asset_observations');
    });

    it('27/28/29/30/31. the surface offers no classification, outcome, work-order or media control', async () => {
      const page = await getPage(`/atiman/report?code=${encodeURIComponent(ID_A1.code)}`, USER_A);
      const form = page.text;

      for (const forbidden of [
        /name="severity"/i, /name="priority"/i, /name="risk"/i, /name="sap/i,
        /name="work_order/i, /name="workOrder/i, /name="outcome"/i, /name="assessment"/i,
        /name="recommendation"/i, /name="classification"/i, /name="technician"/i,
        /name="assigned/i, /name="schedule/i, /name="cost"/i, /name="inventory"/i,
        /name="photo/i, /name="attachment"/i, /type="file"/i, /name="evidence"/i
      ]) {
        assert.ok(!forbidden.test(form), `${forbidden} must not appear in the Report form`);
      }

      const controls = [...form.matchAll(/<(input|textarea|select|button)\b[^>]*>/gi)].map((m) => m[0]);
      assert.ok(controls.length >= 4 && controls.length <= 8,
        `the form must stay small; found ${controls.length} controls`);

      // No media affordance of any kind.
      assert.ok(!/camera|take photo|add photo|attach file|upload/i.test(form));
      // No auto-advance or gesture-driven step runner.
      assert.ok(!/auto-?advance|swipe|touchend/i.test(form));

      // Every control that is not the submit button or a hidden identifier field
      // is a capture field the operator filled in.
      const named = controls.filter((c) => /name="/.test(c) && !/type="hidden"/.test(c));
      assert.strictEqual(named.length, 3, 'exactly three capture fields');
    });
  });

  // --------------------------------------------------------- E. truthfulness

  describe('E. truthful confirmation and failure', () => {
    it('32/33. success wording appears only after persistence, and only on the confirmation state', async () => {
      const form = await getPage(`/atiman/report?code=${encodeURIComponent(ID_A1.code)}`, USER_A);

      // The property is the absence of a COMPLETION CLAIM, not the absence of the
      // words: the form legitimately says it will not show "a saved state".
      for (const claim of [
        /Observation recorded/i,
        /has been (saved|recorded|submitted|completed)/i,
        /successfully (saved|recorded|submitted)/i,
        /is now part of this asset/i,
        /Observation reference/i
      ]) {
        assert.ok(!claim.test(form.text), `${claim} must not appear before anything is stored`);
      }
      assert.match(form.text, /rather than shown a saved state/,
        'the form states plainly that it will not show a saved state it cannot honour');
      assert.ok(!/#\d+/.test(form.text.split('atiman-main')[1] || ''),
        'no observation reference is presented before one exists');

      const wordingMark = mark('wording probe');
      const response = await postForm('/atiman/report', USER_A, formFor(AS_CODE_A1, {
        observationText: wordingMark
      }));
      assert.match(response.text, /Observation recorded/);
      const id = await scalar(
        'SELECT id FROM asset_observations WHERE observation_text = $1', [wordingMark]);
      assert.ok(id, 'the wording is backed by a persisted row');
      assert.ok(response.text.includes(`#${id}`));
    });

    it('34. the confirmation states that no Finding has been created', async () => {
      const response = await postForm('/atiman/report', USER_A, formFor(AS_CODE_A1, {
        observationText: mark('finding boundary probe')
      }));
      assert.match(response.text, /No Finding has been created/);

      // The confirmation states the negation explicitly, and presents no severity,
      // no outcome and no other claim the server did not make.
      assert.match(response.text, /no severity has been set/);
      for (const overclaim of [
        /assessment (is )?(complete|completed)/i,
        /abnormalit(y|ies) confirmed/i,
        /maintenance (is )?required/i,
        /work order (has been )?(created|raised)/i,
        /SAP (has been )?notified/i,
        /notification (has been )?sent/i,
        /evidence uploaded/i
      ]) {
        assert.ok(!overclaim.test(response.text), `${overclaim} must not be claimed`);
      }
      for (const presentation of [
        /name="severity"/i,
        /severity\s*[:=]\s*["']?(low|medium|high|critical)/i,
        /name="outcome"/i,
        /outcome\s*[:=]\s*["']?\w/i,
        /Operator Correction/i,
        /\bEscalation\b/,
        /name="risk"/i,
        /name="priority"/i
      ]) {
        assert.ok(!presentation.test(response.text),
          `${presentation} must not be presented as a value or a control`);
      }
    });

    it('35. a persistence-path failure never displays success', async () => {
      // Drive the REAL controller with a writer that fails after resolution has
      // already succeeded, so the property "no success without persistence" is
      // executed rather than read out of the source.
      const controllerPath = require.resolve('../src/controllers/report-capture.controller');
      const servicePath = require.resolve('../src/services/observation.service');
      const cache = require.cache;
      const realController = cache[controllerPath];
      const realService = cache[servicePath];
      assert.ok(realController && realService, 'both modules must already be loaded');

      const renders = [];
      const fakeReq = {
        user: {
          id: USER_A,
          organization_id: ORG_A,
          organization_name: 'probe',
          is_active: true,
          role: 'operator'
        },
        body: formFor(AS_CODE_A1, { observationText: 'stubbed failure probe' })
      };
      const fakeRes = {
        render(view, options) { renders.push({ view, options }); return this; },
        status() { return this; },
        json() { return this; }
      };
      let captured = null;

      const before = await observationsFor([ORG_A]);
      try {
        cache[servicePath].exports = {
          ...realService.exports,
          createObservation: async () => { throw new Error('writer unavailable'); }
        };
        delete cache[controllerPath];
        const reloaded = require('../src/controllers/report-capture.controller');
        await reloaded.postReport(fakeReq, fakeRes, (error) => { captured = error; });
      } finally {
        cache[servicePath] = realService;
        cache[controllerPath] = realController;
        delete cache[controllerPath];
        require('../src/controllers/report-capture.controller');
      }

      assert.ok(captured instanceof Error, 'the failure is handed to the error handler');
      assert.ok(renders.every((r) => r.options.state !== 'RECORDED'),
        'no recorded state may be rendered when the writer failed');
      assert.strictEqual(await observationsFor([ORG_A]), before, 'nothing was persisted');
    });

    it('36. a validation failure preserves what was entered', async () => {
      const response = await postForm('/atiman/report', USER_A, formFor(AS_CODE_A1, {
        observationText: mark('kept text about the seal'),
        measuredValue: '99',
        unit: 'degC'
      }).valueOf());
      // valid, so no error — now make it invalid while keeping the text
      assert.ok(response.text.includes('Observation recorded'));

      const survivor = mark('this text must survive the failure');
      const invalid = await postForm('/atiman/report', USER_A, {
        identifierType: 'code',
        identifierValue: ID_A1.code,
        observationText: survivor,
        measuredValue: '',
        unit: 'degC'
      });
      assert.ok(!invalid.text.includes('Observation recorded'));
      assert.match(invalid.text, /A unit describes a measured value/);
      assert.ok(invalid.text.includes(survivor),
        'the entered description is returned to the operator');
      assert.ok(invalid.text.includes('value="degC"'), 'the entered unit is returned too');

      const badValue = await postForm('/atiman/report', USER_A, {
        identifierType: 'code',
        identifierValue: ID_A1.code,
        observationText: 'decimal kept',
        measuredValue: 'abc',
        unit: ''
      });
      assert.ok(badValue.text.includes('decimal kept'));
      assert.ok(badValue.text.includes('value="abc"'), 'the rejected value is returned for correction');

      // A lookup failure on submission must not discard the entry either. The claim
      // that the text is kept is only true if the text is actually rendered, so the
      // value itself is asserted — a note saying "kept below" is not evidence.
      const preserved = mark('preserved through a failed lookup');
      const unresolved = await postForm('/atiman/report', USER_A, {
        identifierType: 'code',
        identifierValue: `GONE-${RUN}`,
        observationText: preserved,
        measuredValue: '42.5',
        unit: 'degC'
      });
      assert.match(unresolved.text, /No asset is registered under that code/);
      assert.ok(unresolved.text.includes(preserved),
        'the entered description must actually be rendered, not merely referred to');
      assert.ok(unresolved.text.includes('42.5') && unresolved.text.includes('degC'),
        'the entered measurement and unit must be rendered too');
      assert.ok(!/Observation recorded/.test(unresolved.text));
      assert.ok(!/has been (saved|recorded|submitted)/i.test(unresolved.text),
        'a failed lookup must not claim anything was stored');
    });

    it('37. no offline durability is claimed anywhere on the Report surface', async () => {
      const page = await getPage(`/atiman/report?code=${encodeURIComponent(ID_A1.code)}`, USER_A);
      assert.ok(!/will be saved|saved offline|queued|synchronis|synchroniz|sync/i.test(page.text),
        'the surface must not imply offline durability');
      assert.match(page.text, /Recording needs a connection/i);
      assert.match(page.text, /nothing is stored/i);

      const shell = fs.readFileSync(path.join(REPO_ROOT, 'public/js/atiman-shell.js'), 'utf8');
      assert.match(shell, /Offline — read only/,
        'the accepted I1 connectivity semantics remain authoritative');

      const reportJs = fs.existsSync(path.join(REPO_ROOT, 'public/js/atiman-report.js'));
      assert.strictEqual(reportJs, false, 'no client-side capture script may exist');
    });
  });

  // ----------------------------------------------- F. Today / asset context

  describe('F. Today and asset-context integration', () => {
    it('38. Today offers a real Report action when the capability is held', async () => {
      const withCapability = availableActions(new Set(['finding.report']));
      const action = withCapability.find((entry) => entry.id === 'report');
      assert.ok(action, 'a Report action exists');
      assert.strictEqual(action.href, '/atiman/report', 'the href leads somewhere real');
      assert.ok(!withCapability.some((entry) => entry.id === 'reporting-unavailable'),
        'the placeholder is gone');

      const withoutCapability = availableActions(new Set(['inspection.execute']));
      assert.ok(!withoutCapability.some((entry) => entry.id === 'report'),
        'no action without the capability');

      const page = await getPage('/today', USER_A);
      assert.ok(page.text.includes('href="/atiman/report"'));
      assert.match(page.text, /Report an observation/i);
    });

    it('39. asset context offers a real Report action only for a resolved asset', async () => {
      const resolved = await getPage(`/atiman/asset?code=${encodeURIComponent(ID_A1.code)}`, USER_A);
      assert.ok(resolved.text.includes(`href="/atiman/report?code=${encodeURIComponent(ID_A1.code)}"`),
        'the hand-off carries the identifier, not an asset id');

      const unresolved = await getPage('/atiman/asset?code=NOT-A-REAL-ASSET', USER_A);
      assert.ok(!resolved.text.includes('href="/atiman/report?token='),
        'no token hand-off when the identifier was a code');

      assert.ok(!unresolved.text.includes('Report an observation'),
        'no Report action without resolution');

      // The navigation carries a Report link for an authorized principal on every
      // page; what must not appear is the ASSET-SPECIFIC hand-off.
      const foreign = await getPage(`/atiman/asset?code=${encodeURIComponent(ID_B1.code)}`, USER_A);
      assert.strictEqual(foreign.text.includes('/atiman/report?code='), false,
        'no Report hand-off for another tenant\'s asset');
      assert.strictEqual(foreign.text.includes('/atiman/report?token='), false);
    });

    it('40/41. Inspect, Assess, Monitor and Escalate all remain unavailable', async () => {
      const held = new Set(V1_HUMAN_GRANTABLE);
      const nav = composeWorkNavigation(held).map((d) => d.id);
      assert.ok(!nav.includes('inspect'));
      assert.ok(!nav.includes('assess'));
      assert.ok(!nav.includes('monitor'));
      assert.ok(!nav.includes('escalate'));

      const withheld = withheldDestinations(held).map((d) => d.id).sort();
      assert.deepStrictEqual(withheld, ['assess', 'escalate', 'inspect', 'monitor']);

      const today = await getPage('/today', USER_A);
      assert.ok(!/href="\/atiman\/inspect/.test(today.text));
      assert.ok(!/href="\/atiman\/assess/.test(today.text));

      // Report is not a superset of Inspect: it never asserts procedure context.
      const report = await getPage(`/atiman/report?code=${encodeURIComponent(ID_A1.code)}`, USER_A);
      assert.ok(!/inspect/i.test(report.text.replace(/Inspection execution and finding assessment[^.]*\./g, '')));
    });
  });

  // ------------------------------------------------------- G. accessibility

  describe('G. accessibility', () => {
    it('42. every capture input has a programmatic label', async () => {
      const page = await getPage(`/atiman/report?code=${encodeURIComponent(ID_A1.code)}`, USER_A);
      const labelled = [...page.text.matchAll(/<label[^>]*for="([^"]+)"/g)].map((m) => m[1]);
      const fields = [...page.text.matchAll(/<(?:input|textarea)[^>]*id="([^"]+)"/g)]
        .map((m) => m[1])
        .filter((id) => !/^(identifier)/.test(id));

      for (const field of ['observationText', 'measuredValue', 'unit']) {
        assert.ok(fields.includes(field), `${field} must exist`);
        assert.ok(labelled.includes(field), `${field} must have a label`);
      }
      // Hidden identifier fields are not operator inputs.
      assert.deepStrictEqual(
        [...page.text.matchAll(/<input[^>]*type="hidden"[^>]*name="([^"]+)"/g)].map((m) => m[1]).sort(),
        ['identifierType', 'identifierValue']);
    });

    it('43. validation errors are programmatically associated with their fields', async () => {
      const response = await postForm('/atiman/report', USER_A, {
        identifierType: 'code',
        identifierValue: ID_A1.code,
        observationText: 'note',
        measuredValue: '',
        unit: 'degC'
      });
      assert.match(response.text, /role="alert"/, 'an error summary is announced');
      assert.match(response.text, /id="unit-error"/, 'the field error carries an id');
      assert.match(response.text, /aria-describedby="unit-error"/, 'the field points at its error');
      assert.match(response.text, /aria-invalid="true"/);
      assert.match(response.text, /href="#unit-error"/, 'the summary links to the field');

      // The association is real: the referenced id exists in the same document.
      const referenced = [...response.text.matchAll(/aria-describedby="([^"]+)"/g)].map((m) => m[1]);
      for (const id of referenced) {
        assert.ok(response.text.includes(`id="${id}"`), `${id} must exist for the reference to resolve`);
      }
    });

    it('44/45. the accepted target floor holds and zoom is never suppressed', async () => {
      const shellCss = fs.readFileSync(path.join(REPO_ROOT, 'public/css/atiman-shell.css'), 'utf8');
      assert.match(shellCss, /\.atiman-input\s*\{[^}]*min-height:\s*var\(--atiman-target-min\)/s,
        'the capture input honours the Atiman target floor');
      const tokens = fs.readFileSync(path.join(REPO_ROOT, 'public/css/atiman-tokens.css'), 'utf8');
      assert.match(tokens, /--atiman-target-min:\s*44px/);

      // The layout's own comment NAMES the prohibited attribute in order to forbid
      // it, so comments are stripped before the scan — otherwise the prohibition
      // would be detected as the violation.
      const layout = fs.readFileSync(path.join(REPO_ROOT, 'views/atiman/layout.ejs'), 'utf8')
        .replace(/<%#[\s\S]*?%>/g, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ');
      assert.ok(!/user-scalable\s*=\s*no/.test(layout), 'zoom must not be suppressed');
      assert.ok(!/maximum-scale/.test(layout));

      const page = await getPage(`/atiman/report?code=${encodeURIComponent(ID_A1.code)}`, USER_A);
      assert.ok(!/user-scalable\s*=\s*no/.test(page.text));
      assert.ok(!/maximum-scale/.test(page.text));

      // No inline styles anywhere on the surface (ATM-002-R4 / I1 rule).
      assert.ok(!/\sstyle="/.test(page.text), 'the Report surface must contain no inline styles');
      const reportView = fs.readFileSync(path.join(REPO_ROOT, 'views/atiman/report.ejs'), 'utf8');
      assert.ok(!/\sstyle="/.test(reportView));
    });

    it('46. the whole workflow is reachable by keyboard with no gesture requirement', async () => {
      const reportView = fs.readFileSync(path.join(REPO_ROOT, 'views/atiman/report.ejs'), 'utf8');
      assert.ok(!/onclick|ontouchend|touchstart|swipe/i.test(reportView),
        'no gesture handler may be required');
      assert.ok(!/onclick/i.test(fs.readFileSync(path.join(REPO_ROOT, 'views/atiman/report-denied.ejs'), 'utf8')));

      const page = await getPage(`/atiman/report?code=${encodeURIComponent(ID_A1.code)}`, USER_A);
      assert.ok(page.text.includes('type="submit"'), 'a real submit control performs the action');
      assert.ok(!/<div[^>]*onclick/i.test(page.text), 'no clickable div replaces a control');
      assert.match(page.text, /class="atiman-skip-link"/, 'the shell retains its skip link');

      const mobileJs = fs.readFileSync(path.join(REPO_ROOT, 'public/js/odm-mobile.js'), 'utf8');
      assert.match(mobileJs, /e\.preventDefault\(\)/,
        'the legacy touch handler still exists and must not have been copied into the new surface');
    });
  });

  // -------------------------------------------------------------- H. schema

  describe('H. schema', () => {
    it('47/48. the migration endpoint is still 023 and no 024 exists', async () => {
      const files = fs.readdirSync(path.join(REPO_ROOT, 'database', 'postgresql'))
        .filter((name) => /^\d{3}_.*\.sql$/.test(name)).sort();
      assert.strictEqual(files.length, 23, 'I2E adds no migration');
      assert.strictEqual(files[files.length - 1], '023_asset_observations.sql');
      assert.ok(!files.some((name) => name.startsWith('024')));

      const columns = await scalar(
        `SELECT count(*)::int FROM information_schema.columns WHERE table_name='asset_observations'`);
      assert.strictEqual(columns, 14, 'the accepted Observation schema is unchanged');
    });

    it('adds no generic Observation API', async () => {
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
      assert.deepStrictEqual(routePaths.filter((route) => /observation/i.test(route)), [],
        'no /api/observations surface may exist');

      // The only Report surface is the task-specific pair.
      const reportRoutes = routePaths.filter((route) => /\/report$/.test(route)).sort();
      assert.deepStrictEqual(reportRoutes, ['GET /report', 'POST /report']);
    });
  });
});
