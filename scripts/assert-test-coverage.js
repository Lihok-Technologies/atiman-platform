#!/usr/bin/env node
'use strict';

/**
 * ATM-001-SEC-CLOSURE-WP3-01 / WP3-03 — test-inventory coverage enforcement.
 *
 * WHY THIS EXISTS
 *
 * `npm test` runs `node --test tests/*.test.js`, but a suite that conditionally
 * skips itself when the database-test gate is not satisfied executes NOTHING
 * under `npm test`. Unless it is also registered in
 * `scripts/run-integration-tests.js` it then executes nowhere at all — while CI
 * still reports green. This check closes that silent-omission hole.
 *
 * WP3-03 CORRECTION — FAIL-CLOSED CLASSIFICATION
 *
 * WP3-02 demonstrated a bypass: the earlier version asked "does this suite LOOK
 * self-skipping?" and, when the answer was no, silently treated the suite as
 * covered by `npm test`. A suite gating itself with
 *     const gated = isIntegrationTest() ? describe : describe.skip;
 * executed zero tests, was classified as covered, and the checker printed
 * PASS (exit 0).
 *
 * The direction is now inverted: every suite must be POSITIVELY classified into
 * one of a small, explicitly supported execution mechanisms. Anything that
 * cannot be so classified FAILS. Unknown or ambiguous conditional-execution
 * patterns never default to "covered".
 *
 * Supported mechanisms
 *   UNCONDITIONAL  no conditional-execution construct; executed by `npm test`
 *   GATED          uses the recognised gate idiom AND is registered in the
 *                  contract, so the gate genuinely runs it
 *   LEGACY_EXEMPT  one of the documented superseded suites
 *
 * Rejected (fail closed)
 *   UNSUPPORTED    a conditional/selection construct outside the supported set
 *                  (describe.skip, it.skip, test.skip, suite.skip, skipIf,
 *                  .todo, .only, runOnly, ...)
 *   AMBIGUOUS      a `skip:` option with no recognised gate — it may skip
 *                  unconditionally, so execution cannot be demonstrated
 *   NO_TESTS       no test-definition call in executable code — importing a test
 *                  framework is not proof that any test runs
 *
 * ANALYSIS IS LEXICAL, NOT INTERPRETIVE. Comments and string/template literals
 * are blanked before any pattern is matched, so this check cannot be satisfied —
 * or tripped — by text inside a comment or a string. It is a bounded lexical
 * normaliser, deliberately NOT a JavaScript parser.
 *
 * Checks (no hardcoded suite counts anywhere):
 *   C1  the declared contract and ledger parse and are non-empty (fail closed)
 *   C2  every registration exists on disk (no stale registration)
 *   C3  every gated suite is contracted or documented-exempt
 *   C4  the contract is a subset of the guard's database-mutating ledger
 *   C5  every declared database-mutating suite is classified
 *   C6  the contract contains no duplicates
 *   C7  the repository `test` script still runs the whole discovery glob
 *   C8  no test file exists outside the glob the required commands execute
 *   C9  every required security-critical suite exists and is executed
 *   C10 no unsupported or ambiguous conditional-execution construct
 *   C11 every suite contains at least one test definition
 *
 * Usage:
 *   node scripts/assert-test-coverage.js            # exits 1 on any failure
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const RUNNER_REL = 'scripts/run-integration-tests.js';
const GUARD_REL = 'tests/database-test-guard.test.js';
const PACKAGE_REL = 'package.json';

/** The glob the required `npm test` command executes. */
const REQUIRED_TEST_GLOB = 'tests/*.test.js';

