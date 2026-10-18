/**
 * Step 6: Test Runner
 * Executes all Step 6 tests and generates a comprehensive report
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// This runner exists to execute destructive database suites, so it must
// establish the repository's sanctioned integration-test gate itself.
// NODE_ENV=test and RUN_DB_TESTS=true are exactly what src/config/database.js
// requires in order to select TEST_DB_* credentials and refuse to fall back to
// the runtime DB_*/PG* credentials.
process.env.NODE_ENV = 'test';
process.env.RUN_DB_TESTS = 'true';

// Fail closed before spawning anything. Requiring the adapter runs the
// sanctioned validation, which throws unless TEST_DB_* is complete and
// TEST_DB_NAME clearly identifies a disposable test database. Reusing
// getDatabaseConfig() keeps this runner from carrying a second, divergent copy
// of the database-safety rules.
try {
  require('../src/config/database').getDatabaseConfig();
} catch (error) {
  console.error(`Refusing to run Step 6 database suites: ${error.message}`);
  process.exit(1);
}

const TEST_FILES = [
  'step6-coverage-e2e.test.js',
  'step6-access-control.test.js',
  'step6-regression.test.js',
  'step6-seed-migration.test.js',
  'step6-performance.test.js'
];

const REPORT_FILE = 'STEP6_TEST_REPORT.md';

async function runTests() {
  console.log('================================================================================');
  console.log('STEP 6: PRODUCTION HARDENING & REGRESSION TESTING');
  console.log('================================================================================\n');
  
  const results = {
    startTime: new Date().toISOString(),
    tests: [],
    // Required suites that could not be located. A named suite that is absent
    // supplies no completion evidence, so it fails the run closed.
    missingFiles: [],
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      // Required suites whose child process did not prove a successful
      // completion. Never inferred from parsed output.
      executionFailures: 0
    }
  };
  
  for (const testFile of TEST_FILES) {
    console.log(`\nRunning: ${testFile}`);
    console.log('-'.repeat(80));
    
    const testPath = path.join(__dirname, testFile);
    
    if (!fs.existsSync(testPath)) {
      console.log(`⚠️  Test file not found: ${testFile}`);
      results.missingFiles.push(testFile);
      results.summary.executionFailures++;
      continue;
    }
    
    const result = await runTestFile(testPath);
    results.tests.push({
      file: testFile,
      ...result
    });
    
    results.summary.total += result.total;
    results.summary.passed += result.passed;
    results.summary.failed += result.failed;
    results.summary.skipped += result.skipped;
    
    if (result.executionFailure) {
      results.summary.executionFailures++;
    }
  }
  
  results.endTime = new Date().toISOString();
  results.duration = new Date(results.endTime) - new Date(results.startTime);
  
  // Fail closed. The verdict is derived from each child's completion status,
  // never from the presence or absence of TAP failure text: the default
  // non-TTY reporter is `spec` on Node >= 22, which emits no TAP lines at all,
  // so a child that exits 1 can leave the parsed counters at zero.
  results.success = results.summary.executionFailures === 0
    && results.summary.failed === 0;
  
  // Generate report
  generateReport(results);
  
  // Print summary
  printSummary(results);
  
  return results.success;
}

// A child run is only a success when it produced positive evidence of a
// successful completion: an integer exit status of 0, no termination signal
// and no spawn error. Absence of TAP failure text is never sufficient on its
// own, because the default non-TTY reporter is version-dependent.
function evaluateCompletion(result) {
  const reasons = [];
  
  if (result.spawnError) {
    reasons.push(`spawn error: ${result.spawnError}`);
  } else if (result.signal) {
    reasons.push(`terminated by signal ${result.signal}`);
  }
  
  if (result.exitCode === null) {
    if (!result.spawnError) {
      reasons.push('no exit status reported (indeterminate completion)');
    }
  } else if (result.exitCode !== 0) {
    reasons.push(`child exited with code ${result.exitCode}`);
  } else if (!result.output.trim()) {
    // A clean exit with no output at all is missing evidence, not a pass.
    reasons.push('child exited 0 without producing any output');
  }
  
  if (result.failed > 0) {
    reasons.push(`${result.failed} failing test line(s) in child output`);
  }
  
  result.failureReasons = reasons;
  result.executionFailure = reasons.length > 0;
  return result;
}

