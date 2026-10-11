/**
 * ATM-001-SEC-00C — organization-deletion route wiring (no database).
 *
 * Static companion to tests/organization-delete-containment.test.js. The
 * containment suite is database-mutating and therefore executes ZERO tests
 * unless the sanctioned database-test gate is present (a contract enforced by
 * tests/database-test-guard.test.js). These wiring assertions need no database,
 * so they hold under a plain `npm test` and cannot be silently skipped.
 *
 * They guard the containment's two structural promises:
 *   1. the destructive controller handler is no longer wired to any route; and
 *   2. every unrelated organization endpoint is still registered unchanged.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROUTES_FILE = path.join(__dirname, '..', 'src', 'routes', 'organization.routes.js');
const CONTROLLER_FILE = path.join(__dirname, '..', 'src', 'controllers', 'organization.controller.js');

// Comments legitimately name the removed wiring to explain the containment, so
// wiring assertions read executable lines only.
const codeLines = (file) => fs.readFileSync(file, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('*') && !line.startsWith('//') && !line.startsWith('/*'));

describe('ATM-001-SEC-00C — organization-deletion route wiring', () => {
  it('does not route the destructive controller operation any more', () => {
    const wired = codeLines(ROUTES_FILE)
      .filter((line) => /organizationController\s*\.\s*remove/.test(line));
    assert.deepStrictEqual(
      wired, [],
      'the destructive controller handler must not be wired to any route');
  });

  it('denies with a stable, documented response code independent of role', () => {
    const lines = codeLines(ROUTES_FILE);
    assert.ok(
      lines.some((line) => /ORGANIZATION_DELETION_DISABLED/.test(line)),
      'the containment denial code must be present on the route');
    assert.ok(
      lines.some((line) => /res\.status\(403\)/.test(line)),
      'the denial must be a 403');

    const deleteLine = lines.find((line) => /^router\.delete\(/.test(line));
    assert.ok(deleteLine, 'the DELETE route must still be registered');
    assert.ok(
      !/requireAdmin/.test(deleteLine),
      'the DELETE route must not delegate to role middleware: every role is denied');
  });

  it('retains the destructive operation for a future OWNER-approved policy', () => {
    assert.ok(
      codeLines(CONTROLLER_FILE).some((line) => /Organization\s*\.\s*delete\(/.test(line)),
      'containment is at the route, not by deleting lifecycle code');
  });

  it('preserves every unrelated organization endpoint', () => {
    const lines = codeLines(ROUTES_FILE);
    const expected = [
      "router.get('/public'",
      "router.get('/', requireAdmin",
      "router.post('/', requireAdmin",
      "router.get('/my'",
      "router.get('/:id'",
      "router.put('/:id'",
      "router.put('/:id/subscription'",
      "router.get('/:id/stats'",
      "router.post('/logo'"
    ];
    for (const registration of expected) {
      assert.ok(
        lines.some((line) => line.startsWith(registration)),
        `unrelated organization endpoint was disturbed: ${registration}`);
    }
  });
});