/** The recognised gate. A suite that consults it may legitimately skip. */
const GATE_RE = /\bisIntegrationTest\s*\(/;

/** The ONE supported conditional-skip idiom: a `skip:` suite option. */
const SUPPORTED_SKIP_RE = /\bskip\s*:/;

/** Proof that a suite defines at least one test. */
const TEST_DEFINITION_RE = /\b(?:test|it|describe|suite|context|specify)\s*\(/;

/**
 * Conditional-execution and test-selection constructs that are NOT supported.
 * Each can stop tests from running, and none can be verified by this checker —
 * so each is rejected rather than assumed safe.
 */
const UNSUPPORTED_CONSTRUCTS = Object.freeze([
  {
    id: 'member-skip',
    re: /\b(?:describe|it|test|suite|context|specify)\s*\.\s*skip\b/,
    label: 'member skip (describe.skip / it.skip / test.skip / suite.skip)'
  },
  {
    id: 'skip-if',
    re: /\bskipIf\b/,
    label: 'conditional skip (skipIf)'
  },
  {
    id: 'todo',
    re: /\b(?:describe|it|test|suite)\s*\.\s*todo\b/,
    label: 'pending test (.todo)'
  },
  {
    id: 'only',
    re: /\b(?:describe|it|test|suite|context)\s*\.\s*only\b/,
    label: 'test selection (.only hides sibling tests)'
  },
  {
    id: 'run-only',
    re: /\brunOnly\b/,
    label: 'test selection (runOnly hides sibling tests)'
  }
]);

/** Documented, deliberate exemption — superseded legacy ODM-CMMS suites. */
const SUPERSEDED_LEGACY_SUITES = Object.freeze([
  'step6-access-control.test.js',
  'step6-coverage-e2e.test.js',
  'step6-performance.test.js',
  'step6-regression.test.js',
  'step6-seed-migration.test.js'
]);

/** Security-critical suites that must exist and be executed. */
const SECURITY_CRITICAL_REQUIRED = Object.freeze([
  'database-test-guard.test.js',
  'runtime-security.test.js',
  'phase3-cutover-guard.test.js'
]);

/** Security-critical suites that arrive with a separate integration candidate. */
const SECURITY_CRITICAL_CONDITIONAL = Object.freeze([
  'invitation-role-authority.test.js',
  'invitation-list-authorization.test.js',
  'invitation-resend-authorization.test.js'
]);

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/**
 * Blank out comments and string/template literals, preserving length and line
 * breaks so a match can be reported with an accurate line number.
 *
 * Deliberately a bounded lexical state machine, not a parser. Template literals
 * are treated as opaque: `${...}` interpolation is blanked along with the rest
 * of the literal. That is conservative for this checker's purpose — the
 * constructs it looks for are identifiers and option keys, never template text.
 */
/**
 * A `/` begins a regular-expression literal only where a value may start.
 * These are the preceding characters and keywords for which that is true. This
 * is the standard bounded disambiguation and is what keeps a regex such as
 * `/require\(['"]mysql2['"]\)/` from being mistaken for a string delimiter.
 */
const REGEX_ALLOWED_AFTER = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^'
]);
const REGEX_ALLOWED_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await'
]);

function stripCommentsAndStrings(source) {
  const out = source.split('');
  const n = source.length;
  const blank = (i) => { if (i < n && out[i] !== '\n') out[i] = ' '; };

  let state = 'CODE';
  let i = 0;
  let lastChar = '';
  let lastWord = '';
  let inClass = false;

  while (i < n) {
    const c = source[i];
    const d = i + 1 < n ? source[i + 1] : '';

    if (state === 'CODE') {
      if (c === '/' && d === '/') { blank(i); blank(i + 1); state = 'LINE'; i += 2; continue; }
      if (c === '/' && d === '*') { blank(i); blank(i + 1); state = 'BLOCK'; i += 2; continue; }
      if (c === '/'
          && (lastChar === '' || REGEX_ALLOWED_AFTER.has(lastChar) || REGEX_ALLOWED_KEYWORDS.has(lastWord))) {
        blank(i); state = 'REGEX'; inClass = false; i += 1; continue;
      }
      if (c === "'") { blank(i); state = 'SQ'; lastChar = c; lastWord = ''; i += 1; continue; }
      if (c === '"') { blank(i); state = 'DQ'; lastChar = c; lastWord = ''; i += 1; continue; }
      if (c === '`') { blank(i); state = 'TMPL'; lastChar = c; lastWord = ''; i += 1; continue; }
      if (!/\s/.test(c)) {
        lastChar = c;
        lastWord = /[A-Za-z_$]/.test(c) ? lastWord + c : '';
      }
      i += 1; continue;
    }

    if (state === 'LINE') {
      if (c === '\n') { state = 'CODE'; i += 1; continue; }
      blank(i); i += 1; continue;
    }

    if (state === 'BLOCK') {
      if (c === '*' && d === '/') { blank(i); blank(i + 1); state = 'CODE'; i += 2; continue; }
      blank(i); i += 1; continue;
    }

    if (state === 'REGEX') {
      if (c === '\\') { blank(i); blank(i + 1); i += 2; continue; }
      if (c === '\n') { state = 'CODE'; i += 1; continue; }   // unterminated: recover
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) { blank(i); state = 'FLAGS'; i += 1; continue; }
      blank(i); i += 1; continue;
    }

    if (state === 'FLAGS') {
      if (/[a-z]/i.test(c)) { blank(i); i += 1; continue; }
      state = 'CODE';
      lastChar = ''; lastWord = '';
      continue;                                              // reprocess this char as CODE
    }

    // string or template literal
    if (c === '\\') { blank(i); blank(i + 1); i += 2; continue; }
    if (state === 'SQ' && c === "'") { blank(i); state = 'CODE'; i += 1; continue; }
    if (state === 'DQ' && c === '"') { blank(i); state = 'CODE'; i += 1; continue; }
    if (state === 'TMPL' && c === '`') { blank(i); state = 'CODE'; i += 1; continue; }
    blank(i); i += 1;
  }
  return out.join('');
}

