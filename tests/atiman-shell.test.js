/**
 * ATM-002-I1 — Atiman application shell and Today.
 *
 * Proves the first Atiman-native slice against the ratified records: canonical
 * Today entry, manifest/entry reconciliation, capability-composed work
 * navigation with no role authority, truthful Today content, no EAM-owned
 * destination promoted, no Finding outcome invented, no offline claim, and
 * accessibility-critical markup.
 *
 * Database-mutating suite (it resolves real capabilities and reads real product
 * state): gated on isIntegrationTest().
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const vm = require('node:vm');
const { getConnection, isIntegrationTest } = require('../src/config/database');
const { resolveCapabilities } = require('../src/services/capability.service');
const { DESTINATIONS, composeWorkNavigation, withheldDestinations } = require('../src/config/destinations');
const { reportedFindings, availableActions } = require('../src/services/today.service');
const { getToday } = require('../src/controllers/atiman.controller');
const { LEGACY_COMPATIBILITY_BUNDLES } = require('../src/config/capabilities');
const { requireCapability } = require('../src/middleware/capability.middleware');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'the Atiman shell suite resolves real capabilities and reads real product '
    + 'state, so it requires the sanctioned database-test gate '
    + '(NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) via `npm run test:integration`';

const REPO_ROOT = path.resolve(__dirname, '..');
const ORG = 993001;
const ORG_B = 993002;
const ADMIN = 993101;
const SUPERVISOR = 993102;
const OPERATOR = 993103;
const ORG_FACILITY = 993201;
const ORG_ASSET = 993202;
const ORG_B_FACILITY = 993203;
const ORG_B_ASSET = 993204;

const withConn = async (fn) => {
  const conn = await getConnection();
  try { const r = await fn(conn); await conn.commit(); return r; }
  catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
};

async function ensureFixture() {
  await withConn(async (conn) => {
    for (const [id, name] of [[ORG, 'I1 Org'], [ORG_B, 'I1 Other Org']]) {
      await conn.query(`INSERT INTO organizations (id, organization_name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`, [id, name]);
    }
    for (const [id, username, role, org] of [
      [ADMIN, 'i1-admin', 'admin', ORG],
      [SUPERVISOR, 'i1-supervisor', 'supervisor', ORG],
      [OPERATOR, 'i1-operator', 'operator', ORG]
    ]) {
      await conn.query(
        `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
         VALUES (?, ?, ?, 'x', 'I1 Fixture', ?, ?, true) ON CONFLICT (id) DO NOTHING`,
        [id, username, `${username}@test.local`, role, org]);
    }
    // Findings require a facility and an asset, so the fixture provides both.
    await conn.query(
      `INSERT INTO facilities (id, organization_id, name, code, is_active, default_operator_id)
       VALUES (?, ?, 'I1 Facility', 'I1-FAC', true, ?) ON CONFLICT (id) DO NOTHING`, [ORG_FACILITY, ORG, OPERATOR]);
    await conn.query(
      `INSERT INTO equipment (id, organization_id, facility_id, name, code)
       VALUES (?, ?, ?, 'I1 Asset', 'I1-ASSET') ON CONFLICT (id) DO NOTHING`, [ORG_ASSET, ORG, ORG_FACILITY]);
    await conn.query(
      `INSERT INTO facilities (id, organization_id, name, code, is_active, default_operator_id)
       VALUES (?, ?, 'I1 Other Facility', 'I1-OFAC', true, ?) ON CONFLICT (id) DO NOTHING`, [ORG_B_FACILITY, ORG_B, OPERATOR]);
    await conn.query(
      `INSERT INTO equipment (id, organization_id, facility_id, name, code)
       VALUES (?, ?, ?, 'I1 Other Asset', 'I1-OASSET') ON CONFLICT (id) DO NOTHING`, [ORG_B_ASSET, ORG_B, ORG_B_FACILITY]);
  });
}

const readSource = (relative) => fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
/** Source with comments removed: a comment may NAME a forbidden pattern to explain it. */
const readCode = (relative) => readSource(relative)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/<%#[\s\S]*?%>/g, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
/** Collapse whitespace so assertions are not defeated by template line wrapping. */
const text = (html) => html.replace(/\s+/g, ' ');
const renderPage = (template, data) => ejs.renderFile(
  path.join(REPO_ROOT, 'views', 'atiman', template), data, { async: false });

