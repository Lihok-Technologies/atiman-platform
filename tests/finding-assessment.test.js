/**
 * Finding Assessment Integration Tests
 *
 * Verifies the Assessment stage of the Atiman operational flow against a real
 * PostgreSQL database (ATM-000 sections 9-10, ATM-002 sections 7.2-7.3, 8.2-8.3):
 * a finding receives exactly one accountable outcome — Operator Corrected,
 * Monitor, or Escalate — with attribution, override discipline, and tenant
 * isolation.
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * src/config/database.js uses to select TEST_DB_ credentials, so it can never
 * run against runtime DB_ / PG_ credentials.
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const { getConnection, isIntegrationTest } = require('../src/config/database');
const FindingAssessment = require('../src/models/finding-assessment.model');
const Finding = require('../src/models/finding.model');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating finding-assessment suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'TEST_DB_* is used instead of runtime DB_*/PG* credentials; '
    + 'run it via `npm run test:integration`';

// Disposable, deterministic fixtures. No legacy ODM-CMMS identity is imported.
const ORG_A = 991001;
const ORG_B = 991002;
const SUPERVISOR_A = 991101;
const OPERATOR_A = 991102;
const SUPERVISOR_B = 991103;
const FACILITY_A = 991201;
const ASSET_A = 991301;

