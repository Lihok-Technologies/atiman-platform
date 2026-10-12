/**
 * ATM-001-SEC-CLOSURE-WP3-01 / WP3-03 — focused tests for
 * scripts/assert-test-coverage.js.
 *
 * The point of these tests is that the coverage check must FAIL when coverage is
 * genuinely absent, and must fail for the RIGHT REASON. Every negative control
 * below asserts the specific check id AND the substance of the message — a
 * merely non-zero exit code is not accepted as proof.
 *
 * WP3-03 added the fail-closed classification. The controls that matter most are
 * the ones proving that conditional-execution and test-selection constructs
 * outside the supported set can no longer pass silently, and that comments and
 * string literals cannot satisfy — or trip — the check.
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  analyse,
  classifySuite,
  stripCommentsAndStrings,
  UNSUPPORTED_CONSTRUCTS,
  SUPERSEDED_LEGACY_SUITES
} = require('../scripts/assert-test-coverage.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const fixtures = [];

after(() => {
  for (const dir of fixtures) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* disposable */ }
  }
});

/** Minimal suite that defines a test and executes unconditionally. */
const plainSuiteBody = (label) => [
  "const { test } = require('node:test');",
  `test('${label}', () => {});`
].join('\n');

/** Suite that skips itself unless the database-test gate is satisfied. */
const gatedSuiteBody = (label) => [
  "const { describe, it } = require('node:test');",
  "const { isIntegration" + "Test } = require('../src/config/database');",
  `const REASON_${label} = isIntegration` + "Test() ? false : 'requires the gate';",
  `describe('${label}', { skip: REASON_${label} }, () => { it('gated', () => {}); });`
].join('\n');

/**
 * Build a disposable fixture repository.
 *
 * The three required security-critical suites always exist and always define a
 * test, so that C9/C11 never fire for reasons unrelated to the control under
 * test.
 */
function makeFixture({ ledger = [], contract = [], suites = {},
                       testScript = 'node --test tests/*.test.js' }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-wp3-fixture-'));
  fixtures.push(root);
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });

  const required = ['runtime-security.test.js', 'phase3-cutover-guard.test.js', 'database-test-guard.test.js'];
  for (const name of required) {
    fs.writeFileSync(path.join(root, 'tests', name), plainSuiteBody(name));
  }
  for (const [name, body] of Object.entries(suites)) {
    fs.writeFileSync(path.join(root, 'tests', name), body);
  }

  fs.writeFileSync(path.join(root, 'tests', 'database-test-guard.test.js'),
    `const { test } = require('node:test');\ntest('guard', () => {});\n`
    + `const DB_MUTATING_SUITES = [\n${ledger.map((n) => `  '${n}'`).join(',\n')}\n];\n`);

  fs.writeFileSync(path.join(root, 'scripts', 'run-integration-tests.js'),
    `const SANCTIONED_POSTGRES_INTEGRATION_SUITES = [\n`
    + contract.map((line) => `  ${line}`).join('\n')
    + `\n];\n`);

  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: testScript } }));
  return root;
}

const idsOf = (root) => analyse({ repoRoot: root }).failures.map((f) => f.id);
const failureFor = (root, id) => analyse({ repoRoot: root }).failures.find((f) => f.id === id);

// ---------------------------------------------------------------------------