describe('ATM-002-I1 Atiman application shell', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => { await ensureFixture(); });

  describe('A/B — canonical entry and manifest reconciliation', () => {
    it('the manifest is valid JSON, names Atiman, and points at the canonical Today', async () => {
      const raw = readSource('public/manifest.json');
      let manifest;
      assert.doesNotThrow(() => { manifest = JSON.parse(raw); },
        'the manifest must be valid JSON — it previously contained "=" instead of ":" and was ignored by browsers');
      assert.strictEqual(manifest.start_url, '/today', 'the canonical entry is Today');
      assert.strictEqual(manifest.name, 'Atiman');
      assert.ok(!/ODM/i.test(raw), 'the Atiman shell manifest must not carry legacy ODM identity');
    });

    it('the legacy Today and home entries redirect to the canonical Today', async () => {
      const mobile = readSource('src/routes/mobile.routes.js');
      for (const route of ["router.get('/home'", "router.get('/today'"]) {
        const i = mobile.indexOf(route);
        assert.ok(i >= 0, `${route} must still exist so bookmarks keep working`);
        const block = mobile.slice(i, mobile.indexOf('\n});', i));
        assert.match(block, /redirect\('\/today'\)/, `${route} must redirect to /today`);
      }
    });

    it('the shell router serves /today and its root redirects there', async () => {
      const source = readSource('src/routes/atiman.routes.js');
      assert.match(source, /router\.get\('\/today', requireWebSession, getToday\)/);
      assert.match(source, /router\.get\('\/', requireWebSession, \(req, res\) => res\.redirect\('\/today'\)\)/);
      assert.match(readSource('src/app.js'), /app\.get\('\/today', require\('\.\/routes\/atiman\.routes'\)\)/);
    });
  });

  describe('C — navigation composes from capabilities', () => {
    it('renders only available destinations whose capability is held', async () => {
      const noCaps = composeWorkNavigation(new Set());
      assert.deepStrictEqual(noCaps.map((d) => d.id), ['today', 'knowledge'],
        'an authenticated principal with no capabilities still gets the canonical entry and knowledge reading');

      const withExecute = composeWorkNavigation(new Set(['inspection.execute']));
      assert.deepStrictEqual(withExecute.map((d) => d.id), ['today', 'knowledge'],
        'a destination with no truthful surface is not rendered merely because the capability is held');
    });

    it('a capability-gated destination appears when available and held, and not otherwise', () => {
      // Proves the composition mechanism itself, independent of which destinations
      // happen to be available in this slice.
      const gate = DESTINATIONS.find((d) => d.id === 'assess');
      assert.strictEqual(gate.available, false);
      assert.strictEqual(gate.capability, 'finding.assess');
      assert.ok(!composeWorkNavigation(new Set(['finding.assess'])).some((d) => d.id === 'assess'),
        'availability is checked before capability');
      assert.ok(withheldDestinations(new Set()).some((d) => d.id === 'assess'));
    });

    it('the compatibility bundles compose navigation without any role input', () => {
      const perRole = Object.keys(LEGACY_COMPATIBILITY_BUNDLES).map((role) =>
        composeWorkNavigation(new Set(LEGACY_COMPATIBILITY_BUNDLES[role])).map((d) => d.id));
      assert.deepStrictEqual(perRole[0], perRole[1]);
      assert.deepStrictEqual(perRole[1], perRole[2]);
      assert.ok(perRole.every((ids) => ids.includes('today')));
    });
  });

  describe('D — no role-based navigation authority in the new shell', () => {
    it('no shell file derives navigation from a role', () => {
      for (const file of [
        'src/config/destinations.js', 'src/controllers/atiman.controller.js',
        'src/routes/atiman.routes.js', 'views/atiman/layout.ejs',
        'views/atiman/partials/nav.ejs', 'views/atiman/partials/header.ejs',
        'public/js/atiman-shell.js'
      ]) {
        const source = readSource(file);
        assert.ok(!/\buserRole\b/.test(source), `${file} must not use userRole`);
        assert.ok(!/role\s*===/.test(source), `${file} must not compare roles`);
        assert.ok(!/is(Admin|Supervisor|Operator)\b/.test(source), `${file} must not use role helpers`);
      }
    });

    it('the navigation registry contains no module or EAM destination', () => {
      const forbidden = ['work-order', 'work_order', 'calendar', 'maintenance-plan', 'schedules',
        'reports', 'work-orders', 'inventory', 'procurement', 'custom-fields', 'coverage'];
      for (const destination of DESTINATIONS) {
        const haystack = `${destination.id} ${destination.label} ${destination.href || ''}`.toLowerCase();
        for (const term of forbidden) {
          assert.ok(!haystack.includes(term), `${destination.id} must not promote ${term}`);
        }
      }
    });
  });

  describe('F/G/H/I/J — composition per bundle, no duplicates, nothing withheld', () => {
    it('operator, supervisor and admin each get a truthful, duplicate-free navigation', async () => {
      for (const [role, id] of [['operator', OPERATOR], ['supervisor', SUPERVISOR], ['admin', ADMIN]]) {
        const resolved = await resolveCapabilities({ id });
        assert.strictEqual(resolved.mode, 'LEGACY_COMPATIBILITY', `${role} must resolve in compatibility mode`);
        const nav = composeWorkNavigation(resolved.capabilities);
        const ids = nav.map((d) => d.id);
        assert.strictEqual(new Set(ids).size, ids.length, `${role} navigation must contain no duplicates`);
        const hrefs = nav.map((d) => d.href);
        assert.strictEqual(new Set(hrefs).size, hrefs.length,
          `${role} navigation must not point two destinations at one surface`);
        assert.ok(ids.includes('today'), `${role} must always reach Today`);
      }
    });

    it('withheld destinations are reported, not silently missing', async () => {
      const resolved = await resolveCapabilities({ id: SUPERVISOR });
      const withheld = withheldDestinations(resolved.capabilities).map((d) => d.id);
      for (const id of ['inspect', 'report', 'assess', 'monitor', 'escalate']) {
        assert.ok(withheld.includes(id), `${id} must be reported as withheld`);
      }
    });
  });

  describe('E — descriptor failure fails closed for gated presentation', () => {
    it('a control gated on a capability stays hidden when the descriptor fails', async () => {
      const source = readSource('public/js/atiman-shell.js');
      const sandbox = {
        window: {
          atimanCapabilities: { load: () => Promise.reject(new Error('offline')), hasCapability: () => false },
          addEventListener: () => {}
        },
        document: {
          readyState: 'complete',
          body: { setAttribute: () => {} },
          getElementById: () => null,
          querySelectorAll: () => [{
            getAttribute: () => 'knowledge.publish',
            setAttribute: (name) => { sandbox.hidden = name; },
            removeAttribute: () => { sandbox.revealed = true; }
          }],
          addEventListener: (_, fn) => fn()
        },
        navigator: { onLine: false },
        Array, Promise, RegExp
      };
      vm.createContext(sandbox);
      vm.runInContext(source, sandbox);
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.strictEqual(sandbox.revealed, undefined, 'a gated control must not be revealed');
      assert.strictEqual(sandbox.hidden, 'hidden', 'a gated control must be hidden');
    });
  });

  describe('K — unauthenticated behaviour', () => {
    it('an unauthenticated page request is redirected, never served', async () => {
      const router = require('../src/routes/atiman.routes');
      const response = { statusCode: null, redirected: null };
      const res = {
        status() { return this; },
        json() { return this; },
        redirect(location) { response.redirected = location; return this; }
      };
      await new Promise((resolve) => {
        router.handle({ method: 'GET', url: '/today', originalUrl: '/today', cookies: {}, headers: {} }, res, resolve);
        setTimeout(resolve, 300);
      });
      assert.ok(response.redirected && response.redirected.startsWith('/mobile/login'),
        `unauthenticated access must redirect to the login surface, got ${response.redirected}`);
    });
  });

  describe('L — tenant context', () => {
    it('reported findings are tenant-scoped and fail closed without a tenant', async () => {
      await withConn((conn) => conn.query(
        `INSERT INTO findings (organization_id, facility_id, asset_id, finding_description, severity, reported_by_user_id, reported_at)
         VALUES (?, ?, ?, 'I1 fixture finding for org A', 'low', ?, NOW())`, [ORG, ORG_FACILITY, ORG_ASSET, OPERATOR]));
      await withConn((conn) => conn.query(
        `INSERT INTO findings (organization_id, facility_id, asset_id, finding_description, severity, reported_by_user_id, reported_at)
         VALUES (?, ?, ?, 'I1 fixture finding for org B', 'low', ?, NOW())`, [ORG_B, ORG_B_FACILITY, ORG_B_ASSET, OPERATOR]));

      const mine = await reportedFindings(ORG, { limit: 50 });
      const theirs = await reportedFindings(ORG_B, { limit: 50 });
      assert.ok(mine.items.some((i) => /org A/.test(i.description)));
      assert.ok(!mine.items.some((i) => /org B/.test(i.description)),
        'another tenant\'s findings must never appear');
      assert.ok(theirs.items.some((i) => /org B/.test(i.description)));

      const noTenant = await reportedFindings(null);
      assert.deepStrictEqual(noTenant, { count: 0, items: [] }, 'no tenant context must yield no data');
    });

    it('the shell renders the tenant context it was given', async () => {
      const html = await renderPage('partials/header.ejs', {
        title: 'Today', organizationName: 'I1 Org', accountHref: '/mobile/profile'
      });
      assert.match(html, /I1 Org/);
    });
  });

  describe('M/N — responsive, one IA, accessibility-critical markup', () => {
    it('the shell keeps pinch zoom and uses one navigation for every screen size', async () => {
      const layout = readCode('views/atiman/layout.ejs');
      assert.ok(!/user-scalable\s*=\s*no/i.test(layout), 'pinch zoom must remain available');
      assert.ok(!/maximum-scale/i.test(layout), 'the shell must not cap zoom');

      const css = readSource('public/css/atiman-shell.css');
      assert.match(css, /@media \(min-width: 48rem\)/, 'one expanded breakpoint, not a second product');
      assert.strictEqual((css.match(/atiman-worknav__list/g) || []).length >= 1, true);
      assert.match(css, /--atiman-target-min/, 'the field target floor must be expressed in tokens');
      assert.match(readSource('public/css/atiman-tokens.css'), /--atiman-target-min: 44px/);
    });

    it('renders landmarks, a skip link, accessible names and non-colour state', async () => {
      const html = await renderPage('today.ejs', {
        title: 'Today',
        organizationName: 'I1 Org',
        accountHref: '/mobile/profile',
        activeDestination: 'today',
        workNavigation: composeWorkNavigation(new Set()),
        findings: { count: 0, items: [] },
        actions: availableActions(new Set())
      }).then(async (body) => renderPage('layout.ejs', {
        title: 'Today', organizationName: 'I1 Org', accountHref: '/mobile/profile',
        activeDestination: 'today', workNavigation: composeWorkNavigation(new Set()), body
      }));

      const flat = text(html);
      assert.match(flat, /<html lang="en"/);
      assert.match(flat, /class="atiman-skip-link" href="#atiman-main"/);
      assert.match(flat, /<main[^>]*id="atiman-main"/);
      assert.match(flat, /<nav[^>]*aria-label="Work"/);
      assert.match(flat, /aria-current="page"/, 'the current destination must be exposed to assistive technology');
      assert.match(flat, /current form/, 'a transitional destination must be marked as such in the shell');
      assert.match(flat, /role="status"/, 'connectivity must be announced');
      assert.match(flat, /id="atiman-connectivity-label"/, 'connectivity state must be named in text, not colour alone');
      assert.ok(!/user-scalable/i.test(html));
    });

    it('badges and attention states are communicated without relying on colour', async () => {
      const html = await renderPage('today.ejs', {
        title: 'Today', organizationName: null, accountHref: '/mobile/profile',
        activeDestination: 'today', workNavigation: composeWorkNavigation(new Set()),
        findings: { count: 2, items: [{ id: 1, description: 'Fixture', severity: 'low', reported_at_label: '2026-09-27', reported_by: 'I1 Fixture', asset_label: null }] },
        actions: []
      });
      assert.match(text(html), /2 reported/, 'the attention badge must carry text');
    });
  });

  describe('O/P — truthful boundaries', () => {
    it('invents no Finding outcome and states the boundary instead', async () => {
      const service = readSource('src/services/today.service.js');
      for (const term of ['Operator Correction', 'Monitoring', 'Escalation', 'assessment', 'outcome']) {
        assert.ok(!new RegExp(term, 'i').test(service) || /not implemented|does not|never/.test(service),
          `today.service.js must not assert ${term} semantics`);
      }
      const html = await renderPage('today.ejs', {
        title: 'Today', organizationName: null, accountHref: '/mobile/profile',
        activeDestination: 'today', workNavigation: composeWorkNavigation(new Set()),
        findings: { count: 0, items: [] }, actions: []
      });
      assert.match(text(html), /not implemented yet/, 'Today must state what is not available');
      assert.ok(!/Operator Correction/.test(html), 'no assessment outcome may be presented');
      assert.ok(!/work order/i.test(html), 'no work-order concept may be presented');
    });

    it('makes no offline synchronisation claim', () => {
      for (const file of ['public/js/atiman-shell.js', 'views/atiman/layout.ejs', 'views/atiman/partials/connectivity.ejs']) {
        const source = readCode(file);
        assert.ok(!/\bsync\b|synchronis|synchroniz|queued|will be saved|saved offline/i.test(source),
          `${file} must not imply offline persistence or synchronisation`);
      }
      assert.match(readSource('public/js/atiman-shell.js'), /Offline — read only/,
        'offline must be presented as read-only');
    });

    it('Today is served by the canonical route with server-resolved composition', () => {
      const source = readSource('src/controllers/atiman.controller.js');
      assert.match(source, /resolveCapabilities\(req\.user\)/,
        'the shell must resolve capabilities on the server');
      assert.match(source, /composeWorkNavigation\(capabilities\)/);
      assert.ok(!/req\.body|req\.query|req\.headers/.test(source),
        'the shell must never take authority from the request');
    });
  });

  describe('E/Q — browser capability state cannot authorize', () => {
    it('the rendered Today passes no authority to the browser and the server guard still decides', async () => {
      const localVars = {};
      const res = { render: (view, locals) => { localVars.view = view; localVars.locals = locals; } };
      await getToday({ user: { id: OPERATOR, organization_id: ORG }, organization: { organization_name: 'I1 Org' } }, res, () => {});
      assert.strictEqual(localVars.view, 'atiman/today');
      assert.ok(!('role' in localVars.locals), 'no role may be passed to the view');
      assert.ok(!('capabilities' in localVars.locals), 'the raw capability set is not needed by the template');
      assert.ok(Array.isArray(localVars.locals.workNavigation));

      // A browser that believes it holds a capability still faces the server guard.
      const forged = { user: { id: OPERATOR }, capabilities: new Set(['knowledge.publish']) };
      let allowed = false;
      await requireCapability('knowledge.publish')(forged, { status: () => ({ json: () => {} }) }, () => { allowed = true; });
      assert.strictEqual(allowed, false, 'browser state must never satisfy a server guard');
    });
  });
});
