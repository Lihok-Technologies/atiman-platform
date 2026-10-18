const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getDatabaseConfig, isIntegrationTest } = require('../src/config/database');

const ENV_NAMES = ['NODE_ENV', 'RUN_DB_TESTS', 'TEST_DB_HOST', 'TEST_DB_PORT', 'TEST_DB_NAME', 'TEST_DB_USER', 'TEST_DB_PASSWORD'];

// Every environment variable that could point a test run at a database. Cleared
// for subprocess runs so a result can never depend on this process's environment.
const DATABASE_ENV_NAMES = [
  ...ENV_NAMES,
  'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_SSL',
  'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE',
  // Set by the parent test runner; must be cleared or the child refuses to run
  // files at all ("node:test run() is being called recursively").
  'NODE_TEST_CONTEXT'
];

// Every suite known to mutate a database. Each must be gated on
// isIntegrationTest() so that "may this suite execute?" and "are TEST_DB_*
// credentials selected?" are the same question. A suite gated on anything
// weaker (for example RUN_DB_TESTS alone) runs while getDatabaseConfig() still
// resolves runtime DB_*/PG* credentials - production in a configured
// environment.
//
// Membership here is about SAFETY (which files can mutate a database), not about
// which suites CI should run. The five step6-* files are legacy ODM-CMMS suites
// that are no longer part of the sanctioned PostgreSQL acceptance path, but they
// remain database-mutating files, so they stay in this list.
const DB_MUTATING_SUITES = [
  'knowledge-versioning.test.js',
  'knowledge-publication-admission.test.js',
  // Creates and drops disposable databases on the test server, so it mutates
  // databases just as surely as the suites above.
  'migration-runner.test.js',
  'knowledge-pack-membership.test.js',
  'knowledge-provenance-authoring.test.js',
  // ATM-001 M4: drives migration 015 and the governed pack publication path.
  'knowledge-pack-publication-admission.test.js',
  // ATM-001 M5R.3A: external authority/edition groundwork.
  'external-authority-edition-groundwork.test.js',
  // ATM-001 M5R.3B: external classification foundation (migration 016).
  'external-classification-foundation.test.js',
  // ATM-001 M5R.3C: governed crosswalk (migration 017).
  'external-classification-crosswalk.test.js',
  // ATM-001 M5R.3D: crosswalk evidence foundation (migration 018).
  'external-classification-crosswalk-evidence.test.js',
  // ATM-001 M5R.3E: governed crosswalk application layer.
  'knowledge-crosswalk-application.test.js',
  // ATM-001 M5R.4B: governed taxonomy identity lifecycle mechanism (migration 019).
  'taxonomy-identity-lifecycle.test.js',
  // ATM-001 M5R.4B2 prerequisite: canonical-only import resolution, ambiguity refused.
  'asset-import-resolver-safety.test.js',
  // ATM-001 M5R.4B2: governed taxonomy application (creates disposable databases).
  'taxonomy-application.test.js',
  // ATM-001 M6.3: governed knowledge foundation (migration 020; creates disposable databases).
  'governed-knowledge-foundation.test.js',
  // ATM-001 M6.3 VUDA R1: remediation regression coverage for the seven R1 findings.
  'm6r3-r1-remediation.test.js',
  // ATM-001 M6.4: governed draft authoring primitive.
  'knowledge-authoring.test.js',
  // ATM-001 M6.4 Step 3B-B: AI-assistance disclosure (migration 021).
  'ai-assistance-disclosure.test.js',
  // ATM-003 capability grant foundation (migration 022).
  'capability-grants.test.js',
  // ATM-002-I1 Atiman shell (resolves real capabilities, reads real product state).
  'atiman-shell.test.js',
  // ATM-002-I2B observation operational foundation (migration 023; creates
  // disposable databases to prove 023 alters no existing table).
  'observation-foundation.test.js',
  // ATM-002-I2C trustworthy asset context (resolves real assets across two tenants).
  'asset-context.test.js',
  // ATM-002-I2E report / observation capture (writes real Observations for two tenants).
  'report-capture.test.js',
  // ATM-001-K3 knowledge accession authority (writes real sources, versions and
  // working evidence; issues and revokes a real capability grant).
  'knowledge-accession-authority.test.js',
  // ATM-001-K3-R1 provenance write scope (writes real sources, versions and
  // working evidence for two tenants, plus an out-of-band global source fixture).
  'provenance-write-scope.test.js',
  // ATM-001-KF-06 knowledge evidence deletion integrity (writes real definitions,
  // steps, sources, versions, working evidence, a global source fixture and
  // out-of-band published versions).
  'knowledge-evidence-deletion-integrity.test.js',
  // ATM-001-SEC-107-D2 seat-count alias/type (writes real organizations, plans,
  // subscriptions and users; asserts the production SQL on real PostgreSQL).
  'sec107-d2-seat-count-pg.test.js',
  // ATM-001-SEC-B3B sensitive-data disclosure (Issue #105): creates its own
  // two-tenant fixture - organizations, a facility and users carrying real
  // bcrypt hashes - in the disposable test database and drives the real app
  // over HTTP.
  'user-credential-disclosure.test.js',
  'step6-access-control.test.js',
  'step6-coverage-e2e.test.js',
  'step6-performance.test.js',
  'step6-regression.test.js',
  'step6-seed-migration.test.js'
];

