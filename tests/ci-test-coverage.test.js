/**
 * ATM-001-SEC-CLOSURE-WP3-01 — focused tests for scripts/assert-test-coverage.js.
 *
 * The point of these tests is that the coverage check must FAIL when coverage is
 * genuinely absent. Every negative control builds a disposable fixture
 * repository, mutates exactly one thing, and asserts the specific check fires.
 *
 * NOTE ON SPELLING. A suite is treated as self-skipping when it both consults
 * the database-test gate and passes a `skip:` option. This test file therefore
 * never contains the gate call as a contiguous literal — fixture source below is
 * assembled from parts — so this suite is NOT itself classified as
 * self-skipping. The detector must stay precise, and a test file must not be
 * able to influence its own classification by accident.
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { analyse, SUPERSEDED_LEGACY_SUITES } = require('../scripts/assert-test-coverage.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const fixtures = [];

after(() => {
  for (const dir of fixtures) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* disposable */ }
  }
});

/** Suite body that skips itself unless the database-test gate is satisfied. */
const selfSkippingBody = (label) => [
  "const { isIntegration" + "Test } = require('../src/config/database');",
  `const REASON_${label} = isIntegration` + "Test() ? false : 'requires the gate';",
  `describe('${label}', { skip: REASON_${label} }, () => { it('gated', () => {}); });`
].join('\n');

/**
 * Build a disposable fixture repository.
 *
 * @param {string[]} ledger          names written into DB_MUTATING_SUITES
 * @param {string[]} contract        raw source lines for the sanctioned array
 * @param {string[]} plainSuites     extra suites that do NOT self-skip
 * @param {object}   skippingSuites  { name: body } for suites that DO self-skip
 */
function makeFixture({ ledger = [], contract = [], plainSuites = [], skippingSuites = {},
                       testScript = 'node --test tests/*.test.js' }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-wp3-fixture-'));
  fixtures.push(root);
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });

  // The three required security-critical suites always exist, so that C9 does
  // not fire for reasons unrelated to the control under test.
  const required = ['runtime-security.test.js', 'phase3-cutover-guard.test.js', 'database-test-guard.test.js'];
  for (const name of required) {
    fs.writeFileSync(path.join(root, 'tests', name), '// fixture security-critical suite\n');
  }
  for (const name of plainSuites) {
    fs.writeFileSync(path.join(root, 'tests', name), '// fixture suite\n');
  }
  for (const [name, body] of Object.entries(skippingSuites)) {
    fs.writeFileSync(path.join(root, 'tests', name), body);
  }

  fs.writeFileSync(path.join(root, 'tests', 'database-test-guard.test.js'),
    `const DB_MUTATING_SUITES = [\n${ledger.map((n) => `  '${n}'`).join(',\n')}\n];\n`);

  fs.writeFileSync(path.join(root, 'scripts', 'run-integration-tests.js'),
    `const SANCTIONED_POSTGRES_INTEGRATION_SUITES = [\n`
    + contract.map((line) => `  ${line}`).join('\n')
    + `\n];\n`);

  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: testScript } }));
  return root;
}

const idsOf = (root) => analyse({ repoRoot: root }).failures.map((f) => f.id);
const failuresFor = (root, id) => analyse({ repoRoot: root }).failures.filter((f) => f.id === id);

// ---------------------------------------------------------------------------