async function ensureFixture() {
  const conn = await getConnection();
  try {
    for (const [id, name] of [[ORG_A, 'Assessment Test Org A'], [ORG_B, 'Assessment Test Org B']]) {
      await conn.query(
        `INSERT INTO organizations (id, organization_name) VALUES (?, ?)
         ON CONFLICT (id) DO NOTHING`,
        [id, name]
      );
    }

    const users = [
      [SUPERVISOR_A, 'assess-supervisor-a', 'supervisor', ORG_A],
      [OPERATOR_A, 'assess-operator-a', 'operator', ORG_A],
      [SUPERVISOR_B, 'assess-supervisor-b', 'supervisor', ORG_B]
    ];
    for (const [id, username, role, orgId] of users) {
      await conn.query(
        `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
         VALUES (?, ?, ?, 'x', 'Assessment Fixture User', ?, ?, true)
         ON CONFLICT (id) DO NOTHING`,
        [id, username, `${username}@test.local`, role, orgId]
      );
    }

    await conn.query(
      `INSERT INTO facilities (id, organization_id, name, code) VALUES (?, ?, 'Assessment Test Facility', 'ASSESS-FAC')
       ON CONFLICT (id) DO NOTHING`,
      [FACILITY_A, ORG_A]
    );

    await conn.query(
      `INSERT INTO equipment (id, organization_id, facility_id, name, code) VALUES (?, ?, ?, 'Assessment Test Asset', 'ASSESS-AST')
       ON CONFLICT (id) DO NOTHING`,
      [ASSET_A, ORG_A, FACILITY_A]
    );

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/** Each test gets a fresh finding so tests never share assessment state. */
async function createFinding(organizationId = ORG_A, status = 'open') {
  const conn = await getConnection();
  try {
    const [finding] = await conn.query(
      `INSERT INTO findings (
         organization_id, facility_id, asset_id, finding_description,
         severity, status, reported_by_user_id
       ) VALUES (?, ?, ?, 'Assessment fixture finding', 'medium', ?, ?)
       RETURNING id`,
      [organizationId, FACILITY_A, ASSET_A, status, SUPERVISOR_A]
    );
    await conn.commit();
    return finding;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

const rejectWith = async (promise, statusCode, messagePattern) => {
  await assert.rejects(promise, (err) => {
    assert.strictEqual(err.statusCode, statusCode, `expected ${statusCode}, got ${err.statusCode}: ${err.message}`);
    if (messagePattern) assert.match(err.message, messagePattern);
    return true;
  });
};

describe('Finding Assessment', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => {
    await ensureFixture();
  });

  describe('Recommendation', () => {
    it('opens a pending assessment and marks the finding pending', async () => {
      const finding = await createFinding();
      const assessment = await FindingAssessment.openAssessment(finding.id, ORG_A, {
        recommendedOutcome: 'operator_corrected',
        recommendedByUserId: OPERATOR_A,
        engineeringContext: 'Minor seal weep observed'
      });

      assert.strictEqual(assessment.assessment_state, 'pending');
      assert.strictEqual(assessment.recommended_outcome, 'operator_corrected');
      assert.strictEqual(assessment.confirmed_outcome, null);
      assert.strictEqual(assessment.recommended_by_user_id, OPERATOR_A);

      const scoped = await FindingAssessment.getScopedFinding(finding.id, ORG_A);
      assert.strictEqual(scoped.assessment_state, 'pending');
    });

    it('rejects an unknown recommended outcome', async () => {
      const finding = await createFinding();
      await rejectWith(
        FindingAssessment.openAssessment(finding.id, ORG_A, {
          recommendedOutcome: 'ignore',
          recommendedByUserId: OPERATOR_A
        }),
        400,
        /Invalid recommended outcome/
      );
    });

    it('does not open a second pending assessment for the same finding', async () => {
      const finding = await createFinding();
      await FindingAssessment.openAssessment(finding.id, ORG_A, {
        recommendedOutcome: 'monitor',
        recommendedByUserId: OPERATOR_A
      });

      await rejectWith(
        FindingAssessment.openAssessment(finding.id, ORG_A, {
          recommendedOutcome: 'escalate',
          recommendedByUserId: OPERATOR_A
        }),
        409,
        /already has an assessment awaiting decision/
      );
    });

    it('refuses to assess a finding from another organization', async () => {
      const finding = await createFinding(ORG_A);
      await rejectWith(
        FindingAssessment.openAssessment(finding.id, ORG_B, {
          recommendedOutcome: 'monitor',
          recommendedByUserId: SUPERVISOR_B
        }),
        404,
        /Finding not found/
      );
    });
  });

  describe('Accountable confirmation', () => {
    it('confirms the recommended outcome and resolves the finding', async () => {
      const finding = await createFinding();
      const opened = await FindingAssessment.openAssessment(finding.id, ORG_A, {
        recommendedOutcome: 'operator_corrected',
        recommendedByUserId: OPERATOR_A
      });

      const confirmed = await FindingAssessment.confirmAssessment(opened.id, ORG_A, {
        assessorUserId: SUPERVISOR_A,
        confirmedOutcome: 'operator_corrected'
      });

      assert.strictEqual(confirmed.assessment_state, 'confirmed');
      assert.strictEqual(confirmed.confirmed_outcome, 'operator_corrected');
      assert.strictEqual(confirmed.assessor_user_id, SUPERVISOR_A);
      assert.ok(confirmed.assessed_at, 'assessed_at must be attributed');

      const scoped = await FindingAssessment.getScopedFinding(finding.id, ORG_A);
      assert.strictEqual(scoped.outcome, 'operator_corrected');
      assert.strictEqual(scoped.assessment_state, 'assessed');
      assert.strictEqual(scoped.status, 'resolved');
    });

    it('requires a reason when overriding the recommended outcome', async () => {
      const finding = await createFinding();
      const opened = await FindingAssessment.openAssessment(finding.id, ORG_A, {
        recommendedOutcome: 'monitor',
        recommendedByUserId: OPERATOR_A
      });

      await rejectWith(
        FindingAssessment.confirmAssessment(opened.id, ORG_A, {
          assessorUserId: SUPERVISOR_A,
          confirmedOutcome: 'escalate',
          escalationReference: 'EAM-1'
        }),
        400,
        /requires a reason/
      );
    });

    it('records an override when a reason is supplied', async () => {
      const finding = await createFinding();
      const opened = await FindingAssessment.openAssessment(finding.id, ORG_A, {
        recommendedOutcome: 'monitor',
        recommendedByUserId: OPERATOR_A
      });

      const confirmed = await FindingAssessment.confirmAssessment(opened.id, ORG_A, {
        assessorUserId: SUPERVISOR_A,
        confirmedOutcome: 'escalate',
        overrideReason: 'Vibration trend indicates bearing degradation',
        escalationReference: 'EAM-2026-0001'
      });

      assert.strictEqual(confirmed.confirmed_outcome, 'escalate');
      assert.strictEqual(confirmed.override_reason, 'Vibration trend indicates bearing degradation');

      const scoped = await FindingAssessment.getScopedFinding(finding.id, ORG_A);
      assert.strictEqual(scoped.status, 'escalated');
    });

    it('requires a monitor interval for the Monitor outcome', async () => {
      const finding = await createFinding();
      const opened = await FindingAssessment.openAssessment(finding.id, ORG_A, {
        recommendedOutcome: 'monitor',
        recommendedByUserId: OPERATOR_A
      });

      await rejectWith(
        FindingAssessment.confirmAssessment(opened.id, ORG_A, {
          assessorUserId: SUPERVISOR_A,
          confirmedOutcome: 'monitor'
        }),
        400,
        /monitor interval/
      );

      const confirmed = await FindingAssessment.confirmAssessment(opened.id, ORG_A, {
        assessorUserId: SUPERVISOR_A,
        confirmedOutcome: 'monitor',
        monitorIntervalDays: 30
      });
      assert.strictEqual(confirmed.monitor_interval_days, 30);

      const scoped = await FindingAssessment.getScopedFinding(finding.id, ORG_A);
      assert.strictEqual(scoped.status, 'monitored');
    });

    it('requires an escalation reference for the Escalate outcome', async () => {
      const finding = await createFinding();
      const opened = await FindingAssessment.openAssessment(finding.id, ORG_A, {
        recommendedOutcome: 'escalate',
        recommendedByUserId: OPERATOR_A
      });

      await rejectWith(
        FindingAssessment.confirmAssessment(opened.id, ORG_A, {
          assessorUserId: SUPERVISOR_A,
          confirmedOutcome: 'escalate'
        }),
        400,
        /escalation reference/
      );
    });

    it('does not allow an assessment to be decided twice', async () => {
      const finding = await createFinding();
      const opened = await FindingAssessment.openAssessment(finding.id, ORG_A, {
        recommendedOutcome: 'operator_corrected',
        recommendedByUserId: OPERATOR_A
      });
      await FindingAssessment.confirmAssessment(opened.id, ORG_A, {
        assessorUserId: SUPERVISOR_A,
        confirmedOutcome: 'operator_corrected'
      });

      await rejectWith(
        FindingAssessment.confirmAssessment(opened.id, ORG_A, {
          assessorUserId: SUPERVISOR_A,
          confirmedOutcome: 'monitor',
          monitorIntervalDays: 7
        }),
        409,
        /already confirmed/
      );
    });

    it('refuses to decide an assessment belonging to another organization', async () => {
      const finding = await createFinding();
      const opened = await FindingAssessment.openAssessment(finding.id, ORG_A, {
        recommendedOutcome: 'operator_corrected',
        recommendedByUserId: OPERATOR_A
      });

      await rejectWith(
        FindingAssessment.confirmAssessment(opened.id, ORG_B, {
          assessorUserId: SUPERVISOR_B,
          confirmedOutcome: 'operator_corrected'
        }),
        404,
        /Assessment not found/
      );
    });

    it('refuses to assess a closed finding', async () => {
      const finding = await createFinding(ORG_A, 'closed');
      await rejectWith(
        FindingAssessment.openAssessment(finding.id, ORG_A, {
          recommendedOutcome: 'monitor',
          recommendedByUserId: OPERATOR_A
        }),
        409,
        /cannot be assessed/
      );
    });
  });

  describe('Evidence and rejection', () => {
    it('requires a reason to reject', async () => {
      const finding = await createFinding();
      const opened = await FindingAssessment.openAssessment(finding.id, ORG_A, {
        recommendedOutcome: 'operator_corrected',
        recommendedByUserId: OPERATOR_A
      });

      await rejectWith(
        FindingAssessment.rejectAssessment(opened.id, ORG_A, { assessorUserId: SUPERVISOR_A }),
        400,
        /requires a reason/
      );
    });

    it('rejects an assessment and records the reason', async () => {
      const finding = await createFinding();
      const opened = await FindingAssessment.openAssessment(finding.id, ORG_A, {
        recommendedOutcome: 'operator_corrected',
        recommendedByUserId: OPERATOR_A
      });

      const rejected = await FindingAssessment.rejectAssessment(opened.id, ORG_A, {
        assessorUserId: SUPERVISOR_A,
        rejectionReason: 'Evidence insufficient for operator correction'
      });

      assert.strictEqual(rejected.assessment_state, 'rejected');
      const scoped = await FindingAssessment.getScopedFinding(finding.id, ORG_A);
      assert.strictEqual(scoped.assessment_state, 'rejected');
      assert.strictEqual(scoped.outcome, null, 'a rejected assessment must not set an outcome');
    });

    it('can request more evidence, and re-assessment is then possible', async () => {
      const finding = await createFinding();
      const opened = await FindingAssessment.openAssessment(finding.id, ORG_A, {
        recommendedOutcome: 'monitor',
        recommendedByUserId: OPERATOR_A
      });

      const requested = await FindingAssessment.requestMoreEvidence(opened.id, ORG_A, {
        assessorUserId: SUPERVISOR_A,
        engineeringContext: 'Attach a vibration reading'
      });
      assert.strictEqual(requested.assessment_state, 'more_evidence_requested');

      // Re-assessment opens a fresh row; history is preserved.
      const reopened = await FindingAssessment.openAssessment(finding.id, ORG_A, {
        recommendedOutcome: 'escalate',
        recommendedByUserId: OPERATOR_A
      });
      assert.strictEqual(reopened.assessment_state, 'pending');

      const history = await FindingAssessment.getHistoryForFinding(finding.id, ORG_A);
      assert.strictEqual(history.length, 2);
    });
  });

  describe('Supervisor queue and history scoping', () => {
    it('lists only pending assessments for the caller organization', async () => {
      const findingA = await createFinding(ORG_A);
      await FindingAssessment.openAssessment(findingA.id, ORG_A, {
        recommendedOutcome: 'monitor',
        recommendedByUserId: OPERATOR_A
      });

      const queueA = await FindingAssessment.listPending(ORG_A);
      assert.ok(queueA.some((row) => row.finding_id === findingA.id));

      const queueB = await FindingAssessment.listPending(ORG_B);
      assert.ok(
        !queueB.some((row) => row.finding_id === findingA.id),
        'another organization must not see this finding'
      );
    });

    it('does not expose another organization assessment history', async () => {
      const finding = await createFinding(ORG_A);
      await FindingAssessment.openAssessment(finding.id, ORG_A, {
        recommendedOutcome: 'monitor',
        recommendedByUserId: OPERATOR_A
      });

      const historyB = await FindingAssessment.getHistoryForFinding(finding.id, ORG_B);
      assert.strictEqual(historyB.length, 0);

      const scopedB = await FindingAssessment.getScopedFinding(finding.id, ORG_B);
      assert.strictEqual(scopedB, null);
    });
  });

  // Adversarial coverage: the Assessment stage must not be reachable around.
  describe('Assessment stage cannot be bypassed', () => {
    it('refuses to set an outcome-bearing status through the legacy status endpoint', async () => {
      const finding = await createFinding();

      for (const status of ['resolved', 'monitored', 'escalated', 'assessed']) {
        await rejectWith(
          Finding.updateStatus(finding.id, status, ORG_A),
          409,
          /produced by a confirmed finding assessment/
        );
      }

      const scoped = await FindingAssessment.getScopedFinding(finding.id, ORG_A);
      assert.strictEqual(scoped.status, 'open', 'status must be unchanged');
      assert.strictEqual(scoped.outcome, null);
    });

    it('database rejects an outcome-bearing status without a confirmed assessment', async () => {
      const finding = await createFinding();
      const conn = await getConnection();
      try {
        await assert.rejects(
          conn.query('UPDATE findings SET status = ? WHERE id = ?', ['resolved', finding.id]),
          (err) => {
            assert.match(err.message, /chk_findings_outcome_status_coherence/);
            return true;
          }
        );
      } finally {
        await conn.rollback();
        conn.release();
      }
    });

    it('database rejects an outcome that was never assessed', async () => {
      const finding = await createFinding();
      const conn = await getConnection();
      try {
        await assert.rejects(
          conn.query('UPDATE findings SET outcome = ? WHERE id = ?', ['escalate', finding.id]),
          (err) => {
            assert.match(err.message, /chk_findings_outcome_requires_assessment/);
            return true;
          }
        );
      } finally {
        await conn.rollback();
        conn.release();
      }
    });

    it('database rejects a confirmed assessment that overrides without a reason', async () => {
      const finding = await createFinding();
      const conn = await getConnection();
      try {
        // Recommended monitor, confirmed operator_corrected: an override that
        // requires no other outcome-specific field, isolating the override rule.
        await assert.rejects(
          conn.query(
            `INSERT INTO finding_assessments (
               organization_id, finding_id, recommended_outcome, confirmed_outcome,
               assessment_state, recommended_by_user_id, assessor_user_id, assessed_at
             ) VALUES (?, ?, 'monitor', 'operator_corrected', 'confirmed', ?, ?, NOW())`,
            [ORG_A, finding.id, OPERATOR_A, SUPERVISOR_A]
          ),
          (err) => {
            assert.match(err.message, /chk_finding_assessments_override_requires_reason/);
            return true;
          }
        );
      } finally {
        await conn.rollback();
        conn.release();
      }
    });

    it('database rejects a monitor outcome without an interval', async () => {
      const finding = await createFinding();
      const conn = await getConnection();
      try {
        await assert.rejects(
          conn.query(
            `INSERT INTO finding_assessments (
               organization_id, finding_id, recommended_outcome, confirmed_outcome,
               assessment_state, recommended_by_user_id, assessor_user_id, assessed_at
             ) VALUES (?, ?, 'monitor', 'monitor', 'confirmed', ?, ?, NOW())`,
            [ORG_A, finding.id, OPERATOR_A, SUPERVISOR_A]
          ),
          (err) => {
            assert.match(err.message, /chk_finding_assessments_monitor_requires_interval/);
            return true;
          }
        );
      } finally {
        await conn.rollback();
        conn.release();
      }
    });

    it('rejects malformed identifiers rather than coercing them', async () => {
      await assert.rejects(
        FindingAssessment.openAssessment('abc', ORG_A, {
          recommendedOutcome: 'monitor',
          recommendedByUserId: OPERATOR_A
        }),
        /Finding not found|invalid input syntax/i
      );
    });
  });
});