// Suites the sanctioned PostgreSQL runner is expected to execute. Membership
// here is about CONTRACT (which suites represent current Atiman PostgreSQL
// architecture), not about safety. This must stay in step with
// SANCTIONED_POSTGRES_INTEGRATION_SUITES in scripts/run-integration-tests.js.
const SANCTIONED_POSTGRES_INTEGRATION_SUITES = [
  'knowledge-versioning.test.js',
  'knowledge-publication-admission.test.js',
  'migration-runner.test.js',
  'knowledge-pack-membership.test.js',
  'knowledge-provenance-authoring.test.js',
  'knowledge-pack-publication-admission.test.js',
  'external-authority-edition-groundwork.test.js',
  'external-classification-foundation.test.js',
  'external-classification-crosswalk.test.js',
  'external-classification-crosswalk-evidence.test.js',
  'knowledge-crosswalk-application.test.js',
  'taxonomy-identity-lifecycle.test.js',
  'asset-import-resolver-safety.test.js',
  'taxonomy-application.test.js',
  'governed-knowledge-foundation.test.js',
  'm6r3-r1-remediation.test.js',
  'knowledge-authoring.test.js',
  'ai-assistance-disclosure.test.js',
  'capability-grants.test.js',
  'atiman-shell.test.js',
  'observation-foundation.test.js',
  'asset-context.test.js',
  'report-capture.test.js',
  'knowledge-accession-authority.test.js',
  'provenance-write-scope.test.js',
  'knowledge-evidence-deletion-integrity.test.js',
  'sec107-d2-seat-count-pg.test.js',
  // ATM-001-SEC-B3B sensitive-data disclosure (Issue #105).
  'user-credential-disclosure.test.js'
];

const REPO_ROOT = path.resolve(__dirname, '..');

const save = (names) => Object.fromEntries(names.map((name) => [name, process.env[name]]));
const restore = (values) => Object.entries(values).forEach(([name, value]) => {
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
});

// Run a node entry point in a subprocess with a controlled database environment.
const runNode = (args, overrides = {}) => {
  const childEnv = { ...process.env };
  for (const name of DATABASE_ENV_NAMES) delete childEnv[name];
  Object.assign(childEnv, overrides);

  const result = spawnSync(
    process.execPath,
    args,
    { cwd: REPO_ROOT, env: childEnv, encoding: 'utf8' }
  );
  return { ...result, output: `${result.stdout || ''}${result.stderr || ''}` };
};