function runTestFile(testPath) {
  return new Promise((resolve) => {
    const result = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      output: '',
      // Completion evidence from the child process. A successful verdict
      // requires a clean, complete run; these defaults fail closed and are
      // replaced by observed evidence in evaluateCompletion().
      exitCode: null,
      signal: null,
      spawnError: null,
      executionFailure: true,
      failureReasons: ['child completion status was never observed']
    };
    
    const child = spawn('node', ['--test', testPath], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'test', RUN_DB_TESTS: 'true' }
    });
    
    let output = '';
    let settled = false;
    
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve(evaluateCompletion(result));
    };
    
    child.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stdout.write(text);
    });
    
    child.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stderr.write(text);
    });
    
    child.on('error', (error) => {
      // A child that could not be spawned yields no completion evidence at all.
      result.spawnError = error && error.message ? error.message : String(error);
      settle();
    });
    
    child.on('close', (code, signal) => {
      result.output = output;
      
      // Parse TAP output for reporting only. The verdict never depends on it,
      // so a reporter that emits no TAP lines cannot manufacture a pass.
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.startsWith('ok ')) {
          result.passed++;
          result.total++;
        } else if (line.startsWith('not ok ')) {
          result.failed++;
          result.total++;
        } else if (line.startsWith('# skip')) {
          result.skipped++;
          result.total++;
        }
      }
      
      result.exitCode = Number.isInteger(code) ? code : null;
      result.signal = signal || null;
      settle();
    });
  });
}

