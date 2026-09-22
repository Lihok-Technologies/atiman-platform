/**
 * Knowledge Publication Admission Integration Tests
 *
 * ATM-001 M1 — proves that a published task-template version represents governed
 * knowledge: formally reviewed, explicitly safety-reviewed, evidenced against
 * immutable sources, and approved by a principal other than the publisher.
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * src/config/database.js uses to select test-database credentials, so it can
 * never run against runtime credentials.
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const { getConnection, isIntegrationTest } = require('../src/config/database');
const { TaskTemplate } = require('../src/models');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating publication-admission suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'test-database credentials are used instead of runtime credentials; '
    + 'run it via `npm run test:integration`';

const ORG = 993001;
const ORG_B = 993002;
const AUTHOR = 993101;
const REVIEWER = 993102;
const APPROVER = 993103;
const PUBLISHER = 993104;
const OPERATOR = 993105;
const FOREIGN_REVIEWER = 993106;   // belongs to ORG_B
const CATEGORY = 993201;
const CLASS = 993202;
const EQUIPMENT_TYPE = 993203;
const FACILITY = 993301;

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

async function ensureFixture() {
  await withConn(async (conn) => {
    for (const [id, name] of [[ORG, 'M1 Governance Org'], [ORG_B, 'M1 Foreign Org']]) {
      await conn.query(
        `INSERT INTO organizations (id, organization_name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`,
        [id, name]
      );
    }

    for (const [id, username, role, orgId] of [
      [AUTHOR, 'm1-author', 'supervisor', ORG],
      [REVIEWER, 'm1-reviewer', 'supervisor', ORG],
      [APPROVER, 'm1-approver', 'supervisor', ORG],
      [PUBLISHER, 'm1-publisher', 'admin', ORG],
      [OPERATOR, 'm1-operator', 'operator', ORG],
      [FOREIGN_REVIEWER, 'm1-foreign-reviewer', 'supervisor', ORG_B]
    ]) {
      await conn.query(
        `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
         VALUES (?, ?, ?, 'x', 'M1 Fixture User', ?, ?, true) ON CONFLICT (id) DO NOTHING`,
        [id, username, `${username}@test.local`, role, orgId]
      );
    }

    await conn.query(
      `INSERT INTO equipment_categories (id, category_code, category_name) VALUES (?, 'M1CAT', 'M1 Category')
       ON CONFLICT (id) DO NOTHING`,
      [CATEGORY]
    );
    await conn.query(
      `INSERT INTO equipment_classes (id, category_id, class_code, class_name) VALUES (?, ?, 'M1CLS', 'M1 Class')
       ON CONFLICT (id) DO NOTHING`,
      [CLASS, CATEGORY]
    );
    await conn.query(
      `INSERT INTO equipment_types (id, class_id, type_code, type_name) VALUES (?, ?, 'M1TYPE', 'M1 Equipment Type')
       ON CONFLICT (id) DO NOTHING`,
      [EQUIPMENT_TYPE, CLASS]
    );
    await conn.query(
      `INSERT INTO facilities (id, organization_id, name, code) VALUES (?, ?, 'M1 Facility', 'M1-FAC')
       ON CONFLICT (id) DO NOTHING`,
      [FACILITY, ORG]
    );
  });
}

/** A fresh working template with one valid step, in draft state. */
async function createDraftTemplate() {
  return withConn(async (conn) => {
    const [template] = await conn.query(
      `INSERT INTO task_templates (
         equipment_type_id, organization_id, template_code, template_name, maintenance_type, task_kind,
         frequency_value, frequency_unit, estimated_duration_minutes, priority
       ) VALUES (?, ?, ?, 'M1 Governed Template', 'preventive', 'inspection', 1, 'month', 30, 'medium')
       RETURNING id`,
      [EQUIPMENT_TYPE, ORG, `M1-${Date.now()}-${Math.floor(Math.random() * 1e6)}`]
    );
    await conn.query(
      `INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction, is_required)
       VALUES (?, 1, 'instruction', 'Inspect the asset for abnormal condition', true)`,
      [template.id]
    );
    return template.id;
  });
}