const runSuite = (suiteFile, overrides) =>
  runNode(['--test', path.join('tests', suiteFile)], overrides);

describe('integration database safety guard', () => {
  const names = ENV_NAMES;

  it('refuses destructive test mode without an explicitly named test database', () => {
    const original = save(names);
    try {
      Object.assign(process.env, { NODE_ENV: 'test', RUN_DB_TESTS: 'true' });
      delete process.env.TEST_DB_NAME;
      assert.throws(() => getDatabaseConfig(), /Refusing destructive integration tests/);
      Object.assign(process.env, {
        TEST_DB_HOST: '127.0.0.1', TEST_DB_PORT: '3306', TEST_DB_NAME: 'odm_cmms_test', TEST_DB_USER: 'test', TEST_DB_PASSWORD: 'test-password'
      });
      assert.deepStrictEqual(getDatabaseConfig(), {
        host: '127.0.0.1', port: 3306, database: 'odm_cmms_test', user: 'test', password: 'test-password', ssl: false
      });
    } finally {
      restore(original);
    }
  });

  // RUN_DB_TESTS alone is NOT a sufficient gate: src/config/database.js only
  // switches to TEST_DB_* when NODE_ENV is also 'test'. With RUN_DB_TESTS set
  // and NODE_ENV unset, the pool still uses the runtime DB_* credentials, so any
  // suite gating on RUN_DB_TESTS alone would mutate the runtime database.
  it('treats RUN_DB_TESTS without NODE_ENV=test as NOT enabled for database tests', () => {
    const original = save(names);
    try {
      Object.assign(process.env, { RUN_DB_TESTS: 'true' });
      delete process.env.NODE_ENV;
      assert.strictEqual(isIntegrationTest(), false);

      const config = getDatabaseConfig();
      assert.notStrictEqual(
        config.database,
        process.env.TEST_DB_NAME,
        'must not select TEST_DB_* while the integration-test predicate is false'
      );
    } finally {
      restore(original);
    }
  });
});

// End-to-end proof of the safety invariant, one row per database-mutating suite.
describe('database-mutating suites cannot execute without the database-test gate', () => {
  for (const suiteFile of DB_MUTATING_SUITES) {
    it(`${suiteFile} executes zero tests with no database-test opt-in`, () => {
      const { status, output } = runSuite(suiteFile);
      assert.strictEqual(status, 0, `expected a clean skip run:\n${output}`);
      assert.match(output, /tests 0/, `expected zero executed tests:\n${output}`);
      assert.match(output, /fail 0/, `expected no failing tests:\n${output}`);
    });

    it(`${suiteFile} executes zero tests with RUN_DB_TESTS=true while NODE_ENV is not test`, () => {
      const { status, output } = runSuite(suiteFile, { RUN_DB_TESTS: 'true' });
      assert.strictEqual(status, 0, `expected a clean skip run:\n${output}`);
      assert.match(output, /tests 0/, `expected zero executed tests:\n${output}`);
      assert.match(output, /fail 0/, `expected no failing tests:\n${output}`);
    });

    it(`${suiteFile} fails closed when TEST_DB_* is missing under full opt-in`, () => {
      const { status, output } = runSuite(suiteFile, { NODE_ENV: 'test', RUN_DB_TESTS: 'true' });
      assert.notStrictEqual(status, 0, `expected a fail-closed run:\n${output}`);
      assert.match(
        output,
        /Refusing destructive integration tests/,
        `expected the guard to refuse rather than fall back to runtime credentials:\n${output}`
      );
    });
  }
});