function generateReport(results) {
  const report = `# Step 6: Production Hardening & Regression Test Report

**Date:** ${results.startTime}
**Duration:** ${(results.duration / 1000).toFixed(2)} seconds

## Summary

| Metric | Count |
|--------|-------|
| Total Tests | ${results.summary.total} |
| Passed | ${results.summary.passed} ✅ |
| Failed | ${results.summary.failed} ❌ |
| Skipped | ${results.summary.skipped} ⏭️ |
| **Success Rate** | ${((results.summary.passed / results.summary.total) * 100).toFixed(1)}% |

## Test Results by File

${results.tests.map(t => `
### ${t.file}
- **Status:** ${t.executionFailure ? '❌ FAILED' : '✅ PASSED'}
- **Child exit code:** ${t.exitCode === null ? 'none reported' : t.exitCode}
- **Child signal:** ${t.signal || 'none'}
- **Total:** ${t.total}
- **Passed:** ${t.passed}
- **Failed:** ${t.failed}
- **Skipped:** ${t.skipped}
${t.failureReasons && t.failureReasons.length ? `- **Failure evidence:** ${t.failureReasons.join('; ')}\n` : ''}`).join('\n')}
${results.missingFiles.length ? `\n### Missing required suites\n\n${results.missingFiles.map(f => `- ❌ ${f} (not found)`).join('\n')}\n` : ''}

## Detailed Output

<details>
<summary>Click to expand full test output</summary>

\`\`\`
${results.tests.map(t => `
=== ${t.file} ===
${t.output}
`).join('\n')}
\`\`\`

</details>

## Test Coverage Areas

### 1. End-to-End Coverage Flows (${results.tests.find(t => t.file === 'step6-coverage-e2e.test.js')?.passed || 0} tests)
- ✅ Dashboard data loading
- ✅ Equipment browser with filters
- ✅ Gap resolution workflows
- ✅ Template browsing
- ✅ Audit log viewing
- ✅ Validation execution

### 2. Access Control & Tenant Protection (${results.tests.find(t => t.file === 'step6-access-control.test.js')?.passed || 0} tests)
- ✅ Admin-only endpoint enforcement
- ✅ Organization scoping
- ✅ Cross-tenant leakage prevention
- ✅ UI route protection

### 3. Regression Tests (${results.tests.find(t => t.file === 'step6-regression.test.js')?.passed || 0} tests)
- ✅ QR generation/scanning
- ✅ Scheduler and maintenance plans
- ✅ Work order numbering
- ✅ Inspection execution
- ✅ Findings capture
- ✅ Template clone flow

### 4. Seed & Migration (${results.tests.find(t => t.file === 'step6-seed-migration.test.js')?.passed || 0} tests)
- ✅ Idempotent seed reruns
- ✅ Safe rollback behavior
- ✅ Coverage validation consistency
- ✅ Migration safety

### 5. Performance (${results.tests.find(t => t.file === 'step6-performance.test.js')?.passed || 0} tests)
- ✅ Dashboard query performance
- ✅ Pagination efficiency
- ✅ Filter performance
- ✅ Index usage validation

## Production Readiness Assessment

| Criterion | Status | Notes |
|-----------|--------|-------|
| E2E Coverage | ${results.success ? '✅' : '❌'} | All flows tested |
| Security | ${results.success ? '✅' : '❌'} | Access control validated |
| Regression | ${results.success ? '✅' : '❌'} | Existing features preserved |
| Data Integrity | ${results.success ? '✅' : '❌'} | Seed/migration safe |
| Performance | ${results.success ? '✅' : '❌'} | Queries within thresholds |

## Recommendations

${results.success ? `
✅ **All tests passed. System is production-ready.**

The implementation meets all requirements:
- Coverage management flows are fully functional
- Access controls are properly enforced
- No regressions in existing functionality
- Seeds and migrations are safe
- Performance is within acceptable thresholds
` : `
⚠️ **Some tests failed. Review required before production deployment.**

Failed tests indicate potential issues that should be addressed:
- Review failed test output above
- Fix any security or data integrity issues
- Re-run tests after fixes
`}

---
*Generated by Step 6 Test Runner*
`;

  fs.writeFileSync(path.join(__dirname, '..', REPORT_FILE), report);
  console.log(`\n📄 Report saved to: ${REPORT_FILE}`);
}

function printSummary(results) {
  console.log('\n' + '='.repeat(80));
  console.log('TEST SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total Tests:  ${results.summary.total}`);
  console.log(`Passed:       ${results.summary.passed} ✅`);
  console.log(`Failed:       ${results.summary.failed} ❌`);
  console.log(`Skipped:      ${results.summary.skipped} ⏭️`);
  console.log(`Success Rate: ${((results.summary.passed / results.summary.total) * 100).toFixed(1)}%`);
  console.log('='.repeat(80));
  
  if (results.success) {
    console.log('\n✅ ALL TESTS PASSED - Production Ready');
  } else {
    // Report the authoritative failure evidence rather than the
    // reporter-dependent counter: under the `spec` reporter a failed child
    // yields no parsed failure lines, so a bare counter would read
    // "0 TEST(S) FAILED" while the run has in fact failed.
    const reasons = [];
    if (results.summary.executionFailures > 0) {
      reasons.push(`${results.summary.executionFailures} SUITE(S) DID NOT COMPLETE SUCCESSFULLY`);
    }
    if (results.summary.failed > 0) {
      reasons.push(`${results.summary.failed} TEST(S) FAILED`);
    }
    console.log(`\n❌ ${reasons.join(' + ') || 'RUN FAILED'} - Review Required`);
  }
}

// Run tests if executed directly
if (require.main === module) {
  runTests()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((err) => {
      console.error('Test runner failed:', err);
      process.exit(1);
    });
}

module.exports = { runTests };