const lineAt = (source, index) => source.slice(0, index).split('\n').length;

/** Locate the first match of a regex, returning its line and matched text. */
function firstMatch(source, re) {
  const m = re.exec(source);
  if (!m) return null;
  return { line: lineAt(source, m.index), text: m[0].trim() };
}

/**
 * WP3-05 (F-2) — computed-property member access, e.g. `describe['skip'](...)`.
 *
 * The property key is STRING content, so it cannot be matched against the
 * blanked text. Match the raw source instead, and accept a match only when the
 * receiver identifier survived blanking at the same index — which happens only
 * if the receiver is executable code rather than text inside a string, template
 * or comment. Index-preserving blanking is what makes this safe.
 */
const COMPUTED_MEMBER_RE = /\b(describe|it|test|suite|context|specify)\s*\[\s*['"`](skip|todo|only)['"`]\s*\]/g;

function computedMemberInCode(raw, code) {
  for (const m of raw.matchAll(COMPUTED_MEMBER_RE)) {
    const idx = m.index;
    const receiver = m[1];
    if (code.slice(idx, idx + receiver.length) !== receiver) continue;   // inside a string/comment
    return {
      line: lineAt(raw, idx),
      text: m[0].trim(),
      label: `computed-property member access (${receiver}[${JSON.stringify(m[2])}])`
    };
  }
  return null;
}

/**
 * WP3-05 (F-1) — bounded gate-derivation analysis.
 *
 * Collect identifiers assigned from a call to the database-test gate, e.g.
 *   const REASON = isIntegrationTest() ? false : 'needs gate';
 * and the value expression of every `skip:` suite option. A skip value counts as
 * gate-derived when it calls the gate inline, or references one of those
 * identifiers. This is single-file identifier reasoning — deliberately NOT a
 * parser and NOT a general data-flow analysis.
 */
const GATE_ASSIGN_RE = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=[^;\n]*?isIntegrationTest\s*\(/g;
const SKIP_VALUE_RE = /\bskip\s*:\s*([^,}\n]+)/g;

function gateDerivedNames(code) {
  const names = new Set();
  for (const m of code.matchAll(GATE_ASSIGN_RE)) names.add(m[1]);
  return names;
}

function skipValues(code) {
  return [...code.matchAll(SKIP_VALUE_RE)].map((m) => m[1].trim());
}

function skipValuesAreGateDerived(code) {
  const names = gateDerivedNames(code);
  const values = skipValues(code);
  if (values.length === 0) return false;
  return values.every((value) => {
    if (/isIntegrationTest\s*\(/.test(value)) return true;          // inline gate call
    if (/^(?:true|false|null|undefined)$/.test(value)) return false; // constant skip
    const identifiers = [...value.matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0]);
    return identifiers.some((id) => names.has(id));
  });
}

/**
 * Classify one suite from its source. Exactly one class is returned, so a single
 * defect yields a single actionable failure.
 */
function classifySuite(raw) {
  const code = stripCommentsAndStrings(raw);

  const unsupported = UNSUPPORTED_CONSTRUCTS
    .map((c) => {
      const hit = firstMatch(code, c.re);
      return hit ? { id: c.id, label: c.label, line: hit.line, text: hit.text } : null;
    })
    .filter(Boolean);

  // WP3-05 (F-2): detected on the raw source, validated against the blanked text.
  const computed = computedMemberInCode(raw, code);
  if (computed) {
    unsupported.push({ id: 'computed-member', label: computed.label, line: computed.line, text: computed.text });
  }

  if (unsupported.length > 0) return { klass: 'UNSUPPORTED', unsupported, code };

  const hasSkipOption = SUPPORTED_SKIP_RE.test(code);
  const hasGate = GATE_RE.test(code);

  if (hasSkipOption && !hasGate) {
    return { klass: 'AMBIGUOUS', reason: 'no-gate', skipLine: firstMatch(code, SUPPORTED_SKIP_RE).line, code };
  }

  // WP3-05 (F-1): a gate call ELSEWHERE in the file does not prove that the skip
  // condition derives from it. Mere co-occurrence is not derivation, so the skip
  // value must itself trace back to the gate.
  if (hasSkipOption && hasGate && !skipValuesAreGateDerived(code)) {
    return {
      klass: 'AMBIGUOUS',
      reason: 'gate-not-derived',
      skipLine: firstMatch(code, SUPPORTED_SKIP_RE).line,
      skipValues: skipValues(code),
      gateNames: [...gateDerivedNames(code)],
      code
    };
  }

  if (!TEST_DEFINITION_RE.test(code)) return { klass: 'NO_TESTS', code };
  if (hasSkipOption) return { klass: 'GATED', code };
  return { klass: 'UNCONDITIONAL', code };
}

/** All suites the required `npm test` glob discovers, as basenames. */
function discoverSuites(root) {
  return fs.readdirSync(path.join(root, 'tests'))
    .filter((name) => name.endsWith('.test.js'))
    .sort();
}

/** Recursive scan, to detect suites the glob would NOT execute. */
function discoverSuitesDeep(root) {
  const out = [];
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, r);
      else if (entry.name.endsWith('.test.js')) out.push(r);
    }
  };
  walk(path.join(root, 'tests'), '');
  return out.sort();
}