describe('ATM-001-SEC-CLOSURE-WP3 coverage check', () => {
  it('1. the real repository is fully accounted for, and the analysis is not vacuous', () => {
    const result = analyse({ repoRoot: REPO_ROOT });
    assert.deepStrictEqual(result.failures, [],
      `the repository must be fully accounted for:\n${JSON.stringify(result.failures, null, 2)}`);
    assert.ok(result.discovered.length >= 40, 'expected the real suite inventory to be discovered');
    assert.ok(result.sanctioned.length > 0, 'expected a non-empty integration contract');
    assert.ok(result.selfSkipping.length > 0, 'expected gated suites to be detected');
    assert.ok(result.runsUnderNpmTest.length > 0, 'expected unconditional suites to be classified');
    assert.deepStrictEqual(result.unsupported, [], 'no suite may use an unsupported construct');
    assert.deepStrictEqual(result.ambiguous, [], 'no suite may be ambiguously gated');
    assert.deepStrictEqual(result.noTests, [], 'every suite must define at least one test');
    assert.strictEqual(result.unaccounted.length, 0, 'no suite may be unaccounted for');
    assert.strictEqual(result.gated.length + result.runsUnderNpmTest.length, result.discovered.length,
      'every suite must be either gated or unconditional');
  });

  it('2. the derived gated set reproduces the guard ledger exactly (no hardcoded list)', () => {
    const result = analyse({ repoRoot: REPO_ROOT });
    assert.deepStrictEqual([...result.selfSkipping].sort(), [...result.declaredMutating].sort(),
      'the derived gated set must equal DB_MUTATING_SUITES');
  });

  it('3. NEGATIVE CONTROL (WP3-02 exploit): describe.skip can no longer pass silently', () => {
    const root = makeFixture({
      ledger: ['a.test.js'],
      contract: ["'tests/a.test.js'"],
      suites: {
        'a.test.js': plainSuiteBody('a'),
        'zz-bypass.test.js': [
          "const { describe, it } = require('node:test');",
          "const { isIntegration" + "Test } = require('../src/config/database');",
          'const gated = isIntegration' + "Test() ? describe : describe.skip;",
          "gated('gated suite', () => { it('never runs', () => {}); });"
        ].join('\n')
      }
    });
    assert.deepStrictEqual(idsOf(root), ['C10'], 'the exploit must fail with C10 and nothing else');
    const f = failureFor(root, 'C10');
    assert.match(f.message, /zz-bypass\.test\.js/, 'must name the offending suite');
    assert.match(f.message, /member skip/, 'must name the construct class');
    assert.match(f.message, /describe\.skip/, 'must quote the construct');
    assert.match(f.message, /line \d+/, 'must give a line number');
  });

  it('4. NEGATIVE CONTROL: every unsupported construct fails closed with an actionable reason', () => {
    const cases = [
      ['describe.skip member skip', "describe.skip('suite', body);"],
      ['it.skip member skip', "it.skip('suite', body);"],
      ['test.skip member skip', "test.skip('suite', body);"],
      ['suite.skip member skip', "suite.skip('suite', body);"],
      ['skipIf conditional skip', 'const s = skipIf(true);'],
      ['todo pending test', "it.todo('not yet implemented');"],
      ['only test selection', "it.only('suite', body);"],
      ['describe.only test selection', "describe.only('suite', body);"],
      ['runOnly test selection', 'const r = runOnly;']
    ];
    for (const [label, statement] of cases) {
      const root = makeFixture({
        ledger: ['a.test.js'],
        contract: ["'tests/a.test.js'"],
        suites: {
          'a.test.js': plainSuiteBody('a'),
          'zz-unsupported.test.js': [
            "const { describe, it, test, suite, skipIf, runOnly } = require('node:test');",
            "const body = () => { it('x', () => {}); };",
            statement
          ].join('\n')
        }
      });
      assert.deepStrictEqual(idsOf(root), ['C10'], `${label} must be rejected with C10`);
      const msg = failureFor(root, 'C10').message;
      assert.match(msg, /unsupported conditional-execution construct/,
        `${label} must be reported as unsupported`);
      assert.match(msg, /line \d+/, `${label} must carry a line number`);
    }
  });

  it('5. NEGATIVE CONTROL: a skip option with no recognised gate fails closed', () => {
    const root = makeFixture({
      ledger: ['a.test.js'],
      contract: ["'tests/a.test.js'"],
      suites: {
        'a.test.js': plainSuiteBody('a'),
        'zz-ambiguous.test.js': [
          "const { describe, it } = require('node:test');",
          "describe('always skipped', { skip: 'because' }, () => { it('x', () => {}); });"
        ].join('\n')
      }
    });
    assert.deepStrictEqual(idsOf(root), ['C10'], 'an ungated skip option must fail with C10');
    assert.match(failureFor(root, 'C10').message, /never\s+consults the database-test gate/,
      'the reason must explain that execution cannot be demonstrated');
  });

  it('6. NEGATIVE CONTROL: a suite that defines no test fails closed', () => {
    const root = makeFixture({
      ledger: ['a.test.js'],
      contract: ["'tests/a.test.js'"],
      suites: {
        'a.test.js': plainSuiteBody('a'),
        'zz-empty.test.js': "const { test } = require('node:test');\n// no test is ever defined\n"
      }
    });
    assert.deepStrictEqual(idsOf(root), ['C11'], 'a suite with no test definition must fail with C11');
    assert.match(failureFor(root, 'C11').message, /no test definition/,
      'the reason must say that no test is defined');
  });

  it('7. NEGATIVE CONTROL: an unregistered gated suite fails with C3 and is named', () => {
    const root = makeFixture({
      ledger: ['a.test.js'],
      contract: ["'tests/a.test.js'"],
      suites: { 'a.test.js': plainSuiteBody('a'), 'orphan.test.js': gatedSuiteBody('orphan') }
    });
    assert.deepStrictEqual(idsOf(root), ['C3'], `only C3 should fire, got ${idsOf(root)}`);
    assert.match(failureFor(root, 'C3').message, /orphan\.test\.js/);
    assert.match(failureFor(root, 'C3').message, /executes nowhere/);
  });

  it('8. NO FALSE POSITIVE: the supported gate idiom, registered, is valid', () => {
    const root = makeFixture({
      ledger: ['a.test.js', 'orphan.test.js'],
      contract: ["'tests/a.test.js'", "'tests/orphan.test.js'"],
      suites: { 'a.test.js': plainSuiteBody('a'), 'orphan.test.js': gatedSuiteBody('orphan') }
    });
    assert.deepStrictEqual(analyse({ repoRoot: root }).failures, [],
      'a registered suite using the supported idiom must remain valid');
  });

  it('9. NO FALSE POSITIVE: an ordinary unit suite is valid without registration', () => {
    const root = makeFixture({
      ledger: ['a.test.js'],
      contract: ["'tests/a.test.js'"],
      suites: { 'a.test.js': plainSuiteBody('a'), 'zz-plain.test.js': plainSuiteBody('zz') }
    });
    assert.deepStrictEqual(analyse({ repoRoot: root }).failures, [],
      'an unconditional suite that runs under npm test needs no registration');
  });

  it('10. NEGATIVE CONTROL: a registration with no file on disk fails with C2', () => {
    const root = makeFixture({
      ledger: ['a.test.js', 'ghost.test.js'],
      contract: ["'tests/a.test.js'", "'tests/ghost.test.js'"],
      suites: { 'a.test.js': plainSuiteBody('a') }
    });
    assert.deepStrictEqual(idsOf(root), ['C2'], 'only the stale registration should fire');
    assert.match(failureFor(root, 'C2').message, /ghost\.test\.js/);
  });

  it('11. NEGATIVE CONTROL: a narrowed test script fails with C7', () => {
    const root = makeFixture({
      ledger: ['a.test.js'],
      contract: ["'tests/a.test.js'"],
      suites: { 'a.test.js': plainSuiteBody('a') },
      testScript: 'node --test tests/a.test.js'
    });
    assert.deepStrictEqual(idsOf(root), ['C7'], 'narrowing the executed glob must be detected');
    assert.match(failureFor(root, 'C7').message, /no longer runs/);
  });

  it('12. NEGATIVE CONTROL: a duplicate registration fails with C6', () => {
    const root = makeFixture({
      ledger: ['a.test.js'],
      contract: ["'tests/a.test.js'", "'tests/a.test.js'"],
      suites: { 'a.test.js': plainSuiteBody('a') }
    });
    assert.deepStrictEqual(idsOf(root), ['C6'], 'a duplicate registration must be detected');
    assert.match(failureFor(root, 'C6').message, /duplicate/);
  });

  it('13. FAIL CLOSED: an unparseable contract is a failure, never a pass', () => {
    const root = makeFixture({ ledger: [], contract: [] });
    const c1 = analyse({ repoRoot: root }).failures.filter((f) => f.id === 'C1');
    assert.ok(c1.length >= 1, 'an empty contract must be reported as a C1 failure');
    assert.ok(c1.some((f) => /SANCTIONED_POSTGRES_INTEGRATION_SUITES/.test(f.message)),
      'the unparseable contract must be named');
  });

  it('14. COMMENT IMMUNITY: a registration that appears only in a comment does not count', () => {
    const root = makeFixture({
      ledger: ['a.test.js', 'commented.test.js'],
      contract: ["'tests/a.test.js'", "// 'tests/commented.test.js'"],
      suites: { 'a.test.js': plainSuiteBody('a'), 'commented.test.js': gatedSuiteBody('commented') }
    });
    const result = analyse({ repoRoot: root });
    assert.ok(!result.sanctioned.includes('commented.test.js'),
      'a commented-out registration must not satisfy the contract');
    assert.deepStrictEqual(idsOf(root), ['C3'],
      'the commented-out suite must still be reported as unaccounted for');
    assert.match(failureFor(root, 'C3').message, /commented\.test\.js/);
  });

  it('15. COMMENT IMMUNITY: unsupported constructs inside comments do not trip the check', () => {
    const root = makeFixture({
      ledger: ['a.test.js'],
      contract: ["'tests/a.test.js'"],
      suites: {
        'a.test.js': plainSuiteBody('a'),
        'zz-comment.test.js': [
          "const { describe, it } = require('node:test');",
          '// describe.skip would be unsupported, but this is only a comment',
          '/* it.skip and test.only are also only mentioned here */',
          "describe('real suite', () => { it('runs', () => {}); });"
        ].join('\n')
      }
    });
    assert.deepStrictEqual(analyse({ repoRoot: root }).failures, [],
      'constructs named only in comments must not be treated as executable');
  });

  it('16. STRING IMMUNITY: constructs inside string and template literals do not trip the check', () => {
    const root = makeFixture({
      ledger: ['a.test.js'],
      contract: ["'tests/a.test.js'"],
      suites: {
        'a.test.js': plainSuiteBody('a'),
        'zz-string.test.js': [
          "const { describe, it } = require('node:test');",
          'const a = "describe.skip";',
          'const b = `it.skip and skip: not real`;',
          "const c = 'test.only';",
          "describe('real suite', () => { it('runs', () => {}); });"
        ].join('\n')
      }
    });
    assert.deepStrictEqual(analyse({ repoRoot: root }).failures, [],
      'constructs inside string or template literals must not be treated as executable');
  });

  it('17. REGEX LITERALS do not desynchronise the lexical normaliser', () => {
    // A regex containing quote characters previously derailed the scanner and
    // blanked the remainder of the file, hiding every later construct.
    const src = [
      "const { describe, it } = require('node:test');",
      "const re = /require\\(\\s*['\"]mysql2['\"]\\s*\\)/;",
      "describe('after the regex', () => { it('still visible', () => {}); });"
    ].join('\n');
    const code = stripCommentsAndStrings(src);
    assert.match(code, /describe\s*\(/, 'code after a regex literal must survive normalisation');
    assert.ok(!/mysql2/.test(code), 'regex literal contents must be blanked');
    assert.strictEqual(classifySuite(src).klass, 'UNCONDITIONAL');
  });

  it('18. EXEMPTION IS EXACT: only the documented superseded suites are exempt', () => {
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
      suites: { 'a.test.js': plainSuiteBody('a'), 'step6-regression.test.js': gatedSuiteBody('legacy') }
    });
    assert.deepStrictEqual(analyse({ repoRoot: root }).failures, [],
      'the documented legacy exemption must hold');
  });

  it('19. the unsupported-construct set is explicit and closed', () => {
    const ids = UNSUPPORTED_CONSTRUCTS.map((c) => c.id).sort();
    assert.deepStrictEqual(ids, ['member-skip', 'only', 'run-only', 'skip-if', 'todo'],
      'the rejected construct set must be explicit, so a new construct is a deliberate change');
  });

  it('20. classification is exclusive: one defect yields exactly one failure', () => {
    // A suite that is BOTH unregistered-gated AND uses an unsupported construct
    // must report the more fundamental problem, not two overlapping ones.
    const root = makeFixture({
      ledger: ['a.test.js'],
      contract: ["'tests/a.test.js'"],
      suites: {
        'a.test.js': plainSuiteBody('a'),
        'zz-both.test.js': [
          "const { describe, it } = require('node:test');",
          "const { isIntegration" + "Test } = require('../src/config/database');",
          'const gated = isIntegration' + "Test() ? describe : describe.skip;",
          "gated('x', () => { it('y', () => {}); });"
        ].join('\n')
      }
    });
    assert.deepStrictEqual(idsOf(root), ['C10'], 'exactly one, and the most fundamental, failure');
  });
});