// tests/step6-runner.js spawns the destructive Step 6 suites, so it must
// establish the gate itself and must refuse to run unless TEST_DB_* has already
// passed the repository's sanctioned validation. Every scenario below is one
// that must never reach a database.
describe('integration runner refuses to run without a sanctioned test database', () => {
  const RUNNER = path.join('tests', 'step6-runner.js');

  const completeTestDb = {
    TEST_DB_HOST: '127.0.0.1',
    TEST_DB_PORT: '5432',
    TEST_DB_USER: 'test',
    TEST_DB_PASSWORD: 'test-password'
  };

  const SCENARIOS = [
    ['no database-test configuration at all', {}],
    ['runtime DB_* credentials only', { DB_HOST: '127.0.0.1', DB_NAME: 'odm_cmms', DB_USER: 'postgres', DB_PASSWORD: 'runtime-password' }],
    ['runtime PG* credentials only', { PGHOST: '127.0.0.1', PGDATABASE: 'odm_cmms', PGUSER: 'postgres', PGPASSWORD: 'runtime-password' }],
    ['the partial gate RUN_DB_TESTS=true alone', { RUN_DB_TESTS: 'true' }],
    ['the partial gate NODE_ENV=test alone', { NODE_ENV: 'test' }],
    ['a full gate whose TEST_DB_NAME does not identify a test database', {
      NODE_ENV: 'test', RUN_DB_TESTS: 'true', ...completeTestDb, TEST_DB_NAME: 'production'
    }],
    ['a full gate with TEST_DB_* incomplete', {
      NODE_ENV: 'test', RUN_DB_TESTS: 'true', TEST_DB_HOST: '127.0.0.1'
    }]
  ];

  for (const [label, env] of SCENARIOS) {
    it(`refuses to execute suites with ${label}`, () => {
      const { status, output } = runNode([RUNNER], env);
      assert.notStrictEqual(status, 0, `expected the runner to refuse:\n${output}`);
      assert.match(
        output,
        /Refusing (to run Step 6 database suites|destructive integration tests)/,
        `expected a refusal rather than a database connection attempt:\n${output}`
      );
      assert.ok(
        !/Running: step6-/.test(output),
        `runner must not reach the point of spawning suites:\n${output}`
      );
    });
  }
});

// The sanctioned integration runner defines which suites count as Atiman's
// PostgreSQL acceptance evidence, so its list must not drift silently - either
// by losing a sanctioned suite, or by a legacy suite being re-added without an
// architectural decision. The runner cannot be required for inspection because
// it validates and then exits at module load, so its source is parsed.
describe('sanctioned integration runner matches the PostgreSQL acceptance contract', () => {
  it('invokes exactly the sanctioned PostgreSQL integration suites', () => {
    const runnerSource = fs.readFileSync(
      path.join(REPO_ROOT, 'scripts', 'run-integration-tests.js'),
      'utf8'
    );
    const listed = [...runnerSource.matchAll(/'tests\/([A-Za-z0-9_.-]+\.test\.js)'/g)]
      .map((match) => match[1]);

    assert.deepStrictEqual(
      [...new Set(listed)].sort(),
      [...SANCTIONED_POSTGRES_INTEGRATION_SUITES].sort(),
      'scripts/run-integration-tests.js must invoke exactly the sanctioned PostgreSQL integration suites'
    );
  });

  it('keeps the sanctioned set a subset of the known database-mutating suites', () => {
    const unsanctionedMutators = SANCTIONED_POSTGRES_INTEGRATION_SUITES
      .filter((suiteFile) => !DB_MUTATING_SUITES.includes(suiteFile));

    assert.deepStrictEqual(
      unsanctionedMutators,
      [],
      'every sanctioned integration suite must also be tracked as database-mutating'
    );
  });
});