const stripLineComments = (text) => text
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

function extractSuiteBasenames(text) {
  return [...text.matchAll(/'([^'\n]*?([A-Za-z0-9_.-]+\.test\.js))'/g)].map((m) => m[2]);
}

/**
 * Strict, anchored extraction of a declared suite array. Fails closed: a missing
 * anchor or an empty result is an error, never a pass.
 */
function parseDeclaredArray(source, constName) {
  const anchor = new RegExp(`const\\s+${constName}\\s*=\\s*\\[`);
  const start = source.search(anchor);
  if (start === -1) {
    return { ok: false, reason: `could not locate \`const ${constName} = [\``, entries: [], rawEntries: [] };
  }
  const rest = source.slice(start);
  const end = rest.indexOf('\n];');
  if (end === -1) {
    return { ok: false, reason: `could not locate the end of the \`${constName}\` array`, entries: [], rawEntries: [] };
  }
  const body = stripLineComments(rest.slice(0, end));
  const rawEntries = extractSuiteBasenames(body);
  const entries = [...new Set(rawEntries)];
  if (entries.length === 0) {
    return { ok: false, reason: `\`${constName}\` parsed but contained no suite entries`, entries: [], rawEntries: [] };
  }
  return { ok: true, entries, rawEntries };
}

function analyse(options = {}) {
  const root = options.repoRoot || REPO_ROOT;
  const failures = [];
  const fail = (id, message) => failures.push({ id, message });

  const discovered = discoverSuites(root);
  const discoveredDeep = discoverSuitesDeep(root);

  const runnerSource = read(root, RUNNER_REL);
  const guardSource = read(root, GUARD_REL);
  const pkg = JSON.parse(read(root, PACKAGE_REL));

  // ---- C1: parser integrity ------------------------------------------------
  const contract = parseDeclaredArray(runnerSource, 'SANCTIONED_POSTGRES_INTEGRATION_SUITES');
  if (!contract.ok) fail('C1', `${RUNNER_REL}: ${contract.reason}`);

  const ledger = parseDeclaredArray(guardSource, 'DB_MUTATING_SUITES');
  if (!ledger.ok) fail('C1', `${GUARD_REL}: ${ledger.reason}`);

  const sanctioned = contract.entries;
  const declaredMutating = ledger.entries;
  const exempt = [...SUPERSEDED_LEGACY_SUITES];

  // ---- classify every suite (fail-closed) ---------------------------------
  const classes = new Map();
  for (const name of discovered) {
    classes.set(name, classifySuite(fs.readFileSync(path.join(root, 'tests', name), 'utf8')));
  }
  const withClass = (klass) => discovered.filter((n) => classes.get(n).klass === klass);

  const unsupported = withClass('UNSUPPORTED');
  const ambiguous = withClass('AMBIGUOUS');
  const noTests = withClass('NO_TESTS');
  const gated = withClass('GATED');
  const unconditional = withClass('UNCONDITIONAL');
  const selfSkipping = gated;   // retained name: suites that skip themselves under npm test

  // ---- C10: unsupported / ambiguous conditional execution ------------------
  for (const name of unsupported) {
    const detail = classes.get(name).unsupported
      .map((u) => `line ${u.line}: ${u.label} \`${u.text}\``)
      .join('; ');
    fail('C10',
      `tests/${name} uses an unsupported conditional-execution construct (${detail}). `
      + `Such a construct can stop tests from running without the coverage contract noticing. `
      + `Use the recognised gate idiom (\`{ skip: <reason> }\` derived from isIntegrationTest()) `
      + `and register the suite in ${RUNNER_REL}, or remove the construct.`);
  }
  for (const name of ambiguous) {
    const cls = classes.get(name);
    if (cls.reason === 'gate-not-derived') {
      fail('C10',
        `tests/${name} passes a \`skip:\` option (line ${cls.skipLine}) whose value `
        + `(${JSON.stringify(cls.skipValues.join(', '))}) is not derived from the database-test gate. `
        + `A gate call elsewhere in the file does not make the skip conditional: on this evidence the `
        + `suite may skip unconditionally. Derive the skip from isIntegrationTest() — for example `
        + `\`const SKIP = isIntegrationTest() ? false : 'reason';\` and then \`{ skip: SKIP }\` — or `
        + `remove the skip option.`);
    } else {
      fail('C10',
        `tests/${name} passes a \`skip:\` option (line ${cls.skipLine}) but never `
        + `consults the database-test gate, so it may skip unconditionally and its execution cannot `
        + `be demonstrated. Gate it with isIntegrationTest() and register it in ${RUNNER_REL}, or `
        + `remove the skip option.`);
    }
  }

  // ---- C11: a suite must define at least one test --------------------------
  for (const name of noTests) {
    fail('C11',
      `tests/${name} contains no test definition (no test/it/describe call) in executable code, `
      + `so importing a test framework is the only evidence that anything runs. A suite that `
      + `defines nothing executes nothing; add a test or remove the file.`);
  }

  // ---- C2: no stale registration ------------------------------------------
  for (const name of sanctioned) {
    if (!discovered.includes(name)) {
      fail('C2', `${RUNNER_REL} registers '${name}' but tests/${name} does not exist`);
    }
  }

  // ---- C3: the anti-omission invariant ------------------------------------
  for (const name of gated) {
    if (!sanctioned.includes(name) && !exempt.includes(name)) {
      fail('C3',
        `tests/${name} skips itself without the database-test gate and is NOT in the `
        + `integration contract, so it executes nowhere. Register it in ${RUNNER_REL} `
        + `or add it to the documented superseded-legacy exemption.`);
    }
  }

  // ---- C4: contract is a subset of the safety ledger ----------------------
  for (const name of sanctioned) {
    if (!declaredMutating.includes(name)) {
      fail('C4', `'${name}' is in the integration contract but not in DB_MUTATING_SUITES`);
    }
  }

  // ---- C5: every declared mutator is classified ---------------------------
  for (const name of declaredMutating) {
    if (!gated.includes(name) && !sanctioned.includes(name) && !exempt.includes(name)) {
      fail('C5',
        `'${name}' is declared database-mutating but is not gated, not contracted, `
        + `and not a documented superseded-legacy suite.`);
    }
  }

  // ---- C6: no duplicates in the contract ----------------------------------
  const rawContract = contract.ok ? contract.rawEntries : [];
  const dupes = rawContract.filter((n, i) => rawContract.indexOf(n) !== i);
  if (dupes.length) fail('C6', `${RUNNER_REL} lists duplicate suites: ${[...new Set(dupes)].join(', ')}`);

  // ---- C7: the test script still runs the whole glob ----------------------
  const testScript = (pkg.scripts || {}).test || '';
  if (!testScript.includes(REQUIRED_TEST_GLOB)) {
    fail('C7',
      `package.json "test" is \`${testScript}\` and no longer runs \`${REQUIRED_TEST_GLOB}\`; `
      + `suites could be silently dropped from every required command.`);
  }

  // ---- C8: no suite outside the executed glob -----------------------------
  const coveredByGlob = new Set(discovered);
  for (const rel of discoveredDeep) {
    const base = rel.split('/').pop();
    if (rel.includes('/') && !coveredByGlob.has(base)) {
      fail('C8', `tests/${rel} is not matched by \`${REQUIRED_TEST_GLOB}\` and would never execute`);
    }
  }

  // ---- C9: required security-critical suites exist and execute ------------
  for (const name of SECURITY_CRITICAL_REQUIRED) {
    if (!discovered.includes(name)) {
      fail('C9', `required security-critical suite tests/${name} is missing`);
      continue;
    }
    if (gated.includes(name) && !sanctioned.includes(name)) {
      fail('C9', `required security-critical suite tests/${name} self-skips and is not contracted`);
    }
  }

  const conditionalPresent = SECURITY_CRITICAL_CONDITIONAL.filter((n) => discovered.includes(n));
  for (const name of conditionalPresent) {
    if (gated.includes(name) && !sanctioned.includes(name)) {
      fail('C9', `invitation suite tests/${name} self-skips and is not contracted`);
    }
  }

  const known = new Set(['GATED', 'UNCONDITIONAL', 'UNSUPPORTED', 'AMBIGUOUS', 'NO_TESTS']);
  const unaccounted = discovered.filter((n) => !known.has(classes.get(n).klass));

  return {
    repoRoot: root,
    discovered,
    discoveredDeep,
    sanctioned,
    declaredMutating,
    selfSkipping,
    gated,
    exempt,
    unsupported,
    ambiguous,
    noTests,
    runsUnderNpmTest: unconditional,
    securityCriticalRequired: SECURITY_CRITICAL_REQUIRED,
    securityCriticalConditionalPresent: conditionalPresent,
    unaccounted,
    testScript,
    classes,
    failures
  };
}