/** Evidence pointing at an immutable source version. */
async function addEvidence(templateId, { sourceOrg = null, sourceCode = 'M1-SRC' } = {}) {
  return withConn(async (conn) => {
    const [source] = await conn.query(
      `INSERT INTO knowledge_sources (source_code, source_category, default_title, organization_id)
       VALUES (?, 'engineering_standard', 'M1 Source', ?) RETURNING id`,
      [`${sourceCode}-${Math.floor(Math.random() * 1e6)}`, sourceOrg]
    );
    const [version] = await conn.query(
      `INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title)
       VALUES (?, '1.0', 'M1 Source Version') RETURNING id`,
      [source.id]
    );
    const [evidence] = await conn.query(
      `INSERT INTO knowledge_template_evidence (
         task_template_id, knowledge_source_version_id, section_or_clause, derivation_notes, added_by_user_id
       ) VALUES (?, ?, 'Section 4.2', 'Derived from the equipment manual', ?) RETURNING id`,
      [templateId, version.id, AUTHOR]
    );
    return { sourceId: source.id, versionId: version.id, evidenceId: evidence.id };
  });
}

async function addSafetyControl(templateId) {
  return withConn(async (conn) => {
    const [row] = await conn.query(
      `INSERT INTO task_template_safety_controls (task_template_id, safety_type, description, is_mandatory)
       VALUES (?, 'isolation', 'Isolate and lock out before inspection', true) RETURNING id`,
      [templateId]
    );
    return row.id;
  });
}

/**
 * Drive a template through the full governance lifecycle so it is admissible.
 * Returns the template id.
 */
async function createPublishableTemplate(overrides = {}) {
  const templateId = await createDraftTemplate();

  const safetyState = overrides.safetyReviewState || 'reviewed_no_control_required';
  await TaskTemplate.recordSafetyReview(templateId, REVIEWER, ORG, safetyState);
  if (overrides.withControls) await addSafetyControl(templateId);

  await TaskTemplate.submitForReview(templateId, AUTHOR, ORG);
  await TaskTemplate.approveTemplate(templateId, APPROVER, ORG);

  if (overrides.withEvidence !== false) {
    await addEvidence(templateId, { sourceOrg: overrides.evidenceOrg });
  }

  return templateId;
}

const ruleNames = (error) => (error.failures || []).map((f) => f.rule);

/**
 * Create a fresh principal to act as the publisher of governed knowledge.
 *
 * A dedicated row is required for the publisher-deletion proofs: the publisher
 * of an immutable version must not be deletable, so the test needs a user that
 * exists solely for that assertion and can be disposed of with it.
 *
 * @returns {Promise<number>} the new user id
 */