// ATM-001-SEC-107-TA04: tests/step6-runner.js used to derive its verdict from
// parsed TAP counters alone. The default non-TTY reporter changed from TAP to
// `spec` in Node >= 22, which emits no TAP lines at all, so a child that exited
// 1 produced "ALL TESTS PASSED - Production Ready" and a zero exit status. The
// runner must decide from each child's completion status instead. Every
// scenario below is a controlled child-process fixture and reaches no database:
// the sandbox supplies a stub src/config/database.js, so no pool, credentials
// or repository .env are ever loaded.
describe('step6 runner fails closed on child completion status, not parsed output', () => {
  const SUITES = [
    'step6-coverage-e2e.test.js',
    'step6-access-control.test.js',
    'step6-regression.test.js',
    'step6-seed-migration.test.js',
    'step6-performance.test.js'
  ];

  const PASSING = [
    "const { test } = require('node:test');",
    "const assert = require('node:assert');",
    "test('fixture leaf passes', () => { assert.strictEqual(1, 1); });",
    ''
  ].join('\n');

  // One passing and one deliberately failing leaf: under the `spec` reporter
  // the child exits 1 while emitting no `not ok` line at all.
  const ONE_PASS_ONE_FAIL = `${PASSING}test('fixture leaf fails', () => { assert.strictEqual(1, 2, 'deliberate controlled failure'); });\n`;

  // Forged TAP success output plus the runner's own success wording, followed
  // by a nonzero exit: the parsed counters look perfect, so only the child's
  // completion status can distinguish this from a genuine pass.
  const MISLEADING_SUCCESS_TEXT = [
    "process.stdout.write('TAP version 13\\n1..2\\nok 1 - everything is fine\\nok 2 - everything is fine\\n# pass 2\\n# fail 0\\n');",
    "process.stdout.write('ALL TESTS PASSED - Production Ready\\n');",
    'process.exit(1);',
    ''
  ].join('\n');

  const TERMINATED_BY_SIGNAL = [
    "process.kill(process.ppid, 'SIGKILL');",
    'process.exit(0);',
    ''
  ].join('\n');

  let sandbox;

  const suitePath = (suiteFile) => path.join(sandbox, 'tests', suiteFile);
  const reportPath = () => path.join(sandbox, 'STEP6_TEST_REPORT.md');
  const report = () => (fs.existsSync(reportPath()) ? fs.readFileSync(reportPath(), 'utf8') : '');

  // The runner's own verdict is everything from the TEST SUMMARY banner onward.
  // Echoed child output precedes it, so child-authored success text cannot be
  // mistaken for the runner's verdict.
  const runnerVerdict = (output) => output.slice(output.lastIndexOf('TEST SUMMARY'));

  const writeSuites = (coverageE2e = PASSING) => {
    for (const suiteFile of SUITES) {
      fs.writeFileSync(suitePath(suiteFile), suiteFile === SUITES[0] ? coverageE2e : PASSING);
    }
  };

  // The runner spawns `node`, so the sandbox needs a resolvable node on PATH.
  // The spawn-failure scenario overrides PATH with a location that cannot.
  const runSandbox = (overrides = {}) => runNode(
    [path.join(sandbox, 'tests', 'step6-runner.js')],
    {
      PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}`,
      ...overrides
    }
  );

  before(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'step6-runner-status-'));
    fs.mkdirSync(path.join(sandbox, 'tests'), { recursive: true });
    fs.mkdirSync(path.join(sandbox, 'src', 'config'), { recursive: true });
    fs.writeFileSync(
      path.join(sandbox, 'src', 'config', 'database.js'),
      '// Stub adapter: no pg, no dotenv, no credentials, no connection.\nexports.getDatabaseConfig = () => ({ host: "stub", database: "stub" });\n'
    );
    // The real runner is copied, so the sandbox layout can satisfy its
    // `../src/config/database` import and its `__dirname`-relative suite paths
    // without touching the repository tree.
    fs.copyFileSync(
      path.join(REPO_ROOT, 'tests', 'step6-runner.js'),
      path.join(sandbox, 'tests', 'step6-runner.js')
    );
  });

  after(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  beforeEach(() => {
    fs.rmSync(reportPath(), { force: true });
    writeSuites();
  });

  it('still reports production readiness when every child exits 0 with evidence', () => {
    const { status, output } = runSandbox();
    assert.strictEqual(status, 0, `a clean run must stay green:\n${output}`);
    assert.match(runnerVerdict(output), /ALL TESTS PASSED - Production Ready/);
    assert.match(report(), /System is production-ready/);
  });

  it('fails when a child exits 1 without emitting any TAP failure text', () => {
    writeSuites(ONE_PASS_ONE_FAIL);
    const { status, output } = runSandbox();
    assert.notStrictEqual(status, 0, `a failed child must fail the run:\n${output}`);
    assert.ok(
      !/ALL TESTS PASSED|Production Ready/.test(runnerVerdict(output)),
      `the runner must not claim success:\n${output}`
    );
    assert.match(report(), /child exited with code 1/);
    assert.ok(!/System is production-ready/.test(report()), 'the report must not claim production readiness');
  });

  it('fails when a child emits misleading success text and then exits 1', () => {
    writeSuites(MISLEADING_SUCCESS_TEXT);
    const { status, output } = runSandbox();
    assert.notStrictEqual(status, 0, `a failed child must fail the run:\n${output}`);
    assert.ok(
      !/ALL TESTS PASSED|Production Ready/.test(runnerVerdict(output)),
      `the runner must not claim success:\n${output}`
    );
    assert.ok(!/System is production-ready/.test(report()), 'the report must not claim production readiness');
  });

  it('fails when a child is terminated by a signal', () => {
    writeSuites(TERMINATED_BY_SIGNAL);
    const { status, output } = runSandbox();
    assert.notStrictEqual(status, 0, `a signalled child must fail the run:\n${output}`);
    assert.match(report(), /terminated by signal/);
    assert.ok(!/System is production-ready/.test(report()), 'the report must not claim production readiness');
  });

  it('fails when a child cannot be spawned at all', () => {
    const { status, output } = runSandbox({ PATH: '/nonexistent-step6-runner-path' });
    assert.notStrictEqual(status, 0, `a spawn failure must fail the run:\n${output}`);
    assert.match(report(), /spawn error/);
    assert.ok(!/System is production-ready/.test(report()), 'the report must not claim production readiness');
  });

  it('fails when a required suite file is missing', () => {
    fs.rmSync(suitePath('step6-performance.test.js'));
    const { status, output } = runSandbox();
    assert.notStrictEqual(status, 0, `a missing required suite must fail the run:\n${output}`);
    assert.match(report(), /step6-performance\.test\.js \(not found\)/);
    assert.ok(!/System is production-ready/.test(report()), 'the report must not claim production readiness');
  });
});

// ===========================================================================
// ATM-001-SEC-107-TA06-R2 — frame-hold behavioural regression
//
// TA06-R1 established that the frame-hold fixture's ASSERTION — not the capture
// helper — was the defect. The old leaf 5 echoed the captured buffer straight
// back into the runner channel:
//
//   process.stdout.write('CAPTURED-APPLICATION-TEXT[' + capturedApplicationText + ']\n')
//
// Leaf 4 wrote the runner-channel payload while the capture window was held, so
// the helper correctly withheld it into the captured text. Leaf 5's echo then
// carried that same payload into the runner output, so the membership check
// passed although no write had reached the runner channel at all, and the echo
// satisfied the non-vacuity marker check as well. An assertion that can be
// satisfied by the fixture's own diagnostics proves nothing.
//
// R2 observes the ACTUAL runner output channel:
//   * the primary detector is a text-payload sentinel that only leaf 4 writes,
//     and only through process.stdout.write — the runner's own channel;
//   * the captured payload is never echoed; leaf 5 reports bounded booleans only;
//   * the sentinel literal occurs exactly once in the generated fixture, and no
//     runner-channel write may interpolate the captured payload, so no title,
//     marker or diagnostic can manufacture it;
//   * non-vacuity is carried by an explicit boolean marker;
//   * missing output is an explicit assertion failure whose message carries the
//     child's output, and the verdict is read from output content — never from
//     the child's exit status, which is 0 even when the payload is lost;
//   * reporter counters are NOT a pass criterion. On Node 22/26 node:test frames
//     are Buffers, so a Buffer-forwarding helper reports a perfect 5/5/0 while
//     still swallowing the sentinel: the counter check is inert exactly where
//     the loss occurs. Counters are therefore diagnostic only here.
//
// The second case is the detector's own negative control, so the regression
// cannot silently become vacuous again. Every case below is a controlled
// child-process fixture requiring only node:test and node:assert: it loads no
// application code, opens no database and reads no credentials.
// ===========================================================================
describe('runner output capture preserves the runner channel (TA06 frame-hold regression)', () => {
  const HELPER_NAME = 'captureStdout';
  const RUNNER_SENTINEL = 'TA06-RUNNER-CHANNEL-TEXT-SENTINEL';
  const APP_MARKER = 'APP-LOG-UNDER-CAPTURE';
  const NON_VACUOUS_PREFIX = 'TA06_CAPTURE_NON_VACUOUS=';
  const WITHHELD_PREFIX = 'TA06_SENTINEL_WITHHELD=';

  const CAPTURE_SUITES = [
    'sensitive-data-redaction.test.js',
    'user-credential-disclosure.test.js'
  ];

  const HISTORICAL_BUFFER_GUARDED_HELPER = [
    'const captureStdout = async (fn) => {',
    '  const chunks = [];',
    '  const original = process.stdout.write;',
    '  process.stdout.write = (chunk, ...rest) => {',
    "    // node:test's child->parent protocol frames are Buffers. Never swallow them.",
    '    if (Buffer.isBuffer(chunk)) return original.call(process.stdout, chunk, ...rest);',
    "    chunks.push(typeof chunk === 'string' ? chunk : String(chunk));",
    '    // Keep the harness output quiet for the duration of the capture.',
    "    if (typeof rest[rest.length - 1] === 'function') rest[rest.length - 1]();",
    '    return true;',
    '  };',
    '  try {',
    '    await fn();',
    '  } finally {',
    '    process.stdout.write = original;',
    '  }',
    "  return chunks.join('');",
    '};'
  ].join('\n');

  const countOccurrences = (haystack, needle) => haystack.split(needle).length - 1;

  const extractHelper = (source) => {
    const marker = `const ${HELPER_NAME} = async (fn) => {`;
    const start = source.indexOf(marker);
    const end = start === -1 ? -1 : source.indexOf('\n};', start);
    assert.notStrictEqual(start, -1, `${HELPER_NAME} not found in the suite source`);
    assert.notStrictEqual(end, -1, `${HELPER_NAME} has no closing brace in the suite source`);
    return source.slice(start, end + 3);
  };

  const fixtureSource = (helperSource) => [
    "'use strict';",
    "const { describe, it } = require('node:test');",
    "const assert = require('node:assert');",
    '',
    '// --- capture helper under test, extracted verbatim from the suite ---',
    helperSource,
    '',
    `const RUNNER_SENTINEL = '${RUNNER_SENTINEL}';`,
    `const APP_MARKER = '${APP_MARKER}';`,
    '',
    'let releaseWindow;',
    'const heldWindow = new Promise((resolve) => { releaseWindow = resolve; });',
    "let capturedApplicationText = '';",
    '',
    "describe('frame-hold fixture', () => {",
    "  it('leaf 1 opens a capture window it does not close', async () => {",
    '    captureStdout(async () => {',
    '      console.log(APP_MARKER);',
    '      await heldWindow;',
    '    }).then((text) => { capturedApplicationText = text; });',
    '    await new Promise((resolve) => setTimeout(resolve, 60));',
    '  });',
    '',
    "  it('leaf 2 reaches its reporting boundary inside the held window', async () => {",
    '    await new Promise((resolve) => setTimeout(resolve, 20));',
    '  });',
    '',
    "  it('leaf 3 reaches its reporting boundary inside the held window', async () => {",
    '    await new Promise((resolve) => setTimeout(resolve, 20));',
    '  });',
    '',
    "  it('leaf 4 writes the payload and releases the window', async () => {",
    "    process.stdout.write(RUNNER_SENTINEL + '\\n');",
    '    releaseWindow();',
    '    await new Promise((resolve) => setTimeout(resolve, 80));',
    '  });',
    '',
    "  it('leaf 5 reports bounded boolean markers only', () => {",
    '    assert.ok(',
    '      capturedApplicationText.includes(APP_MARKER),',
    "      'the capture must be non-vacuous'",
    '    );',
    `    process.stdout.write('${NON_VACUOUS_PREFIX}' + capturedApplicationText.includes(APP_MARKER) + '\\n');`,
    `    process.stdout.write('${WITHHELD_PREFIX}' + capturedApplicationText.includes(RUNNER_SENTINEL) + '\\n');`,
    '  });',
    '});',
    ''
  ].join('\n');

  const runFixture = (helperSource) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ta06-frame-hold-'));
    try {
      const fixture = path.join(dir, 'frame-hold.test.js');
      fs.writeFileSync(fixture, fixtureSource(helperSource));

      const childEnv = { ...process.env };
      for (const name of DATABASE_ENV_NAMES) delete childEnv[name];

      const result = spawnSync(process.execPath, ['--test', fixture], {
        cwd: REPO_ROOT, env: childEnv, encoding: 'utf8'
      });
      const output = `${result.stdout || ''}${result.stderr || ''}`;
      const bool = (prefix) => {
        const m = output.match(new RegExp(`${prefix}(true|false)`));
        return m ? m[1] === 'true' : null;
      };
      return {
        status: result.status,
        output,
        sentinelSeen: output.includes(RUNNER_SENTINEL),
        nonVacuity: bool(NON_VACUOUS_PREFIX),
        withheld: bool(WITHHELD_PREFIX)
      };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  const suiteHelper = (suiteFile) =>
    extractHelper(fs.readFileSync(path.join(REPO_ROOT, 'tests', suiteFile), 'utf8'));

  it('generates a fixture that cannot manufacture the sentinel', () => {
    const fixture = fixtureSource(suiteHelper(CAPTURE_SUITES[0]));
    assert.strictEqual(
      countOccurrences(fixture, RUNNER_SENTINEL), 1,
      'the sentinel literal must occur exactly once, so no title or diagnostic can satisfy it'
    );
    const writes = fixture.match(/process\.stdout\.write\([^;]*\)/g) || [];
    for (const write of writes) {
      const interpolated = [...write.matchAll(/capturedApplicationText(?!\s*\.includes\()/g)];
      assert.strictEqual(
        interpolated.length, 0,
        `a runner-channel write must never interpolate the captured payload: ${write}`
      );
    }
  });

  it('detects actual output loss on the historical Buffer-guarded helper', () => {
    const r = runFixture(HISTORICAL_BUFFER_GUARDED_HELPER);
    assert.strictEqual(r.nonVacuity, true, `the capture must be non-vacuous:\n${r.output}`);
    assert.strictEqual(
      r.sentinelSeen, false,
      `the sentinel must not reach the runner through a helper that swallows it:\n${r.output}`
    );
    assert.strictEqual(
      r.status, 0,
      `the run exits 0 while the payload is lost, so exit status alone is not a verdict:\n${r.output}`
    );
  });

  for (const suiteFile of CAPTURE_SUITES) {
    it(`forwards the runner channel through the ${suiteFile} capture helper`, () => {
      const r = runFixture(suiteHelper(suiteFile));
      assert.strictEqual(r.nonVacuity, true, `the capture must be non-vacuous:\n${r.output}`);
      assert.strictEqual(
        r.sentinelSeen, true,
        `the runner output lost the text payload sentinel ${RUNNER_SENTINEL}:\n${r.output}`
      );
      assert.strictEqual(
        r.withheld, false,
        `the sentinel was withheld from the runner channel instead of forwarded:\n${r.output}`
      );
    });
  }
});