function report(result) {
  const lines = [];
  lines.push('Test-inventory coverage — scripts/assert-test-coverage.js');
  lines.push(`  repository           : ${result.repoRoot}`);
  lines.push(`  discovered suites    : ${result.discovered.length}  (glob ${REQUIRED_TEST_GLOB})`);
  lines.push(`  integration contract : ${result.sanctioned.length}`);
  lines.push(`  gated (self-skipping): ${result.selfSkipping.length}`);
  lines.push(`  unconditional        : ${result.runsUnderNpmTest.length}`);
  lines.push(`  superseded legacy    : ${result.exempt.length}  (documented exemption)`);
  lines.push(`  database-mutating    : ${result.declaredMutating.length}  (guard ledger)`);
  lines.push(`  unsupported patterns : ${result.unsupported.length}`);
  lines.push(`  ambiguous skip       : ${result.ambiguous.length}`);
  lines.push(`  no test definitions  : ${result.noTests.length}`);
  lines.push(`  unaccounted          : ${result.unaccounted.length}`);
  lines.push(`  test script          : ${result.testScript}`);
  lines.push('');
  lines.push('  classification is fail-closed: a suite must be UNCONDITIONAL, or GATED and');
  lines.push('  contracted, or a documented legacy exemption. Anything else fails.');
  lines.push('');
  lines.push('  security-critical required    : '
    + result.securityCriticalRequired.map((n) => (result.discovered.includes(n) ? `${n} OK` : `${n} MISSING`)).join(', '));
  lines.push('  security-critical conditional : '
    + (result.securityCriticalConditionalPresent.length
      ? result.securityCriticalConditionalPresent.join(', ')
      : '(none present in this tree)'));
  lines.push('');

  if (result.failures.length === 0) {
    lines.push(`PASS: ${result.discovered.length} suite(s) discovered and fully accounted for.`);
    return { text: lines.join('\n'), ok: true };
  }
  lines.push(`FAIL: ${result.failures.length} coverage problem(s):`);
  for (const f of result.failures) lines.push(`  [${f.id}] ${f.message}`);
  return { text: lines.join('\n'), ok: false };
}

if (require.main === module) {
  const result = analyse();
  const { text, ok } = report(result);
  console.log(text);
  process.exit(ok ? 0 : 1);
}

module.exports = {
  analyse,
  report,
  classifySuite,
  stripCommentsAndStrings,
  UNSUPPORTED_CONSTRUCTS,
  SUPERSEDED_LEGACY_SUITES,
  SECURITY_CRITICAL_REQUIRED,
  REQUIRED_TEST_GLOB
};