async function createGovernedPublisherUser() {
  return withConn(async (conn) => {
    const [user] = await conn.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, organization_id, is_active)
       VALUES (
         'pub-doomed-' || floor(random() * 1000000000)::int::text,
         'pub-doomed-' || floor(random() * 1000000000)::int::text || '@test.local',
         'x', 'Publisher Under Deletion Test', 'admin', ?, true
       ) RETURNING id`,
      [ORG]
    );
    return user.id;
  });
}

/**
 * Insert a governed version row DIRECTLY in SQL, bypassing the admission
 * service entirely, so the database-level invariant can be attacked rather
 * than only the service rule.
 *
 * Follows the documented assembly pattern: insert unsealed, add a step version,
 * then seal — all inside one transaction, because migration 009 refuses to
 * insert an already-sealed row and its deferred trigger refuses to commit an
 * unsealed post-publication row.
 *
 * Pass publisherUserId or approverUserId as null to withhold that attribution
 * and provoke the corresponding row-local governance constraint.
 *
 * @param {number} templateId
 * @param {Object} options
 * @param {number|null} options.approverUserId
 * @param {number|null} options.publisherUserId
 * @param {string} [options.lifecycle]
 * @param {number} [options.versionNumber]
 * @param {number|null} [options.supersededByVersionId] - required by migration 009
 *   for a superseded row, so the supersession precondition is satisfied and the
 *   row fails only for the governance condition under test
 * @returns {Promise<number>} the created version id
 */
async function insertGovernedVersionRaw(templateId, {
  approverUserId,
  publisherUserId,
  lifecycle = 'published',
  versionNumber = 1,
  supersededByVersionId = null
}) {
  return withConn(async (conn) => {
    const [version] = await conn.query(
      `INSERT INTO task_template_versions (
         task_template_id, version_number, equipment_type_id, template_name, maintenance_type,
         lifecycle_state_at_publish, is_step_set_sealed,
         published_by_user_id, published_at,
         reviewer_user_id, reviewed_at, approver_user_id, approved_at,
         safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at,
         superseded_by_version_id
       ) VALUES (?, ?, ?, 'Raw governed version', 'preventive', ?, FALSE,
         ?, NOW(), ?, NOW(), ?, NOW(), 'reviewed_no_control_required', ?, NOW(), ?)
       RETURNING id`,
      [templateId, versionNumber, EQUIPMENT_TYPE, lifecycle,
        publisherUserId, REVIEWER, approverUserId, REVIEWER, supersededByVersionId]
    );

    const [step] = await conn.query(
      `SELECT id FROM task_template_steps WHERE task_template_id = ? ORDER BY step_no LIMIT 1`,
      [templateId]
    );
    await conn.query(
      `INSERT INTO task_template_step_versions (
         task_template_version_id, step_no, task_template_step_id, step_type, instruction
       ) VALUES (?, 1, ?, 'instruction', 'Raw fixture step version')`,
      [version.id, step.id]
    );
    await conn.query(`UPDATE task_template_versions SET is_step_set_sealed = TRUE WHERE id = ?`, [version.id]);

    return version.id;
  });
}

describe('Knowledge Publication Admission', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => {
    await ensureFixture();
  });

  // ---------------------------------------------------------------- lifecycle
  describe('Review lifecycle', () => {
    it('moves a draft template to under_review and records the submitter', async () => {
      const id = await createDraftTemplate();
      const template = await TaskTemplate.submitForReview(id, AUTHOR, ORG);

      assert.strictEqual(template.review_state, 'under_review');
      assert.strictEqual(Number(template.submitted_for_review_by_user_id), AUTHOR);
      assert.ok(template.submitted_for_review_at);
    });

    it('refuses an invalid transition (submitting an already submitted template)', async () => {
      const id = await createDraftTemplate();
      await TaskTemplate.submitForReview(id, AUTHOR, ORG);
      await assert.rejects(
        () => TaskTemplate.submitForReview(id, AUTHOR, ORG),
        /Only a draft template can be submitted/
      );
    });

    it('approves a template under review and records reviewer, approver and content binding', async () => {
      const id = await createDraftTemplate();
      await TaskTemplate.submitForReview(id, AUTHOR, ORG);
      const template = await TaskTemplate.approveTemplate(id, APPROVER, ORG);

      assert.strictEqual(template.review_state, 'approved');
      assert.strictEqual(Number(template.reviewer_user_id), APPROVER);
      assert.strictEqual(Number(template.approver_user_id), APPROVER);
      assert.ok(template.reviewed_at && template.approved_at);
      assert.match(template.approved_content_sha, /^[0-9a-f]{64}$/);
    });

    it('requires a reason to reject', async () => {
      const id = await createDraftTemplate();
      await TaskTemplate.submitForReview(id, AUTHOR, ORG);
      await assert.rejects(
        () => TaskTemplate.rejectTemplate(id, REVIEWER, ORG, '   '),
        /requires a reason/
      );
    });

    it('rejects with a reason and clears any approval binding', async () => {
      const id = await createDraftTemplate();
      await TaskTemplate.submitForReview(id, AUTHOR, ORG);
      const template = await TaskTemplate.rejectTemplate(id, REVIEWER, ORG, 'Evidence insufficient');

      assert.strictEqual(template.review_state, 'rejected');
      assert.strictEqual(template.rejection_reason, 'Evidence insufficient');
      assert.strictEqual(template.approved_content_sha, null);
      assert.strictEqual(template.approver_user_id, null);
    });

    it('returns a rejected template to draft for rework, requiring re-approval', async () => {
      const id = await createDraftTemplate();
      await TaskTemplate.submitForReview(id, AUTHOR, ORG);
      await TaskTemplate.rejectTemplate(id, REVIEWER, ORG, 'Needs more detail');
      const template = await TaskTemplate.reopenForRework(id, AUTHOR, ORG);

      assert.strictEqual(template.review_state, 'draft');
      assert.strictEqual(template.rejection_reason, null);
    });

    it('does not allow a rejected template to be approved directly', async () => {
      const id = await createDraftTemplate();
      await TaskTemplate.submitForReview(id, AUTHOR, ORG);
      await TaskTemplate.rejectTemplate(id, REVIEWER, ORG, 'Insufficient');
      await assert.rejects(
        () => TaskTemplate.approveTemplate(id, APPROVER, ORG),
        /Only a template under review can be approved/
      );
    });

    it('keeps system templates out of the governance lifecycle', async () => {
      const id = await createDraftTemplate();
      await withConn((conn) => conn.query(
        'UPDATE task_templates SET is_system = true WHERE id = ?', [id]
      ));
      await assert.rejects(
        () => TaskTemplate.submitForReview(id, AUTHOR, ORG),
        /System templates are not submitted for review/
      );
    });
  });

  // ------------------------------------------------------------------ safety
  describe('Safety review', () => {
    it('refuses to publish when safety was never assessed', async () => {
      const id = await createPublishableTemplate();
      await withConn((conn) => conn.query(
        `UPDATE task_templates SET safety_review_state='not_assessed',
         safety_reviewed_by_user_id=NULL, safety_reviewed_at=NULL WHERE id = ?`, [id]
      ));

      await assert.rejects(() => TaskTemplate.publishVersion(id, PUBLISHER, {
        publishedByOrganizationId: ORG
      }), (err) => {
        assert.ok(ruleNames(err).includes('SAFETY_NOT_ASSESSED'));
        return true;
      });
    });

    it('accepts reviewed_no_control_required with zero safety controls', async () => {
      const id = await createPublishableTemplate({ safetyReviewState: 'reviewed_no_control_required' });
      const result = await TaskTemplate.publishVersion(id, PUBLISHER, { publishedByOrganizationId: ORG });
      assert.ok(result.versionId);
      assert.strictEqual(result.safetyControlVersionCount, 0);
    });

    it('refuses reviewed_controls_defined when no control rows exist', async () => {
      const id = await createPublishableTemplate({ safetyReviewState: 'reviewed_controls_defined' });
      await assert.rejects(() => TaskTemplate.publishVersion(id, PUBLISHER, {
        publishedByOrganizationId: ORG
      }), (err) => {
        assert.ok(ruleNames(err).includes('SAFETY_CONTROLS_MISSING'));
        return true;
      });
    });

    it('accepts reviewed_controls_defined when real control rows exist', async () => {
      const id = await createPublishableTemplate({
        safetyReviewState: 'reviewed_controls_defined', withControls: true
      });
      const result = await TaskTemplate.publishVersion(id, PUBLISHER, { publishedByOrganizationId: ORG });
      assert.strictEqual(result.safetyControlVersionCount, 1);
    });

    it('rejects an unknown safety review state', async () => {
      const id = await createDraftTemplate();
      await assert.rejects(
        () => TaskTemplate.recordSafetyReview(id, REVIEWER, ORG, 'looks_fine_probably'),
        /Unknown safety review state/
      );
    });
  });

  // ---------------------------------------------------------------- evidence
  describe('Evidence and provenance', () => {
    it('refuses to publish without evidence', async () => {
      const id = await createPublishableTemplate({ withEvidence: false });
      await assert.rejects(() => TaskTemplate.publishVersion(id, PUBLISHER, {
        publishedByOrganizationId: ORG
      }), (err) => {
        assert.ok(ruleNames(err).includes('EVIDENCE_MISSING'));
        return true;
      });
    });

    it('refuses evidence that cites no immutable source version', async () => {
      const id = await createPublishableTemplate({ withEvidence: false });
      await withConn((conn) => conn.query(
        `INSERT INTO knowledge_template_evidence (task_template_id, section_or_clause, added_by_user_id)
         VALUES (?, 'Somewhere', ?)`, [id, AUTHOR]
      ).catch(() => {
        // knowledge_source_version_id is NOT NULL by schema: the database itself
        // refuses evidence that is not tied to an immutable source version.
      }));

      await assert.rejects(() => TaskTemplate.publishVersion(id, PUBLISHER, {
        publishedByOrganizationId: ORG
      }), (err) => {
        assert.ok(ruleNames(err).includes('EVIDENCE_MISSING'));
        return true;
      });
    });

    it('accepts evidence resolvable to an immutable source version', async () => {
      const id = await createPublishableTemplate();
      const result = await TaskTemplate.publishVersion(id, PUBLISHER, { publishedByOrganizationId: ORG });
      assert.ok(result.templateEvidenceCount >= 1);
    });

    it('refuses to associate evidence from a source outside the template tenant scope', async () => {
      const id = await createPublishableTemplate({ withEvidence: false });

      // Migration 011 enforces provenance tenant scope at the DATABASE level: an
      // out-of-scope source version cannot even be attached to tenant-scoped
      // knowledge. The admission validator repeats the scope check as defence in
      // depth (EVIDENCE_SOURCE_OUT_OF_SCOPE) for templates that are not
      // tenant-scoped, where the database trigger's comparison differs.
      await assert.rejects(
        () => addEvidence(id, { sourceOrg: ORG_B }),
        /tenant scope does not match/
      );
    });

    it('accepts evidence from a source in the same tenant scope (positive control)', async () => {
      const id = await createPublishableTemplate({ withEvidence: false });
      await addEvidence(id, { sourceOrg: ORG });

      const result = await TaskTemplate.publishVersion(id, PUBLISHER, {
        publishedByOrganizationId: ORG
      });
      assert.ok(result.templateEvidenceCount >= 1);
    });
  });

  // --------------------------------------------------------------- structure
  describe('Structure and rule conformance', () => {
    it('refuses a template with no steps', async () => {
      const id = await createPublishableTemplate();
      await withConn((conn) => conn.query('DELETE FROM task_template_steps WHERE task_template_id = ?', [id]));
      await assert.rejects(() => TaskTemplate.publishVersion(id, PUBLISHER, {
        publishedByOrganizationId: ORG
      }), /no steps/);
    });

    it('refuses a step with an empty instruction', async () => {
      const id = await createPublishableTemplate();
      await withConn((conn) => conn.query(
        `UPDATE task_template_steps SET instruction = '   ' WHERE task_template_id = ?`, [id]
      ));
      await assert.rejects(() => TaskTemplate.publishVersion(id, PUBLISHER, {
        publishedByOrganizationId: ORG
      }), (err) => {
        assert.ok(ruleNames(err).includes('STEP_INSTRUCTION_MISSING'));
        return true;
      });
    });

    it('refuses incoherent measurement bounds', async () => {
      const id = await createPublishableTemplate();
      await withConn((conn) => conn.query(
        `UPDATE task_template_steps SET data_type='measurement', unit='bar', min_value=10, max_value=1
          WHERE task_template_id = ?`, [id]
      ));
      await assert.rejects(() => TaskTemplate.publishVersion(id, PUBLISHER, {
        publishedByOrganizationId: ORG
      }), (err) => {
        assert.ok(ruleNames(err).includes('STEP_LIMITS_INCOHERENT'));
        return true;
      });
    });

    it('refuses a measurement step without a unit', async () => {
      const id = await createPublishableTemplate();
      await withConn((conn) => conn.query(
        `UPDATE task_template_steps SET data_type='measurement', unit=NULL, min_value=1, max_value=5
          WHERE task_template_id = ?`, [id]
      ));
      await assert.rejects(() => TaskTemplate.publishVersion(id, PUBLISHER, {
        publishedByOrganizationId: ORG
      }), (err) => {
        assert.ok(ruleNames(err).includes('STEP_MEASUREMENT_UNIT_MISSING'));
        return true;
      });
    });

    it('does not require measurement semantics for an instructional step', async () => {
      const id = await createPublishableTemplate();
      const result = await TaskTemplate.publishVersion(id, PUBLISHER, { publishedByOrganizationId: ORG });
      assert.ok(result.versionId);
    });

    it('refuses a self-parenting template', async () => {
      const id = await createPublishableTemplate();
      await withConn((conn) => conn.query(
        'UPDATE task_templates SET parent_template_id = id WHERE id = ?', [id]
      ));
      await assert.rejects(() => TaskTemplate.publishVersion(id, PUBLISHER, {
        publishedByOrganizationId: ORG
      }), (err) => {
        assert.ok(ruleNames(err).includes('PARENT_CYCLE'));
        return true;
      });
    });
  });

  // ----------------------------------------------------------- accountability
  describe('Accountability and segregation of duties', () => {
    it('refuses to publish a template that was never approved', async () => {
      const id = await createDraftTemplate();
      await TaskTemplate.recordSafetyReview(id, REVIEWER, ORG, 'reviewed_no_control_required');
      await addEvidence(id);
      await assert.rejects(() => TaskTemplate.publishVersion(id, PUBLISHER, {
        publishedByOrganizationId: ORG
      }), (err) => {
        assert.ok(ruleNames(err).includes('NOT_APPROVED'));
        return true;
      });
    });

    it('refuses publication when the publisher is the approver', async () => {
      const id = await createPublishableTemplate();
      await assert.rejects(() => TaskTemplate.publishVersion(id, APPROVER, {
        publishedByOrganizationId: ORG
      }), (err) => {
        assert.ok(ruleNames(err).includes('SEGREGATION_OF_DUTIES'));
        return true;
      });

      // The refusal must be a refusal to write, not a version left behind.
      const versions = await withConn((conn) => conn.query(
        'SELECT COUNT(*)::int AS n FROM task_template_versions WHERE task_template_id = ?', [id]
      ).then((rows) => rows[0].n));
      assert.strictEqual(versions, 0, 'a refused self-publication must not create a version row');
    });

    it('allows a different authorised publisher', async () => {
      const id = await createPublishableTemplate();
      const result = await TaskTemplate.publishVersion(id, PUBLISHER, { publishedByOrganizationId: ORG });
      assert.ok(result.versionId);
    });

    it('reports every admission failure, not just the first', async () => {
      const id = await createDraftTemplate();
      await assert.rejects(() => TaskTemplate.publishVersion(id, PUBLISHER, {
        publishedByOrganizationId: ORG
      }), (err) => {
        const rules = ruleNames(err);
        assert.ok(rules.includes('NOT_APPROVED'));
        assert.ok(rules.includes('SAFETY_NOT_ASSESSED'));
        assert.ok(rules.includes('EVIDENCE_MISSING'));
        return true;
      });
    });
  });

  // ------------------------------------------ database-level segregation (M1)
  describe('Segregation of duties is enforced by PostgreSQL, not only the service', () => {
    it('rejects direct SQL that names the same principal as approver and publisher', async () => {
      const id = await createDraftTemplate();

      await assert.rejects(
        () => insertGovernedVersionRaw(id, {
          approverUserId: APPROVER,
          publisherUserId: APPROVER
        }),
        /chk_task_template_versions_approver_not_publisher/,
        'a governed published row must not be representable with approver == publisher'
      );
    });

    it('rejects direct SQL with approver == publisher for retired knowledge too', async () => {
      const id = await createDraftTemplate();

      await assert.rejects(
        () => insertGovernedVersionRaw(id, {
          approverUserId: REVIEWER,
          publisherUserId: REVIEWER,
          lifecycle: 'retired'
        }),
        /chk_task_template_versions_approver_not_publisher/
      );
    });

    it('permits direct SQL when approver and publisher are different principals', async () => {
      const id = await createDraftTemplate();
      const versionId = await insertGovernedVersionRaw(id, {
        approverUserId: APPROVER,
        publisherUserId: PUBLISHER
      });

      const [row] = await withConn((conn) => conn.query(
        `SELECT approver_user_id, published_by_user_id FROM task_template_versions WHERE id = ?`,
        [versionId]
      ));
      assert.strictEqual(Number(row.approver_user_id), APPROVER);
      assert.strictEqual(Number(row.published_by_user_id), PUBLISHER);
      assert.notStrictEqual(Number(row.approver_user_id), Number(row.published_by_user_id));
    });

    it('records the publishing principal on the row the service creates', async () => {
      const id = await createPublishableTemplate();
      const result = await TaskTemplate.publishVersion(id, PUBLISHER, { publishedByOrganizationId: ORG });

      const [row] = await withConn((conn) => conn.query(
        `SELECT approver_user_id, published_by_user_id FROM task_template_versions WHERE id = ?`,
        [result.versionId]
      ));
      assert.strictEqual(Number(row.published_by_user_id), PUBLISHER,
        'the service must freeze who published, so the database rule has something to compare');
      assert.strictEqual(Number(row.approver_user_id), APPROVER);
      assert.notStrictEqual(Number(row.approver_user_id), Number(row.published_by_user_id));
    });
  });

  // -------------------------------- publisher accountability is mandatory (M1)
  describe('A governed version cannot exist without an accountable publisher', () => {
    // The name of the row-local constraint that makes an unattributed governed
    // version unrepresentable. Asserting the name keeps this suite honest about
    // WHICH invariant refused the write.
    const PUBLISHER_REQUIRED = /chk_task_template_versions_requires_governance/;

    it('rejects direct SQL for a published version with a NULL publisher', async () => {
      const id = await createDraftTemplate();

      await assert.rejects(
        () => insertGovernedVersionRaw(id, {
          approverUserId: APPROVER,
          publisherUserId: null
        }),
        PUBLISHER_REQUIRED,
        'a published row must not be representable without its accountable publisher'
      );
    });

    it('rejects direct SQL for a superseded version with a NULL publisher', async () => {
      const id = await createDraftTemplate();

      // Migration 009 requires a superseded row to name a published successor in
      // the same template, and that precondition is enforced by a BEFORE trigger
      // — so it must be satisfied here, otherwise the row would be refused for
      // supersession instead of for the missing publisher under test.
      const successorId = await insertGovernedVersionRaw(id, {
        approverUserId: APPROVER,
        publisherUserId: PUBLISHER,
        versionNumber: 1
      });

      await assert.rejects(
        () => insertGovernedVersionRaw(id, {
          approverUserId: APPROVER,
          publisherUserId: null,
          lifecycle: 'superseded',
          versionNumber: 2,
          supersededByVersionId: successorId
        }),
        PUBLISHER_REQUIRED
      );
    });

    it('rejects direct SQL for a retired version with a NULL publisher', async () => {
      const id = await createDraftTemplate();

      await assert.rejects(
        () => insertGovernedVersionRaw(id, {
          approverUserId: APPROVER,
          publisherUserId: null,
          lifecycle: 'retired'
        }),
        PUBLISHER_REQUIRED
      );
    });

    it('permits direct SQL with complete attribution, a publisher, and approver != publisher', async () => {
      const id = await createDraftTemplate();
      const versionId = await insertGovernedVersionRaw(id, {
        approverUserId: APPROVER,
        publisherUserId: PUBLISHER
      });

      const [row] = await withConn((conn) => conn.query(
        `SELECT reviewer_user_id, approver_user_id, published_by_user_id, safety_reviewed_by_user_id
           FROM task_template_versions WHERE id = ?`,
        [versionId]
      ));
      assert.ok(row.reviewer_user_id, 'reviewer attribution must be frozen');
      assert.ok(row.approver_user_id, 'approver attribution must be frozen');
      assert.ok(row.safety_reviewed_by_user_id, 'safety-review attribution must be frozen');
      assert.strictEqual(Number(row.published_by_user_id), PUBLISHER,
        'publisher attribution must be frozen and non-null');
    });

    it('rejects deletion of a user referenced as the publisher of governed knowledge', async () => {
      const id = await createDraftTemplate();
      const publisherId = await createGovernedPublisherUser();
      const versionId = await insertGovernedVersionRaw(id, {
        approverUserId: APPROVER,
        publisherUserId: publisherId
      });

      await assert.rejects(
        () => withConn((conn) => conn.query(`DELETE FROM users WHERE id = ?`, [publisherId])),
        /foreign key|violates|restrict/i,
        'a publisher of immutable governed knowledge must not be deletable'
      );
    });

    it('leaves the frozen attribution intact after a refused publisher deletion', async () => {
      const id = await createDraftTemplate();
      const publisherId = await createGovernedPublisherUser();
      const versionId = await insertGovernedVersionRaw(id, {
        approverUserId: APPROVER,
        publisherUserId: publisherId
      });

      const before = await withConn((conn) => conn.query(
        `SELECT published_by_user_id, approver_user_id FROM task_template_versions WHERE id = ?`, [versionId]
      ).then((rows) => rows[0]));

      await assert.rejects(
        () => withConn((conn) => conn.query(`DELETE FROM users WHERE id = ?`, [publisherId]))
      );

      const after = await withConn((conn) => conn.query(
        `SELECT published_by_user_id, approver_user_id FROM task_template_versions WHERE id = ?`, [versionId]
      ).then((rows) => rows[0]));
      const stillExists = await withConn((conn) => conn.query(
        `SELECT id FROM users WHERE id = ?`, [publisherId]
      ).then((rows) => rows.length));

      assert.strictEqual(Number(after.published_by_user_id), Number(before.published_by_user_id),
        'a refused publisher deletion must not erase the frozen publisher');
      assert.strictEqual(Number(after.approver_user_id), Number(before.approver_user_id));
      assert.strictEqual(stillExists, 1, 'the refused deletion must not remove the user');
    });
  });

  // ------------------------------------------------------------- freeze/stale
  describe('Frozen attribution and approval staleness', () => {
    it('freezes reviewer, approver and safety attribution into the version', async () => {
      const id = await createPublishableTemplate({
        safetyReviewState: 'reviewed_controls_defined', withControls: true
      });
      const result = await TaskTemplate.publishVersion(id, PUBLISHER, { publishedByOrganizationId: ORG });
      const version = await withConn((conn) => conn.query(
        'SELECT * FROM task_template_versions WHERE id = ?', [result.versionId]
      ).then((rows) => rows[0]));

      assert.strictEqual(Number(version.approver_user_id), APPROVER);
      assert.strictEqual(Number(version.reviewer_user_id), APPROVER);
      assert.ok(version.approved_at && version.reviewed_at);
      assert.strictEqual(version.safety_review_state, 'reviewed_controls_defined');
      assert.strictEqual(Number(version.safety_reviewed_by_user_id), REVIEWER);
      assert.ok(version.safety_reviewed_at);
      assert.match(version.approved_content_sha, /^[0-9a-f]{64}$/);
    });

    it('refuses to publish when material content changed after approval', async () => {
      const id = await createPublishableTemplate();
      await withConn((conn) => conn.query(
        `UPDATE task_template_steps SET instruction = 'A materially different instruction'
          WHERE task_template_id = ?`, [id]
      ));

      await assert.rejects(() => TaskTemplate.publishVersion(id, PUBLISHER, {
        publishedByOrganizationId: ORG
      }), (err) => {
        assert.ok(ruleNames(err).includes('APPROVAL_STALE'));
        return true;
      });
    });

    it('does not let later working-template changes alter a published version', async () => {
      const id = await createPublishableTemplate();
      const result = await TaskTemplate.publishVersion(id, PUBLISHER, { publishedByOrganizationId: ORG });

      await TaskTemplate.reopenForRework(id, AUTHOR, ORG).catch(() => {});
      await withConn((conn) => conn.query(
        `UPDATE task_templates SET safety_review_state='not_assessed',
         safety_reviewed_by_user_id=NULL, safety_reviewed_at=NULL,
         approver_user_id=NULL, approved_at=NULL, approved_content_sha=NULL, review_state='draft'
         WHERE id = ?`, [id]
      ));

      const version = await withConn((conn) => conn.query(
        'SELECT * FROM task_template_versions WHERE id = ?', [result.versionId]
      ).then((rows) => rows[0]));

      assert.strictEqual(version.safety_review_state, 'reviewed_no_control_required');
      assert.strictEqual(Number(version.approver_user_id), APPROVER);
      assert.ok(version.approved_content_sha);
    });
  });

  // ---------------------------------------------------------------- atomicity
  describe('Failure atomicity and tenant isolation', () => {
    it('creates no partial version graph when admission fails', async () => {
      const id = await createDraftTemplate();
      await assert.rejects(() => TaskTemplate.publishVersion(id, PUBLISHER, {
        publishedByOrganizationId: ORG
      }));

      const counts = await withConn(async (conn) => {
        const versions = await conn.query(
          'SELECT COUNT(*)::int AS n FROM task_template_versions WHERE task_template_id = ?', [id]);
        return versions[0].n;
      });
      assert.strictEqual(counts, 0, 'no version rows may exist after a failed admission');
    });

    it('leaves the working template editable after a failed admission', async () => {
      const id = await createDraftTemplate();
      await assert.rejects(() => TaskTemplate.publishVersion(id, PUBLISHER, {
        publishedByOrganizationId: ORG
      }));

      const updated = await TaskTemplate.updateIfEditable(id, { template_name: 'Still editable' });
      assert.ok(updated !== undefined);
      const template = await withConn((conn) => conn.query(
        'SELECT template_name, is_editable FROM task_templates WHERE id = ?', [id]
      ).then((rows) => rows[0]));
      assert.strictEqual(template.template_name, 'Still editable');
      assert.strictEqual(template.is_editable, true);
    });

    it('refuses to publish a template from another organization', async () => {
      const id = await createPublishableTemplate();
      await assert.rejects(() => TaskTemplate.publishVersion(id, PUBLISHER, {
        publishedByOrganizationId: ORG_B
      }), /Access denied/);
    });
  });

  // --------------------------------------------------------------- regression
  describe('Existing immutable versioning still holds', () => {
    it('still freezes step versions and refuses to mutate a published version', async () => {
      const id = await createPublishableTemplate();
      const result = await TaskTemplate.publishVersion(id, PUBLISHER, { publishedByOrganizationId: ORG });

      const stepVersions = await withConn((conn) => conn.query(
        'SELECT COUNT(*)::int AS n FROM task_template_step_versions WHERE task_template_version_id = ?',
        [result.versionId]
      ).then((rows) => rows[0].n));
      assert.strictEqual(stepVersions, 1);

      await assert.rejects(
        () => withConn((conn) => conn.query(
          `UPDATE task_template_versions SET template_name = 'hacked' WHERE id = ?`, [result.versionId]
        )),
        /immutable/
      );
    });
  });
});