describe('ATM-001-SEC-CLOSURE-WP3-01 test-inventory coverage check', () => {
  it('1. the real repository is fully accounted for, and the analysis is not vacuous', () => {
    const result = analyse({ repoRoot: REPO_ROOT });
    assert.deepStrictEqual(result.failures, [],
      `the repository must be fully accounted for:\n${JSON.stringify(result.failures, null, 2)}`);

    // A check that passes on empty inputs would be worthless, so require that
    // real material was actually inspected.
    assert.ok(result.discovered.length >= 40, 'expected the real suite inventory to be discovered');
    assert.ok(result.sanctioned.length > 0, 'expected a non-empty integration contract');
    assert.ok(result.selfSkipping.length > 0, 'expected self-skipping suites to be detected');
    assert.strictEqual(result.unaccounted.length, 0, 'no suite may be unaccounted for');
  });

  it('2. the derived self-skipping set reproduces the guard ledger exactly (no hardcoded list)', () => {
    const result = analyse({ repoRoot: REPO_ROOT });
    // The detector is derived from source, not from a list, and must agree with
    // the ledger the project maintains by hand. A drift means one of them is wrong.
    assert.deepStrictEqual(
      [...result.selfSkipping].sort(),
      [...result.declaredMutating].sort(),
      'the derived self-skipping set must equal DB_MUTATING_SUITES');
  });

  it('3. NEGATIVE CONTROL: an unregistered self-skipping suite fails with C3 and is named', () => {
    const root = makeFixture({
      ledger: ['a.test.js'],
      contract: ["'tests/a.test.js'"],
      plainSuites: ['a.test.js'],
      skippingSuites: { 'orphan.test.js': selfSkippingBody('orphan') }
    });
    assert.deepStrictEqual(idsOf(root), ['C3'],
      `only C3 should fire, got ${JSON.stringify(analyse({ repoRoot: root }).failures)}`);
    assert.match(failuresFor(root, 'C3')[0].message, /orphan\.test\.js/,
      'the unaccounted suite must be named');
  });

  it('4. NO FALSE POSITIVE: registering that same self-skipping suite clears the failure', () => {
    const root = makeFixture({
      ledger: ['a.test.js', 'orphan.test.js'],
      contract: ["'tests/a.test.js'", "'tests/orphan.test.js'"],
      plainSuites: ['a.test.js'],
      skippingSuites: { 'orphan.test.js': selfSkippingBody('orphan') }
    });
    assert.deepStrictEqual(analyse({ repoRoot: root }).failures, [],
      'registering the suite must clear the failure');
  });

  it('5. NEGATIVE CONTROL: a registration with no file on disk fails with C2', () => {
    const root = makeFixture({
      ledger: ['a.test.js', 'ghost.test.js'],
      contract: ["'tests/a.test.js'", "'tests/ghost.test.js'"],
      plainSuites: ['a.test.js']
    });
    assert.deepStrictEqual(idsOf(root), ['C2'], 'only the stale registration should fire');
    assert.match(failuresFor(root, 'C2')[0].message, /ghost\.test\.js/);
  });

  it('6. NEGATIVE CONTROL: a narrowed test script fails with C7', () => {
    const root = makeFixture({
      ledger: ['a.test.js'],
      contract: ["'tests/a.test.js'"],
      plainSuites: ['a.test.js'],
      testScript: 'node --test tests/a.test.js'
    });
    assert.deepStrictEqual(idsOf(root), ['C7'], 'narrowing the executed glob must be detected');
  });

  it('7. NEGATIVE CONTROL: a duplicate registration fails with C6', () => {
    const root = makeFixture({
      ledger: ['a.test.js'],
      contract: ["'tests/a.test.js'", "'tests/a.test.js'"],
      plainSuites: ['a.test.js']
    });
    assert.deepStrictEqual(idsOf(root), ['C6'], 'a duplicate registration must be detected');
    assert.match(failuresFor(root, 'C6')[0].message, /a\.test\.js/);
  });

  it('8. FAIL CLOSED: an unparseable contract is a failure, never a pass', () => {
    const root = makeFixture({ ledger: [], contract: [] });
    const c1 = failuresFor(root, 'C1');
    assert.ok(c1.length >= 1, 'an empty contract must be reported as a C1 failure');
    assert.ok(c1.some((f) => /SANCTIONED_POSTGRES_INTEGRATION_SUITES/.test(f.message)),
      'the unparseable contract must be named');
  });

  it('9. COMMENT IMMUNITY: a registration that appears only in a comment does not count', () => {
    const root = makeFixture({
      ledger: ['a.test.js', 'commented.test.js'],
      // `commented.test.js` is registered ONLY inside a line comment.
      contract: ["'tests/a.test.js'", "// 'tests/commented.test.js'"],
      plainSuites: ['a.test.js'],
      skippingSuites: { 'commented.test.js': selfSkippingBody('commented') }
    });
    const result = analyse({ repoRoot: root });
    assert.ok(!result.sanctioned.includes('commented.test.js'),
      'a commented-out registration must not satisfy the contract');
    // ...and because it genuinely skips itself, it must be reported as unaccounted.
    assert.deepStrictEqual(idsOf(root), ['C3'],
      'the commented-out suite must still be reported as unaccounted for');
    assert.match(failuresFor(root, 'C3')[0].message, /commented\.test\.js/);
  });

  it('10. EXEMPTION IS EXACT: only the documented superseded suites are exempt', () => {
    assert.deepStrictEqual([...SUPERSEDED_LEGACY_SUITES].sort(), [
      'step6-access-control.test.js',
      'step6-coverage-e2e.test.js',
      'step6-performance.test.js',
      'step6-regression.test.js',
      'step6-seed-migration.test.js'
    ]);
    const root = makeFixture({
      ledger: ['a.test.js', 'step6-regression.test.js'],
      contract: ["'tests/a.test.js'"],
      plainSuites: ['a.test.js'],
      skippingSuites: { 'step6-regression.test.js': selfSkippingBody('legacy') }
    });
    assert.deepStrictEqual(analyse({ repoRoot: root }).failures, [],
      'the documented legacy exemption must hold');
  });
});
