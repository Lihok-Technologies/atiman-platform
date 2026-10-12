/**
 * ATM-001 SEC — role-issuance authority on POST /api/auth/register.
 *
 * The defect: `POST /api/auth/register` was guarded only by `requireAdmin`, which
 * admits BOTH `admin` and `supervisor` (src/middleware/auth.js:62-70), while
 * `authController.register` persists the client-supplied `role` verbatim. A
 * supervisor could therefore create an `admin` account inside their own
 * organization — a privilege escalation.
 *
 * The correction reuses the approved authority already applied to user creation
 * at `POST /api/users`: `canCreateUser` (src/middleware/rbac.js:435).
 *
 * This suite asserts BOTH the wiring (the route actually mounts the authority)
 * and the behaviour (the authority actually refuses the escalation). It is a
 * pure unit suite: it needs no database, so it runs under `npm test`.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const ROUTES = path.join(REPO_ROOT, 'src', 'routes', 'auth.routes.js');
const routeSource = fs.readFileSync(ROUTES, 'utf8');

const { canCreateUser } = require('../src/middleware/rbac');

const REGISTER_LINE = routeSource
  .split('\n')
  .find((line) => /router\.post\(\s*'\/register'/.test(line));

function mockRes() {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

async function runAuthority(user, body) {
  const req = { user, body: { ...body } };
  const res = mockRes();
  let passed = false;
  await canCreateUser(req, res, (err) => { if (err) throw err; passed = true; });
  return { passed, statusCode: res.statusCode, body: res.body, req };
}

test('W1 — POST /register mounts the role-issuance authority', () => {
  assert.ok(REGISTER_LINE, 'the /register route must exist');
  assert.match(REGISTER_LINE, /authenticate/, 'authentication must still gate the route');
  assert.match(REGISTER_LINE, /canCreateUser/, 'the role-issuance authority must gate the route');
  // Order matters: authority is resolved after authentication and before the controller.
  const order = REGISTER_LINE.indexOf('authenticate');
  const authority = REGISTER_LINE.indexOf('canCreateUser');
  const controller = REGISTER_LINE.indexOf('authController.register');
  assert.ok(order < authority && authority < controller, 'authority must sit between authentication and the controller');
});

test('W2 — the authority is imported from the approved RBAC middleware', () => {
  assert.match(
    routeSource,
    /require\('\.\.\/middleware\/rbac'\)/,
    'canCreateUser must come from the shared RBAC middleware',
  );
});

test('B1 — NEGATIVE CONTROL: a supervisor cannot create an admin', async () => {
  const r = await runAuthority(
    { role: 'supervisor', facility_id: 7, organization_id: 1 },
    { role: 'admin', username: 'x', email: 'x@example.test' },
  );
  assert.strictEqual(r.passed, false, 'the escalation must be refused');
  assert.strictEqual(r.statusCode, 403);
});

test('B2 — a supervisor can still create an operator in their facility', async () => {
  const r = await runAuthority(
    { role: 'supervisor', facility_id: 7, organization_id: 1 },
    { role: 'operator', username: 'x', email: 'x@example.test' },
  );
  assert.strictEqual(r.passed, true, 'a supervisor must still be able to create operators');
  assert.strictEqual(r.req.body.facility_id, 7, 'the supervisor facility must be applied');
});

test('B3 — a supervisor cannot create another supervisor', async () => {
  const r = await runAuthority(
    { role: 'supervisor', facility_id: 7, organization_id: 1 },
    { role: 'supervisor', username: 'x', email: 'x@example.test' },
  );
  assert.strictEqual(r.passed, false);
  assert.strictEqual(r.statusCode, 403);
});

test('B4 — a supervisor with no facility is refused', async () => {
  const r = await runAuthority(
    { role: 'supervisor', facility_id: null, organization_id: 1 },
    { role: 'operator', username: 'x', email: 'x@example.test' },
  );
  assert.strictEqual(r.passed, false);
  assert.strictEqual(r.statusCode, 403);
});

test('B5 — a non-organization-admin cannot create an admin', async () => {
  const r = await runAuthority(
    { role: 'admin', is_organization_admin: false, organization_id: 1 },
    { role: 'admin', username: 'x', email: 'x@example.test' },
  );
  assert.strictEqual(r.passed, false, 'only an organization administrator may create admins');
  assert.strictEqual(r.statusCode, 403);
});

test('B6 — an operator cannot create anyone', async () => {
  const r = await runAuthority(
    { role: 'operator', organization_id: 1 },
    { role: 'operator', username: 'x', email: 'x@example.test' },
  );
  assert.strictEqual(r.passed, false);
  assert.strictEqual(r.statusCode, 403);
});

test('B7 — an admin may still create non-admin users', async () => {
  const r = await runAuthority(
    { role: 'admin', is_organization_admin: false, organization_id: 1 },
    { role: 'operator', username: 'x', email: 'x@example.test' },
  );
  assert.strictEqual(r.passed, true, 'ordinary user creation must keep working');
});
